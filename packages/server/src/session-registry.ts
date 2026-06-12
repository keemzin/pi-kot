import {
  type AgentSessionEvent,
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
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

/**
 * Create a new session. This is the core SDK integration point,
 * adapted from pi-forge's session-registry.ts.
 */
export async function createSession(
  projectId: string,
  workspacePath: string,
): Promise<LiveSession> {
  const sessionManager = SessionManager.inMemory();

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
