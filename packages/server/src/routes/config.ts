import type { FastifyPluginAsync } from "fastify";
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
  probeProvider,
  addCustomProvider,
  removeCustomProvider,
  type ModelsJson,
  type ProvidersListingOptions,
} from "../config-store.js";
import {
  setToolEnabled,
  setProjectToolOverride,
  listToolOverrides,
  isToolEffective,
} from "../tool-policy.js";
import { getStatus as mcpGetStatus, customToolsForProject, ensureProjectLoaded } from "../mcp/manager.js";
import { getProject } from "../workspace-store.js";
import { discoverExtensionResources } from "../extension-scanner.js";

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

  // ── Probe provider endpoint ──────────────────────────────────────────
  fastify.post<{ Body: { baseUrl: string; apiKey?: string; apiType?: string; headers?: Record<string, string> } }>(
    "/config/providers/probe",
    {
      schema: {
        description:
          "Test connectivity to a provider endpoint, auto-detect API type, and fetch available models.",
        tags: ["config"],
        body: {
          type: "object",
          required: ["baseUrl"],
          additionalProperties: false,
          properties: {
            baseUrl: { type: "string", minLength: 1 },
            apiKey: { type: "string" },
            apiType: { type: "string" },
            headers: { type: "object", additionalProperties: { type: "string" } },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["reachable"],
            properties: {
              reachable: { type: "boolean" },
              error: { type: "string" },
              detectedApiType: { type: "string" },
              suggestedName: { type: "string" },
              models: {
                type: "array",
                items: {
                  type: "object",
                  properties: { id: { type: "string" }, name: { type: "string" } },
                },
              },
            },
          },
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      try {
        const result = await probeProvider(req.body);
        return result;
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  // ── Add custom provider to models.json ───────────────────────────────
  fastify.post<{ Body: { providerName: string; config: Record<string, unknown> } }>(
    "/config/providers",
    {
      schema: {
        description:
          "Add or update a custom provider in models.json.",
        tags: ["config"],
        body: {
          type: "object",
          required: ["providerName", "config"],
          additionalProperties: false,
          properties: {
            providerName: { type: "string", minLength: 1 },
            config: { type: "object" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["providers"],
            properties: {
              providers: { type: "object", additionalProperties: true },
            },
          },
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      try {
        return await addCustomProvider(req.body.providerName, req.body.config);
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  // ── Remove custom provider from models.json ────────────────────────────
  fastify.delete<{ Params: { providerName: string } }>(
    "/config/providers/:providerName",
    {
      schema: {
        description:
          "Remove a custom provider from models.json.",
        tags: ["config"],
        params: {
          type: "object",
          required: ["providerName"],
          properties: { providerName: { type: "string", minLength: 1 } },
        },
        response: {
          200: {
            type: "object",
            required: ["providers"],
            properties: {
              providers: { type: "object", additionalProperties: true },
            },
          },
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      try {
        return await removeCustomProvider(req.params.providerName);
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
      const { readToolOverrides: readOverrides } = await import("../tool-policy.js");
      const overrides = await readOverrides();

      // Builtin tools
      const builtin = BUILTIN_TOOL_NAMES.map((name) => ({
        name,
        description: BUILTIN_TOOL_DESCRIPTIONS[name] ?? "",
        enabled: isToolEffective(overrides, projectId, "builtin", name),
        globalEnabled: !overrides.builtin.includes(name),
      }));

      // MCP tools
      const mcpTools: Array<{
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

      // Extension-contributed tools — discover from the filesystem
      // (no live session needed, matches forge behavior)
      const extResources = await discoverExtensionResources(
        process.cwd(),
      );
      for (const err of extResources.errors) {
        req.log.warn({ path: err.path }, "Extension discovery warning: %s", err.error);
      }
      const extensionGroups = new Map<string, typeof builtin>();
      for (const t of extResources.tools) {
        const existing = extensionGroups.get(t.packageSource) ?? [];
        existing.push({
          name: t.name,
          description: t.description,
          enabled: isToolEffective(overrides, projectId, "extension", t.name),
          globalEnabled: !overrides.extension.includes(t.name),
        });
        extensionGroups.set(t.packageSource, existing);
      }
      const extensionTools = Array.from(extensionGroups.entries()).map(([packageSource, tools]) => ({
        packageSource,
        tools,
      }));

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

  // ── UI Settings — persisted frontend preferences ───────────────────────
  fastify.get(
    "/config/ui-settings",
    {
      schema: {
        description: "Read user-facing UI preferences (theme, toggles).",
        tags: ["config"],
        response: { 200: { type: "object" }, 500: errorSchema },
      },
    },
    async (_req, reply) => {
      try {
        const { uiSettings } = await import("../ui-settings-store.js");
        return uiSettings.read();
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  fastify.put<{ Body: Record<string, unknown> }>(
    "/config/ui-settings",
    {
      schema: {
        description: "Partial-update UI preferences (patch).",
        tags: ["config"],
        body: { type: "object" },
        response: { 200: { type: "object" }, 500: errorSchema },
      },
    },
    async (req, reply) => {
      try {
        const { uiSettings } = await import("../ui-settings-store.js");
        return uiSettings.patch(req.body);
      } catch (err) {
        fastify.log.error(err);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );
};
