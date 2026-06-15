import { create } from "zustand";
import {
  type SessionSummary,
  type Project,
  createSession,
  listSessions,
  getSessionMessages,
  sendPrompt,
  abortSession,
  fetchProjects,
  renameSession as renameSessionAPI,
  archiveSession as archiveSessionAPI,
  unarchiveSession as unarchiveSessionAPI,
  deleteProjectAPI,
} from "../lib/api-client";
import { streamSessionSSE, type SSEClient } from "../lib/sse-client";
import { useAskUserQuestionStore } from "./ask-user-question-store";

export const EMPTY_MESSAGES: unknown[] = [];

export interface MessageLike {
  role?: string;
  content?: unknown;
  [k: string]: unknown;
}

interface StreamState {
  text: string;
  activeToolName: string | undefined;
  isStreaming: boolean;
}

interface SessionState {
  /** All known projects. */
  projects: Project[];
  /** Currently active project ID. */
  activeProjectId: string | undefined;
  /** All known sessions (flat, for sidebar). */
  sessions: SessionSummary[];
  /** Sessions per project (loaded by loadProjectSessions). */
  projectSessions: Record<string, SessionSummary[]>;
  /** Archived sessions per project. */
  archivedSessions: Record<string, SessionSummary[]>;
  /** Currently active session ID. */
  activeSessionId: string | undefined;
  /** Messages for the active session. */
  messages: unknown[];
  /** Streaming state per session. */
  streamState: StreamState;
  /** Whether we're loading. */
  loading: boolean;
  /** Error message, if any. */
  error: string | undefined;
  /** SSE client handle (for cleanup). */
  sseClient: SSEClient | undefined;
}

interface SessionActions {
  loadProjects: () => Promise<void>;
  setActiveProject: (id: string) => Promise<void>;
  loadProjectSessions: (projectId: string) => Promise<void>;
  createAndActivate: (projectId?: string) => Promise<string>;
  setActiveSession: (id: string) => Promise<void>;
  connectSSE: (sessionId: string) => void;
  sendPrompt: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  renameSession: (sessionId: string, name: string) => Promise<void>;
  archiveSession: (sessionId: string) => Promise<void>;
  unarchiveSession: (sessionId: string, projectId: string) => Promise<void>;
  loadArchivedSessions: (projectId: string) => Promise<void>;
  reloadMessages: (sessionId: string) => Promise<void>;
  clearError: () => void;
  deleteProject: (id: string) => Promise<void>;
}

type SessionStore = SessionState & SessionActions;

export const useSessionStore = create<SessionStore>((set, get) => ({
  // State
  projects: [],
  activeProjectId: undefined,
  sessions: [],
  projectSessions: {},
  archivedSessions: {},
  activeSessionId: undefined,
  messages: [],
  streamState: { text: "", activeToolName: undefined, isStreaming: false },
  loading: false,
  error: undefined,
  sseClient: undefined,

  // Actions
  loadProjects: async () => {
    try {
      const { projects } = await fetchProjects();
      set({ projects });
      // Auto-select first project if none active and projects exist
      const state = get();
      if (state.activeProjectId === undefined && projects.length > 0) {
        const firstId = projects[0].id;
        set({ activeProjectId: firstId });
        await get().loadProjectSessions(firstId);
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to load projects" });
    }
  },

  setActiveProject: async (id: string) => {
    set({ activeProjectId: id, activeSessionId: undefined, messages: [] });
    // Disconnect old SSE
    const old = get().sseClient;
    old?.close();
    set({ sseClient: undefined });
    await get().loadProjectSessions(id);
  },

  loadProjectSessions: async (projectId: string) => {
    try {
      const { sessions } = await listSessions(projectId);
      set((s) => ({
        projectSessions: { ...s.projectSessions, [projectId]: sessions },
        sessions,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to load sessions" });
    }
  },

  refreshSessions: async () => {
    const { activeProjectId } = get();
    if (activeProjectId !== undefined) {
      await get().loadProjectSessions(activeProjectId);
    }
  },

  createAndActivate: async (projectId?: string) => {
    set({ loading: true, error: undefined });
    const pid = projectId ?? get().activeProjectId ?? "default";
    try {
      const res = await createSession({ projectId: pid });
      const summary: SessionSummary = {
        sessionId: res.sessionId,
        projectId: res.projectId,
        isLive: true,
        messageCount: 0,
        lastActivityAt: res.createdAt,
        createdAt: res.createdAt,
      };
      set((s) => ({
        sessions: [summary, ...s.sessions],
        projectSessions: s.activeProjectId
          ? { ...s.projectSessions, [s.activeProjectId]: [summary, ...(s.projectSessions[s.activeProjectId] ?? [])] }
          : s.projectSessions,
        activeSessionId: res.sessionId,
        messages: [],
        loading: false,
      }));
      get().connectSSE(res.sessionId);
      return res.sessionId;
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to create session",
      });
      return "";
    }
  },

  setActiveSession: async (id: string) => {
    // Disconnect old SSE
    const old = get().sseClient;
    old?.close();

    set({
      activeSessionId: id,
      messages: [],
      streamState: { text: "", activeToolName: undefined, isStreaming: false },
      error: undefined,
    });

    // Load messages
    try {
      const { messages } = await getSessionMessages(id);
      set({ messages });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to load messages" });
    }

    // Connect SSE
    get().connectSSE(id);
  },

  connectSSE: (sessionId: string) => {
    const old = get().sseClient;
    old?.close();

    // RAF-coalesced text delta buffer (like forge)
    let pendingDelta = "";
    let rafId: number | undefined;
    const flushDelta = () => {
      rafId = undefined;
      const text = pendingDelta;
      if (text.length === 0) return;
      pendingDelta = "";
      set((s) => ({
        streamState: {
          ...s.streamState,
          text: s.streamState.text + text,
        },
      }));
    };

    // Debounced message refetch (like forge's scheduleMessagesRefetch)
    let refetchInflight = false;
    let refetchQueued = false;
    const refetchMessages = () => {
      if (refetchInflight) {
        refetchQueued = true;
        return;
      }
      refetchInflight = true;
      getSessionMessages(sessionId)
        .then(({ messages }) => {
          set({ messages });
        })
        .catch(() => {})
        .finally(() => {
          if (refetchQueued) {
            refetchQueued = false;
            refetchInflight = false;
            refetchMessages();
          } else {
            refetchInflight = false;
          }
        });
    };

    const client = streamSessionSSE(sessionId, {
      onEvent: (event) => {
        switch (event.type) {
          case "snapshot": {
            const msgs = (event.messages as unknown[]) ?? [];
            set({
              messages: msgs,
              streamState: {
                text: "",
                activeToolName: undefined,
                isStreaming: event.isStreaming === true,
              },
            });
            break;
          }
          case "agent_start": {
            set({
              streamState: {
                text: "",
                activeToolName: undefined,
                isStreaming: true,
              },
            });
            break;
          }
          case "message_update": {
            const assistantEvent = event.assistantMessageEvent as Record<string, unknown> | undefined;
            if (assistantEvent?.type === "text_delta") {
              const delta = assistantEvent.delta as string;
              if (delta) {
                // RAF-coalesce like forge: accumulate, flush once per frame
                pendingDelta += delta;
                if (rafId === undefined) {
                  rafId = requestAnimationFrame(flushDelta);
                }
              }
            }
            // tool_use_start etc are handled by refetching messages —
            // the SDK finalizes the assistant message with toolCall
            // blocks before emitting tool_execution_start.
            break;
          }
          case "tool_execution_start": {
            set((s) => ({
              streamState: {
                ...s.streamState,
                activeToolName: event.toolName as string | undefined,
              },
            }));
            // Refetch so the toolCall block appears in messages immediately
            refetchMessages();
            break;
          }
          case "tool_execution_end": {
            set((s) => ({
              streamState: {
                ...s.streamState,
                activeToolName: undefined,
              },
            }));
            // Refetch so the toolResult appears in messages
            refetchMessages();
            break;
          }
          case "ask_user_question": {
            const { requestId, questions } = event as unknown as {
              requestId: string;
              questions: import("../lib/api-client").AskQuestion[];
            };
            useAskUserQuestionStore.getState().setPending({
              requestId,
              sessionId,
              questions,
            });
            break;
          }
          case "ask_user_question_cancelled": {
            const { requestId: cancelledId } = event as unknown as {
              requestId: string;
            };
            useAskUserQuestionStore.getState().clearPending(sessionId, cancelledId);
            break;
          }
          case "agent_end": {
            // Flush any remaining text delta
            if (rafId !== undefined) {
              cancelAnimationFrame(rafId);
              rafId = undefined;
            }
            flushDelta();
            // Stop streaming and refetch the final message state
            set({
              streamState: {
                text: "",
                activeToolName: undefined,
                isStreaming: false,
              },
            });
            refetchMessages();
            break;
          }
          case "message_end":
          case "tool_result": {
            // Refetch to get the latest message state (toolResult blocks,
            // updated assistant message). Don't stop streaming — the agent
            // may still be running.
            if (rafId !== undefined) {
              cancelAnimationFrame(rafId);
              rafId = undefined;
            }
            flushDelta();
            refetchMessages();
            break;
          }
        }
      },
      onReconnect: ({ attempt }) => {
        if (attempt > 1) {
          set({ error: `Reconnecting... (attempt ${attempt})` });
        }
      },
      onClose: () => {
        // SSE connection fully closed
      },
    });

    set({ sseClient: client });
  },

  sendPrompt: async (text: string) => {
    const { activeSessionId } = get();
    if (activeSessionId === undefined) return;

    // Add user message immediately
    set((s) => ({
      messages: [...s.messages, { role: "user", content: text }],
    }));

    try {
      await sendPrompt(activeSessionId, text);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to send prompt" });
    }
  },

  abort: async () => {
    const { activeSessionId } = get();
    if (activeSessionId === undefined) return;
    try {
      await abortSession(activeSessionId);
    } catch {
      // best-effort
    }
  },

  renameSession: async (sessionId: string, name: string) => {
    try {
      await renameSessionAPI(sessionId, name);
      // Update local state
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.sessionId === sessionId ? { ...sess, name } : sess,
        ),
        projectSessions: Object.fromEntries(
          Object.entries(s.projectSessions).map(([pid, sessions]) => [
            pid,
            sessions.map((sess) =>
              sess.sessionId === sessionId ? { ...sess, name } : sess,
            ),
          ]),
        ),
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to rename session" });
    }
  },

  archiveSession: async (sessionId: string) => {
    // Find the projectId from local state
    const state = get();
    const session = state.sessions.find((s) => s.sessionId === sessionId);
    const projectId = session?.projectId ?? state.activeProjectId;
    try {
      await archiveSessionAPI(sessionId, projectId);
      // Remove from local state
      set((s) => ({
        sessions: s.sessions.filter((sess) => sess.sessionId !== sessionId),
        projectSessions: projectId
          ? {
              ...s.projectSessions,
              [projectId]: (s.projectSessions[projectId] ?? []).filter(
                (sess) => sess.sessionId !== sessionId,
              ),
            }
          : s.projectSessions,
        activeSessionId:
          s.activeSessionId === sessionId ? undefined : s.activeSessionId,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to archive session" });
    }
  },

  unarchiveSession: async (sessionId: string, projectId: string) => {
    try {
      await unarchiveSessionAPI(sessionId, projectId);
      // Reload both active and archived sessions
      await get().loadProjectSessions(projectId);
      await get().loadArchivedSessions(projectId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to restore session" });
    }
  },

  loadArchivedSessions: async (projectId: string) => {
    try {
      const { listArchivedSessions } = await import("../lib/api-client");
      const { sessions } = await listArchivedSessions(projectId);
      set((s) => ({
        archivedSessions: { ...s.archivedSessions, [projectId]: sessions },
      }));
    } catch {
      // silently fail
    }
  },

  reloadMessages: async (sessionId: string) => {
    try {
      const { getSessionMessages } = await import("../lib/api-client");
      const { messages } = await getSessionMessages(sessionId);
      set({ messages });
    } catch {
      // silently fail — next SSE snapshot will fix it
    }
  },

  clearError: () => set({ error: undefined }),

  deleteProject: async (id: string) => {
    try {
      await deleteProjectAPI(id);
      const state = get();
      let nextActiveProjectId: string | undefined = state.activeProjectId;
      let nextSessions: SessionSummary[] = state.sessions;
      if (state.activeProjectId === id) {
        nextActiveProjectId = undefined;
        nextSessions = [];
      }
      const old = get().sseClient;
      old?.close();
      const { projects } = await fetchProjects();
      if (nextActiveProjectId === undefined && projects.length > 0) {
        nextActiveProjectId = projects[0].id;
        const { sessions } = await listSessions(nextActiveProjectId);
        nextSessions = sessions;
      }
      set({
        projects,
        activeProjectId: nextActiveProjectId,
        activeSessionId: undefined,
        messages: [],
        sessions: nextSessions,
        projectSessions: nextActiveProjectId
          ? { [nextActiveProjectId]: nextSessions }
          : {},
        sseClient: undefined,
        streamState: { text: "", activeToolName: undefined, isStreaming: false },
        error: undefined,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to delete project" });
    }
  },

  // ── Session Tree / Navigate / Fork ──

  getSessionTree: async (sessionId: string) => {
    const { getSessionTree: api } = await import("../lib/api-client");
    return api(sessionId);
  },

  navigateSession: async (
    sessionId: string,
    entryId: string,
    opts?: { summarize?: boolean; customInstructions?: string; label?: string },
  ) => {
    const { navigateSession: api } = await import("../lib/api-client");
    return api(sessionId, entryId, opts);
  },

  forkSession: async (sessionId: string, entryId: string) => {
    const { forkSession: api } = await import("../lib/api-client");
    return api(sessionId, entryId);
  },
}));
