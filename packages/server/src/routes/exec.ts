import { spawn, execSync } from "node:child_process";
import type { FastifyPluginAsync } from "fastify";
import type { BashOperations } from "@earendil-works/pi-coding-agent";
import { errorSchema } from "./_schemas.js";
import { getSession } from "../session-store.js";
import { serializeSSE } from "../event-stream.js";

/**
 * Cross-platform shell resolution.
 * - Windows: uses ComSpec (cmd.exe) which is always set by the OS.
 * - Unix: uses SHELL env var, fallback /bin/sh.
 */
function resolveShell(): {
	shell: string;
	argsTemplate: (cmd: string) => string[];
} {
	const isWin = process.platform === "win32";
	if (isWin) {
		return {
			shell: process.env.ComSpec ?? "cmd.exe",
			argsTemplate: (cmd: string) => ["/d", "/s", "/c", cmd],
		};
	}
	return {
		shell: process.env.SHELL ?? "/bin/sh",
		argsTemplate: (cmd: string) => ["-c", cmd],
	};
}

const DEFAULT_TIMEOUT_MS = 30_000;

interface ExecBody {
	command: string;
	excludeFromContext?: boolean;
}

/**
 * BashOperations that spawns a shell process with sandboxed env.
 * The onData callback receives stdout/stderr chunks as they arrive.
 */
function createBashOps(
	workspacePath: string,
	timeoutSignal: AbortSignal,
): BashOperations {
	const shellConfig = resolveShell();
	return {
		exec: (command, _cwd, options) => {
			return new Promise<{ exitCode: number | null }>((resolve, reject) => {
				const isWin = process.platform === "win32";
				const proc = spawn(
					shellConfig.shell,
					shellConfig.argsTemplate(command),
					{
						cwd: workspacePath,
						env: {
							...process.env,
							PI_API_KEY: undefined,
						},
						stdio: ["ignore", "pipe", "pipe"],
						// On Unix: detach so the shell+command become their own
						// process group. Killing the group leader with a negative
						// PID terminates ALL descendants (ping, long-running tools,
						// etc.), not just the shell wrapper.
						// On Windows: detached:true would create a new console window
						// AND disconnect stdout/stderr pipes from the parent (so the
						// SDK never receives any output). We skip detached on Windows
						// and fall back to proc.kill() directly.
						detached: !isWin,
						windowsHide: true,
					},
				);

				const kill = (): void => {
					if (isWin) {
						// Windows: single taskkill /F/T is the equivalent of
						// SIGTERM→SIGKILL on Unix — kills the entire tree
						// synchronously. SIGTERM/SIGKILL on Node.js only kill
						// the immediate cmd.exe, not its children, so we skip
						// them and go straight to taskkill.
						try {
							execSync(`taskkill /F /T /PID ${proc.pid!} 2>nul`, {
								windowsHide: true,
								timeout: 5000,
							});
						} catch {}
					} else {
						// Unix: process group kill via negative PID.
						// SIGTERM gives the process a chance to clean up
						// (flush buffers, run trap handlers). After 2s,
						// escalate to SIGKILL.
						const pgid = proc.pid;
						if (pgid === undefined) return;
						try {
							process.kill(-pgid, "SIGTERM");
						} catch {}
						setTimeout(() => {
							try {
								process.kill(-pgid, "SIGKILL");
							} catch {}
						}, 2000);
					}
				};

				const signal = options.signal ?? timeoutSignal;
				const onAbort = (): void => kill();
				if (signal.aborted || timeoutSignal.aborted) {
					kill();
				} else {
					// Listen on the SDK's signal so the agent can abort us
					signal.addEventListener("abort", onAbort, { once: true });
					// Also listen on our own timeout signal so client disconnect
					// (req.raw.on("close") → timeoutController.abort()) kills the process
					if (signal !== timeoutSignal) {
						timeoutSignal.addEventListener("abort", onAbort, { once: true });
					}
				}

				options.onData = options.onData ?? (() => {});
				proc.stdout?.on("data", (data: Buffer) => options.onData!(data));
				proc.stderr?.on("data", (data: Buffer) => options.onData!(data));

				proc.on("error", (err) => reject(err));
				proc.on("close", (code) => resolve({ exitCode: code }));
			});
		},
	};
}

export const execRoutes: FastifyPluginAsync = async (fastify) => {
	/**
	 * Sync exec — fire-and-forget. Returns final output after command finishes.
	 * The chat input's `!` / `!!` prefix dispatches here.
	 */
	fastify.post<{ Params: { id: string }; Body: ExecBody }>(
		"/sessions/:id/exec",
		{
			schema: {
				description:
					"Run a one-shot bash command in the session's project cwd " +
					"(the chat input's `!` / `!!` prefix dispatches here). The " +
					"result is added to the session's in-memory context AND " +
					"persisted to the session JSONL. With " +
					"`excludeFromContext: true` (the `!!` prefix) the result " +
					"is recorded but kept out of the next turn's LLM input. " +
					"Output is captured whole — no streaming for v1.",
				tags: ["sessions"],
				params: {
					type: "object",
					required: ["id"],
					properties: { id: { type: "string" } },
				},
				body: {
					type: "object",
					required: ["command"],
					additionalProperties: false,
					properties: {
						command: { type: "string", minLength: 1, maxLength: 4096 },
						excludeFromContext: { type: "boolean" },
					},
				},
				response: {
					200: {
						type: "object",
						required: [
							"exitCode",
							"output",
							"durationMs",
							"truncated",
							"cancelled",
						],
						properties: {
							exitCode: { type: ["integer", "null"] },
							output: { type: "string" },
							durationMs: { type: "integer" },
							truncated: { type: "boolean" },
							cancelled: { type: "boolean" },
						},
					},
					404: errorSchema,
					500: errorSchema,
				},
			},
		},
		async (req, reply) => {
			const live = getSession(req.params.id);
			if (live === undefined) {
				return reply.code(404).send({ error: "session_not_found" });
			}
			const { command, excludeFromContext = false } = req.body;
			const started = Date.now();
			const workspacePath = live.workspacePath;
			const timeoutController = new AbortController();
			const timer = setTimeout(
				() => timeoutController.abort(),
				DEFAULT_TIMEOUT_MS,
			);

			try {
				const bashOps = createBashOps(workspacePath, timeoutController.signal);
				const result = await live.session.executeBash(command, undefined, {
					excludeFromContext,
					operations: bashOps,
				});
				const durationMs = Date.now() - started;
				live.lastActivityAt = new Date();

				// Cross-tab refetch trigger
				for (const c of live.clients) {
					try {
						c.send({ type: "user_bash_result" });
					} catch {
						/* best-effort */
					}
				}

				return {
					exitCode: result.exitCode === undefined ? null : result.exitCode,
					output: result.output,
					durationMs,
					truncated: result.truncated,
					cancelled: result.cancelled,
				};
			} catch (err) {
				return reply.code(500).send({
					error: "exec_failed",
					message: err instanceof Error ? err.message : String(err),
				});
			} finally {
				clearTimeout(timer);
			}
		},
	);

	/**
	 * Streaming exec — fires SSE events (exec_start → exec_update ×N → exec_end)
	 * so the client can render live terminal output. Calls executeBash so output
	 * also lands in LLM context.
	 */
	fastify.post<{ Params: { id: string }; Body: ExecBody }>(
		"/sessions/:id/exec-stream",
		{
			schema: {
				description:
					"Run a one-shot bash command and stream output via SSE " +
					"(exec_start → exec_update ×N → exec_end). " +
					"Same semantics as POST /sessions/:id/exec but with live output.",
				tags: ["sessions"],
				params: {
					type: "object",
					required: ["id"],
					properties: { id: { type: "string" } },
				},
				body: {
					type: "object",
					required: ["command"],
					additionalProperties: false,
					properties: {
						command: { type: "string", minLength: 1, maxLength: 4096 },
						excludeFromContext: { type: "boolean" },
					},
				},
				response: {
					200: {
						type: "object",
						required: [
							"exitCode",
							"output",
							"durationMs",
							"truncated",
							"cancelled",
						],
						properties: {
							exitCode: { type: ["integer", "null"] },
							output: { type: "string" },
							durationMs: { type: "integer" },
							truncated: { type: "boolean" },
							cancelled: { type: "boolean" },
						},
					},
					404: errorSchema,
					500: errorSchema,
				},
			},
		},
		async (req, reply) => {
			const live = getSession(req.params.id);
			if (live === undefined) {
				return reply.code(404).send({ error: "session_not_found" });
			}
			const { command, excludeFromContext = false } = req.body;
			const started = Date.now();
			const workspacePath = live.workspacePath;
			const timeoutController = new AbortController();
			const timer = setTimeout(
				() => timeoutController.abort(),
				DEFAULT_TIMEOUT_MS,
			);
			let execReject: ((err: Error) => void) | undefined;
			let cancelTimer: ReturnType<typeof setTimeout> | undefined;

			try {
				// Send exec_start to SSE
				live.clients.forEach((c) => {
					try {
						c.send({
							type: "exec_start",
							sessionId: live.sessionId,
							command,
							excludeFromContext,
						});
					} catch {
						/* best-effort */
					}
				});

				// Run the command with a wrapper that fans stdout chunks to SSE.
				const baseOps = createBashOps(workspacePath, timeoutController.signal);
				const streamingOps: BashOperations = {
					exec: (cmd, cwd, options) => {
						const origOnData = options.onData;
						options.onData = (data: Buffer) => {
							live.clients.forEach((c) => {
								try {
									c.send({
										type: "exec_update",
										sessionId: live.sessionId,
										output: data.toString(),
									});
								} catch {
									/* best-effort */
								}
							});
							origOnData?.(data);
						};
						return baseOps.exec(cmd, cwd, options);
					},
				};

				// ── Cancel / abort handling ──
				//
				// Three-layer strategy, in order:
				//   1. abortBash()   — SDK's official bash abort
				//   2. taskkill /F/T — brute-force process tree kill
				//   3. Force reject  — if the process genuinely won't die
				//      (antivirus / permissions / Win quirk), a 3s
				//      fallback promise rejects so the route handler can
				//      send exec_end and return immediately.
				//
				live.currentExecAbort = () => {
					// Layer 1: SDK abort (aborts _bashAbortController signal)
					try {
						live.session.abortBash();
					} catch {}
					// Layer 2: timeout abort (triggers kill() via AbortSignal)
					try {
						timeoutController.abort();
					} catch {}
					// Layer 3: force-reject after 3s if process won't die
					cancelTimer = setTimeout(() => {
						execReject?.(
							new Error("exec cancel timed out — process may still be alive"),
						);
					}, 3000);
				};

				// Race executeBash against the cancel fallback
				const execPromise = live.session.executeBash(command, undefined, {
					excludeFromContext,
					operations: streamingOps,
				});
				const result = await new Promise<Awaited<typeof execPromise>>(
					(resolve, reject) => {
						execReject = reject;
						execPromise.then(resolve).catch(reject);
					},
				).finally(() => {
					clearTimeout(cancelTimer);
				});

				const durationMs = Date.now() - started;
				live.lastActivityAt = new Date();

				// Send exec_end to SSE
				const cancelled = timeoutController.signal.aborted;
				live.clients.forEach((c) => {
					try {
						c.send({
							type: "exec_end",
							sessionId: live.sessionId,
							exitCode: result.exitCode ?? null,
							output: result.output,
							cancelled,
						});
					} catch {
						/* best-effort */
					}
				});

				// Cross-tab refetch trigger
				for (const c of live.clients) {
					try {
						c.send({ type: "user_bash_result" });
					} catch {
						/* best-effort */
					}
				}

				return {
					exitCode: result.exitCode === undefined ? null : result.exitCode,
					output: result.output,
					durationMs,
					truncated: result.truncated,
					cancelled,
				};
			} catch (err) {
				// Send exec_end with error
				try {
					live.clients.forEach((c) => {
						try {
							c.send({
								type: "exec_end",
								sessionId: live.sessionId,
								exitCode: null,
								output: "",
								cancelled: timeoutController.signal.aborted,
								error: err instanceof Error ? err.message : String(err),
							});
						} catch {
							/* best-effort */
						}
					});
				} catch {
					/* socket already torn down */
				}
				return reply.code(500).send({
					error: "exec_failed",
					message: err instanceof Error ? err.message : String(err),
				});
			} finally {
				clearTimeout(timer);
				clearTimeout(cancelTimer);
				live.currentExecAbort = undefined;
			}
		},
	);

	/**
	 * Cancel a running streaming exec command.
	 */
	fastify.post<{ Params: { id: string } }>(
		"/sessions/:id/exec-cancel",
		{
			schema: {
				description:
					"Cancel the currently running streaming exec command for this session.",
				tags: ["sessions"],
				params: {
					type: "object",
					required: ["id"],
					properties: { id: { type: "string" } },
				},
				response: {
					200: {
						type: "object",
						properties: { cancelled: { type: "boolean" } },
					},
					404: errorSchema,
				},
			},
		},
		async (req, reply) => {
			const live = getSession(req.params.id);
			if (live === undefined) {
				return reply.code(404).send({ error: "session_not_found" });
			}
			const abort = live.currentExecAbort;
			if (abort !== undefined) {
				abort();
				return { cancelled: true };
			}
			return { cancelled: false };
		},
	);
};
