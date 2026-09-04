import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { LiveSession, SSEClient } from "./session-store.js";
import { getPendingForSession } from "./ask-user-question/registry.js";
import { getPendingPlanReviewsForSession } from "./ask-user-question/plannotator-registry.js";
import { getSessionStatuses, setSessionStatus } from "./extension-ui-bridge.js";

/**
 * One-shot padding flush sent right after `compaction_start` so L7
 * proxies (notably HAProxy on OpenShift) release the event immediately
 * rather than buffering it through the multi-second compaction LLM call.
 *
 * The `compaction_start` event is ~150 bytes, well below any L7 proxy's
 * minimum-buffer-to-flush threshold (1–8 KB is common). Without padding,
 * the proxy holds the response for the entire duration of the compaction
 * LLM call (several seconds) — by which point `compaction_end` has also
 * fired and been buffered. The browser receives both events together,
 * which defeats the purpose of sending `compaction_start` at all.
 *
 * This padding line is ~2000 bytes of comments. We use a dedicated
 * writeRaw path that bypasses the event filter so it's invisible to
 * clients. An `event: ping` SSE frame is less standard-compliant than
 * a comment-only line (comments are defined in the SSE spec and all
 * SSE parsers must ignore them).
 */
const COMPACTION_START_PADDING_LINE = `: ${Array(80).fill("-").join("")}\n`.repeat(40);

/**
 * Serialize an event into SSE wire format.
 */
export function serializeSSE(event: { type: string; [k: string]: unknown }): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Allowed event types forwarded to browser clients.
 * Unknown types are silently dropped for forwards-compatibility.
 */
const ALLOWED_EVENT_TYPES = new Set([
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "tool_call",
  "tool_result",
  "queue_update",
  "compaction_start",
  "compaction_end",
  "auto_retry_start",
  "auto_retry_end",
  "snapshot",
  "ask_user_question",
  "ask_user_question_cancelled",
  "plannotator_plan_review_requested",
  "plannotator_plan_review_resolved",
  // Streaming exec events (!cmd / !!cmd live terminal feed)
  "exec_start",
  "exec_update",
  "exec_end",
  // Extension UI bridge events
  "extension_ui_select",
  "extension_ui_confirm",
  "extension_ui_input",
  "extension_ui_notify",
  "extension_ui_status",
  "extension_ui_done",
]);

function isAllowedEvent(event: { type: string }): boolean {
  return ALLOWED_EVENT_TYPES.has(event.type);
}

/**
 * Build a snapshot event from the current LiveSession state.
 * Sent immediately on SSE connect so the browser can hydrate
 * without a separate HTTP round-trip.
 */
export function buildSnapshot(live: LiveSession): {
  type: "snapshot";
  sessionId: string;
  projectId: string;
  messages: unknown[];
  isStreaming: boolean;
} {
  return {
    type: "snapshot",
    sessionId: live.sessionId,
    projectId: live.projectId,
    messages: live.session.messages,
    isStreaming: live.session.isStreaming,
  };
}

/**
 * Hijack the Fastify reply and turn it into a long-lived SSE stream
 * attached to `live.clients`. Sends a snapshot immediately, forwards
 * filtered AgentSessionEvents, and unregisters on socket close.
 */
export function createSSEClient(reply: FastifyReply, live: LiveSession): SSEClient {
  reply.hijack();
  const raw = reply.raw;

  let registeredClient: SSEClient | undefined;
  let closed = false;

  try {
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const id = randomUUID();

    const close = (): void => {
      if (closed) return;
      closed = true;
      if (registeredClient !== undefined) live.clients.delete(registeredClient);
      try {
        raw.end();
      } catch {
        // socket already torn down
      }
    };

    const send = (event: AgentSessionEvent | { type: string; [k: string]: unknown }): void => {
      if (closed) return;
      if (!isAllowedEvent(event)) return;
      try {
        raw.write(serializeSSE(event));
        // After compaction_start, follow with a padding flush so L7
        // proxies (notably the OpenShift HAProxy router) release the
        // event immediately rather than holding it through the
        // multi-second compaction LLM call.
        if (event.type === "compaction_start") {
          raw.write(COMPACTION_START_PADDING_LINE);
        }
      } catch {
        close();
      }
    };

    const client: SSEClient = { id, send, close };
    registeredClient = client;

    // Snapshot must be sent BEFORE adding to live.clients so events
    // after the snapshot never arrive before it.
    raw.write(
      serializeSSE(
        buildSnapshot(live) as unknown as { type: string; [k: string]: unknown },
      ),
    );

    // Re-emit any pending ask_user_question events for this session
    // so clients that reconnect (page refresh, new tab) don't lose them.
    for (const pending of getPendingForSession(live.sessionId)) {
      raw.write(
        serializeSSE({
          type: "ask_user_question",
          sessionId: live.sessionId,
          requestId: pending.requestId,
          questions: pending.questions,
        } as unknown as { type: string; [k: string]: unknown }),
      );
    }

    // Re-emit any pending plannotator plan review events for this session
    for (const pending of getPendingPlanReviewsForSession(live.sessionId)) {
      raw.write(
        serializeSSE({
          type: "plannotator_plan_review_requested",
          sessionId: live.sessionId,
          requestId: pending.requestId,
          planFilePath: pending.planFilePath,
          planContent: pending.planContent,
        } as unknown as { type: string; [k: string]: unknown }),
      );
    }

    // Re-emit any active extension UI statuses for this session
    const statuses = getSessionStatuses(live.sessionId);
    for (const { key, status } of statuses) {
      raw.write(
        serializeSSE({
          type: "extension_ui_status",
          sessionId: live.sessionId,
          key,
          status,
        } as unknown as { type: string; [k: string]: unknown }),
      );
    }

    // If plannotator status is not in memory yet, check session entries
    const hasPlannotator = statuses.some((s) => s.key === "plannotator");
    if (!hasPlannotator && isSessionInPlanMode(live)) {
      setSessionStatus(live.sessionId, "plannotator", "📋 Plan Mode");
      raw.write(
        serializeSSE({
          type: "extension_ui_status",
          sessionId: live.sessionId,
          key: "plannotator",
          status: "📋 Plan Mode",
        } as unknown as { type: string; [k: string]: unknown }),
      );
    }

    live.clients.add(client);

    raw.on("close", close);
    raw.on("error", close);

    return client;
  } catch (err) {
    closed = true;
    if (registeredClient !== undefined) live.clients.delete(registeredClient);
    try {
      raw.destroy();
    } catch {
      // already destroyed
    }
    throw err;
  }
}

/**
 * Check whether a session is currently in plan mode based on:
 * 1. Active pending plan reviews
 * 2. In-memory extension statuses
 * 3. Durable sessionManager entries on disk
 */
export function isSessionInPlanMode(live: LiveSession): boolean {
  // 1. Check if there is an active pending plan review
  if (getPendingPlanReviewsForSession(live.sessionId).length > 0) {
    return true;
  }

  // 2. Check in-memory session status
  const statuses = getSessionStatuses(live.sessionId);
  const planStatus = statuses.find((s) => s.key === "plannotator" || s.key === "plan-mode");
  if (planStatus && planStatus.status) {
    const s = planStatus.status.toLowerCase();
    if (s.includes("plan") || s.includes("📋") || s.includes("⏸")) {
      return true;
    }
  }

  // 3. Inspect sessionManager entries on disk
  try {
    const entries = live.sessionManager.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i] as {
        type?: string;
        customType?: string;
        data?: { phase?: string; active?: boolean };
      };
      if (e && e.type === "custom" && (e.customType === "plannotator" || e.customType === "plan-mode")) {
        if (e.data?.phase === "planning" || e.data?.active === true) {
          return true;
        }
        if (e.data?.phase === "idle" || e.data?.phase === "executing" || e.data?.active === false) {
          return false;
        }
      }
    }
  } catch {
    // best-effort
  }

  return false;
}
