import type { FastifyPluginAsync, FastifyReply } from "fastify";
import {
  deleteMcpServer,
  readMcpJsonRedacted,
  setMcpDisabled,
  upsertMcpServer,
  type McpServerConfig,
  type McpTransport,
} from "../mcp/config.js";
import {
  customToolsForProject,
  ensureProjectLoaded,
  getStatus,
  isGloballyEnabled,
  probe,
  reconnectGatedStdioForProject,
  reloadGlobal,
  unloadProject,
} from "../mcp/manager.js";
import { grantStdioTrust, isStdioTrustedForProject, revokeStdioTrust } from "../mcp/stdio-trust.js";
import { getProject } from "../project-manager.js";
import { errorSchema } from "./_schemas.js";

interface McpServerBody {
  enabled?: boolean;
  url?: string;
  transport?: McpTransport;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

const serverConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" },
    url: { type: "string", minLength: 1 },
    transport: { type: "string", enum: ["auto", "streamable-http", "sse"] },
    headers: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    command: { type: "string", minLength: 1 },
    args: { type: "array", items: { type: "string" } },
    env: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    cwd: { type: "string", minLength: 1 },
  },
} as const;

const statusEntrySchema = {
  type: "object",
  required: ["scope", "name", "kind", "enabled", "state", "toolCount"],
  properties: {
    scope: { type: "string", enum: ["global", "project"] },
    projectId: { type: "string" },
    name: { type: "string" },
    kind: { type: "string", enum: ["remote", "stdio"] },
    url: { type: "string" },
    command: { type: "string" },
    args: { type: "array", items: { type: "string" } },
    enabled: { type: "boolean" },
    state: {
      type: "string",
      enum: ["idle", "connecting", "connected", "error", "disabled", "trust_required"],
    },
    toolCount: { type: "integer", minimum: 0 },
    lastError: { type: "string" },
    transport: { type: "string", enum: ["auto", "streamable-http", "sse"] },
  },
} as const;

function buildServerConfigFromBody(
  body: McpServerBody,
  reply: FastifyReply,
): McpServerConfig | undefined {
  const hasUrl = typeof body.url === "string" && body.url.length > 0;
  const hasCommand = typeof body.command === "string" && body.command.length > 0;
  if (hasUrl && hasCommand) {
    reply.code(400).send({
      error: "mcp_invalid_config",
      message: "an MCP server must declare either `url` (remote) or `command` (stdio), not both",
    });
    return undefined;
  }
  if (!hasUrl && !hasCommand) {
    reply.code(400).send({
      error: "mcp_invalid_config",
      message: "an MCP server must declare either `url` (remote) or `command` (stdio)",
    });
    return undefined;
  }
  const cfg: McpServerConfig = {};
  if (body.enabled !== undefined) cfg.enabled = body.enabled;
  if (hasUrl && body.url !== undefined) {
    cfg.url = body.url;
    if (body.transport !== undefined) cfg.transport = body.transport;
    if (body.headers !== undefined) cfg.headers = body.headers;
  } else if (body.command !== undefined) {
    cfg.command = body.command;
    if (body.args !== undefined) cfg.args = [...body.args];
    if (body.env !== undefined) cfg.env = body.env;
    if (body.cwd !== undefined) cfg.cwd = body.cwd;
  }
  return cfg;
}

export const mcpRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/mcp/settings",
    {
      schema: {
        description: "Master MCP toggle + connection summary.",
        tags: ["config"],
        response: {
          200: {
            type: "object",
            required: ["enabled", "connected", "total"],
            properties: {
              enabled: { type: "boolean" },
              connected: { type: "integer", minimum: 0 },
              total: { type: "integer", minimum: 0 },
            },
          },
        },
      },
    },
    async () => {
      const status = getStatus();
      const enabled = isGloballyEnabled();
      const total = status.length;
      const connected = status.filter((s) => s.state === "connected").length;
      return { enabled, connected, total };
    },
  );

  fastify.put<{ Body: { enabled: boolean } }>(
    "/mcp/settings",
    {
      schema: {
        description: "Toggle the master MCP enable/disable flag.",
        tags: ["config"],
        body: {
          type: "object",
          required: ["enabled"],
          additionalProperties: false,
          properties: { enabled: { type: "boolean" } },
        },
        response: {
          200: {
            type: "object",
            required: ["enabled", "connected", "total"],
            properties: {
              enabled: { type: "boolean" },
              connected: { type: "integer", minimum: 0 },
              total: { type: "integer", minimum: 0 },
            },
          },
          400: errorSchema,
        },
      },
    },
    async (req) => {
      await setMcpDisabled(!req.body.enabled);
      await reloadGlobal();
      const status = getStatus();
      return {
        enabled: isGloballyEnabled(),
        total: status.length,
        connected: status.filter((s) => s.state === "connected").length,
      };
    },
  );

  fastify.get(
    "/mcp/servers",
    {
      schema: {
        description: "List global MCP servers (redacted) with optional project scope.",
        tags: ["config"],
        querystring: {
          type: "object",
          properties: { projectId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["servers", "status"],
            properties: {
              servers: { type: "object", additionalProperties: serverConfigSchema },
              status: { type: "array", items: statusEntrySchema },
              stdioTrust: {
                type: "object",
                required: ["trusted"],
                properties: { trusted: { type: "boolean" } },
              },
            },
          },
          500: errorSchema,
        },
      },
    },
    async (req) => {
      const projectId = (req.query as { projectId?: string }).projectId;
      let stdioTrust: { trusted: boolean } | undefined;
      if (projectId !== undefined) {
        const project = await getProject(projectId);
        if (project !== undefined) {
          await ensureProjectLoaded(project.id, project.path);
          stdioTrust = { trusted: await isStdioTrustedForProject(project.id) };
        }
      }
      const cfg = await readMcpJsonRedacted();
      const result: {
        servers: Record<string, McpServerConfig>;
        status: ReturnType<typeof getStatus>;
        stdioTrust?: { trusted: boolean };
      } = {
        servers: cfg.servers,
        status: getStatus(projectId !== undefined ? { projectId } : undefined),
      };
      if (stdioTrust !== undefined) result.stdioTrust = stdioTrust;
      return result;
    },
  );

  fastify.put<{ Params: { name: string }; Body: McpServerBody }>(
    "/mcp/servers/:name",
    {
      schema: {
        description: "Create or replace a global MCP server entry.",
        tags: ["config"],
        params: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", minLength: 1, maxLength: 64 } },
        },
        body: serverConfigSchema,
        response: {
          200: {
            type: "object",
            required: ["ok"],
            properties: { ok: { type: "boolean" } },
          },
          400: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const { name } = req.params;
      const cfg = buildServerConfigFromBody(req.body, reply);
      if (cfg === undefined) return reply;
      await upsertMcpServer(name, cfg);
      await reloadGlobal();
      return { ok: true };
    },
  );

  fastify.delete<{ Params: { name: string } }>(
    "/mcp/servers/:name",
    {
      schema: {
        description: "Remove a global MCP server entry.",
        tags: ["config"],
        params: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["removed"],
            properties: { removed: { type: "boolean" } },
          },
          500: errorSchema,
        },
      },
    },
    async (req) => {
      const removed = await deleteMcpServer(req.params.name);
      if (removed) await reloadGlobal();
      return { removed };
    },
  );

  fastify.post<{ Params: { name: string }; Querystring: { projectId?: string } }>(
    "/mcp/servers/:name/probe",
    {
      schema: {
        description: "Force a reconnect for the named server.",
        tags: ["config"],
        params: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
        },
        querystring: {
          type: "object",
          properties: { projectId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["status"],
            properties: { status: statusEntrySchema },
          },
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const { name } = req.params;
      const projectId = req.query.projectId;
      if (projectId !== undefined) {
        const project = await getProject(projectId);
        if (project === undefined) {
          return reply.code(404).send({ error: "project_not_found" });
        }
        await ensureProjectLoaded(project.id, project.path);
        const status = await probe({ project: project.id }, name);
        if (status === undefined) {
          return reply.code(404).send({ error: "mcp_server_not_found" });
        }
        return { status };
      }
      const status = await probe("global", name);
      if (status === undefined) {
        return reply.code(404).send({ error: "mcp_server_not_found" });
      }
      return { status };
    },
  );

  fastify.get<{ Querystring: { projectId: string } }>(
    "/mcp/tools",
    {
      schema: {
        description: "List every MCP tool available to sessions in the given project.",
        tags: ["config"],
        querystring: {
          type: "object",
          required: ["projectId"],
          properties: { projectId: { type: "string", minLength: 1 } },
        },
        response: {
          200: {
            type: "object",
            required: ["tools"],
            properties: {
              tools: {
                type: "array",
                items: {
                  type: "object",
                  required: ["name", "description"],
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                  },
                },
              },
            },
          },
          404: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const project = await getProject(req.query.projectId);
      if (project === undefined) {
        return reply.code(404).send({ error: "project_not_found" });
      }
      await ensureProjectLoaded(project.id, project.path);
      const tools = customToolsForProject(project.id).map((t) => ({
        name: t.name,
        description: t.description,
      }));
      return { tools };
    },
  );

  fastify.post<{ Params: { projectId: string } }>(
    "/mcp/trust/:projectId",
    {
      schema: {
        description: "Grant this project permission to declare stdio MCP servers.",
        tags: ["config"],
        params: {
          type: "object",
          required: ["projectId"],
          properties: { projectId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["trusted", "status"],
            properties: {
              trusted: { type: "boolean" },
              status: { type: "array", items: statusEntrySchema },
            },
          },
          404: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const project = await getProject(req.params.projectId);
      if (project === undefined) {
        return reply.code(404).send({ error: "project_not_found" });
      }
      await grantStdioTrust(project.id);
      await ensureProjectLoaded(project.id, project.path);
      await reconnectGatedStdioForProject(project.id);
      return {
        trusted: true,
        status: getStatus({ projectId: project.id }),
      };
    },
  );

  fastify.delete<{ Params: { projectId: string } }>(
    "/mcp/trust/:projectId",
    {
      schema: {
        description: "Revoke this project's stdio MCP trust.",
        tags: ["config"],
        params: {
          type: "object",
          required: ["projectId"],
          properties: { projectId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["trusted"],
            properties: { trusted: { type: "boolean" } },
          },
          404: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const project = await getProject(req.params.projectId);
      if (project === undefined) {
        return reply.code(404).send({ error: "project_not_found" });
      }
      await revokeStdioTrust(project.id);
      await unloadProject(project.id);
      return { trusted: false };
    },
  );
};
