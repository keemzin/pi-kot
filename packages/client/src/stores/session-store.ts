import { create } from "zustand";
import {
  type SessionSummary,
  createSession,
  listSessions,
  getSessionMessages,
  sendPrompt,
  abortSession,
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
  /** All known sessions (for sidebar). */
  sessions: SessionSummary[];
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
  createAndActivate: () => Promise<string>;
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
  sessions: [],
  activeSessionId: undefined,
  messages: [],
  streamState: { text: "", activeToolName: undefined, isStreaming: false },
  loading: false,
  error: undefined,
  sseClient: undefined,

  // Actions
  refreshSessions: async () => {
    try {
      const { sessions } = await listSessions();
      set({ sessions });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to list sessions" });
    }
  },

  createAndActivate: async () => {
    set({ loading: true, error: undefined });
    try {
      const res = await createSession({ projectId: "default" });
      const sessions = [...get().sessions, { ...res, isLive: true, messageCount: 0, lastActivityAt: res.createdAt }];
      set({ sessions, activeSessionId: res.sessionId, messages: [], loading: false });
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

    set({ activeSessionId: id, messages: [], streamState: { text: "", activeToolName: undefined, isStreaming: false }, error: undefined });

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
