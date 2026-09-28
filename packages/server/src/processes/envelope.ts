import type { ExecuteResult, ProcessesDetails, ProcessInfo } from "./types.js";

export function formatProcessSummary(p: ProcessInfo): string {
  const statusStr = p.status === "running" ? "running" : `${p.status} (exit ${p.exitCode ?? "?"})`;
  return `[${p.id}] "${p.name}" (PID ${p.pid}) — ${statusStr}\n  command: ${p.command}\n  stdout: ${p.stdoutFile}\n  stderr: ${p.stderrFile}`;
}

export function buildSuccessEnvelope(
  action: ProcessesDetails["action"],
  message: string,
  extra: Partial<ProcessesDetails> = {},
): ExecuteResult {
  const details: ProcessesDetails = {
    action,
    success: true,
    message,
    ...extra,
  };
  return {
    content: [{ type: "text", text: message }],
    details,
  };
}

export function buildErrorEnvelope(
  action: ProcessesDetails["action"],
  message: string,
  extra: Partial<ProcessesDetails> = {},
): ExecuteResult {
  const details: ProcessesDetails = {
    action,
    success: false,
    message,
    ...extra,
  };
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    details,
  };
}
