import {
  type AgentSessionEvent,
  createAgentSession,
  SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { mkdir, rename, unlink, readdir, stat } from "node:fs/promises";
import { createAskUserQuestionTool } from "./ask-user-question/tool.js";
import { join, basename } from "node:path";
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
  /** The SDK SessionManager for this session (exposed for rename, fork, etc.). */
  sessionManager: import("@earendil-works/pi-coding-agent").SessionManager;
  clients: Set<SSEClient>;
  createdAt: Date;
  lastActivityAt: Date;
  /** Index of the first message of the latest agent turn (for turn-diff). */
  lastAgentStartIndex: number | undefined;
  /** Internal — call to detach the registry's own subscription on dispose. */
  unsubscribe: () => void;
  /** The session name set via appendSessionInfo, if any. */
  name: string | undefined;
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
        name: l.name ?? (l.session as { sessionName?: string }).sessionName,
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

  // Get sessionId synchronously before createAgentSession so the
  // ask_user_question tool can capture it in its execute() closure.
  const sessionId = sessionManager.getSessionId();
  const customTools: ToolDefinition[] = [
    createAskUserQuestionTool(sessionId),
  ];

  const { session } = await createAgentSession({
    cwd: workspacePath,
    sessionManager,
    agentDir: config.piConfigDir,
    customTools,
  });

  const now = new Date();
  const live: LiveSession = {
    session,
    sessionId: session.sessionId,
    projectId,
    workspacePath,
    sessionManager,
    clients: new Set(),
    createdAt: now,
    lastActivityAt: now,
    lastAgentStartIndex: undefined,
    unsubscribe: () => undefined,
    name: sessionManager.getSessionName(),
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

/** Register a session in the registry (used by session resume). */
export function registerSession(live: LiveSession): void {
  registry.set(live.sessionId, live);
}

/* ── Archive / Unarchive ── */

function archivedDirFor(projectId: string): string {
  return join(config.sessionDir, projectId, "_archived");
}

/**
 * Archive a session: move JSONL to _archived/ subfolder, remove from live registry.
 * Works for both live and disk-only sessions.
 * Returns true if archived, false if not found on disk or in registry.
 */
export async function archiveSession(sessionId: string, projectId?: string): Promise<boolean> {
  // Always check registry first — live session takes precedence
  const live = registry.get(sessionId);
  const resolvedProjectId = live?.projectId ?? projectId;
  if (resolvedProjectId === undefined) return false;
  const pid = resolvedProjectId;

  const srcDir = join(config.sessionDir, pid);
  let fileMoved = false;

  // Find and move the JSONL file
  try {
    const files = await readdir(srcDir);
    const match = files.find((f) => f.endsWith(".jsonl") && f.includes(sessionId));
    if (match) {
      const archiveDir = archivedDirFor(pid);
      await mkdir(archiveDir, { recursive: true });
      await rename(join(srcDir, match), join(archiveDir, match));
      fileMoved = true;
    }
  } catch {
    // best-effort file move
  }

  // Remove from live registry if present
  if (live !== undefined) {
    try { await live.session.abort(); } catch {}
    try { live.unsubscribe(); } catch {}
    for (const client of live.clients) {
      try { client.close(); } catch {}
    }
    live.clients.clear();
    try { live.session.dispose(); } catch {}
    registry.delete(sessionId);
  }

  return fileMoved || live !== undefined;
}

/**
 * Unarchive a session: move JSONL back from _archived/ to main dir.
 * Does NOT warm it back into the live registry — that happens on SSE connect.
 * Returns true if restored, false if no archive file found.
 */
export async function unarchiveSession(sessionId: string, projectId: string): Promise<boolean> {
  const archiveDir = archivedDirFor(projectId);
  try {
    const files = await readdir(archiveDir);
    const match = files.find((f) => f.endsWith(".jsonl") && f.includes(sessionId));
    if (!match) return false;
    const srcDir = join(config.sessionDir, projectId);
    await rename(join(archiveDir, match), join(srcDir, match));
    return true;
  } catch {
    return false;
  }
}

/**
 * List archived sessions for a project.
 */
export async function listArchivedSessions(
  projectId: string,
  workspacePath: string,
): Promise<UnifiedSession[]> {
  const archiveDir = archivedDirFor(projectId);
  try {
    await stat(archiveDir);
  } catch {
    return []; // archive dir doesn't exist
  }

  try {
    const files = await readdir(archiveDir);
    const jsonls = files.filter((f) => f.endsWith(".jsonl"));
    const results: UnifiedSession[] = [];

    for (const file of jsonls) {
      try {
        const sessionPath = join(archiveDir, file);
        const sm = SessionManager.open(sessionPath);
        // Derive sessionId from the filename (UUID after timestamp prefix)
        const base = basename(file, ".jsonl");
        const underscoreIdx = base.indexOf("_");
        const sessionId = underscoreIdx !== -1 ? base.slice(underscoreIdx + 1) : base;
        const ctx = sm.buildSessionContext();
        const info = SessionManager.list(workspacePath, archiveDir);
        const match = (await info).find((i) => i.id === sessionId);
        results.push({
          sessionId,
          projectId,
          isLive: false,
          name: match?.name ?? sm.getSessionName(),
          createdAt: match?.created ?? new Date(0),
          lastActivityAt: match?.modified ?? new Date(0),
          messageCount: ctx.messages.length,
        });
      } catch {
        // skip corrupt files
      }
    }

    return results.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
  } catch {
    return [];
  }
}

/**
 * Rename a live session. Persists via SessionManager.appendSessionInfo.
 * Returns true if renamed, false if session not live.
 */
export function renameSession(sessionId: string, name: string): boolean {
  const live = registry.get(sessionId);
  if (live === undefined) return false;
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  live.sessionManager.appendSessionInfo(trimmed);
  live.name = trimmed;
  return true;
}

/**
 * Auto-name a session from the first user prompt text.
 * Called when the first prompt is sent. Truncates to 60 chars.
 */
export function autoNameSession(sessionId: string, promptText: string): void {
  const live = registry.get(sessionId);
  if (live === undefined) return;
  // Only auto-name if no name is already set
  if (live.name !== undefined) return;
  const name = promptText.trim().slice(0, 60).replace(/\n/g, " ");
  if (name.length === 0) return;
  live.sessionManager.appendSessionInfo(name);
  live.name = name;
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

/**
 * Find a session's location on disk. Returns projectId and workspacePath
 * by scanning all project session dirs.
 */
export async function findSessionLocation(
  sessionId: string,
): Promise<{ projectId: string; workspacePath: string } | undefined> {
  // Check all project directories
  const { readProjects } = await import("./project-manager.js");
  try {
    const projects = await readProjects();
    for (const project of projects) {
      const dir = join(config.sessionDir, project.id);
      try {
        const files = await readdir(dir);
        if (files.some((f) => f.includes(sessionId))) {
          return { projectId: project.id, workspacePath: project.path };
        }
      } catch {
        // dir doesn't exist, skip
      }
    }
  } catch {
    // can't read projects
  }
  return undefined;
}

/**
 * Resume a cold session from disk. Opens the JSONL, creates an AgentSession,
 * registers it in the registry, and returns the LiveSession.
 */
export async function resumeSessionById(
  sessionId: string,
): Promise<LiveSession> {
  const loc = await findSessionLocation(sessionId);
  if (loc === undefined) {
    throw new Error(`session_not_found: ${sessionId}`);
  }

  const dir = join(config.sessionDir, loc.projectId);
  const files = await readdir(dir);
  const match = files.find((f) => f.endsWith(".jsonl") && f.includes(sessionId));
  if (match === undefined) {
    throw new Error(`session_not_found: ${sessionId}`);
  }

  const sessionPath = join(dir, match);
  const sessionManager = SessionManager.open(sessionPath);
  const customTools: ToolDefinition[] = [
    createAskUserQuestionTool(sessionId),
  ];

  const { session } = await createAgentSession({
    cwd: loc.workspacePath,
    sessionManager,
    agentDir: config.piConfigDir,
    customTools,
  });

  const now = new Date();
  const live: LiveSession = {
    session,
    sessionId,
    projectId: loc.projectId,
    workspacePath: loc.workspacePath,
    sessionManager,
    clients: new Set(),
    createdAt: now,
    lastActivityAt: now,
    lastAgentStartIndex: undefined,
    unsubscribe: () => undefined,
    name: sessionManager.getSessionName(),
  };

  live.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
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
  });

  registry.set(live.sessionId, live);
  return live;
}

/**
 * Fork a session at a given entry. Creates a new JSONL file containing
 * the path-to-leaf from root to the given entry, registers the new
 * session, and returns it.
 *
 * NOTE: `createBranchedSession` mutates the source session's in-memory
 * file reference to point at the new fork (SDK behavior). We handle this
 * by capturing the source file before and re-opening the source after.
 */
export async function forkSession(
  sessionId: string,
  entryId: string,
): Promise<LiveSession> {
  const sourceLive = registry.get(sessionId);
  if (sourceLive === undefined) {
    // Try to resume cold first, then fork
    const resumed = await resumeSessionById(sessionId);
    return forkSession(resumed.sessionId, entryId);
  }

  // Capture the source file path BEFORE createBranchedSession mutates it
  const sourceSessionFile = sourceLive.sessionManager.getSessionFile();
  if (sourceSessionFile === undefined) {
    throw new Error("fork_failed: source session has no file (in-memory only)");
  }
  const sourceDir = join(config.sessionDir, sourceLive.projectId);

  // Create the branched session file
  const newPath = sourceLive.sessionManager.createBranchedSession(entryId);
  if (newPath === undefined) {
    throw new Error("fork_failed: createBranchedSession returned undefined");
  }

  // Re-open the SOURCE session from the original file to undo SDK mutation
  const restoredSourceSM = SessionManager.open(sourceSessionFile, sourceDir, sourceLive.workspacePath);
  sourceLive.sessionManager = restoredSourceSM;

  // Open the new fork as a SessionManager
  const dir = join(config.sessionDir, sourceLive.projectId);
  const forkedSM = SessionManager.open(newPath, dir, sourceLive.workspacePath);
  const forkedId = forkedSM.getSessionId();
  const customTools: ToolDefinition[] = [
    createAskUserQuestionTool(forkedId),
  ];

  const { session } = await createAgentSession({
    cwd: sourceLive.workspacePath,
    sessionManager: forkedSM,
    agentDir: config.piConfigDir,
    customTools,
  });

  const now = new Date();
  const forkedLive: LiveSession = {
    session,
    sessionId: session.sessionId,
    projectId: sourceLive.projectId,
    workspacePath: sourceLive.workspacePath,
    sessionManager: forkedSM,
    clients: new Set(),
    createdAt: now,
    lastActivityAt: now,
    lastAgentStartIndex: undefined,
    unsubscribe: () => undefined,
    name: forkedSM.getSessionName(),
  };

  forkedLive.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    forkedLive.lastActivityAt = new Date();
    if (event.type === "agent_start") {
      forkedLive.lastAgentStartIndex = forkedLive.session.messages.length;
    }
    for (const client of forkedLive.clients) {
      try {
        client.send(event);
      } catch {
        forkedLive.clients.delete(client);
      }
    }
  });

  registry.set(forkedLive.sessionId, forkedLive);
  return forkedLive;
}
