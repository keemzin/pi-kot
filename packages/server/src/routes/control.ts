import { join } from "node:path";
import { type FastifyPluginAsync } from "fastify";
import {
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { getSession, listSessions, rebuildSessionTools } from "../session-store.js";
import { config } from "../config.js";
import { readSettings, writeSettings } from "../config-store.js";



/**
 * Error schema helper for route responses.
 * Pattern from routes/_schemas.
 */
const errorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: { type: "string" },
    message: { type: "string" },
  },
} as const;

/**
 * Wrap a Promise in a timeout. The SDK's compact call awaits an LLM
 * round-trip; without a timeout, a hung provider holds the HTTP request
 * open indefinitely. We surface 504 on timeout so the client can recover.
 *
 * Note: this does NOT abort the underlying SDK call — that needs an
 * AbortSignal threaded through, which the current SDK API doesn't
 * fully expose. The in-flight LLM call will eventually resolve or
 * reject server-side; the route just returns to the client first.
 *
 * Pattern from control.ts withTimeout.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
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

const COMPACT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Map SDK throw strings — which are plain Error with English messages —
 * to stable error codes the API contract documents. The SDK has no typed
 * error classes for these cases, so message-substring matching is the
 * best we can do.
 *
 * Pattern from control.ts mapSdkError.
 */
function mapSdkError(reply: import("fastify").FastifyReply, err: unknown): import("fastify").FastifyReply {
  if (!(err instanceof Error)) {
    return reply.code(500).send({ error: "internal_error" });
  }
  const m = err.message;
  if (/already compacted/i.test(m)) {
    return reply.code(400).send({ error: "already_compacted" });
  }
  if (/nothing to compact/i.test(m)) {
    return reply.code(400).send({ error: "nothing_to_compact" });
  }
  if (/no model/i.test(m)) {
    return reply.code(400).send({ error: "no_model_configured" });
  }
  if (/no api key found/i.test(m)) {
    return reply.code(400).send({ error: "no_api_key" });
  }
  if (/compaction cancelled/i.test(m)) {
    return reply.code(409).send({ error: "compaction_cancelled" });
  }
  return reply.code(500).send({ error: "internal_error" });
}

export const controlRoutes: FastifyPluginAsync = async (fastify) => {
  // ── POST /sessions/:id/model — set per-session model (+ optional thinking level) ──
  fastify.post<{
    Params: { id: string };
    Body: { provider: string; modelId: string; thinkingLevel?: string };
  }>(
    "/sessions/:id/model",
    {
      schema: {
        description:
          "Set the model for a session, and optionally the thinking level. " +
          "Provider + modelId are validated against the SDK's ModelRegistry. " +
          "Returns an error if the provider or model is unknown, or if no " +
          "API key is configured for the provider.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["provider", "modelId"],
          properties: {
            provider: { type: "string" },
            modelId: { type: "string" },
            thinkingLevel: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["provider", "modelId", "thinkingLevel"],
            properties: {
              provider: { type: "string" },
              modelId: { type: "string" },
              thinkingLevel: { type: "string" },
              availableThinkingLevels: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
          400: errorSchema,
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

      const { provider, modelId, thinkingLevel } = req.body;

      // Build fresh ModelRuntime (reads latest auth.json + models.json)
      const modelRuntime = await ModelRuntime.create({
        authPath: join(config.piConfigDir, "auth.json"),
        modelsPath: join(config.piConfigDir, "models.json"),
      });

      // Check provider exists
      const providerKnown = modelRuntime.getProvider(provider) !== undefined;
      if (!providerKnown) {
        return reply.code(400).send({
          error: "unknown_provider",
          message: `Provider "${provider}" not found. Check available providers via GET /config/providers.`,
        });
      }

      // Check model exists under that provider
      const model = modelRuntime.getModel(provider, modelId);
      if (model === undefined) {
        return reply.code(400).send({
          error: "unknown_model",
          message: `Model "${modelId}" not found under provider "${provider}".`,
        });
      }

      // Check auth is configured for this provider
      if (!modelRuntime.hasConfiguredAuth(provider)) {
        return reply.code(400).send({
          error: "auth_not_configured",
          message: `No API key configured for provider "${provider}". Add one via PUT /api/v1/config/auth/${provider}.`,
        });
      }

      // Set the model on the live session.
      //
      // ⚠️ Pi SDK side effect: session.setModel() calls
      // settingsManager.setDefaultModelAndProvider() which writes to
      // settings.json — picking a model for ONE session would otherwise
      // mutate the global default for EVERY new session.
      //
      // We snapshot settings.json BEFORE the call and restore it AFTER,
      // so the per-session change doesn't leak. Snapshot before / restore after.
      //
      // The snapshot is best-effort: if settings.json doesn't exist
      // (first launch) we skip the restore.
      type SetModelResult =
        | { ok: true }
        | { ok: false; status: number; body: { error: string; message?: string } };

      const result = await (async (): Promise<SetModelResult> => {
        let priorSettings: Record<string, unknown> | undefined;
        try {
          priorSettings = readSettings();
        } catch {
          // settings.json missing / unreadable — skip restore
        }

        try {
          // Refresh the session's internal model runtime so it picks up
          // any API keys added after session creation.
          await live.session.modelRuntime.reloadConfig();

          // Pass the full model object from the registry, not a {provider, id} stub.
          // ⚠️ The SDK's setModel() stores the model object in agent.state.model, and
          //    the agent later reads fields like `api`, `baseUrl`, `contextWindow`,
          //    `maxTokens` from it to route LLM requests. Passing a stub with only
          //    `provider` + `id` leaves those fields as undefined, which silently
          //    breaks every subsequent prompt — the session appears "dead."
          //    Pattern: pass the full model from registry.find().
          await live.session.setModel(model as Parameters<typeof live.session.setModel>[0]);
        } catch (err) {
          return {
            ok: false,
            status: 400,
            body: {
              error: "set_model_failed",
              message: err instanceof Error ? err.message : String(err),
            },
          };
        }

        // Restore prior settings to undo setModel's side effect
        if (priorSettings !== undefined) {
          try {
            await writeSettings(priorSettings);
          } catch (err) {
            req.log.warn({ err }, "failed to restore settings after per-session setModel");
          }
        }

        return { ok: true };
      })();

      if (!result.ok) {
        return reply.code(result.status).send(result.body);
      }

      // Apply thinking level after model change (level must be clamped to new model)
      if (thinkingLevel !== undefined) {
        const available = live.session.getAvailableThinkingLevels();
        if (available.includes(thinkingLevel as any)) {
          live.session.setThinkingLevel(thinkingLevel as any);
        }
        // silently ignore invalid levels — the client can re-fetch
      }

      return {
        provider,
        modelId,
        thinkingLevel: live.session.thinkingLevel,
        availableThinkingLevels: live.session.getAvailableThinkingLevels(),
      };
    },
  );

  // ── GET /sessions/:id/model — get current model + thinking info ──
  fastify.get<{
    Params: { id: string };
  }>(
    "/sessions/:id/model",
    {
      schema: {
        description: "Get the currently configured model and thinking level for a session.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["provider", "modelId", "thinkingLevel"],
            properties: {
              provider: { type: "string" },
              modelId: { type: "string" },
              thinkingLevel: { type: "string" },
              availableThinkingLevels: {
                type: "array",
                items: { type: "string" },
              },
            },
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
        // Session not in memory (e.g. from before a server restart) —
        // return empty defaults so the client doesn't log 404 errors.
        return { provider: "", modelId: "", thinkingLevel: "off", availableThinkingLevels: [] };
      }
      const model = live.session.model;
      if (model === undefined) {
        return reply.code(200).send({ provider: "", modelId: "", thinkingLevel: "off", availableThinkingLevels: [] });
      }
      return {
        provider: model.provider,
        modelId: model.id,
        thinkingLevel: live.session.thinkingLevel,
        availableThinkingLevels: live.session.getAvailableThinkingLevels(),
      };
    },
  );

  // ── POST /sessions/:id/thinking — set thinking level (no model change) ──
  fastify.post<{
    Params: { id: string };
    Body: { thinkingLevel: string };
  }>(
    "/sessions/:id/thinking",
    {
      schema: {
        description:
          "Set the thinking/reasoning level for a session without changing " +
          "the model. Validates the level against the session's available " +
          "thinking levels.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["thinkingLevel"],
          properties: {
            thinkingLevel: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["thinkingLevel"],
            properties: {
              thinkingLevel: { type: "string" },
              availableThinkingLevels: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
          400: errorSchema,
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

      const { thinkingLevel } = req.body;
      const available = live.session.getAvailableThinkingLevels();

      if (!available.includes(thinkingLevel as any)) {
        return reply.code(400).send({
          error: "invalid_thinking_level",
          message: `"${thinkingLevel}" is not available. Available levels: ${available.join(", ")}`,
        });
      }

      live.session.setThinkingLevel(thinkingLevel as any);

      return {
        thinkingLevel: live.session.thinkingLevel,
        availableThinkingLevels: live.session.getAvailableThinkingLevels(),
      };
    },
  );

  // ── POST /sessions/:id/compact — manual compaction ──────────────

  fastify.post<{
    Params: { id: string };
    Body: { customInstructions?: string };
  }>(
    "/sessions/:id/compact",
    {
      schema: {
        description:
          "Manually compact the session context. Aborts any in-flight " +
          "agent operation first. Returns 400 with a stable error code if " +
          "the session is too small to compact, has already been compacted, " +
          "or has no model configured.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: { customInstructions: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              summary: { type: "string" },
              tokensBefore: { type: "integer", minimum: 0 },
            },
          },
          400: errorSchema,
          404: errorSchema,
          409: errorSchema,
          504: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const live = getSession(req.params.id);
      if (live === undefined) {
        return reply.code(404).send({ error: "session_not_found" });
      }
      try {
        const result = await withTimeout(
          live.session.compact(req.body.customInstructions),
          COMPACT_TIMEOUT_MS,
          "compact",
        );
        // SDK returns { summary, firstKeptEntryId, tokensBefore, details }.
        // Cast safely with defaults so an SDK shape change doesn't
        // surface "undefined" as a string in the response.
        const r = result as {
          summary?: unknown;
          tokensBefore?: unknown;
        };
        return {
          summary: typeof r.summary === "string" ? r.summary : "",
          tokensBefore: typeof r.tokensBefore === "number" ? r.tokensBefore : 0,
        };
      } catch (err) {
        if (err instanceof TimeoutError) {
          req.log.warn({ err, sessionId: req.params.id }, "compact timed out");
          return reply.code(504).send({ error: "compact_timeout", message: err.message });
        }
        return mapSdkError(reply, err);
      }
    },
  );

  // ── POST /control/reload — reload agent config via CLI ───────────

  fastify.post(
    "/control/reload",
    {
      schema: {
        description:
          "Reload the pi agent configuration by delegating to the pi CLI. " +
          "Runs `pi reload` in the background. If the CLI is not available, " +
          "falls back to re-reading settings and MCP configs in-process.",
        tags: ["control"],
        response: {
          200: {
            type: "object",
            properties: {
              reloaded: { type: "boolean" },
              method: { type: "string" },
            },
          },
          500: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (_req, reply) => {
      try {
        const allSessions = listSessions();

        // 1. SDK full reload on every live session.
        //    session.reload() re-reads settings.json, re-discovers
        //    extensions/skills/prompts/themes/context files, resets
        //    API providers, and rebuilds the extension runtime.
        //    Sessions stay live — no reconnect needed.
        const reloadResults = await Promise.allSettled(
          allSessions.map(async (s) => {
            try {
              await s.session.reload();
            } catch (err) {
              _req.log.warn(
                { sessionId: s.sessionId, err },
                "control/reload: session.reload() failed",
              );
            }
          }),
        );
        const reloaded = reloadResults.filter(
          (r) => r.status === "fulfilled",
        ).length;

        // 2. Reload MCP configs (re-reads settings + re-launches servers).
        //    This is outside the SDK's resource loader, so we do it
        //    separately.
        const { loadGlobal: reloadMcp } = await import("../mcp/manager.js");
        await reloadMcp();

        // 3. Clear extension discovery cache so the /extensions API
        //    returns fresh data on the next fetch.
        const { clearExtensionCache } = await import("../extension-manager.js");
        clearExtensionCache();

        // 4. Rebuild tools for all live sessions so newly installed
        //    extensions are available immediately.
        const rebuildResults = await Promise.allSettled(
          allSessions.map((s) => rebuildSessionTools(s.sessionId)),
        );
        const rebuilt = rebuildResults.filter(
          (r) => r.status === "fulfilled",
        ).length;

        _req.log.info(
          { reloaded, rebuilt, total: allSessions.length },
          "control/reload: sessions reloaded, MCP refreshed, tools rebuilt",
        );
        return { reloaded: true, method: "sdk-inprocess" };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        _req.log.error(err, "control/reload failed");
        return reply.code(500).send({ error: message });
      }
    },
  );
};
