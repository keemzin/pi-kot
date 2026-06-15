/**
 * Routes for extension discovery and install.
 * GET  /extensions          — list detected + recommended extensions
 * POST /extensions/install  — install a recommended extension
 */

import { type FastifyPluginAsync } from "fastify";
import {
  discoverExtensions,
  installExtension,
  uninstallExtension,
} from "../extension-manager.js";

// ── Schemas ─────────────────────────────────────────────────────────

const errorSchema = {
  type: "object",
  required: ["error"],
  properties: { error: { type: "string" } },
} as const;

const autoError = { "4xx": errorSchema, "5xx": errorSchema } as const;

// ── Plugin ──────────────────────────────────────────────────────────

export const extensionRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /api/v1/extensions ──────────────────────────────────────────

  fastify.get(
    "/extensions",
    {
      config: { public: true },
      schema: {
        description: "List all detected and recommended extensions",
        tags: ["extensions"],
        response: {
          200: {
            type: "object",
            required: ["detected", "recommended", "agents"],
            properties: {
              detected: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    source: { type: "string" },
                    description: { type: "string" },
                    version: { type: "string" },
                    agentTypes: { type: "array", items: { type: "string" } },
                    package: { type: "string" },
                    enablesFeatures: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                },
              },
              recommended: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    description: { type: "string" },
                    package: { type: "string" },
                    category: { type: "string" },
                    installed: { type: "boolean" },
                    verified: { type: "boolean" },
                    providesAgentTypes: {
                      type: "array",
                      items: { type: "string" },
                    },
                    enablesFeatures: {
                      type: "array",
                      items: { type: "string" },
                    },
                    icon: { type: "string" },
                  },
                },
              },
              agents: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    model: { type: "string" },
                    tools: { type: "array", items: { type: "string" } },
                    source: { type: "string" },
                  },
                },
              },
            },
          },
          ...autoError,
        },
      },
    },
    async (_req, reply) => {
      try {
        const result = await discoverExtensions();
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        _req.log.error(err, "Failed to discover extensions");
        return reply.status(500).send({ error: message });
      }
    },
  );

  // ── POST /api/v1/extensions/install ─────────────────────────────────

  fastify.post(
    "/extensions/install",
    {
      schema: {
        description: "Install a pi extension package",
        tags: ["extensions"],
        body: {
          type: "object",
          required: ["package"],
          properties: {
            package: { type: "string", description: "Package name (npm: prefix or bare)" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              error: { type: "string" },
            },
          },
          ...autoError,
        },
      },
    },
    async (req, reply) => {
      try {
        const { package: pkg } = req.body as { package: string };
        const result = await installExtension(pkg);
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        req.log.error(err, "Failed to install extension");
        return reply.status(500).send({ error: message });
      }
    },
  );

  // ── POST /api/v1/extensions/uninstall ────────────────────────────────

  fastify.post(
    "/extensions/uninstall",
    {
      schema: {
        description: "Uninstall a pi extension package",
        tags: ["extensions"],
        body: {
          type: "object",
          required: ["package"],
          properties: {
            package: { type: "string", description: "Package name (npm: prefix or bare)" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              error: { type: "string" },
            },
          },
          ...autoError,
        },
      },
    },
    async (req, reply) => {
      try {
        const { package: pkg } = req.body as { package: string };
        const result = await uninstallExtension(pkg);
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        req.log.error(err, "Failed to uninstall extension");
        return reply.status(500).send({ error: message });
      }
    },
  );
};
