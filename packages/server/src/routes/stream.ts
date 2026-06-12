import type { FastifyPluginAsync } from "fastify";
import { getSession } from "../session-registry.js";
import { createSSEClient } from "../sse-bridge.js";

export const streamRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/sessions/:id/stream — SSE stream of agent events
  fastify.get<{
    Params: { id: string };
  }>(
    "/sessions/:id/stream",
    {
      schema: {
        description:
          "Open an SSE stream for a session. Sends a `snapshot` event on " +
          "connect, then forwards filtered AgentSessionEvents until the " +
          "client disconnects.\n\n" +
          "NOTE: This route uses reply.hijack() — it does NOT return a " +
          "standard Fastify response. The connection stays open indefinitely.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const live = getSession(req.params.id);
      if (live === undefined) {
        return reply.code(404).send({ error: "session_not_found" });
      }

      createSSEClient(reply, live);
      // createSSEClient calls reply.hijack() — we return reply to satisfy
      // the type system, but the response is already being driven manually.
      return reply;
    },
  );
};
