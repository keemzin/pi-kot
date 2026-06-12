import {
  type AgentSessionEvent,
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";

/**
 * Minimal SSE client contract — the concrete implementation lives in
 * sse-bridge.ts.
 */
export interface SSEClient {
  readonly id: string;
  send(event: AgentSessionEvent | { type: string; [k: string]: unknown }): void;
  close(): void;
}

/**
 * A live session in the in-memory registry. Wraps an SDK AgentSession
 * plus metadata and connected SSE clients.
 */
export interface LiveSession {
  session: import("@earendil-works/pi-coding-agent").AgentSession;
  sessionId: string;
  projectId: string;
  workspacePath: string;
  clients: Set<SSEClient>;
  createdAt: Date;
  lastActivityAt: Date;
  /** Index of the first message of the latest agent turn (for turn-diff). */
  lastAgentStartIndex: number | undefined;
  /** Internal — call to detach the registry's own subscription on dispose. */
  unsubscribe: () => void;
}

const registry = new Map<string, LiveSession>();

function sessionDirFor(projectId: string): string {
  return join(config.sessionDir, projectId);
}

async function ensureSessionDir(projectId: string): Promise<string> {
  const dir = sessionDirFor(projectId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Discover session JSONL files on disk for a project.
 * Returns basic metadata without loading the full session state.
 */
export interface DiscoveredSession {
  sessionId: string;
  path: string;
  createdAt: Date;
  modifiedAt: Date;
  messageCount: number;
  /** Session name from the SDK's session_info, if any. */
  name?: string;
}

export async function discoverSessionsOnDisk(
  projectId: string,
  workspacePath: string,
): Promise<DiscoveredSession[]> {
  const dir = sessionDirFor(projectId);

  try {
    const infos = await SessionManager.list(workspacePath, dir);
    return infos.map((info) => ({
      sessionId: info.id,
      path: info.path,
      createdAt: info.created,
      modifiedAt: info.modified,
      messageCount: info.messageCount,
      name: info.name,
    }));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/**
 * List all known sessions (live + disk) for a project.
 * Returns UnifiedSession view sorted by recency.
 */
export interface UnifiedSession {
  sessionId: string;
  projectId: string;
  isLive: boolean;
  name: string | undefined;
  createdAt: Date;
  lastActivityAt: Date;
  messageCount: number;
}

export async function listSessionsForProject(
  projectId: string,
  workspacePath: string,
): Promise<UnifiedSession[]> {
  const live = listSessions(projectId);
  const liveById = new Map<string, UnifiedSession>(
    live.map((l) => [
      l.sessionId,
      {
        sessionId: l.sessionId,
        projectId: l.projectId,
        isLive: true,
        name: (l.session as { sessionName?: string }).sessionName,
        createdAt: l.createdAt,
        lastActivityAt: l.lastActivityAt,
        messageCount: l.session.messages.length,
      },
    ]),
  );

  const disk = await discoverSessionsOnDisk(projectId, workspacePath);
  for (const d of disk) {
    const merged = liveById.get(d.sessionId);
    if (merged !== undefined) {
      merged.messageCount = d.messageCount;
      continue;
    }
    liveById.set(d.sessionId, {
      sessionId: d.sessionId,
      projectId,
      isLive: false,
      name: d.name,
      createdAt: d.createdAt,
      lastActivityAt: d.modifiedAt,
      messageCount: d.messageCount,
    });
  }

  return Array.from(liveById.values()).sort(
    (a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime(),
  );
}

/**
 * Create a new session. Uses disk-backed SessionManager for persistence.
 */
export async function createSession(
  projectId: string,
  workspacePath: string,
): Promise<LiveSession> {
  const dir = await ensureSessionDir(projectId);
  const sessionManager = SessionManager.create(workspacePath, dir);

  const { session } = await createAgentSession({
    cwd: workspacePath,
    sessionManager,
    agentDir: config.piConfigDir,
  });

  const now = new Date();
  const live: LiveSession = {
    session,
    sessionId: session.sessionId,
    projectId,
    workspacePath,
    clients: new Set(),
    createdAt: now,
    lastActivityAt: now,
    lastAgentStartIndex: undefined,
    unsubscribe: () => undefined,
  };

  // Wire the registry's event subscription
  live.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    live.lastActivityAt = new Date();

    if (event.type === "agent_start") {
      live.lastAgentStartIndex = live.session.messages.length;
    }

    // Fan out to all connected SSE clients
    for (const client of live.clients) {
      try {
        client.send(event);
      } catch {
        live.clients.delete(client);
      }
    }
  });

  registry.set(live.sessionId, live);
  return live;
}

/** Get a live session by id. Returns undefined if not in the registry. */
export function getSession(sessionId: string): LiveSession | undefined {
  return registry.get(sessionId);
}

/** List live sessions, optionally filtered by projectId. */
export function listSessions(projectId?: string): LiveSession[] {
  const all = Array.from(registry.values());
  return projectId === undefined ? all : all.filter((s) => s.projectId === projectId);
}

/** Number of active sessions. */
export function sessionCount(): number {
  return registry.size;
}

/** Dispose a live session — abort, unsubscribe, close clients, remove from registry. */
export async function disposeSession(sessionId: string): Promise<boolean> {
  const live = registry.get(sessionId);
  if (live === undefined) return false;

  try {
    await live.session.abort();
  } catch {
    // best-effort
  }

  try {
    live.unsubscribe();
  } catch {
    // ignore
  }

  for (const client of live.clients) {
    try {
      client.close();
    } catch {
      // ignore
    }
  }
  live.clients.clear();

  try {
    live.session.dispose();
  } catch {
    // ignore
  }

  registry.delete(sessionId);
  return true;
}

/** Dispose all sessions (called on server shutdown). */
export async function disposeAllSessions(): Promise<void> {
  const ids = Array.from(registry.keys());
  await Promise.all(ids.map((id) => disposeSession(id)));
}
