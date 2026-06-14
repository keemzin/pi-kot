import { archiveSession, disposeSession, getSession } from "../session-registry.js";
import { bridgeWorkerDeleted } from "./event-bridge.js";
import { disableSupervisor, getWorkerIds, unregisterWorker } from "./store.js";

export type WorkerArchiveStatus = "archived" | "not_found";

export interface KillWorkerResult {
  wasLive: boolean;
  archiveStatus: WorkerArchiveStatus;
}

export interface CleanupSupervisorWorkersResult {
  workerIds: string[];
  results: Record<string, KillWorkerResult>;
}

function notifySupervisorSessionListChanged(args: {
  supervisorId: string;
  workerId: string;
  reason: string;
}): void {
  const supervisor = getSession(args.supervisorId);
  if (supervisor === undefined) return;
  for (const client of supervisor.clients) {
    try {
      client.send({
        type: "session_list_changed",
        reason: args.reason,
        projectId: supervisor.projectId,
        sessionId: args.workerId,
      });
    } catch {
      // SSE client already dropped
    }
  }
}

export async function killWorkerAndArchive(args: {
  supervisorId: string;
  workerId: string;
}): Promise<KillWorkerResult> {
  const wasLive = await disposeSession(args.workerId);
  await bridgeWorkerDeleted(args.workerId, { wasLive, reason: "killed" }).catch(
    () => undefined,
  );
  await unregisterWorker(args.workerId);
  notifySupervisorSessionListChanged({
    supervisorId: args.supervisorId,
    workerId: args.workerId,
    reason: "kill_worker",
  });
  return {
    wasLive,
    archiveStatus: "archived",
  };
}

export async function cleanupWorkersForDeletedSupervisor(
  supervisorId: string,
): Promise<CleanupSupervisorWorkersResult> {
  const workerIds = await getWorkerIds(supervisorId);
  const results: Record<string, KillWorkerResult> = {};
  for (const workerId of workerIds) {
    results[workerId] = await killWorkerAndArchive({ supervisorId, workerId });
  }
  await disableSupervisor(supervisorId);
  return { workerIds, results };
}
