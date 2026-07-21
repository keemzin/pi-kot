import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { getSession, autoNameSession } from "../session-store.js";
import { config } from "../config.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expandFileReferences } from "../path-refs.js";
import { getProject } from "../workspace-store.js";

const ABORT_TIMEOUT_MS = 10_000;

const VISION_TEMP_DIR = "/tmp/pi-kot-vision";

/** SDK-compatible ImageContent shape (matches @earendil-works/pi-ai's ImageContent). */
interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

/**
 * If the session's model doesn't support images natively (no "image" in
 * model.input), save the image data to temp files and inject file-path
 * markers into the text. This lets text-only models use tools like
 * describe_image that accept file paths.
 *
 * If the model supports images, passes through unchanged.
 */
async function maybeSaveImagesToFiles(
  model: { input?: string[] } | undefined,
  text: string,
  images: ImageContent[] | undefined,
): Promise<{ text: string; images: ImageContent[] | undefined }> {
  if (!images || images.length === 0) return { text, images };
  if (model?.input?.includes("image")) return { text, images };

  try {
    await mkdir(VISION_TEMP_DIR, { recursive: true });

    const paths: string[] = [];
    for (const img of images) {
      const ext = img.mimeType.split("/")[1] ?? "png";
      const filepath = join(VISION_TEMP_DIR, `${randomUUID()}.${ext}`);
      await writeFile(filepath, Buffer.from(img.data, "base64"));
      paths.push(filepath);
    }

    const pathMarkers = paths.map((p) => `[Image: ${p}]`).join("\n");
    return { text: `${text}\n\n${pathMarkers}`, images: undefined };
  } catch (err) {
    console.error("[prompt] failed to save images to files, dropping:", err);
    // Fall back to stripping images silently
    return { text, images: undefined };
  }
}

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
  if (!live.session.modelRuntime.hasConfiguredAuth(model.provider)) {
    await reply.code(400).send({
      error: "auth_not_configured",
      message: `No API key configured for provider "${model.provider}". Add one via PUT /api/v1/config/auth/${model.provider}.`,
    });
    return undefined;
  }
  return live;
}

export const promptRoutes: FastifyPluginAsync = async (fastify) => {
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

      let { text, streamingBehavior, images } = req.body;

      // Expand @-file references before sending to the LLM
      const project = await getProject(live.projectId);
      if (project !== undefined) {
        text = await expandFileReferences(text, project.path);
      }

      // Save images to files if the model doesn't support vision natively
      let transformed = await maybeSaveImagesToFiles(live.session.model, text, images);
      text = transformed.text;
      images = transformed.images;

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
        // Disable auto-retry before abort so the SDK doesn't treat the
        // abort-caused provider error as a transient failure and retry
        // the same conversation turn (including re-executing tool calls
        // like web_search, fetch_content, etc.).
        //
        // Chain: user aborts → agent.abort() fires → LLM call rejects
        // with stopReason="error"/errorMessage=~"fetch failed" → SDK's
        // _isRetryableError() matches retryable patterns → _prepareRetry
        // removes the error message and retries the same messages with
        // backoff. By disabling retry here, _prepareRetry sees
        // settings.enabled=false and returns immediately.
        live.session.setAutoRetryEnabled(false);

        // Fire the abort signal immediately, then wait for the agent to
        // become idle with a timeout. The SDK's session.abort() calls
        // agent.abort() (fires the AbortController) and then awaits
        // agent.waitForIdle(). If an MCP tool (e.g. ctx_execute) is
        // in-flight, the abort signal propagates to the MCP client, but
        // waitForIdle() may hang if the transport doesn't reject the
        // pending call in time. A timeout ensures the route returns to
        // the client promptly — the agent loop will clean up in the
        // background.
        await withTimeout(live.session.abort(), ABORT_TIMEOUT_MS, "session.abort");
      } catch (err) {
        if (err instanceof TimeoutError) {
          req.log.warn({ sessionId: req.params.id }, "abort timed out after " + ABORT_TIMEOUT_MS + "ms");
        }
        // best-effort — abort signal was already fired
      } finally {
        // Re-enable retry so subsequent provider errors (network flake,
        // rate limit) still get automatic recovery.
        try {
          live.session.setAutoRetryEnabled(true);
        } catch {
          // best-effort — session may have been disposed during abort
        }
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

      let { text, mode, images } = req.body;

      // Expand @-file references
      const project = await getProject(live.projectId);
      if (project !== undefined) {
        text = await expandFileReferences(text, project.path);
      }

      // Save images to files if the model doesn't support vision natively
      const transformed = await maybeSaveImagesToFiles(live.session.model, text, images);
      text = transformed.text;
      images = transformed.images;

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

/**
 * Wrap a Promise in a timeout.
 * Pattern from control.ts withTimeout.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

