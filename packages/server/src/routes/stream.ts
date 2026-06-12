import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { SessionManager, createAgentSession } from "@earendil-works/pi-coding-agent";

import type { FastifyPluginAsync } from "fastify";
import {
  getSession,
  registerSession,
  type LiveSession,
} from "../session-registry.js";
import { createSSEClient } from "../sse-bridge.js";
import { config } from "../config.js";

async function warmUpSession(
  sessionId: string,
): Promise<LiveSession | undefined> {
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");

  try {
    const projectDirs = await readdir(config.sessionDir, { withFileTypes: true });
    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;
      const projectDir = join(config.sessionDir, dir.name);
      const files = await readdir(projectDir);
      const matchFile = files.find(
        (f) => f.endsWith(".jsonl") && f.includes(sessionId),
      );
      if (matchFile) {
        const sessionPath = join(projectDir, matchFile);
        const sm = SessionManager.open(sessionPath);
        const cwd = sm.getCwd();

        // Build a live session wrapping the existing SessionManager
        const { session } = await createAgentSession({
          cwd,
          sessionManager: sm,
          agentDir: config.piConfigDir,
        });

        const now = new Date();
        const live: LiveSession = {
          session,
          sessionId: session.sessionId,
          projectId: dir.name,
          workspacePath: cwd,
          clients: new Set(),
          createdAt: now,
          lastActivityAt: now,
          lastAgentStartIndex: undefined,
          unsubscribe: () => undefined,
        };

        // Wire event subscription
        live.unsubscribe = session.subscribe(
          (event: AgentSessionEvent) => {
            live.lastActivityAt = new Date();
            if (event.type === "agent_start") {
              live.lastAgentStartIndex = live.session.messages.length;
            }
            for (const client of live.clients) {
              try {
                client.send(event);
              } catch {
                live.clients.delete(client);
              }
            }
          },
        );

        registerSession(live);
        return live;
      }
    }
  } catch {
    // not found
  }
  return undefined;
}

export const streamRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/sessions/:id/stream — SSE stream of agent events
  fastify.get<{
    Params: { id: string };
  }>(
    "/sessions/:id/stream",
    {
      schema: {
        description:
          "Open an SSE stream for a session. Sends a `snapshot` event on " +
          "connect, then forwards filtered AgentSessionEvents until the " +
          "client disconnects.\n\n" +
          "Auto-warms up disk sessions (cold session resume).\n\n" +
          "NOTE: This route uses reply.hijack() — it does NOT return a " +
          "standard Fastify response. The connection stays open indefinitely.",
        tags: ["sessions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      let live = getSession(req.params.id);

      // Warm up disk session if not live
      if (live === undefined) {
        live = await warmUpSession(req.params.id);
      }

      if (live === undefined) {
        return reply.code(404).send({ error: "session_not_found" });
      }

      createSSEClient(reply, live);
      // createSSEClient calls reply.hijack() — we return reply to satisfy
      // the type system, but the response is already being driven manually.
      return reply;
    },
  );
};
