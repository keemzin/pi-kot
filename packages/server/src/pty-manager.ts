/**
 * PTY Manager — node-pty lifecycle for terminal sessions.
 *
 * Manages creation, resize, write, and cleanup of PTY processes.
 * Each terminal session gets its own PTY with a bash shell.
 */

import type { IPty } from "node-pty";
import { spawn } from "node-pty";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

export interface PtySession {
  /** Unique terminal ID (monotonic counter string) */
  id: string;
  /** The node-pty process */
  pty: IPty;
  /** Project working directory when created */
  cwd: string;
  /** Timestamp of creation */
  createdAt: number;
  /** Set once the process has exited */
  exited: boolean;
  /** Exit code, populated after exit */
  exitCode?: number;
}

const terminals = new Map<string, PtySession>();
let nextId = 1;

const DEFAULT_SHELL = process.platform === "win32" ? "powershell.exe" : "bash";

/**
 * Create a new PTY session.
 * @param cwd Working directory for the shell. Falls back to HOME.
 * @param shell Shell executable. Falls back to bash/powershell.
 * @returns The created PtySession.
 */
export function createPtySession(
  cwd?: string,
  shell?: string,
): PtySession {
  const id = String(nextId++);
  const shellPath = shell ?? DEFAULT_SHELL;
  let workDir = cwd;

  if (!workDir || !existsSync(workDir)) {
    workDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
  }

  const pty = spawn(shellPath, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: workDir,
    env: {
      ...process.env,
      TERM: "xterm-256color",
    },
  });

  const session: PtySession = {
    id,
    pty,
    cwd: resolve(workDir),
    createdAt: Date.now(),
    exited: false,
  };

  terminals.set(id, session);

  pty.onExit(({ exitCode, signal }) => {
    session.exited = true;
    session.exitCode = exitCode;
    // Keep in map so consumers can check exit status
  });

  return session;
}

/**
 * Write data to a PTY session.
 */
export function writeToPty(id: string, data: string): boolean {
  const session = terminals.get(id);
  if (!session || session.exited) return false;
  try {
    session.pty.write(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resize a PTY session.
 */
export function resizePty(id: string, cols: number, rows: number): boolean {
  const session = terminals.get(id);
  if (!session || session.exited) return false;
  try {
    session.pty.resize(cols, rows);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a PTY session and remove it from the map.
 */
export function killPty(id: string): boolean {
  const session = terminals.get(id);
  if (!session) return false;
  try {
    session.pty.kill();
  } catch {
    // already dead
  }
  terminals.delete(id);
  return true;
}

/**
 * Get a PTY session by id.
 */
export function getPtySession(id: string): PtySession | undefined {
  return terminals.get(id);
}

/**
 * List all active PTY sessions.
 */
export function listPtySessions(): PtySession[] {
  return Array.from(terminals.values());
}

/**
 * Kill all active PTY sessions.
 */
export function killAllPty(): void {
  for (const [id, session] of terminals) {
    try {
      session.pty.kill();
    } catch {
      // already dead
    }
    terminals.delete(id);
  }
}
