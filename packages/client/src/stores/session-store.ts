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
} from "../lib/api-client";
import { streamSessionSSE, type SSEClient } from "../lib/sse-client";

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
  clearError: () => void;
}

type SessionStore = SessionState & SessionActions;

export const useSessionStore = create<SessionStore>((set, get) => ({
  // State
  projects: [],
  activeProjectId: undefined,
  sessions: [],
  projectSessions: {},
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

    const client = streamSessionSSE(sessionId, {
      onEvent: (event) => {
        const state = get();
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
              set((s) => ({
                streamState: {
                  ...s.streamState,
                  text: s.streamState.text + delta,
                },
              }));
            }
            if (assistantEvent?.type === "tool_use_start") {
              set((s) => ({
                streamState: {
                  ...s.streamState,
                  activeToolName: assistantEvent?.name as string | undefined,
                },
              }));
            }
            break;
          }
          case "agent_end": {
            set((s) => ({
              messages: [...s.messages, { role: "assistant", content: s.streamState.text }],
              streamState: { text: "", activeToolName: undefined, isStreaming: false },
            }));
            // Refresh message list for full state
            getSessionMessages(sessionId)
              .then(({ messages }) => set({ messages }))
              .catch(() => {});
            break;
          }
          case "tool_execution_start": {
            set((s) => ({
              streamState: {
                ...s.streamState,
                activeToolName: event.toolName as string | undefined,
              },
            }));
            break;
          }
          case "tool_execution_end": {
            set((s) => ({
              streamState: {
                ...s.streamState,
                activeToolName: undefined,
              },
            }));
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

  clearError: () => set({ error: undefined }),
}));
