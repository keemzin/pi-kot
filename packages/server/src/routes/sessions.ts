import type { FastifyPluginAsync } from "fastify";
import {
  createSession,
  disposeSession,
  listSessions,
  listSessionsForProject,
  getSession,
  renameSession,
  archiveSession,
  unarchiveSession,
  listArchivedSessions,
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
      let projectId = req.body.projectId ?? "default";

      // Backward compat: resolve "default" to the Default project's UUID
      if (projectId === "default") {
        const { listProjects } = await import("../project-manager.js");
        const projects = await listProjects();
        if (projects.length > 0) {
          projectId = projects[0].id;
        }
      }

      // Resolve the project to get its path as workspacePath
      const { getProject } = await import("../project-manager.js");
      const project = await getProject(projectId);
      if (project === undefined) {
        return reply.code(404).send({ error: "project_not_found" });
      }

      const workspacePath = req.body.workspacePath ?? project.path;
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
  // When archived=true is set (requires projectId), returns archived sessions.
  fastify.get<{
    Querystring: { projectId?: string; archived?: string };
  }>(
    "/sessions",
    {
      schema: {
        description:
          "List sessions. When projectId is specified, returns " +
          "both live and disk sessions with names and message counts. " +
          "When omitted, returns only live sessions. " +
          "Use ?archived=true to list archived (soft-deleted) sessions.",
        tags: ["sessions"],
        querystring: {
          type: "object",
          properties: {
            projectId: { type: "string" },
            archived: { type: "string" },
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
      let { projectId, archived } = req.query;

      // Backward compat: resolve "default" to the Default project's UUID
      if (projectId === "default") {
        const { listProjects } = await import("../project-manager.js");
        const projects = await listProjects();
        if (projects.length > 0) {
          projectId = projects[0].id;
        }
      }

      if (projectId !== undefined) {
        const { config } = await import("../config.js");
        const project = await getProject(projectId);
        const workspacePath = project?.path ?? config.workspacePath;

        // If archived=true, list archived sessions
        if (archived === "true") {
          const archivedSessions = await listArchivedSessions(projectId, workspacePath);
          return {
            sessions: archivedSessions.map((s) => ({
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

        // Unified view: live + disk sessions for this project
        const unified = await listSessionsForProject(projectId, workspacePath);
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
          name: s.name ?? (s.session as { sessionName?: string }).sessionName,
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
      const { SessionManager } = await import("@earendil-works/pi-coding-agent");

      // Try live registry first
      const live = getSession(req.params.id);
      if (live !== undefined) {
        return { messages: live.session.messages };
      }

      // Search for the session file on disk across all projects
      const { readdir } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const { config } = await import("../config.js");

      try {
        const projectDirs = await readdir(config.sessionDir, { withFileTypes: true });
        for (const dir of projectDirs) {
          if (!dir.isDirectory()) continue;
          const projectDir = join(config.sessionDir, dir.name);
          const files = await readdir(projectDir);
          const matchFile = files.find(
            (f) => f.endsWith(".jsonl") && f.includes(req.params.id),
          );
          if (matchFile) {
            const sessionPath = join(projectDir, matchFile);
            const sm = SessionManager.open(sessionPath);
            const ctx = sm.buildSessionContext();
            return { messages: ctx.messages };
          }
        }
      } catch {
        // Session not found on disk either
      }

      return reply.code(404).send({ error: "session_not_found" });
    },
  );

  // PATCH /api/v1/sessions/:id/name — rename a session
  fastify.patch<{
    Params: { id: string };
    Body: { name: string };
  }>(
    "/sessions/:id/name",
    {
      schema: {
        description: "Rename a session. Persists to disk via SessionManager.appendSessionInfo.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", minLength: 1 } },
        },
        response: {
          200: {
            type: "object",
            required: ["renamed"],
            properties: { renamed: { type: "boolean" } },
          },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const ok = renameSession(req.params.id, req.body.name);
      if (!ok) {
        return reply.code(404).send({ error: "session_not_found" });
      }
      return { renamed: true };
    },
  );

  // POST /api/v1/sessions/:id/archive — archive a session (moves JSONL to _archived/)
  fastify.post<{
    Params: { id: string };
    Body?: { projectId?: string };
  }>(
    "/sessions/:id/archive",
    {
      schema: {
        description:
          "Archive a session: moves the JSONL file to an _archived/ subfolder " +
          "and removes from the live registry. The session data is preserved " +
          "and can be restored later via POST /sessions/:id/unarchive. " +
          "For disk-only sessions, provide { projectId } in the body.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          properties: { projectId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["archived"],
            properties: { archived: { type: "boolean" } },
          },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const projectId = req.body?.projectId;
      const archived = await archiveSession(req.params.id, projectId);
      if (!archived) {
        return reply.code(404).send({ error: "session_not_found" });
      }
      return { archived: true };
    },
  );

  // POST /api/v1/sessions/:id/unarchive — restore an archived session
  fastify.post<{
    Params: { id: string };
    Body: { projectId: string };
  }>(
    "/sessions/:id/unarchive",
    {
      schema: {
        description:
          "Restore an archived session: moves the JSONL file back from " +
          "_archived/ to the main session directory. The session will appear " +
          "again on the next SSE connect or page refresh.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["projectId"],
          properties: { projectId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["unarchived"],
            properties: { unarchived: { type: "boolean" } },
          },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const unarchived = await unarchiveSession(req.params.id, req.body.projectId);
      if (!unarchived) {
        return reply.code(404).send({ error: "archived_session_not_found" });
      }
      return { unarchived: true };
    },
  );

  // DELETE /api/v1/sessions/:id — dispose a session (remove from registry)
  fastify.delete<{
    Params: { id: string };
  }>(
    "/sessions/:id",
    {
      schema: {
        description: "Dispose a session (remove from registry). The JSONL file stays on disk.",
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
