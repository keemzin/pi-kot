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
	reorderProjectsAPI,
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

const ACTIVE_PROJECT_KEY = "pi-kot/active-project-id";
const ACTIVE_SESSION_KEY = "pi-kot/active-session-id";

function getInitialActiveProjectId(): string | undefined {
	try {
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

export interface ActiveCompaction {
	reason: "manual" | "threshold" | "overflow";
	startedAt: number;
	/** Set when compaction_end fires — transitions notice to done state */
	completedAt?: number;
	aborted?: boolean;
	errorMessage?: string;
	tokensBefore?: number;
	estimatedTokensAfter?: number;
}

interface SessionState {
	projects: Project[];
	activeProjectId: string | undefined;
	sessions: SessionSummary[];
	projectSessions: Record<string, SessionSummary[]>;
	archivedSessions: Record<string, SessionSummary[]>;
	activeSessionId: string | undefined;
	/** Raw SDK messages for the active session. */
	messages: unknown[];
	compactionsBySession: Record<string, CompactionEvent[]>;
	compactionEndCountBySession: Record<string, number>;
	activeCompaction: ActiveCompaction | null;
	queuedBySession: Record<
		string,
		{ steering: string[]; followUp: string[] } | undefined
	>;
	streamState: StreamState;
	/** Raw streaming SDK message (from message_update). Rendered directly by ChatView. */
	streamingMessage: Record<string, unknown> | undefined;
	isStreaming: boolean;
	loading: boolean;
	error: string | undefined;
	sseClient: SSEClient | undefined;
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
	compactAndReload: (
		sessionId: string,
	) => Promise<{ summary: string; tokensBefore: number }>;
	reloadMessages: (sessionId: string) => Promise<void>;
	clearError: () => void;
	deleteProject: (id: string) => Promise<void>;
	reorderProjects: (ids: string[]) => Promise<void>;
	moveProject: (id: string, direction: "up" | "down") => Promise<void>;
	getSessionTree: (sessionId: string) => Promise<unknown>;
	navigateSession: (
		sessionId: string,
		entryId: string,
		opts?: { summarize?: boolean; customInstructions?: string; label?: string },
	) => Promise<{
		editorText?: string;
		cancelled: boolean;
		summaryEntry?: unknown;
	}>;
	forkSession: (
		sessionId: string,
		entryId: string,
	) => Promise<{ sessionId: string }>;
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
	activeCompaction: null,
	streamingMessage: undefined,
	isStreaming: false,
	loading: false,
	error: undefined,
	sseClient: undefined,
	connectionState: "disconnected",

	// ── Actions ──

	loadProjects: async () => {
		try {
			const { projects } = await fetchProjects();
			const state = get();
			let nextProjectId = state.activeProjectId;

			if (
				nextProjectId !== undefined &&
				!projects.some((p) => p.id === nextProjectId)
			) {
				nextProjectId = undefined;
			}
			if (nextProjectId === undefined && projects.length > 0) {
				nextProjectId = projects[0].id;
			}

			set({ projects, activeProjectId: nextProjectId });

			if (nextProjectId !== undefined) {
				try {
					localStorage.setItem(ACTIVE_PROJECT_KEY, nextProjectId);
				} catch {
					/* private */
				}
				await get().loadProjectSessions(nextProjectId);
			}
		} catch (err) {
			set({
				error: err instanceof Error ? err.message : "Failed to load projects",
			});
		}
	},

	setActiveProject: async (id: string) => {
		try {
			localStorage.setItem(ACTIVE_PROJECT_KEY, id);
			localStorage.removeItem(ACTIVE_SESSION_KEY);
		} catch {
			/* private */
		}
		set({ activeProjectId: id, activeSessionId: undefined, messages: [] });
		const old = get().sseClient;
		old?.close();
		set({ sseClient: undefined, connectionState: "disconnected" });
		await get().loadProjectSessions(id);
	},

	loadProjectSessions: async (projectId) => {
		try {
			const { sessions } = await listSessions(projectId);
			set((s) => ({
				projectSessions: { ...s.projectSessions, [projectId]: sessions },
				sessions,
			}));
		} catch (err) {
			set({
				error: err instanceof Error ? err.message : "Failed to load sessions",
			});
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
					? {
							...s.projectSessions,
							[s.activeProjectId]: [
								summary,
								...(s.projectSessions[s.activeProjectId] ?? []),
							],
						}
					: s.projectSessions,
				activeSessionId: res.sessionId,
				messages: [],
				loading: false,
			}));
			try {
				localStorage.setItem(ACTIVE_SESSION_KEY, res.sessionId);
			} catch {
				/* private */
			}
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
		} catch {
			/* private */
		}
		const old = get().sseClient;
		old?.close();
		set({
			activeSessionId: id,
			messages: [],
			streamState: { text: "", activeToolName: undefined, isStreaming: false },
			activeCompaction: null,
			streamingMessage: undefined,
			isStreaming: false,
			queuedBySession: {},
			error: undefined,
		});

		// Load messages
		try {
			const { messages } = await getSessionMessages(id);
			set({ messages, streamingMessage: undefined });
		} catch (err) {
			set({
				error: err instanceof Error ? err.message : "Failed to load messages",
			});
		}

		// Connect SSE
		get().connectSSE(id);
	},

	connectSSE: (sessionId: string) => {
		const old = get().sseClient;
		old?.close();
		set({ connectionState: "connecting" });

		// RAF-coalesced partial message (raw SDK message, no normalization)
		let rafPartialId: number | undefined;
		let pendingPartial: Record<string, unknown> | undefined;

		const flushPartial = () => {
			rafPartialId = undefined;
			if (pendingPartial === undefined) return;
			set({
				streamingMessage: pendingPartial,
				isStreaming: true,
			});
			pendingPartial = undefined;
		};

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

		void get().loadCompactions(sessionId);

		const client = streamSessionSSE(sessionId, {
			onEvent: (event) => {
				set({ connectionState: "connected" });
				switch (event.type) {
					case "snapshot": {
						const msgs = (event.messages as unknown[]) ?? [];
						const isStreaming = event.isStreaming === true;
						set({
							messages: msgs,
							streamingMessage: undefined,
							isStreaming,
							streamState: {
								text: "",
								activeToolName: undefined,
								isStreaming,
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
							isStreaming: true,
							streamingMessage: undefined,
						});
						break;
					}
					case "message_update": {
						// Store raw SDK message — ChatView renders content[] directly
						const msg = event.message as Record<string, unknown> | undefined;
						if (msg !== undefined && typeof msg === "object") {
							pendingPartial = msg;
							if (rafPartialId === undefined) {
								rafPartialId = requestAnimationFrame(flushPartial);
							}
						}

						// Legacy text delta accumulation (kept for streamState compat)
						const assistantEvent = event.assistantMessageEvent as
							| Record<string, unknown>
							| undefined;
						if (assistantEvent?.type === "text_delta") {
							const delta = assistantEvent.delta as string;
							if (delta) {
								set((s) => ({
									streamState: {
										...s.streamState,
										text: s.streamState.text + delta,
									},
								}));
							}
						}
						break;
					}
					case "tool_execution_start": {
						const toolName = event.toolName as string;
						set((s) => ({
							streamState: {
								...s.streamState,
								activeToolName: toolName,
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
					case "tool_result": {
						if (rafPartialId !== undefined) {
							cancelAnimationFrame(rafPartialId);
							rafPartialId = undefined;
						}
						flushPartial();
						refetchMessages();
						break;
					}
					case "message_end": {
						if (rafPartialId !== undefined) {
							cancelAnimationFrame(rafPartialId);
							rafPartialId = undefined;
						}
						flushPartial();
						set({ streamingMessage: undefined });
						refetchMessages();
						break;
					}
					case "ask_user_question": {
						const { requestId, questions } = event as unknown as {
							requestId: string;
							questions: import("../lib/api-client").AskQuestion[];
						};
						useAskUserQuestionStore
							.getState()
							.setPending({ requestId, sessionId, questions });
						break;
					}
					case "ask_user_question_cancelled": {
						const { requestId: cancelledId } = event as unknown as {
							requestId: string;
						};
						useAskUserQuestionStore
							.getState()
							.clearPending(sessionId, cancelledId);
						break;
					}
					case "compaction_start": {
						const compactionEvent = event as {
							reason?: "manual" | "threshold" | "overflow";
						};
						set((s) => ({
							activeCompaction: {
								reason: compactionEvent.reason ?? "overflow",
								startedAt: Date.now(),
							},
						}));
						break;
					}
					case "compaction_end": {
						const endEv = event as {
							reason?: "manual" | "threshold" | "overflow";
							aborted?: boolean;
							errorMessage?: string;
							result?: {
								summary: string;
								tokensBefore: number;
								estimatedTokensAfter?: number;
							};
						};
						// Synthesize a CompactionEvent from the SSE data so
						// the card renders immediately — no dependency on
						// the async GET /compactions API call which may race
						// with compactAndReload's parallel loadCompactions().
						const synResult = endEv.result;
						const syntheticEvent = synResult
							? {
									id: `syn-compact-${Date.now()}`,
									timestamp: new Date().toISOString(),
									summary: synResult.summary ?? "",
									tokensBefore: synResult.tokensBefore ?? 0,
									estimatedTokensAfter:
										synResult.estimatedTokensAfter,
									insertBeforeIndex: 0,
									archivedMessages: [],
								}
							: null;
						set((s) => ({
							activeCompaction: s.activeCompaction
								? {
										...s.activeCompaction,
										completedAt: Date.now(),
										aborted: endEv.aborted ?? false,
										errorMessage: endEv.errorMessage,
										tokensBefore: endEv.result?.tokensBefore,
										estimatedTokensAfter:
											endEv.result?.estimatedTokensAfter,
									}
								: null,
							compactionEndCountBySession: {
								...s.compactionEndCountBySession,
								[sessionId]:
									(s.compactionEndCountBySession[sessionId] ?? 0) + 1,
							},
							compactionsBySession: syntheticEvent
								? {
										...s.compactionsBySession,
										[sessionId]: [
											syntheticEvent,
											...(s.compactionsBySession[sessionId] ??
												EMPTY_COMPACTIONS),
										],
									}
								: s.compactionsBySession,
						}));
						// Load compactions + messages from the API (will
						// overwrite the synthetic event with proper data
						// including archivedMessages when the API has it).
						void get()
							.loadCompactions(sessionId)
							.then(() => refetchMessages());
						// Auto-dismiss completion notice after 5s (card should be visible by then)
						const dismissTimer = setTimeout(() => {
							const current = get();
							if (current.activeSessionId !== sessionId) return;
							if (current.activeCompaction?.completedAt) {
								set({ activeCompaction: null });
							}
						}, 5000);
						break;
					}
					case "queued": {
						const ev = event as { steering?: unknown; followUp?: unknown };
						const steering = Array.isArray(ev.steering)
							? (ev.steering as unknown[]).filter(
									(v): v is string => typeof v === "string",
								)
							: [];
						const followUp = Array.isArray(ev.followUp)
							? (ev.followUp as unknown[]).filter(
									(v): v is string => typeof v === "string",
								)
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
						if (rafPartialId !== undefined) {
							cancelAnimationFrame(rafPartialId);
							rafPartialId = undefined;
						}
						flushPartial();

						const agentEndEv = event as Record<string, unknown>;
						const willRetry = agentEndEv.willRetry === true;

						if (willRetry) {
							set({ streamingMessage: undefined });
						} else {
							let errorMessage = agentEndEv.errorMessage as string | undefined;
							const finalMsgs = agentEndEv.messages as unknown[] | undefined;
							if (!errorMessage && finalMsgs && finalMsgs.length > 0) {
								const last = finalMsgs[finalMsgs.length - 1] as
									| Record<string, unknown>
									| undefined;
								if (
									last?.role === "assistant" &&
									last?.stopReason === "error"
								) {
									errorMessage = last.errorMessage as string | undefined;
								}
							}

							set((s) => ({
								streamState: {
									text: "",
									activeToolName: undefined,
									isStreaming: false,
								},
								streamingMessage: undefined,
								isStreaming: false,
								error: errorMessage ?? undefined,
								queuedBySession: {
									...s.queuedBySession,
									[sessionId]: undefined,
								},
							}));
						}

						refetchMessages();
						break;
					}
					case "auto_retry_start": {
						const retryEv = event as Record<string, unknown>;
						const attempt = retryEv.attempt ?? "?";
						const maxAttempts = retryEv.maxAttempts ?? "?";
						const errMsg = (retryEv.errorMessage as string) ?? "Unknown error";
						set({
							error: `Model error — retrying (${attempt}/${maxAttempts}): ${errMsg}`,
						});
						break;
					}
					case "auto_retry_end": {
						set({ error: undefined });
						break;
					}
					// ── Extension UI bridge events ──
					case "extension_ui_select":
					case "extension_ui_confirm":
					case "extension_ui_input":
					case "extension_ui_notify":
					case "extension_ui_done": {
						useExtensionUIStore
							.getState()
							.pushEvent(
								event as unknown as import("./extension-ui-store").ExtensionUIEvent,
							);
						break;
					}
					// ── Streaming exec events ──
					case "exec_start": {
						const { command, excludeFromContext } = event as unknown as {
							command: string;
							excludeFromContext: boolean;
						};
						const optimisticMsg = {
							role: "bashExecution",
							command,
							output: "",
							exitCode: undefined as number | undefined,
							cancelled: false,
							truncated: false,
							excludeFromContext,
							timestamp: Date.now(),
							_pendingExec: true,
						};
						set((s) => ({ messages: [...s.messages, optimisticMsg] }));
						break;
					}
					case "exec_update": {
						const { output } = event as unknown as { output: string };
						set((s) => {
							const msgs = [...s.messages];
							const last = msgs[msgs.length - 1];
							if (last && (last as Record<string, unknown>)._pendingExec) {
								(last as Record<string, unknown>).output =
									(((last as Record<string, unknown>).output as string) ?? "") +
									output;
							}
							return { messages: msgs };
						});
						break;
					}
					case "exec_end": {
						const {
							exitCode,
							output,
							error,
							cancelled: execCancelled,
						} = event as unknown as {
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
									m.exitCode = exitCode;
								} else {
									m.exitCode = exitCode;
									m.cancelled = false;
								}
								m.output = error
									? `${m.output as string}${output}\n\n[error] ${error}`
									: output;
								m.truncated = false;
								m._pendingExec = false;
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
			onReconnect: ({ attempt }: { attempt: number }) => {
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

	// ── Prompt / Abort ──

	sendPrompt: async (text: string, images?: ImageContent[]) => {
		const { activeSessionId } = get();
		if (activeSessionId === undefined) return;

		const optimisticContent: Record<string, unknown>[] = [
			{ type: "text", text },
		];
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

		set((s) => ({
			messages: [...s.messages, { role: "user", content: optimisticContent }],
		}));

		try {
			await sendPrompt(activeSessionId, text, undefined, images);
		} catch (err) {
			set((s) => ({
				error: err instanceof Error ? err.message : "Failed to send prompt",
				streamState: s.streamState.isStreaming
					? { text: "", activeToolName: undefined, isStreaming: false }
					: s.streamState,
			}));
		}
	},

	sendSteer: async (text: string, images?: ImageContent[]) => {
		const { activeSessionId } = get();
		if (activeSessionId === undefined) return;

		const optimisticContent: Record<string, unknown>[] = [
			{ type: "text", text },
		];
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
				streamState: s.streamState.isStreaming
					? { text: "", activeToolName: undefined, isStreaming: false }
					: s.streamState,
			}));
		}
	},

	abort: async () => {
		const { activeSessionId } = get();
		if (activeSessionId === undefined) return;

		set({
			streamState: { text: "", activeToolName: undefined, isStreaming: false },
			activeCompaction: null,
			streamingMessage: undefined,
			isStreaming: false,
		});

		try {
			await abortSession(activeSessionId);
		} catch {
			// best-effort
		}
	},

	// ── Session management ──

	renameSession: async (sessionId: string, name: string) => {
		try {
			await renameSessionAPI(sessionId, name);
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
			set({
				error: err instanceof Error ? err.message : "Failed to rename session",
			});
		}
	},

	archiveSession: async (sessionId: string) => {
		const state = get();
		const session = state.sessions.find((s) => s.sessionId === sessionId);
		const projectId = session?.projectId ?? state.activeProjectId;
		try {
			await archiveSessionAPI(sessionId, projectId);
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
				} catch {
					/* private */
				}
			}
		} catch (err) {
			set({
				error: err instanceof Error ? err.message : "Failed to archive session",
			});
		}
	},

	unarchiveSession: async (sessionId: string, projectId: string) => {
		try {
			await unarchiveSessionAPI(sessionId, projectId);
			await get().loadProjectSessions(projectId);
			await get().loadArchivedSessions(projectId);
		} catch (err) {
			set({
				error: err instanceof Error ? err.message : "Failed to restore session",
			});
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
			// Only overwrite if the API returned data. If the API
			// returns empty (race between compaction_end SSE and
			// compactAndReload), keep any synthetic event that was
			// injected by the compaction_end handler.
			if (compactions.length > 0) {
				set((s) => ({
					compactionsBySession: {
						...s.compactionsBySession,
						[sessionId]: compactions,
					},
				}));
			}
		} catch {
			// non-fatal
		}
	},

	compactAndReload: async (sessionId: string) => {
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
			// silently fail
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
				} catch {
					/* private */
				}
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
				streamState: {
					text: "",
					activeToolName: undefined,
					isStreaming: false,
				},
				error: undefined,
			});
		} catch (err) {
			set({
				error: err instanceof Error ? err.message : "Failed to delete project",
			});
		}
	},

	reorderProjects: async (ids: string[]) => {
		const previous = get().projects;
		const byId = new Map(previous.map((p) => [p.id, p] as const));
		const next = ids
			.map((id) => byId.get(id))
			.filter((p): p is Project => p !== undefined);
		if (next.length !== previous.length) return;
		set({ projects: next, error: undefined });
		try {
			const { projects } = await reorderProjectsAPI(ids);
			set({ projects });
		} catch (err) {
			set({
				projects: previous,
				error:
					err instanceof Error ? err.message : "Failed to reorder projects",
			});
			throw err;
		}
	},

	moveProject: async (id: string, direction: "up" | "down") => {
		const { projects, reorderProjects } = get();
		const idx = projects.findIndex((p) => p.id === id);
		if (idx === -1) return;
		const newIdx = direction === "up" ? idx - 1 : idx + 1;
		if (newIdx < 0 || newIdx >= projects.length) return;
		const ids = projects.map((p) => p.id);
		[ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
		await reorderProjects(ids);
	},

	// ── Session Tree / Navigate / Fork ──

	getSessionTree: async (sessionId: string) => {
		const { getSessionTree: api } = await import("../lib/api-client");
		return api(sessionId);
	},

	navigateSession: async (sessionId, entryId, opts) => {
		const { navigateSession: api } = await import("../lib/api-client");
		return api(sessionId, entryId, opts);
	},

	forkSession: async (sessionId: string, entryId: string) => {
		const { forkSession: api } = await import("../lib/api-client");
		return api(sessionId, entryId);
	},
}));
