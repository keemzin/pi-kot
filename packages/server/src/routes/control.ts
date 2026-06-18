import { join } from "node:path";
import { type FastifyPluginAsync } from "fastify";
import {
  AuthStorage,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import { getSession, listSessions, rebuildSessionTools } from "../session-registry.js";
import { config } from "../config.js";
import { readSettings, writeSettings } from "../config-manager.js";

/**
 * Auth storage backed by ~/.pi/agent/auth.json.
 * ⚠️ AuthStorage.create() expects a FILE path, not a directory.
 *    Passing a directory causes the ReadFileSync to fail silently,
 *    leaving authStorage.data empty and hasAuth() always returning false.
 *    This was the root cause of the "No API key configured" error.
 *    Pattern from pi-forge's config-manager.ts: AUTH_FILE path.
 */
function authStorage() {
  return AuthStorage.create(join(config.piConfigDir, "auth.json"));
}

export const controlRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /sessions/:id/model — set per-session model override
  fastify.post<{
    Params: { id: string };
    Body: { provider: string; modelId: string };
  }>(
    "/sessions/:id/model",
    {
      schema: {
        description:
          "Set the model for a session. Provider + modelId are validated " +
          "against the SDK's ModelRegistry. Returns an error if the provider " +
          "or model is unknown, or if no API key is configured for the provider.",
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
          },
        },
        response: {
          200: {
            type: "object",
            required: ["provider", "modelId"],
            properties: {
              provider: { type: "string" },
              modelId: { type: "string" },
            },
          },
          400: {
            type: "object",
            required: ["error"],
            properties: {
              error: { type: "string" },
              message: { type: "string" },
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
        return reply.code(404).send({ error: "session_not_found" });
      }

      const { provider, modelId } = req.body;

      // Build fresh ModelRegistry (reads latest auth.json + models.json)
      const store = authStorage();
      const modelsFile = `${config.piConfigDir}/models.json`;
      const registry = ModelRegistry.create(store, modelsFile);

      // Check provider exists
      const providerKnown = registry.getAll().some((m) => m.provider === provider);
      if (!providerKnown) {
        return reply.code(400).send({
          error: "unknown_provider",
          message: `Provider "${provider}" not found. Check available providers via GET /config/providers.`,
        });
      }

      // Check model exists under that provider
      const model = registry.find(provider, modelId);
      if (model === undefined) {
        return reply.code(400).send({
          error: "unknown_model",
          message: `Model "${modelId}" not found under provider "${provider}".`,
        });
      }

      // Check auth is configured for this model
      const hasAuth = registry.hasConfiguredAuth(model);
      if (!hasAuth) {
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
      // so the per-session change doesn't leak. Pattern from pi-forge's
      // control.ts setModel handler.
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
          // Refresh the session's internal ModelRegistry so it picks up
          // any API keys added after session creation.
          live.session.modelRegistry.authStorage.reload();
          live.session.modelRegistry.refresh();

          // Pass the full model object from the registry, not a {provider, id} stub.
          // ⚠️ The SDK's setModel() stores the model object in agent.state.model, and
          //    the agent later reads fields like `api`, `baseUrl`, `contextWindow`,
          //    `maxTokens` from it to route LLM requests. Passing a stub with only
          //    `provider` + `id` leaves those fields as undefined, which silently
          //    breaks every subsequent prompt — the session appears "dead."
          //    Pattern from pi-forge: pass the full model from registry.find().
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

      return { provider, modelId };
    },
  );

  // GET /sessions/:id/model — get current model info
  fastify.get<{
    Params: { id: string };
  }>(
    "/sessions/:id/model",
    {
      schema: {
        description: "Get the currently configured model for a session.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["provider", "modelId"],
            properties: {
              provider: { type: "string" },
              modelId: { type: "string" },
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
        return reply.code(404).send({ error: "session_not_found" });
      }
      const model = live.session.model;
      if (model === undefined) {
        return reply.code(200).send({ provider: "", modelId: "" });
      }
      return { provider: model.provider, modelId: model.id };
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
        // Reload MCP configs (re-reads settings + re-launches servers)
        const { loadGlobal: reloadMcp } = await import("../mcp/manager.js");
        await reloadMcp();

        // Clear extension discovery cache so the next fetch is fresh
        const { clearExtensionCache } = await import("../extension-manager.js");
        clearExtensionCache();

        // Rebuild tools for all live sessions so newly installed
        // extensions (pi-subagents, pi-processes, etc.) are available
        // immediately without reconnecting.
        const allSessions = listSessions();
        const rebuildResults = await Promise.allSettled(
          allSessions.map((s) => rebuildSessionTools(s.sessionId)),
        );
        const rebuilt = rebuildResults.filter(
          (r) => r.status === "fulfilled",
        ).length;

        _req.log.info(
          { rebuilt, total: allSessions.length },
          "control/reload: MCP reloaded, extension cache cleared, tools rebuilt",
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
