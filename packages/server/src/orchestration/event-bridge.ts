/**
 * Bridges forge-side worker events into supervisor notifications/history.
 *
 * Four event sources feed worker lifecycle updates:
 *   AgentSession events (per-session subscribe in session-store):
 *     - `agent_start`      → record open turn state only
 *     - `agent_end`        → `worker.ended` (with final error info)
 *   ask-user-question registry:
 *     - `ask_user_question` → `worker.ask_user` + awaiting_question state
 *   processManager:
 *     - `process_alert` → intentionally NOT bridged (too noisy)
 *   session-store lifecycle (sessions DELETE route):
 *     - hot delete → `worker.deleted`
 */
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { bridgeWorkerEvent } from "./inbox.js";
import { getWorkerRecord, updateWorkerLifecycle } from "./store.js";

interface LastAssistantSummary {
  stopReason?: string;
  errorMessage?: string;
  text?: string;
}

function findLastAssistant(messages: readonly unknown[]): LastAssistantSummary | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string } | undefined;
    if (m?.role !== "assistant") continue;
    const a = m as { stopReason?: string; errorMessage?: string; content?: unknown };
    const text = extractAssistantText(a.content);
    const out: LastAssistantSummary = {};
    if (a.stopReason !== undefined) out.stopReason = a.stopReason;
    if (a.errorMessage !== undefined) out.errorMessage = a.errorMessage;
    if (text !== undefined) out.text = text;
    return out;
  }
  return undefined;
}

function extractAssistantText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const c of content) {
    const o = c as { type?: string; text?: string };
    if (o.type === "text" && typeof o.text === "string") parts.push(o.text);
  }
  if (parts.length === 0) return undefined;
  return parts.join("\n");
}

export async function bridgeWorkerAgentEvent(
  meta: { sessionId: string; session: AgentSession },
  event: AgentSessionEvent,
): Promise<void> {
  const e = event as unknown as { type: string };
  const now = new Date().toISOString();
  if (e.type === "agent_start") {
    await updateWorkerLifecycle(meta.sessionId, {
      state: "running",
      turnOpen: true,
      lastStateAt: now,
      lastAgentStartAt: now,
      stopReason: null,
      errorMessage: null,
    });
    return;
  }
  if (e.type !== "agent_end") return;

  const messages = meta.session.messages;
  const lastAssistant = findLastAssistant(messages);
  const errorMessage =
    (meta.session as unknown as { errorMessage?: string }).errorMessage ??
    lastAssistant?.errorMessage;
  const hasError = typeof errorMessage === "string" && errorMessage.length > 0;
  await updateWorkerLifecycle(meta.sessionId, {
    state: hasError ? "errored" : "ended",
    turnOpen: false,
    lastStateAt: now,
    lastAgentEndAt: now,
    stopReason: lastAssistant?.stopReason ?? null,
    errorMessage: errorMessage ?? null,
  });
  await bridgeWorkerEvent(meta.sessionId, "worker.ended", {
    stopReason: lastAssistant?.stopReason ?? null,
    errorMessage: errorMessage ?? null,
    assistantText: lastAssistant?.text ?? null,
  });
}

export async function bridgeWorkerAskUserQuestion(
  sessionId: string,
  questions: readonly { header?: string; question?: string }[],
  requestId: string,
): Promise<void> {
  await updateWorkerLifecycle(sessionId, {
    state: "awaiting_question",
    lastStateAt: new Date().toISOString(),
  });
  await bridgeWorkerEvent(sessionId, "worker.ask_user", {
    requestId,
    questionCount: questions.length,
    firstQuestionHeader: questions[0]?.header ?? null,
    firstQuestionText: questions[0]?.question ?? null,
  });
}

export async function bridgeWorkerExecutionStopped(
  sessionId: string,
  meta: { wasLive: boolean; reason: "deleted" | "killed" | "disposed" | "aborted" },
): Promise<void> {
  const rec = await getWorkerRecord(sessionId);
  if (rec?.turnOpen !== true) return;
  await updateWorkerLifecycle(sessionId, {
    state: "stopped",
    turnOpen: false,
    lastStateAt: new Date().toISOString(),
    stopReason: meta.reason,
  });
  await bridgeWorkerEvent(sessionId, "worker.execution_stopped_without_agent_end", {
    reason: meta.reason,
    wasLive: meta.wasLive,
    lastAgentStartAt: rec.lastAgentStartAt ?? null,
  });
}

export async function bridgeWorkerDeleted(
  sessionId: string,
  meta: { wasLive: boolean; reason?: "deleted" | "killed" | "disposed" | "aborted" },
): Promise<void> {
  const reason = meta.reason ?? "deleted";
  await bridgeWorkerExecutionStopped(sessionId, { wasLive: meta.wasLive, reason });
  await updateWorkerLifecycle(sessionId, {
    state: "deleted",
    turnOpen: false,
    lastStateAt: new Date().toISOString(),
    stopReason: reason,
  });
  await bridgeWorkerEvent(sessionId, "worker.deleted", {
    wasLive: meta.wasLive,
  });
}
