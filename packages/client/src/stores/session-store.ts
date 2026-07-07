import { create } from "zustand";
import {
  type SessionSummary,
  type Project,
  type ImageContent,
  createSession,
  listSessions,
  getSessionMessages,
  sendPrompt,
  abortSession,
  steerSession,
  fetchProjects,
  renameSession as renameSessionAPI,
  archiveSession as archiveSessionAPI,
  unarchiveSession as unarchiveSessionAPI,
  deleteProjectAPI,
  compactSession,
  getCompactions,
} from "../lib/api-client";
import type { CompactionEvent } from "../lib/api-client";
import { streamSessionSSE, type SSEClient } from "../lib/sse-client";
import { useAskUserQuestionStore } from "./ask-user-question-store";
import { useExtensionUIStore } from "./extension-ui-store";

export const EMPTY_MESSAGES: unknown[] = [];
export const EMPTY_COMPACTIONS: CompactionEvent[] = [];
export const EMPTY_QUEUED: { steering: string[]; followUp: string[] } = {
  steering: [],
  followUp: [],
};

// ── localStorage persistence keys ──

const ACTIVE_PROJECT_KEY = "pi-kot/active-project-id";
const ACTIVE_SESSION_KEY = "pi-kot/active-session-id";

function getInitialActiveProjectId(): string | undefined {
  try {
    // URL hash takes priority (deep link / bookmark)
    const hash = window.location.hash;
    const m = hash.match(/^#\/project\/([^/]+)/);
    if (m) return m[1];
    return localStorage.getItem(ACTIVE_PROJECT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function getInitialActiveSessionId(): string | undefined {
  try {
    const hash = window.location.hash;
    const m = hash.match(/^#\/project\/[^/]+\/session\/([^/]+)/);
    if (m) return m[1];
    return localStorage.getItem(ACTIVE_SESSION_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

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
  /** Per-session compaction archive from GET /sessions/:id/compactions. */
  compactionsBySession: Record<string, CompactionEvent[]>;
  /** Per-session monotonic counter bumped on every compaction_end event. */
  compactionEndCountBySession: Record<string, number>;
  /** Pending steer/followUp messages per session (from SSE queued event). */
  queuedBySession: Record<string, { steering: string[]; followUp: string[] } | undefined>;
  /** Streaming state per session. */
  streamState: StreamState;
  /** Whether we're loading. */
  loading: boolean;
  /** Error message, if any. */
  error: string | undefined;
  /** SSE client handle (for cleanup). */
  sseClient: SSEClient | undefined;
  /** SSE connection state for the active session. */
  connectionState: "disconnected" | "connecting" | "connected" | "error";
}

interface SessionActions {
  loadProjects: () => Promise<void>;
  setActiveProject: (id: string) => Promise<void>;
  loadProjectSessions: (projectId: string) => Promise<void>;
  createAndActivate: (projectId?: string) => Promise<string>;
  setActiveSession: (id: string) => Promise<void>;
  connectSSE: (sessionId: string) => void;
  sendPrompt: (text: string, images?: ImageContent[]) => Promise<void>;
  sendSteer: (text: string, images?: ImageContent[]) => Promise<void>;
  abort: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  renameSession: (sessionId: string, name: string) => Promise<void>;
  archiveSession: (sessionId: string) => Promise<void>;
  unarchiveSession: (sessionId: string, projectId: string) => Promise<void>;
  loadArchivedSessions: (projectId: string) => Promise<void>;
  loadCompactions: (sessionId: string) => Promise<void>;
  compactAndReload: (sessionId: string) => Promise<{ summary: string; tokensBefore: number }>;
  reloadMessages: (sessionId: string) => Promise<void>;
  clearError: () => void;
  deleteProject: (id: string) => Promise<void>;
}

type SessionStore = SessionState & SessionActions;

export const useSessionStore = create<SessionStore>((set, get) => ({
  // State
  projects: [],
  activeProjectId: getInitialActiveProjectId(),
  sessions: [],
  projectSessions: {},
  archivedSessions: {},
  activeSessionId: getInitialActiveSessionId(),
  messages: [],
  compactionsBySession: {},
  compactionEndCountBySession: {},
  queuedBySession: {},
  streamState: { text: "", activeToolName: undefined, isStreaming: false },
  loading: false,
  error: undefined,
  sseClient: undefined,
  connectionState: "disconnected",

  // Actions
  loadProjects: async () => {
    try {
      const { projects } = await fetchProjects();
      const state = get();
      let nextProjectId = state.activeProjectId;

      // Validate stored project still exists on the server
      if (nextProjectId !== undefined && !projects.some((p) => p.id === nextProjectId)) {
        nextProjectId = undefined;
      }

      // Auto-select first project if none active and projects exist
      if (nextProjectId === undefined && projects.length > 0) {
        nextProjectId = projects[0].id;
      }

      set({ projects, activeProjectId: nextProjectId });

      if (nextProjectId !== undefined) {
        try {
          localStorage.setItem(ACTIVE_PROJECT_KEY, nextProjectId);
        } catch { /* private mode */ }
        await get().loadProjectSessions(nextProjectId);
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to load projects" });
    }
  },

  setActiveProject: async (id: string) => {
    try {
      localStorage.setItem(ACTIVE_PROJECT_KEY, id);
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch { /* private mode */ }
    set({ activeProjectId: id, activeSessionId: undefined, messages: [] });
    // Disconnect old SSE
    const old = get().sseClient;
    old?.close();
    set({ sseClient: undefined, connectionState: "disconnected" });
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
      try {
        localStorage.setItem(ACTIVE_SESSION_KEY, res.sessionId);
      } catch { /* private mode */ }
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
    try {
      localStorage.setItem(ACTIVE_SESSION_KEY, id);
    } catch { /* private mode */ }
    // Disconnect old SSE
    const old = get().sseClient;
    old?.close();

    set({
      activeSessionId: id,
      messages: [],
      streamState: { text: "", activeToolName: undefined, isStreaming: false },
      queuedBySession: {},
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
    set({ connectionState: "connecting" });

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

    // Load the per-compaction archive on open so historical
    // CompactionCards render immediately.
    void get().loadCompactions(sessionId);

    const client = streamSessionSSE(sessionId, {
      onEvent: (event) => {
        // Any event means the connection is alive
        set({ connectionState: "connected" });
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
          case "compaction_start": {
            // Show a brief banner so the user knows compaction is in progress.
            // On manual compact there's already a "Compacting…" state in
            // ChatInput, but auto-compact (context overflow) needs this.
            set((s) => ({
              streamState: {
                ...s.streamState,
                activeToolName: "compacting…",
              },
            }));
            break;
          }
          case "compaction_end": {
            // Clear the compacting indicator.
            set((s) => ({
              streamState: {
                ...s.streamState,
                activeToolName: undefined,
              },
              // Bump the compaction-end counter so panels that need to
              // react (e.g. ContextInspectorPanel re-fetching token
              // usage) get a stable signal.
              compactionEndCountBySession: {
                ...s.compactionEndCountBySession,
                [sessionId]: (s.compactionEndCountBySession[sessionId] ?? 0) + 1,
              },
            }));
            // Refetch compactions FIRST so the card data is available,
            // then refetch messages. If messages update before compactions
            // arrive, the ChatView renders post-compaction messages without
            // the CompactionCard — a brief flash of ungrouped tool calls.
            void get().loadCompactions(sessionId).then(() => {
              refetchMessages();
            });
            break;
          }
          case "queued": {
            const ev = event as { steering?: unknown; followUp?: unknown };
            const steering = Array.isArray(ev.steering)
              ? (ev.steering as unknown[]).filter((v): v is string => typeof v === "string")
              : [];
            const followUp = Array.isArray(ev.followUp)
              ? (ev.followUp as unknown[]).filter((v): v is string => typeof v === "string")
              : [];
            set((s) => ({
              queuedBySession: {
                ...s.queuedBySession,
                [sessionId]:
                  steering.length === 0 && followUp.length === 0
                    ? undefined
                    : { steering, followUp },
              },
            }));
            break;
          }
          case "agent_end": {
            // Flush any remaining text delta
            if (rafId !== undefined) {
              cancelAnimationFrame(rafId);
              rafId = undefined;
            }
            flushDelta();

            const agentEndEv = event as Record<string, unknown>;
            const willRetry = agentEndEv.willRetry === true;

            if (willRetry) {
              // SDK auto-retry will restart the agent — keep isStreaming true
              // so the abort button stays visible throughout the retry cycle.
              // Without this, isStreaming toggles off then immediately on
              // (agent_end → agent_start), causing the UI buttons to flicker.
              set((s) => ({
                streamState: {
                  ...s.streamState,
                  text: "",
                },
              }));
            } else {
              // Surface error from the final failed attempt, if any.
              // The SDK puts errorMessage at the event top level only for
              // synthetic agent_end (promise rejection). For real agent_end
              // events, it's in the last assistant message's errorMessage.
              let errorMessage = agentEndEv.errorMessage as string | undefined;
              if (!errorMessage) {
                const msgs = agentEndEv.messages as unknown[] | undefined;
                if (msgs && msgs.length > 0) {
                  const last = msgs[msgs.length - 1] as Record<string, unknown> | undefined;
                  if (last?.role === "assistant" && last?.stopReason === "error") {
                    errorMessage = last.errorMessage as string | undefined;
                  }
                }
              }

              // Stop streaming
              set({
                streamState: {
                  text: "",
                  activeToolName: undefined,
                  isStreaming: false,
                },
              });

              // Show error from failed LLM calls (out of credit, etc.)
              if (errorMessage) {
                set({ error: errorMessage });
              }

              // Clear queued on final agent end
              set((s) => ({
                queuedBySession: { ...s.queuedBySession, [sessionId]: undefined },
              }));
            }

            refetchMessages();
            break;
          }
          case "message_end": {
            // Flush any remaining text delta, then clear stream text
            // so the next assistant message starts with a fresh buffer.
            // Without this, text from multiple messages accumulates into
            // one blob in the streaming bubble at the bottom, making it
            // look like all agent text "bleeds into 1" across tool calls.
            if (rafId !== undefined) {
              cancelAnimationFrame(rafId);
              rafId = undefined;
            }
            flushDelta();
            set((s) => ({
              streamState: {
                ...s.streamState,
                text: "",
              },
            }));
            refetchMessages();
            break;
          }
          case "auto_retry_start": {
            const retryEv = event as Record<string, unknown>;
            const attempt = retryEv.attempt ?? "?";
            const maxAttempts = retryEv.maxAttempts ?? "?";
            const errMsg = (retryEv.errorMessage as string) ?? "Unknown error";
            set({ error: `Model error — retrying (${attempt}/${maxAttempts}): ${errMsg}` });
            break;
          }

          case "auto_retry_end": {
            const retryEndEv = event as Record<string, unknown>;
            if (retryEndEv.success === true) {
              // Retry succeeded — clear the error banner
              set({ error: undefined });
            } else {
              // All retries exhausted — show the final error from the provider
              const finalError = retryEndEv.finalError as string | undefined;
              if (finalError) {
                set({ error: finalError });
              }
            }
            break;
          }

          case "tool_result": {
            // Refetch to show the toolResult block inline in the
            // rendered messages. Don't clear stream text — the agent
            // may continue writing (same message) after analyzing the result.
            if (rafId !== undefined) {
              cancelAnimationFrame(rafId);
              rafId = undefined;
            }
            flushDelta();
            refetchMessages();
            break;
          }
          // ── Extension UI bridge events ──
          case "extension_ui_select":
          case "extension_ui_confirm":
          case "extension_ui_input":
          case "extension_ui_notify":
          case "extension_ui_done": {
            useExtensionUIStore.getState().pushEvent(
              event as unknown as import("../stores/extension-ui-store").ExtensionUIEvent,
            );
            break;
          }
          // ── Streaming exec events (!cmd / !!cmd live terminal) ──
          case "exec_start": {
            const { command, excludeFromContext } = event as unknown as {
              command: string;
              excludeFromContext: boolean;
            };
            // Push an optimistic bashExecution message that streams live
            const optimisticMsg = {
              role: "bashExecution",
              command,
              output: "",
              exitCode: undefined as number | undefined, // undefined = running
              cancelled: false,
              truncated: false,
              excludeFromContext,
              timestamp: Date.now(),
              _pendingExec: true, // marker for the UI to show cancel button
            };
            set((s) => ({
              messages: [...s.messages, optimisticMsg],
            }));
            break;
          }
          case "exec_update": {
            const { output } = event as unknown as { output: string };
            set((s) => {
              const msgs = [...s.messages];
              const last = msgs[msgs.length - 1];
              if (last && (last as Record<string, unknown>)._pendingExec) {
                (last as Record<string, unknown>).output = ((last as Record<string, unknown>).output as string ?? "") + output;
              }
              return { messages: msgs };
            });
            break;
          }
          case "exec_end": {
            const { exitCode, output, error, cancelled: execCancelled } = event as unknown as {
              exitCode: number | null;
              output: string;
              error?: string;
              cancelled?: boolean;
            };
            set((s) => {
              const msgs = [...s.messages];
              const last = msgs[msgs.length - 1];
              if (last && (last as Record<string, unknown>)._pendingExec) {
                const m = last as Record<string, unknown>;
                if (execCancelled) {
                  m.cancelled = true;
                  m.exitCode = exitCode; // null for killed process — fine, cancelled takes priority in UI
                } else {
                  m.exitCode = exitCode;
                  m.cancelled = false;
                }
                m.output = error ? `${m.output as string}${output}\n\n[error] ${error}` : output;
                m.truncated = false;
              }
              return { messages: msgs };
            });
            const sid = get().activeSessionId;
            if (sid !== undefined) {
              setTimeout(() => get().reloadMessages(sid), 500);
            }
            break;
          }
        }
      },
      onReconnect: ({ attempt }) => {
        set({ connectionState: "connecting" });
        if (attempt > 1) {
          set({ error: `Reconnecting... (attempt ${attempt})` });
        }
      },
      onClose: () => {
        set({ connectionState: "disconnected" });
      },
    });

    set({ sseClient: client });
  },

  sendPrompt: async (text: string, images?: ImageContent[]) => {
    const { activeSessionId } = get();
    if (activeSessionId === undefined) return;

    // Add user message immediately (optimistic)
    const optimisticContent: Record<string, unknown>[] = [{ type: "text", text }];
    if (images !== undefined && images.length > 0) {
      for (const img of images) {
        // Use the base64 data as a data URL for the optimistic preview
        optimisticContent.push({
          type: "image",
          mimeType: img.mimeType,
          data: `data:${img.mimeType};base64,${img.data}`,
          __blobUrl: true,
        });
      }
    }

    set((s) => ({
      messages: [
        ...s.messages,
        { role: "user", content: optimisticContent },
      ],
    }));

    try {
      await sendPrompt(activeSessionId, text, undefined, images);
    } catch (err) {
      set((s) => ({
        error: err instanceof Error ? err.message : "Failed to send prompt",
        // If an existing stream was active, reset it
        streamState: s.streamState.isStreaming
          ? { text: "", activeToolName: undefined, isStreaming: false }
          : s.streamState,
      }));
    }
  },

  sendSteer: async (text: string, images?: ImageContent[]) => {
    const { activeSessionId } = get();
    if (activeSessionId === undefined) return;

    // Build optimistic content
    const optimisticContent: Record<string, unknown>[] = [{ type: "text", text }];
    if (images !== undefined && images.length > 0) {
      for (const img of images) {
        optimisticContent.push({
          type: "image",
          mimeType: img.mimeType,
          data: `data:${img.mimeType};base64,${img.data}`,
          __blobUrl: true,
        });
      }
    }

    // Add user message immediately with metadata.steer=true
    set((s) => ({
      messages: [
        ...s.messages,
        { role: "user", content: optimisticContent, metadata: { steer: true } },
      ],
    }));

    try {
      await steerSession(activeSessionId, text, "steer", images);
    } catch (err) {
      set((s) => ({
        error: err instanceof Error ? err.message : "Failed to steer",
        // If an existing stream was active, reset it
        streamState: s.streamState.isStreaming
          ? { text: "", activeToolName: undefined, isStreaming: false }
          : s.streamState,
      }));
    }
  },

  abort: async () => {
    const { activeSessionId } = get();
    if (activeSessionId === undefined) return;

    // Optimistically reset streaming state so the UI responds immediately
    // (abort button disappears, send button reappears). The SSE agent_end
    // will confirm this, but we don't wait for it.
    set({
      streamState: {
        text: "",
        activeToolName: undefined,
        isStreaming: false,
      },
    });

    try {
      await abortSession(activeSessionId);
    } catch {
      // best-effort — SSE events will eventually confirm the state
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
      const wasActive = get().activeSessionId === sessionId;
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
      if (wasActive) {
        try {
          localStorage.removeItem(ACTIVE_SESSION_KEY);
        } catch { /* private mode */ }
      }
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

  loadCompactions: async (sessionId: string) => {
    try {
      const { compactions } = await getCompactions(sessionId);
      set((s) => ({
        compactionsBySession: { ...s.compactionsBySession, [sessionId]: compactions },
      }));
    } catch {
      // Non-fatal — chat just renders without the cards.
    }
  },

  compactAndReload: async (sessionId: string) => {
    // Call the compact API. If it succeeds, also refetch messages and
    // compactions so the ChatView updates even if SSE compaction_end
    // events don't fire (race on manual compact).
    // Load compactions FIRST, then messages — prevents a flash where
    // post-compaction messages render without the CompactionCard.
    const result = await compactSession(sessionId);
    await get().loadCompactions(sessionId);
    await get().reloadMessages(sessionId);
    return result;
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
      if (state.activeProjectId === id) {
        try {
          localStorage.removeItem(ACTIVE_PROJECT_KEY);
          localStorage.removeItem(ACTIVE_SESSION_KEY);
        } catch { /* private mode */ }
      }
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
