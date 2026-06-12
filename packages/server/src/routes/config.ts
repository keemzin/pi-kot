import { type FastifyPluginAsync } from "fastify";
import {
  AuthStorage,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { config } from "../config.js";

// ── Schema ────────────────────────────────────────────────────────────────

const providersListingSchema = {
  type: "object",
  required: ["providers"],
  properties: {
    providers: {
      type: "array",
      items: {
        type: "object",
        required: ["provider", "models"],
        properties: {
          provider: { type: "string" },
          models: {
            type: "array",
            items: {
              type: "object",
              required: [
                "id",
                "name",
                "contextWindow",
                "maxTokens",
                "reasoning",
                "input",
                "hasAuth",
                "supportedThinkingLevels",
              ],
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                contextWindow: { type: "integer" },
                maxTokens: { type: "integer" },
                reasoning: { type: "boolean" },
                input: { type: "array", items: { type: "string" } },
                hasAuth: { type: "boolean" },
                supportedThinkingLevels: {
                  type: "array",
                  items: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

const errorSchema = {
  type: "object",
  required: ["error"],
  properties: { error: { type: "string" } },
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────

function authStorage() {
  return AuthStorage.create(config.piConfigDir);
}

// ── Routes ────────────────────────────────────────────────────────────────

export const configRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /config/providers — live provider + model listing from SDK's ModelRegistry
  fastify.get(
    "/config/providers",
    {
      schema: {
        description:
          "Live provider + model listing assembled from the SDK's ModelRegistry " +
          "(combines built-in models with anything in models.json). Each model " +
          "carries a hasAuth boolean so the UI can dim entries with no key.",
        tags: ["config"],
        response: { 200: providersListingSchema, 500: errorSchema },
      },
    },
    async (_req, reply) => {
      try {
        const store = authStorage();
        const modelsFile = `${config.piConfigDir}/models.json`;
        const registry = ModelRegistry.create(store, modelsFile);
        const all = registry.getAll();

        const grouped = new Map<string, {
          provider: string;
          models: Array<{
            id: string;
            name: string;
            contextWindow: number;
            maxTokens: number;
            reasoning: boolean;
            input: string[];
            hasAuth: boolean;
            supportedThinkingLevels: string[];
          }>;
        }>();

        for (const m of all) {
          let entry = grouped.get(m.provider);
          if (entry === undefined) {
            entry = { provider: m.provider, models: [] };
            grouped.set(m.provider, entry);
          }
          entry.models.push({
            id: m.id,
            name: m.name,
            contextWindow: m.contextWindow,
            maxTokens: m.maxTokens,
            reasoning: m.reasoning,
            input: m.input,
            hasAuth: registry.hasConfiguredAuth(m),
            supportedThinkingLevels: getSupportedThinkingLevels(m),
          });
        }

        return { providers: Array.from(grouped.values()) };
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );
};
