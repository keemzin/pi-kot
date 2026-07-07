/**
 * Routes for extension discovery and install.
 * GET  /extensions          — list detected + recommended extensions
 * POST /extensions/install  — install a recommended extension
 */

import { type FastifyPluginAsync } from "fastify";
import {
  discoverExtensions,
  installExtension,
  installManualExtension,
  uninstallExtension,
  checkExtensionUpdates,
  updateExtension,
} from "../extension-manager.js";
import { listSessions, rebuildSessionTools } from "../session-store.js";
import { config } from "../config.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

const VISION_CONFIG_PATH = join(config.piConfigDir, "vision-tool.json");

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
        if (result.success) {
          await rebuildActiveSessions(req.log);
        }
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        req.log.error(err, "Failed to install extension");
        return reply.status(500).send({ error: message });
      }
    },
  );

  // ── POST /api/v1/extensions/install-manual ──────────────────────────

  fastify.post(
    "/extensions/install-manual",
    {
      schema: {
        description:
          "Install from a pi install spec (npm:package, git:github.com/user/repo, etc.). " +
          "Delegates to `pi install` CLI first, falls back to npm install for npm: packages.",
        tags: ["extensions"],
        body: {
          type: "object",
          required: ["package"],
          properties: {
            package: {
              type: "string",
              description:
                "Install spec, e.g. 'npm:pi-free' or 'git:github.com/apmantza/pi-free'",
            },
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
        const result = await installManualExtension(pkg);
        if (result.success) {
          await rebuildActiveSessions(req.log);
        }
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        req.log.error(err, "Failed to install extension manually");
        return reply.status(500).send({ error: message });
      }
    },
  );

  // ── GET /api/v1/extensions/updates ────────────────────────────────────

  fastify.get(
    "/extensions/updates",
    {
      schema: {
        description: "Check npm registry for newer versions of installed extensions",
        tags: ["extensions"],
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                package: { type: "string" },
                name: { type: "string" },
                installed: { type: "string" },
                latest: { type: "string" },
                updateAvailable: { type: "boolean" },
              },
            },
          },
          ...autoError,
        },
      },
    },
    async (_req, reply) => {
      try {
        const updates = await checkExtensionUpdates();
        return reply.send(updates);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        _req.log.error(err, "Failed to check extension updates");
        return reply.status(500).send({ error: message });
      }
    },
  );

  // ── POST /api/v1/extensions/update ──────────────────────────────────

  fastify.post(
    "/extensions/update",
    {
      schema: {
        description: "Update an installed extension to the latest version",
        tags: ["extensions"],
        body: {
          type: "object",
          required: ["package"],
          properties: {
            package: { type: "string", description: "Package name" },
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
        const result = await updateExtension(pkg);
        if (result.success) {
          await rebuildActiveSessions(req.log);
        }
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        req.log.error(err, "Failed to update extension");
        return reply.status(500).send({ error: message });
      }
    },
  );

  // ── GET /api/v1/extensions/vision-config ─────────────────────────────

  fastify.get(
    "/extensions/vision-config",
    {
      config: { public: true },
      schema: {
        description: "Get pi-vision-tool configuration (only meaningful when the extension is installed)",
        tags: ["extensions"],
        response: {
          200: {
            type: "object",
            properties: {
              provider: { type: "string" },
              model: { type: "string" },
              enabled: { type: "boolean" },
              installed: { type: "boolean" },
              maxDimension: { type: "number" },
              jpegQuality: { type: "number" },
              defaultReasoningEffort: { type: "string" },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      // Check if pi-vision-tool is installed
      const extResult = await discoverExtensions();
      const installed = extResult.detected.some(
        (e) => e.name === "pi-vision-tool" || e.package === "npm:pi-vision-tool",
      );

      if (!installed) {
        return reply.send({ installed: false });
      }

      try {
        const raw = await readFile(VISION_CONFIG_PATH, "utf-8");
        const cfg = JSON.parse(raw);
        return reply.send({
          installed: true,
          provider: cfg.provider || null,
          model: cfg.model || null,
          enabled: cfg.enabled !== false,
          maxDimension: cfg.maxDimension ?? 1568,
          jpegQuality: cfg.jpegQuality ?? 85,
          defaultReasoningEffort: cfg.defaultReasoningEffort ?? "off",
        });
      } catch {
        return reply.send({
          installed: true,
          enabled: true,
          maxDimension: 1568,
          jpegQuality: 85,
          defaultReasoningEffort: "off",
        });
      }
    },
  );

  // ── PUT /api/v1/extensions/vision-config ─────────────────────────────

  fastify.put(
    "/extensions/vision-config",
    {
      schema: {
        description: "Update pi-vision-tool configuration",
        tags: ["extensions"],
        body: {
          type: "object",
          properties: {
            provider: { type: "string" },
            model: { type: "string" },
            enabled: { type: "boolean" },
            maxDimension: { type: "number" },
            jpegQuality: { type: "number" },
            defaultReasoningEffort: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              saved: { type: "boolean" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { provider, model, enabled, maxDimension, jpegQuality, defaultReasoningEffort } =
        req.body as {
          provider?: string;
          model?: string;
          enabled?: boolean;
          maxDimension?: number;
          jpegQuality?: number;
          defaultReasoningEffort?: string;
        };
      let existing: Record<string, unknown> = {};
      try {
        const raw = await readFile(VISION_CONFIG_PATH, "utf-8");
        existing = JSON.parse(raw);
      } catch {
        // doesn't exist yet
      }

      const updated: Record<string, unknown> = {
        ...existing,
      };
      if (provider !== undefined) updated.provider = provider;
      if (model !== undefined) updated.model = model;
      if (enabled !== undefined) updated.enabled = enabled;
      if (maxDimension !== undefined) updated.maxDimension = maxDimension;
      if (jpegQuality !== undefined) updated.jpegQuality = jpegQuality;
      if (defaultReasoningEffort !== undefined) updated.defaultReasoningEffort = defaultReasoningEffort;

      await mkdir(dirname(VISION_CONFIG_PATH), { recursive: true });
      await writeFile(VISION_CONFIG_PATH, JSON.stringify(updated, null, 2) + "\n");

      return reply.send({ saved: true });
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
        if (result.success) {
          await rebuildActiveSessions(req.log);
        }
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        req.log.error(err, "Failed to uninstall extension");
        return reply.status(500).send({ error: message });
      }
    },
  );
};

/**
 * After an extension install/uninstall/update, rebuild all active sessions
 * so the new tools and commands become available without creating a new session.
 */
async function rebuildActiveSessions(logger: {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}): Promise<void> {
  const sessions = listSessions();
  for (const live of sessions) {
    try {
      await rebuildSessionTools(live.sessionId);
      logger.info({ sessionId: live.sessionId }, "Rebuilt session tools after extension change");
    } catch (err) {
      logger.error({ err, sessionId: live.sessionId }, "Failed to rebuild session tools");
    }
  }
}
