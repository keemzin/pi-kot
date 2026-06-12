import { type FastifyPluginAsync } from "fastify";
import {
  AuthStorage,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import { getSession } from "../session-registry.js";
import { config } from "../config.js";

function authStorage() {
  return AuthStorage.create(config.piConfigDir);
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

      // Set the model on the live session
      try {
        live.session.modelRegistry.authStorage.reload();
        live.session.modelRegistry.refresh();

        await live.session.setModel({
          provider: model.provider,
          id: model.id,
        } as Parameters<typeof live.session.setModel>[0]);
      } catch (err) {
        return reply.code(400).send({
          error: "set_model_failed",
          message: err instanceof Error ? err.message : String(err),
        });
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
};
