import type { FastifyPluginAsync } from "fastify";
import {
  createSession,
  disposeSession,
  listSessions,
  listSessionsForProject,
  getSession,
} from "../session-registry.js";
import { getProject } from "../project-manager.js";

export const sessionRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/v1/sessions — create a new session
  fastify.post<{
    Body: { projectId?: string; workspacePath?: string };
  }>(
    "/sessions",
    {
      schema: {
        description: "Create a new session.",
        tags: ["sessions"],
        body: {
          type: "object",
          properties: {
            projectId: { type: "string", description: "Project ID (default: 'default')" },
            workspacePath: { type: "string", description: "Working directory (default: config.workspacePath)" },
          },
        },
        response: {
          201: {
            type: "object",
            required: ["sessionId"],
            properties: {
              sessionId: { type: "string" },
              projectId: { type: "string" },
              createdAt: { type: "string" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { config } = await import("../config.js");
      let projectId = req.body.projectId ?? "default";

      // Backward compat: resolve "default" to the Default project's UUID
      if (projectId === "default") {
        const { listProjects } = await import("../project-manager.js");
        const projects = await listProjects();
        if (projects.length > 0) {
          projectId = projects[0].id;
        }
      }

      const workspacePath = req.body.workspacePath ?? config.workspacePath;
      const live = await createSession(projectId, workspacePath);
      return reply.code(201).send({
        sessionId: live.sessionId,
        projectId: live.projectId,
        createdAt: live.createdAt.toISOString(),
      });
    },
  );

  // GET /api/v1/sessions — list sessions, optionally filtered by projectId.
  // When projectId is specified, returns unified view (live + disk).
  // When omitted, returns only live sessions (backward compat).
  fastify.get<{
    Querystring: { projectId?: string };
  }>(
    "/sessions",
    {
      schema: {
        description:
          "List sessions. When projectId is specified, returns " +
          "both live and disk sessions with names and message counts. " +
          "When omitted, returns only live sessions.",
        tags: ["sessions"],
        querystring: {
          type: "object",
          properties: {
            projectId: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["sessions"],
            properties: {
              sessions: {
                type: "array",
                items: {
                  type: "object",
                  required: ["sessionId", "projectId", "isLive", "createdAt", "lastActivityAt"],
                  properties: {
                    sessionId: { type: "string" },
                    projectId: { type: "string" },
                    isLive: { type: "boolean" },
                    name: { type: "string" },
                    createdAt: { type: "string" },
                    lastActivityAt: { type: "string" },
                    messageCount: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (req) => {
      let { projectId } = req.query;

      // Backward compat: resolve "default" to the Default project's UUID
      if (projectId === "default") {
        const { listProjects } = await import("../project-manager.js");
        const projects = await listProjects();
        if (projects.length > 0) {
          projectId = projects[0].id;
        }
      }

      if (projectId !== undefined) {
        // Unified view: live + disk sessions for this project
        const unified = await listSessionsForProject(projectId);
        return {
          sessions: unified.map((s) => ({
            sessionId: s.sessionId,
            projectId: s.projectId,
            isLive: s.isLive,
            name: s.name,
            createdAt: s.createdAt.toISOString(),
            lastActivityAt: s.lastActivityAt.toISOString(),
            messageCount: s.messageCount,
          })),
        };
      }

      // Backward compat: only live sessions
      const sessions = listSessions();
      return {
        sessions: sessions.map((s) => ({
          sessionId: s.sessionId,
          projectId: s.projectId,
          isLive: true,
          name: (s.session as { sessionName?: string }).sessionName,
          createdAt: s.createdAt.toISOString(),
          lastActivityAt: s.lastActivityAt.toISOString(),
          messageCount: s.session.messages.length,
        })),
      };
    },
  );

  // GET /api/v1/sessions/:id/messages — get messages for a session
  fastify.get<{
    Params: { id: string };
  }>(
    "/sessions/:id/messages",
    {
      schema: {
        description: "Get message history for a session.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["messages"],
            properties: {
              messages: { type: "array" },
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
      return { messages: live.session.messages };
    },
  );

  // DELETE /api/v1/sessions/:id — dispose a session
  fastify.delete<{
    Params: { id: string };
  }>(
    "/sessions/:id",
    {
      schema: {
        description: "Dispose a session (remove from registry).",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["disposed"],
            properties: { disposed: { type: "boolean" } },
          },
        },
      },
    },
    async (req) => {
      const disposed = await disposeSession(req.params.id);
      return { disposed };
    },
  );
};
