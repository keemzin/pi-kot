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
  readEnabledModels,
  writeEnabledModels,
  AuthProviderNotFoundError,
  type ModelsJson,
  type ProvidersListingOptions,
} from "../config-manager.js";
import {
  setToolEnabled,
  setProjectToolOverride,
  listToolOverrides,
  isToolEffective,
} from "../tool-overrides.js";
import { getStatus as mcpGetStatus, customToolsForProject, ensureProjectLoaded } from "../mcp/manager.js";
import { getProject } from "../project-manager.js";

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
  fastify.get<{ Querystring: { scoped?: string } }>(
    "/config/providers",
    {
      schema: {
        description:
          "Live provider + model listing assembled from the SDK's ModelRegistry. Pass ?scoped=true to hide models not in the enabledModels list.",
        tags: ["config"],
        querystring: {
          type: "object",
          properties: { scoped: { type: "string" } },
        },
        response: { 200: { type: "object", required: ["providers"], properties: { providers: { type: "array" } } }, 500: errorSchema },
      },
    },
    async (req, reply) => {
      try {
        const opts: ProvidersListingOptions = {};
        if (req.query.scoped === "true") opts.scoped = true;
        return liveProvidersListing(opts);
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

  // ── Enabled models (scope) ───────────────────────────────────────────
  fastify.get(
    "/config/enabled-models",
    {
      schema: {
        description:
          "Read enabledModels from settings. Returns an array of 'provider/modelId' strings, or null when all models are visible.",
        tags: ["config"],
        response: {
          200: {
            type: "object",
            required: ["enabledModels"],
            properties: {
              enabledModels: {
                type: "array",
                items: { type: "string" },
                nullable: true,
              },
            },
          },
          500: errorSchema,
        },
      },
    },
    async (_req, reply) => {
      try {
        const enabledModels = readEnabledModels() ?? null;
        return { enabledModels };
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  fastify.put<{ Body: { enabledModels: string[] | null } }>(
    "/config/enabled-models",
    {
      schema: {
        description:
          "Persist enabledModels (array of 'provider/modelId' strings) to settings. Pass null to disable scoping.",
        tags: ["config"],
        body: {
          type: "object",
          required: ["enabledModels"],
          additionalProperties: false,
          properties: {
            enabledModels: {
              type: "array",
              items: { type: "string" },
              nullable: true,
            },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["enabledModels"],
            properties: {
              enabledModels: {
                type: "array",
                items: { type: "string" },
                nullable: true,
              },
            },
          },
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      try {
        writeEnabledModels(req.body.enabledModels);
        const result = readEnabledModels() ?? null;
        return { enabledModels: result };
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  // ---- Tool listing ----
  const BUILTIN_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];
  const BUILTIN_TOOL_DESCRIPTIONS: Record<string, string> = {
    read: "Read a file from the filesystem",
    bash: "Execute a bash command",
    edit: "Edit an existing file",
    write: "Write a new file",
    grep: "Search file contents",
    find: "Find files by name",
    ls: "List directory contents",
  };

/**
 * Derive a human-readable package name from a source info baseDir or source.
 * e.g. "/home/user/.pi/agent/npm/node_modules/@ayulab/pi-rewind" → "@ayulab/pi-rewind"
 */
function friendlySourceName(src: string): string {
  const nmIndex = src.lastIndexOf("node_modules/");
  if (nmIndex !== -1) {
    const afterNm = src.slice(nmIndex + "node_modules/".length);
    const parts = afterNm.split("/");
    if (parts[0]?.startsWith("@")) {
      return `${parts[0]}/${parts[1] ?? ""}`;
    }
    return parts[0] ?? src;
  }
  return src;
}
  fastify.get<{ Querystring: { projectId?: string } }>(
    "/config/tools",
    {
      schema: {
        description: "List all tools across builtin, MCP, and extension families.",
        tags: ["config"],
        querystring: {
          type: "object",
          properties: { projectId: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const projectId = (req.query as { projectId?: string }).projectId;
      const { readToolOverrides: readOverrides } = await import("../tool-overrides.js");
      const overrides = await readOverrides();

      // Builtin tools
      const builtin = BUILTIN_TOOL_NAMES.map((name) => ({
        name,
        description: BUILTIN_TOOL_DESCRIPTIONS[name] ?? "",
        enabled: isToolEffective(overrides, projectId, "builtin", name),
        globalEnabled: !overrides.builtin.includes(name),
      }));

      // MCP tools
      let mcpTools: Array<{
        server: string;
        scope: "global" | "project";
        projectId?: string;
        enabled: boolean;
        state: string;
        lastError?: string;
        tools: Array<{ name: string; shortName: string; description: string; enabled: boolean; globalEnabled: boolean }>;
      }> = [];

      if (projectId !== undefined) {
        const project = await getProject(projectId);
        if (project !== undefined) {
          await ensureProjectLoaded(project.id, project.path);
        }
      }

      const mcpStatus = mcpGetStatus(projectId !== undefined ? { projectId } : undefined);
      for (const srv of mcpStatus) {
        const tools = srv.tools.map((t) => ({
          name: t.name,
          shortName: t.shortName,
          description: t.description,
          enabled: isToolEffective(overrides, projectId, "mcp", t.name),
          globalEnabled: !overrides.mcp.includes(t.name),
        }));
        mcpTools.push({
          server: srv.name,
          scope: srv.scope,
          projectId: srv.projectId,
          enabled: srv.enabled,
          state: srv.state,
          lastError: srv.lastError,
          tools,
        });
      }

      // Extension-contributed tools — collect from all live sessions
      const extensionTools: Array<{ packageSource: string; tools: typeof builtin }> = [];
      const seenExtensionTools = new Set<string>();
      const { listSessions } = await import("../session-registry.js");
      for (const live of listSessions()) {
        const runner = live.session.extensionRunner;
        const tools = runner.getAllRegisteredTools();
        for (const t of tools) {
          if (!seenExtensionTools.has(t.definition.name)) {
            seenExtensionTools.add(t.definition.name);
          }
        }
        // Group by source (approximate — use extension path prefix)
        const bySource = new Map<string, typeof builtin>();
        for (const t of tools) {
          if (!seenExtensionTools.has(t.definition.name)) continue;
          seenExtensionTools.delete(t.definition.name); // only show once
          const src = t.sourceInfo?.baseDir ?? t.sourceInfo?.source ?? "extension";
          const pkgName = friendlySourceName(src);
          const arr = bySource.get(pkgName) ?? [];
          arr.push({
            name: t.definition.name,
            description:
              typeof t.definition.description === "string"
                ? t.definition.description
                : "",
            enabled: isToolEffective(overrides, projectId, "extension", t.definition.name),
            globalEnabled: !overrides.extension.includes(t.definition.name),
          });
          bySource.set(pkgName, arr);
        }
        for (const [pkgSource, toolList] of bySource) {
          extensionTools.push({ packageSource: pkgSource, tools: toolList });
        }
      }

      return { builtin, mcp: mcpTools, extension: extensionTools };
    },
  );

  fastify.get(
    "/config/tools/overrides",
    {
      schema: {
        description: "All per-project tool overrides across all families.",
        tags: ["config"],
        response: {
          200: {
            type: "object",
            required: ["projects"],
            properties: {
              projects: {
                type: "object",
                additionalProperties: {
                  type: "object",
                  required: ["builtin", "mcp", "extension"],
                  properties: {
                    builtin: { type: "object", properties: { enable: { type: "array", items: { type: "string" } }, disable: { type: "array", items: { type: "string" } } } },
                    mcp: { type: "object", properties: { enable: { type: "array", items: { type: "string" } }, disable: { type: "array", items: { type: "string" } } } },
                    extension: { type: "object", properties: { enable: { type: "array", items: { type: "string" } }, disable: { type: "array", items: { type: "string" } } } },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      const projects = await listToolOverrides();
      return { projects };
    },
  );

  fastify.put<{
    Params: { family: string; name: string };
    Querystring: { projectId?: string };
    Body: { enabled: boolean; scope?: "global" | "project" };
  }>(
    "/config/tools/:family/:name/enabled",
    {
      schema: {
        description: "Toggle global or per-project tool enable/disable.",
        tags: ["config"],
        params: { type: "object", required: ["family", "name"], properties: { family: { type: "string" }, name: { type: "string" } } },
        body: { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" }, scope: { type: "string", enum: ["global", "project"] } } },
        response: { 200: { type: "object", properties: { ok: { type: "boolean" } } }, 400: errorSchema },
      },
    },
    async (req, reply) => {
      const family = req.params.family as "builtin" | "mcp" | "extension";
      if (!["builtin", "mcp", "extension"].includes(family)) {
        return reply.code(400).send({ error: "invalid_family" });
      }
      const { enabled, scope } = req.body;
      const projectId = (req.query as { projectId?: string }).projectId;

      if (scope === "project" && projectId !== undefined) {
        await setProjectToolOverride(projectId, family, req.params.name, enabled ? "enabled" : "disabled");
      } else {
        await setToolEnabled(family, req.params.name, enabled);
      }

      // Clear project override when re-enabling global (scope not set)
      if (scope !== "project" && projectId !== undefined && enabled) {
        await setProjectToolOverride(projectId, family, req.params.name, undefined);
      }

      return { ok: true };
    },
  );

  fastify.delete<{
    Params: { family: string; name: string };
    Querystring: { projectId?: string };
  }>(
    "/config/tools/:family/:name/enabled",
    {
      schema: {
        description: "Clear a per-project tool override (revert to inherit).",
        tags: ["config"],
        params: { type: "object", required: ["family", "name"], properties: { family: { type: "string" }, name: { type: "string" } } },
        response: { 200: { type: "object", properties: { ok: { type: "boolean" } } }, 400: errorSchema },
      },
    },
    async (req, reply) => {
      const family = req.params.family as "builtin" | "mcp" | "extension";
      if (!["builtin", "mcp", "extension"].includes(family)) {
        return reply.code(400).send({ error: "invalid_family" });
      }
      const projectId = (req.query as { projectId?: string }).projectId;
      if (projectId !== undefined) {
        await setProjectToolOverride(projectId, family, req.params.name, undefined);
      }
      return { ok: true };
    },
  );
};
