import { spawn } from "node:child_process";
import type { FastifyPluginAsync } from "fastify";
import { errorSchema } from "./_schemas.js";
import { getSession } from "../session-registry.js";

/**
 * Cross-platform shell resolution.
 * - Windows: uses ComSpec (cmd.exe) which is always set by the OS.
 * - Unix: uses SHELL env var, fallback /bin/sh.
 */
function resolveShell(): { shell: string; argsTemplate: (cmd: string) => string[] } {
  const isWin = process.platform === "win32";
  if (isWin) {
    // Windows: cmd.exe /c <command>
    return {
      shell: process.env.ComSpec ?? "cmd.exe",
      argsTemplate: (cmd: string) => ["/d", "/s", "/c", cmd],
    };
  }
  // Unix: sh -c <command>
  return {
    shell: process.env.SHELL ?? "/bin/sh",
    argsTemplate: (cmd: string) => ["-c", cmd],
  };
}

/**
 * One-shot user bash execution — the chat input's `!` / `!!` prefix.
 *
 *  - `!cmd`  → output appended to the session's message history as a
 *             BashExecutionMessage; the next agent turn sees it in
 *             LLM context.
 *  - `!!cmd` → same render, `excludeFromContext: true` keeps it out
 *             of the next turn's prompt. Local convenience only.
 *
 * Uses the SDK's `AgentSession.executeBash()` which:
 *   1. Spawns the command via the provided BashOperations
 *   2. Pushes a BashExecutionMessage into agent.state.messages
 *   3. Persists the message via sessionManager.appendMessage
 */

const DEFAULT_TIMEOUT_MS = 30_000;

interface ExecBody {
  command: string;
  excludeFromContext?: boolean;
}

export const execRoutes: FastifyPluginAsync = async (fastify) => {
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
          "is recorded but kept out of the next turn's LLM input.",
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
            required: ["exitCode", "output", "durationMs", "truncated", "cancelled"],
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

      // Build a simple BashOperations that spawns /bin/sh in the project workspace
      const workspacePath = live.workspacePath;
      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort(), DEFAULT_TIMEOUT_MS);

      try {
        const bashOps = createBashOperations(workspacePath, timeoutController.signal);
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
            // best-effort
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
};

import type { BashOperations } from "@earendil-works/pi-coding-agent";

function createBashOperations(
  workspacePath: string,
  timeoutSignal: AbortSignal,
): BashOperations {
  const shellConfig = resolveShell();
  return {
    exec: (command, _cwd, options) => {
      return new Promise<{ exitCode: number | null }>((resolve, reject) => {
        const proc = spawn(shellConfig.shell, shellConfig.argsTemplate(command), {
          cwd: workspacePath,
          env: {
            ...process.env,
            // Strip potentially sensitive vars
            PI_API_KEY: undefined,
          },
          stdio: ["ignore", "pipe", "pipe"],
        });

        const kill = (): void => {
          try { proc.kill("SIGTERM"); } catch { /* best-effort */ }
          setTimeout(() => {
            try { proc.kill("SIGKILL"); } catch { /* best-effort */ }
          }, 2000);
        };

        const signal = options.signal ?? timeoutSignal;
        if (signal.aborted) {
          kill();
        } else {
          const onAbort = (): void => kill();
          if (options.signal !== undefined && options.signal !== signal) {
            // Merge signals: abort from either source
            options.signal.addEventListener("abort", onAbort, { once: true });
          }
          signal.addEventListener("abort", onAbort, { once: true });
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
