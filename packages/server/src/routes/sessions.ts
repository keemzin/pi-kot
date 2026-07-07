import type { FastifyPluginAsync } from "fastify";
import { buildCompactionHistory } from "../compaction-cards.js";
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
  resumeSessionById,
  forkSession,
  findSessionLocation,
} from "../session-store.js";
import { getProject } from "../workspace-store.js";
import { bridgeWorkerDeleted } from "../orchestration/event-bridge.js";
import { getSupervisorIdForWorker } from "../orchestration/store.js";
import { buildSnapshot } from "../event-stream.js";

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
        const { listProjects } = await import("../workspace-store.js");
        const projects = await listProjects();
        if (projects.length > 0) {
          projectId = projects[0].id;
        }
      }

      // Resolve the project to get its path as workspacePath
      const { getProject } = await import("../workspace-store.js");
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
                    supervisorId: { type: "string" },
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
        const { listProjects } = await import("../workspace-store.js");
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
          const sessions = await Promise.all(
            archivedSessions.map(async (s) => ({
              sessionId: s.sessionId,
              projectId: s.projectId,
              isLive: s.isLive,
              name: s.name,
              createdAt: s.createdAt.toISOString(),
              lastActivityAt: s.lastActivityAt.toISOString(),
              messageCount: s.messageCount,
              supervisorId: (await getSupervisorIdForWorker(s.sessionId)) ?? undefined,
            })),
          );
          return { sessions };
        }

        // Unified view: live + disk sessions for this project
        const unified = await listSessionsForProject(projectId, workspacePath);
        const unifiedSessions = await Promise.all(
          unified.map(async (s) => ({
            sessionId: s.sessionId,
            projectId: s.projectId,
            isLive: s.isLive,
            name: s.name,
            createdAt: s.createdAt.toISOString(),
            lastActivityAt: s.lastActivityAt.toISOString(),
            messageCount: s.messageCount,
            supervisorId: (await getSupervisorIdForWorker(s.sessionId)) ?? undefined,
          })),
        );
        return { sessions: unifiedSessions };
      }

      // Backward compat: only live sessions
      const liveSessions = listSessions();
      const liveWithSupervisors = await Promise.all(
        liveSessions.map(async (s) => ({
          sessionId: s.sessionId,
          projectId: s.projectId,
          isLive: true,
          name: s.name ?? (s.session as { sessionName?: string }).sessionName,
          createdAt: s.createdAt.toISOString(),
          lastActivityAt: s.lastActivityAt.toISOString(),
          messageCount: s.session.messages.length,
          supervisorId: (await getSupervisorIdForWorker(s.sessionId)) ?? undefined,
        })),
      );
      return { sessions: liveWithSupervisors };
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
      const sessionId = req.params.id;
      const disposed = await disposeSession(sessionId);
      // Fire worker.deleted if this session was an orchestration worker
      void bridgeWorkerDeleted(sessionId, { wasLive: disposed }).catch(() => undefined);
      return { disposed };
    },
  );

  // ── Session Tree ──
  // GET /sessions/:id/tree — branching history, lazy-resumes cold sessions
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id/tree",
    {
      schema: {
        description:
          "Branching history of the session. Returns every entry on the " +
          "tree (across all branches) plus the current leaf id and the " +
          "set of entry ids on the active branch path. Lazy-resumes cold " +
          "sessions on demand.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["leafId", "branchIds", "entries"],
            properties: {
              leafId: { type: ["string", "null"] },
              branchIds: { type: "array", items: { type: "string" } },
              entries: {
                type: "array",
                items: {
                  type: "object",
                  required: ["id", "parentId", "type", "timestamp"],
                  properties: {
                    id: { type: "string" },
                    parentId: { type: ["string", "null"] },
                    type: { type: "string" },
                    timestamp: { type: "string" },
                    role: { type: "string" },
                    preview: { type: "string" },
                    label: { type: "string" },
                  },
                },
              },
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
      let live = getSession(req.params.id);
      if (live === undefined) {
        try {
          live = await resumeSessionById(req.params.id);
        } catch {
          return reply.code(404).send({ error: "session_not_found" });
        }
      }
      const sm = live.sessionManager;
      const all = sm.getEntries();
      const leafId = sm.getLeafId();
      const branchIds = sm.getBranch().map((e: { id: string }) => e.id);
      const entries = all.map((e: {
        id: string;
        parentId: string | null;
        type: string;
        timestamp: string;
        message?: { role?: string; content?: unknown };
      }) => {
        const out: Record<string, unknown> = {
          id: e.id,
          parentId: e.parentId,
          type: e.type,
          timestamp: e.timestamp,
        };
        const label = sm.getLabel(e.id);
        if (label !== undefined) out.label = label;
        if (e.type === "message" && e.message !== undefined) {
          const m = e.message as { role?: string; content?: unknown };
          if (typeof m.role === "string") out.role = m.role;
          const preview = previewOfMessageContent(m.content);
          if (preview !== undefined) out.preview = preview;
        }
        return out;
      });
      return { leafId, branchIds, entries };
    },
  );

  // ── Session Navigate ──
  // POST /sessions/:id/navigate — navigate to a different tree leaf
  fastify.post<{ Params: { id: string }; Body: { entryId: string; summarize?: boolean; customInstructions?: string; label?: string } }>(
    "/sessions/:id/navigate",
    {
      schema: {
        description:
          "Navigate the session leaf to a different entry on its tree. " +
          "Operates IN-PLACE on the same session file (unlike fork which " +
          "creates a new file). Session must be live.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["entryId"],
          properties: {
            entryId: { type: "string" },
            summarize: { type: "boolean" },
            customInstructions: { type: "string" },
            label: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["cancelled"],
            properties: {
              cancelled: { type: "boolean" },
              aborted: { type: "boolean" },
              editorText: { type: "string" },
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
      const opts: Parameters<typeof live.session.navigateTree>[1] = {};
      if (req.body.summarize !== undefined) opts.summarize = req.body.summarize;
      if (req.body.customInstructions !== undefined) opts.customInstructions = req.body.customInstructions;
      if (req.body.label !== undefined) opts.label = req.body.label;
      try {
        const result = await live.session.navigateTree(req.body.entryId, opts);
        const out: Record<string, unknown> = { cancelled: result.cancelled };
        if (result.aborted !== undefined) out.aborted = result.aborted;
        if (result.editorText !== undefined) out.editorText = result.editorText;

        // Emit snapshot to all connected SSE clients so the chat UI
        // reflects the new session leaf without a client-triggered refetch.
        for (const client of live.clients) {
          try {
            client.send(buildSnapshot(live));
          } catch {
            live.clients.delete(client);
          }
        }

        return out;
      } catch (err) {
        return reply.code(400).send({ error: "navigate_failed", message: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // ── Session Fork ──
  // POST /sessions/:id/fork — fork into a new session
  fastify.post<{ Params: { id: string }; Body: { entryId: string } }>(
    "/sessions/:id/fork",
    {
      schema: {
        description:
          "Create a new session from an entry on the current session's " +
          "tree. Writes a new .jsonl file containing the path-to-leaf and " +
          "registers it as a fresh live session in the same project. The " +
          "source session is left live and untouched.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["entryId"],
          properties: { entryId: { type: "string" } },
        },
        response: {
          201: {
            type: "object",
            required: ["sessionId", "projectId"],
            properties: {
              sessionId: { type: "string" },
              projectId: { type: "string" },
            },
          },
          400: {
            type: "object",
            properties: { error: { type: "string" } },
          },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const forked = await forkSession(req.params.id, req.body.entryId);
        return reply.code(201).send({
          sessionId: forked.sessionId,
          projectId: forked.projectId,
        });
      } catch (err) {
        if (err instanceof Error && err.message?.startsWith("session_not_found")) {
          return reply.code(404).send({ error: "session_not_found" });
        }
        return reply.code(400).send({ error: "fork_failed", message: err instanceof Error ? err.message : String(err) });
      }
    },
  );
  // GET /api/v1/sessions/:id/context — context usage telemetry + session stats
  fastify.get<{
    Params: { id: string };
  }>(
    "/sessions/:id/context",
    {
      schema: {
        description: "Get context usage telemetry and session statistics.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              contextUsage: {
                type: "object",
                properties: {
                  contextWindow: { type: "number" },
                  tokens: { type: "number", nullable: true },
                  percent: { type: "number", nullable: true },
                },
              },
              stats: {
                type: "object",
                properties: {
                  userMessages: { type: "number" },
                  assistantMessages: { type: "number" },
                  toolCalls: { type: "number" },
                  toolResults: { type: "number" },
                  totalMessages: { type: "number" },
                  tokens: {
                    type: "object",
                    properties: {
                      input: { type: "number" },
                      output: { type: "number" },
                      cacheRead: { type: "number" },
                      cacheWrite: { type: "number" },
                      total: { type: "number" },
                    },
                  },
                  cost: { type: "number" },
                },
              },
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
      const usage = live.session.getContextUsage();
      const stats = live.session.getSessionStats();
      return { contextUsage: usage ?? null, stats };
    },
  );

  // ── GET /sessions/:id/compactions — compaction history ──────────
  // Returns the per-compaction archive that the SDK strips out of
  // `live.session.messages` after each compact() call, so the chat
  // view can render a "compacted N messages → Y tokens" card at each
  // compaction point with the archived messages one click away.
  // Server-side derivation keeps the entry-id arithmetic out of the
  // client. See packages/server/src/compaction-cards.ts for the
  // shape contract.
  fastify.get<{
    Params: { id: string };
  }>(
    "/sessions/:id/compactions",
    {
      schema: {
        description:
          "Per-compaction archive for the live session. Each entry " +
          "carries the SDK-generated summary, the pre-compaction " +
          "token count, and the AgentMessage[] that was archived (no " +
          "longer in the LLM's context window). `insertBeforeIndex` " +
          "tells the client where to splice a card into the post-" +
          "compaction `messages` array.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["compactions"],
            properties: {
              compactions: {
                type: "array",
                items: {
                  type: "object",
                  required: [
                    "id",
                    "timestamp",
                    "summary",
                    "tokensBefore",
                    "insertBeforeIndex",
                    "archivedMessages",
                  ],
                  properties: {
                    id: { type: "string" },
                    timestamp: { type: "string" },
                    summary: { type: "string" },
                    tokensBefore: { type: "integer" },
                    insertBeforeIndex: { type: "integer" },
                    archivedMessages: { type: "array" },
                  },
                },
              },
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
      return { compactions: buildCompactionHistory(live.session) };
    },
  );
};

/**
 * Truncated text preview of a message's content for the session tree.
 */
const PREVIEW_MAX_CHARS = 200;
function previewOfMessageContent(content: unknown): string | undefined {
  let text: string;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const c of content) {
      const o = c as { type?: unknown; text?: unknown };
      if (o.type === "text" && typeof o.text === "string") parts.push(o.text);
    }
    text = parts.join("\n");
  } else {
    return undefined;
  }
  text = text.trim();
  if (text.length === 0) return undefined;
  if (text.length <= PREVIEW_MAX_CHARS) return text;
  return text.slice(0, PREVIEW_MAX_CHARS - 1) + "…";
}
