import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { getSession, autoNameSession } from "../session-registry.js";
import { config } from "../config.js";

/**
 * Pre-flight checks shared by prompt + steer routes.
 * Returns the LiveSession or undefined (after sending a 4xx reply).
 */
async function preflight(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<Awaited<ReturnType<typeof getSession>> | undefined> {
  const sessionId = (req.params as { id: string }).id;
  const live = getSession(sessionId);
  if (live === undefined) {
    await reply.code(404).send({ error: "session_not_found", message: "no live session with that id" });
    return undefined;
  }
  const model = live.session.model;
  if (model === undefined) {
    await reply.code(400).send({
      error: "no_model_configured",
      message: "no model is configured for this session",
    });
    return undefined;
  }
  // Check auth is configured for the current model
  if (!live.session.modelRegistry.hasConfiguredAuth(model)) {
    await reply.code(400).send({
      error: "auth_not_configured",
      message: `No API key configured for provider "${model.provider}". Add one via PUT /api/v1/config/auth/${model.provider}.`,
    });
    return undefined;
  }
  return live;
}

export const promptRoutes: FastifyPluginAsync = async (fastify) => {
  /** SDK-compatible ImageContent shape (matches @earendil-works/pi-ai's ImageContent). */
interface ImageContent {
  type: "image";
  data: string;    // base64 encoded image data
  mimeType: string; // e.g., "image/jpeg", "image/png"
}

// POST /api/v1/sessions/:id/prompt — fire-and-forget, returns 202
  fastify.post<{
    Params: { id: string };
    Body: { text: string; streamingBehavior?: "steer" | "followUp"; images?: ImageContent[] };
  }>(
    "/sessions/:id/prompt",
    {
      schema: {
        description:
          "Send a prompt to the session. Returns 202 immediately; the agent " +
          "response streams over GET /sessions/:id/stream.\n\n" +
          "Pi SDK key fact: session.prompt() resolves only after the FULL " +
          "agent run finishes (including retries + compaction). Routes MUST " +
          "NOT await it — call without await and return 202 immediately. " +
          "Output streams over SSE.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["text"],
          additionalProperties: false,
          properties: {
            text: { type: "string", minLength: 1 },
            streamingBehavior: { type: "string", enum: ["steer", "followUp"] },
            images: {
              type: "array",
              items: {
                type: "object",
                required: ["type", "data", "mimeType"],
                properties: {
                  type: { type: "string", const: "image" },
                  data: { type: "string" },
                  mimeType: { type: "string" },
                },
              },
            },
          },
        },
        response: {
          202: {
            type: "object",
            required: ["accepted"],
            properties: { accepted: { type: "boolean", const: true } },
          },
          400: {
            type: "object",
            properties: {
              error: { type: "string" },
              message: { type: "string" },
            },
          },
          404: {
            type: "object",
            properties: {
              error: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const live = await preflight(req, reply);
      if (live === undefined) return reply;

      const { text, streamingBehavior, images } = req.body;

      const opts: Parameters<typeof live.session.prompt>[1] = {};
      if (streamingBehavior !== undefined) opts.streamingBehavior = streamingBehavior;
      if (images !== undefined && images.length > 0) opts.images = images;

      // Auto-name from the first prompt if no name is set yet
      autoNameSession(req.params.id, text);

      // Synthesize a failure event if prompt() rejects without emitting agent_end.
      const synthesizeFailureEvent = (err: unknown): void => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        for (const client of live.clients) {
          try {
            client.send({
              type: "agent_end",
              sessionId: req.params.id,
              errorMessage,
            });
          } catch {
            // single client send-failure shouldn't stop fan-out
          }
        }
      };

      // Fire-and-forget — the promise resolves only after the ENTIRE
      // agent run is complete, so we DO NOT await it.
      live.session.prompt(text, opts).catch((err: unknown) => {
        synthesizeFailureEvent(err);
      });

      return reply.code(202).send({ accepted: true });
    },
  );

  // POST /api/v1/sessions/:id/abort — abort current run
  fastify.post<{
    Params: { id: string };
  }>(
    "/sessions/:id/abort",
    {
      schema: {
        description: "Abort the current agent run.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["aborted"],
            properties: { aborted: { type: "boolean" } },
          },
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
      try {
        await live.session.abort();
      } catch {
        // best-effort
      }
      return { aborted: true };
    },
  );

  // POST /api/v1/sessions/:id/steer — steer during streaming
  fastify.post<{
    Params: { id: string };
    Body: { text: string; mode?: "steer" | "followUp"; images?: ImageContent[] };
  }>(
    "/sessions/:id/steer",
    {
      schema: {
        description: "Steer or follow-up during an active streaming session.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["text"],
          properties: {
            text: { type: "string", minLength: 1 },
            mode: { type: "string", enum: ["steer", "followUp"], default: "steer" },
            images: {
              type: "array",
              items: {
                type: "object",
                required: ["type", "data", "mimeType"],
                properties: {
                  type: { type: "string", const: "image" },
                  data: { type: "string" },
                  mimeType: { type: "string" },
                },
              },
            },
          },
        },
        response: {
          202: {
            type: "object",
            required: ["accepted"],
            properties: { accepted: { type: "boolean" } },
          },
        },
      },
    },
    async (req, reply) => {
      const live = getSession(req.params.id);
      if (live === undefined) {
        return reply.code(404).send({ error: "session_not_found" });
      }

      const { text, mode, images } = req.body;
      try {
        if (mode === "followUp") {
          await live.session.followUp(text, images);
        } else {
          await live.session.steer(text, images);
        }
      } catch {
        // best-effort; the session handles invalid-state calls gracefully
      }

      return reply.code(202).send({ accepted: true });
    },
  );
};
