import type { FastifyPluginAsync } from "fastify";
import { getSession, rebuildSessionTools } from "../session-store.js";
import {
  enableSupervisor,
  disableSupervisor,
  isSupervisor,
  isWorker,
  getWorkerIds,
  getWorkerRecord,
  getSupervisorIdForWorker,
  readPendingInbox,
  readAllInbox,
  clearInbox,
  pendingInboxCount,
} from "../orchestration/store.js";
import {
  killWorkerAndArchive,
} from "../orchestration/worker-lifecycle.js";
import { unregisterWorker } from "../orchestration/store.js";
import { bridgeWorkerDeleted } from "../orchestration/event-bridge.js";
import {
  isOrchestrationAvailable,
  availableReason,
  maxWorkersPerSupervisor,
} from "../orchestration/config.js";

/**
 * Orchestration REST routes — all under /api/v1/orchestration/.
 */

function disabledResponse(reason: string) {
  return { disabled: true, disabledReason: reason };
}

export const orchestrationRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/orchestration/config — instance availability + caps
  fastify.get(
    "/orchestration/config",
    {
      schema: {
        description: "Orchestration availability and configuration",
        tags: ["orchestration"],
      },
    },
    async () => {
      if (!isOrchestrationAvailable()) {
        return disabledResponse(availableReason());
      }
      return {
        available: true,
        maxWorkersPerSupervisor: maxWorkersPerSupervisor(),
        tools: [
          "orchestrate_spawn_worker",
          "orchestrate_list_workers",
          "orchestrate_read_worker",
          "orchestrate_send_to_worker",
          "orchestrate_interrupt_worker",
          "orchestrate_kill_worker",
          "orchestrate_detach_worker",
          "orchestrate_read_inbox",
        ],
      };
    },
  );

  // GET /api/v1/orchestration/sessions/:id — role + linkage
  fastify.get<{
    Params: { id: string };
  }>(
    "/orchestration/sessions/:id",
    {
      schema: {
        description: "Get orchestration role for a session",
        tags: ["orchestration"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req) => {
      const { id } = req.params;
      const [sup, wrk] = await Promise.all([isSupervisor(id), isWorker(id)]);
      let role: "supervisor" | "worker" | "standalone";
      if (sup) role = "supervisor";
      else if (wrk) role = "worker";
      else role = "standalone";
      const supervisorId = wrk ? await getSupervisorIdForWorker(id) : undefined;
      return { sessionId: id, role, supervisorId };
    },
  );

  // POST /api/v1/orchestration/sessions/:id/enable — enable supervisor
  fastify.post<{
    Params: { id: string };
  }>(
    "/orchestration/sessions/:id/enable",
    {
      schema: {
        description: "Enable supervisor mode for a session",
        tags: ["orchestration"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const live = getSession(id);
      if (live === undefined) {
        return reply.status(400).send({ error: "session_not_live" });
      }
      try {
        await enableSupervisor(id);
      } catch (e) {
        return reply.status(400).send({
          error: e instanceof Error ? e.message : String(e),
        });
      }
      await rebuildSessionTools(id);
      return { enabled: true, sessionId: id };
    },
  );

  // POST /api/v1/orchestration/sessions/:id/disable — disable supervisor
  fastify.post<{
    Params: { id: string };
  }>(
    "/orchestration/sessions/:id/disable",
    {
      schema: {
        description: "Disable supervisor mode for a session",
        tags: ["orchestration"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const live = getSession(id);
      if (live === undefined) {
        return reply.status(400).send({ error: "session_not_live" });
      }
      await disableSupervisor(id);
      await rebuildSessionTools(id);
      return { disabled: true, sessionId: id };
    },
  );

  // GET /api/v1/orchestration/sessions/:id/workers — worker list
  fastify.get<{
    Params: { id: string };
  }>(
    "/orchestration/sessions/:id/workers",
    {
      schema: {
        description: "List workers for a supervisor session",
        tags: ["orchestration"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req) => {
      const { id } = req.params;
      if (!(await isSupervisor(id))) {
        return { workers: [] };
      }
      const ids = await getWorkerIds(id);
      const workers = await Promise.all(
        ids.map(async (workerId) => {
          const rec = await getWorkerRecord(workerId);
          const live = getSession(workerId);
          return {
            workerId,
            state: rec?.state ?? "cold",
            isLive: live !== undefined,
            name: live?.session.sessionName ?? null,
            messageCount: live?.session.messages.length ?? null,
            lastStateAt: rec?.lastStateAt ?? null,
          };
        }),
      );
      return { workers };
    },
  );

  // GET /api/v1/orchestration/sessions/:id/inbox — inbox history
  fastify.get<{
    Params: { id: string };
  }>(
    "/orchestration/sessions/:id/inbox",
    {
      schema: {
        description: "Get supervisor inbox (delivered + pending)",
        tags: ["orchestration"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req) => {
      const { id } = req.params;
      if (!(await isSupervisor(id))) {
        return { items: [], count: 0 };
      }
      const items = await readAllInbox(id);
      return { items, count: items.length };
    },
  );

  // POST /api/v1/orchestration/sessions/:id/inbox/clear — clear inbox
  fastify.post<{
    Params: { id: string };
  }>(
    "/orchestration/sessions/:id/inbox/clear",
    {
      schema: {
        description: "Clear supervisor inbox",
        tags: ["orchestration"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req) => {
      await clearInbox(req.params.id);
      return { cleared: true };
    },
  );

  // POST /api/v1/orchestration/sessions/:id/workers/:wid/detach
  fastify.post<{
    Params: { id: string; wid: string };
  }>(
    "/orchestration/sessions/:id/workers/:wid/detach",
    {
      schema: {
        description: "Detach a worker from its supervisor",
        tags: ["orchestration"],
        params: {
          type: "object",
          required: ["id", "wid"],
          properties: { id: { type: "string" }, wid: { type: "string" } },
        },
      },
    },
    async (req) => {
      const { wid } = req.params;
      await unregisterWorker(wid);
      return { detached: true, workerId: wid };
    },
  );

  // POST /api/v1/orchestration/sessions/:id/workers/:wid/kill
  fastify.post<{
    Params: { id: string; wid: string };
  }>(
    "/orchestration/sessions/:id/workers/:wid/kill",
    {
      schema: {
        description: "Kill a worker session",
        tags: ["orchestration"],
        params: {
          type: "object",
          required: ["id", "wid"],
          properties: { id: { type: "string" }, wid: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { id, wid } = req.params;
      try {
        const result = await killWorkerAndArchive({
          supervisorId: id,
          workerId: wid,
        });
        return {
          killed: true,
          workerId: wid,
          wasLive: result.wasLive,
        };
      } catch (e) {
        return reply
          .status(400)
          .send({ error: e instanceof Error ? e.message : String(e) });
      }
    },
  );

  // POST /api/v1/orchestration/sessions/:id/workers/:wid/resume
  fastify.post<{
    Params: { id: string; wid: string };
  }>(
    "/orchestration/sessions/:id/workers/:wid/resume",
    {
      schema: {
        description: "Force-resume a cold worker into the registry",
        tags: ["orchestration"],
        params: {
          type: "object",
          required: ["id", "wid"],
          properties: { id: { type: "string" }, wid: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      const { wid } = req.params;
      const alreadyLive = getSession(wid);
      if (alreadyLive !== undefined) {
        return { resumed: true, workerId: wid, wasCold: false };
      }
      try {
        const { resumeSessionById, disposeSession } = await import(
          "../session-store.js"
        );
        await resumeSessionById(wid);
        return { resumed: true, workerId: wid, wasCold: true };
      } catch (e) {
        return reply
          .status(400)
          .send({ error: e instanceof Error ? e.message : String(e) });
      }
    },
  );
};
