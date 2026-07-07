/**
 * Session orchestration — types + constants.
 *
 * A "supervisor" session has the `orchestrate_*` tool group enabled
 * and can spawn / observe / message / interrupt / kill / detach a set
 * of "worker" sessions. Workers are real first-class sessions (same
 * .jsonl on disk, same browser visibility) — the link is purely
 * forge-side metadata in `${FORGE_DATA_DIR}/session-orchestration.json`.
 *
 * Topology is strict hub-and-spoke: workers don't get the orchestrate
 * tools and have no way to enumerate or message other workers.
 * Enforcement is by tool-surface (the tools simply aren't there),
 * not by permission check at the registry layer.
 *
 * Depth is limited to 1: a worker cannot become a supervisor. Keeps
 * the worst case bounded against fork-bomb runaway prompts.
 */

export const ORCHESTRATION_VERSION = 1 as const;

/**
 * Worker event types stored in orchestration history and pushed to
 * supervisors as `orchestration-notify` custom messages.
 */
export const INBOX_EVENT_TYPES = [
  "worker.ended",
  "worker.ask_user",
  "worker.execution_stopped_without_agent_end",
  "worker.auto_retry_failed",
  "worker.process_alert",
  "worker.deleted",
] as const;

export type InboxEventType = (typeof INBOX_EVENT_TYPES)[number];

export function isInboxEventType(v: unknown): v is InboxEventType {
  return typeof v === "string" && (INBOX_EVENT_TYPES as readonly string[]).includes(v);
}

export interface InboxItem {
  id: string;
  type: InboxEventType;
  workerId: string;
  occurredAt: string;
  data: Record<string, unknown>;
  delivered: boolean;
}

export interface SupervisorRecord {
  enabledAt: string;
  workerIds: string[];
}

export type WorkerLifecycleState =
  | "idle"
  | "running"
  | "ended"
  | "errored"
  | "stopped"
  | "deleted"
  | "awaiting_question";

export interface WorkerRecord {
  supervisorId: string;
  spawnedAt: string;
  spawnedFrom?: {
    sessionId: string;
    mode: "fresh" | "summary";
  };
  state?: WorkerLifecycleState;
  turnOpen?: boolean;
  lastStateAt?: string;
  lastAgentStartAt?: string;
  lastAgentEndAt?: string;
  stopReason?: string | null;
  errorMessage?: string | null;
}

export interface OrchestrationStore {
  version: typeof ORCHESTRATION_VERSION;
  supervisors: Record<string, SupervisorRecord>;
  workers: Record<string, WorkerRecord>;
}

export function emptyStore(): OrchestrationStore {
  return { version: ORCHESTRATION_VERSION, supervisors: {}, workers: {} };
}

export interface InboxStore {
  version: typeof ORCHESTRATION_VERSION;
  inboxes: Record<string, InboxItem[]>;
}

export function emptyInboxStore(): InboxStore {
  return { version: ORCHESTRATION_VERSION, inboxes: {} };
}

export const MAX_INBOX_ITEMS = 200;
export const DEFAULT_MAX_WORKERS_PER_SUPERVISOR = 8;
export const MAX_DEPTH = 1;
