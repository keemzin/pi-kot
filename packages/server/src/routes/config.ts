import { type FastifyPluginAsync } from "fastify";
import {
  liveProvidersListing,
  readAuthSummary,
  writeApiKey,
  removeApiKey,
  readSettings,
  updateSettings,
  readModelsJsonRedacted,
  writeModelsJson,
  AuthProviderNotFoundError,
  type ModelsJson,
} from "../config-manager.js";

// ── Schema ────────────────────────────────────────────────────────────────

const errorSchema = {
  type: "object",
  required: ["error"],
  properties: { error: { type: "string" } },
} as const;

const authSummarySchema = {
  type: "object",
  required: ["providers"],
  properties: {
    providers: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["configured"],
        properties: {
          configured: { type: "boolean" },
          source: { type: "string" },
          label: { type: "string" },
        },
      },
    },
  },
} as const;

const settingsSchema = {
  type: "object",
  additionalProperties: true,
} as const;

const modelsJsonSchema = {
  type: "object",
  required: ["providers"],
  additionalProperties: true,
  properties: {
    providers: { type: "object", additionalProperties: true },
  },
} as const;

// ── Routes ────────────────────────────────────────────────────────────────

export const configRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Providers (live listing) ──────────────────────────────────────────
  fastify.get(
    "/config/providers",
    {
      schema: {
        description:
          "Live provider + model listing assembled from the SDK's ModelRegistry.",
        tags: ["config"],
        response: { 200: { type: "object", required: ["providers"], properties: { providers: { type: "array" } } }, 500: errorSchema },
      },
    },
    async (_req, reply) => {
      try {
        return liveProvidersListing();
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  // ── Auth presence ─────────────────────────────────────────────────────
  fastify.get(
    "/config/auth",
    {
      schema: {
        description: "Provider credential presence map. Never includes actual key values.",
        tags: ["config"],
        response: { 200: authSummarySchema, 500: errorSchema },
      },
    },
    async (_req, reply) => {
      try {
        return readAuthSummary();
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  // ── Set API key ───────────────────────────────────────────────────────
  fastify.put<{ Params: { provider: string }; Body: { apiKey: string } }>(
    "/config/auth/:provider",
    {
      schema: {
        description: "Store an API key for a provider.",
        tags: ["config"],
        params: {
          type: "object",
          required: ["provider"],
          properties: { provider: { type: "string", minLength: 1 } },
        },
        body: {
          type: "object",
          required: ["apiKey"],
          additionalProperties: false,
          properties: { apiKey: { type: "string", minLength: 1 } },
        },
        response: {
          200: {
            type: "object",
            required: ["provider", "configured"],
            properties: {
              provider: { type: "string" },
              configured: { type: "boolean", const: true },
            },
          },
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      try {
        writeApiKey(req.params.provider, req.body.apiKey);
        return { provider: req.params.provider, configured: true };
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  // ── Remove API key ────────────────────────────────────────────────────
  fastify.delete<{ Params: { provider: string } }>(
    "/config/auth/:provider",
    {
      schema: {
        description: "Remove credentials for a provider.",
        tags: ["config"],
        params: {
          type: "object",
          required: ["provider"],
          properties: { provider: { type: "string", minLength: 1 } },
        },
        response: { 204: { type: "null" }, 404: errorSchema, 500: errorSchema },
      },
    },
    async (req, reply) => {
      try {
        removeApiKey(req.params.provider);
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof AuthProviderNotFoundError) {
          return reply.code(404).send({ error: "auth_provider_not_found" });
        }
        fastify.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  // ── Read settings ─────────────────────────────────────────────────────
  fastify.get(
    "/config/settings",
    {
      schema: {
        description: "Read settings.json (default provider/model, modes, etc).",
        tags: ["config"],
        response: { 200: settingsSchema, 500: errorSchema },
      },
    },
    async (_req, reply) => {
      try {
        return readSettings();
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  // ── Update settings ───────────────────────────────────────────────────
  fastify.put<{ Body: Record<string, unknown> }>(
    "/config/settings",
    {
      schema: {
        description:
          "Partial-merge update for settings.json. Sending null for any key deletes it.",
        tags: ["config"],
        body: settingsSchema,
        response: { 200: settingsSchema, 500: errorSchema },
      },
    },
    async (req, reply) => {
      try {
        return updateSettings(req.body);
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  // ── Read models.json (redacted) ───────────────────────────────────────
  fastify.get(
    "/config/models",
    {
      schema: {
        description:
          "Read models.json with API keys redacted.",
        tags: ["config"],
        response: { 200: modelsJsonSchema, 500: errorSchema },
      },
    },
    async (_req, reply) => {
      try {
        return await readModelsJsonRedacted();
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  // ── Write models.json ─────────────────────────────────────────────────
  fastify.put<{ Body: ModelsJson }>(
    "/config/models",
    {
      schema: {
        description: "Replace models.json atomically.",
        tags: ["config"],
        body: modelsJsonSchema,
        response: { 200: modelsJsonSchema, 500: errorSchema },
      },
    },
    async (req, reply) => {
      try {
        await writeModelsJson(req.body);
        return req.body;
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );
};
