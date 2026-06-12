import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { LiveSession, SSEClient } from "./session-registry.js";

/**
 * Serialize an event into SSE wire format.
 * Adapted from pi-forge's sse-bridge.ts.
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
 *
 * Adapted from pi-forge's sse-bridge.ts createSSEClient.
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
