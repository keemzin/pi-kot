import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { processManager } from "./manager.js";
import {
  formatProcessSummary,
  buildSuccessEnvelope,
  buildErrorEnvelope,
} from "./envelope.js";
import {
  PROMPT_GUIDELINES,
  PROMPT_SNIPPET,
  TOOL_DESCRIPTION,
} from "./prompt-strings.js";
import { TOOL_LABEL, TOOL_NAME, type ProcessAction, type StartOptions } from "./types.js";

const inputSchema = {
  type: "object",
  required: ["action"],
  properties: {
    action: {
      type: "string",
      enum: ["start", "list", "output", "logs", "kill", "clear", "write"],
      description: "Action to perform on background processes",
    },
    name: {
      type: "string",
      description: "Short human-readable name for the process (required for 'start')",
    },
    command: {
      type: "string",
      description: "Shell command to execute in background (required for 'start')",
    },
    id: {
      type: "string",
      description: "Process identifier (required for 'output', 'logs', 'kill', 'write')",
    },
    input: {
      type: "string",
      description: "Text input to write to process stdin (required for 'write')",
    },
    end: {
      type: "boolean",
      description: "Whether to close stdin after writing input (optional for 'write')",
    },
    alertOnSuccess: {
      type: "boolean",
      description: "Notify agent when process completes with exit code 0 (default: false)",
    },
    alertOnFailure: {
      type: "boolean",
      description: "Notify agent when process fails or crashes with non-zero exit code (default: true)",
    },
    alertOnKill: {
      type: "boolean",
      description: "Notify agent if process is killed by external signal (default: false)",
    },
    logWatches: {
      type: "array",
      items: {
        type: "object",
        required: ["pattern"],
        properties: {
          pattern: { type: "string", description: "Regex pattern to match against log output" },
          stream: { type: "string", enum: ["stdout", "stderr", "both"] },
          repeat: { type: "boolean", description: "Whether to trigger on every match or just the first" },
        },
      },
      description: "List of regex watches to monitor output lines while running",
    },
    lines: {
      type: "integer",
      description: "Number of output lines to retrieve (optional for 'output', default: 200)",
    },
  },
} as const;

interface ToolParams {
  action: ProcessAction;
  name?: string;
  command?: string;
  id?: string;
  input?: string;
  end?: boolean;
  alertOnSuccess?: boolean;
  alertOnFailure?: boolean;
  alertOnKill?: boolean;
  logWatches?: StartOptions["logWatches"];
  lines?: number;
}

export function createProcessTool(sessionId: string, workspacePath: string): ToolDefinition {
  return {
    name: TOOL_NAME,
    label: TOOL_LABEL,
    description: TOOL_DESCRIPTION,
    promptSnippet: PROMPT_SNIPPET,
    promptGuidelines: PROMPT_GUIDELINES,
    parameters: inputSchema,
    async execute(_toolCallId: string, rawParams: unknown) {
      const params = (rawParams ?? {}) as ToolParams;
      const action = params.action;

      switch (action) {
        case "start": {
          if (!params.name || typeof params.name !== "string" || params.name.trim() === "") {
            return buildErrorEnvelope("start", "Missing required 'name' parameter for start action");
          }
          if (!params.command || typeof params.command !== "string" || params.command.trim() === "") {
            return buildErrorEnvelope("start", "Missing required 'command' parameter for start action");
          }

          const info = processManager.start(
            sessionId,
            params.name.trim(),
            params.command.trim(),
            workspacePath,
            {
              alertOnSuccess: params.alertOnSuccess,
              alertOnFailure: params.alertOnFailure,
              alertOnKill: params.alertOnKill,
              logWatches: params.logWatches,
            },
          );

          const summary = `Started process [${info.id}] "${info.name}" (PID ${info.pid})\nCommand: ${info.command}`;
          return buildSuccessEnvelope("start", summary, { process: info });
        }

        case "list": {
          const list = processManager.list(sessionId);
          if (list.length === 0) {
            return buildSuccessEnvelope("list", "No active or recorded background processes.", { processes: [] });
          }

          const text = list.map(formatProcessSummary).join("\n\n");
          return buildSuccessEnvelope("list", text, { processes: list });
        }

        case "output": {
          if (!params.id) {
            return buildErrorEnvelope("output", "Missing required 'id' parameter for output action");
          }
          const out = processManager.getOutput(sessionId, params.id, params.lines ?? 200);
          if (!out) {
            return buildErrorEnvelope("output", `Process not found: ${params.id}`);
          }

          const stdoutText = out.stdout.length > 0 ? out.stdout.join("\n") : "(no stdout output)";
          const stderrText = out.stderr.length > 0 ? `\n--- stderr ---\n${out.stderr.join("\n")}` : "";
          const text = `Output for [${params.id}] (${out.status}):\n${stdoutText}${stderrText}`;

          return buildSuccessEnvelope("output", text, { output: out });
        }

        case "logs": {
          if (!params.id) {
            return buildErrorEnvelope("logs", "Missing required 'id' parameter for logs action");
          }
          const logFiles = processManager.getLogFiles(sessionId, params.id);
          if (!logFiles) {
            return buildErrorEnvelope("logs", `Process not found: ${params.id}`);
          }

          const text = `Log files for process [${params.id}]:\n  stdout: ${logFiles.stdoutFile}\n  stderr: ${logFiles.stderrFile}`;
          return buildSuccessEnvelope("logs", text, { logFiles });
        }

        case "kill": {
          if (!params.id) {
            return buildErrorEnvelope("kill", "Missing required 'id' parameter for kill action");
          }
          const result = await processManager.kill(sessionId, params.id);
          if (!result.ok) {
            return buildErrorEnvelope("kill", `Failed to kill process [${params.id}]: ${result.reason}`);
          }
          return buildSuccessEnvelope("kill", `Terminated process [${params.id}] "${result.info.name}"`, {
            process: result.info,
          });
        }

        case "clear": {
          const cleared = processManager.clearFinished(sessionId);
          return buildSuccessEnvelope("clear", `Cleared ${cleared} finished process(es).`, { cleared });
        }

        case "write": {
          if (!params.id) {
            return buildErrorEnvelope("write", "Missing required 'id' parameter for write action");
          }
          if (params.input === undefined) {
            return buildErrorEnvelope("write", "Missing required 'input' parameter for write action");
          }

          const result = processManager.write(sessionId, params.id, params.input, params.end ?? false);
          if (!result.ok) {
            return buildErrorEnvelope("write", `Failed to write to process [${params.id}]: ${result.reason}`);
          }
          return buildSuccessEnvelope("write", `Wrote ${params.input.length} characters to stdin of [${params.id}].`);
        }

        default:
          return buildErrorEnvelope(
            (action ?? "list") as ProcessAction,
            `Unknown action: ${String(action)}`,
          );
      }
    },
  };
}
