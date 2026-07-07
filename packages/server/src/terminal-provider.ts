/**
 * PTY Manager — node-pty lifecycle with detach/reattach support.
 *
 * Each terminal tab opens its own WebSocket which spawns a dedicated
 * PTY here — never share PTY instances across distinct tabs.
 *
 * **Survival across panel toggle / page refresh.** On WS close the
 * PTY is NOT killed; it is detached and held for {@link IDLE_REAP_MS}
 * so re-opening the panel (or a page reload) can reattach via `tabId`
 * and pick up where the user left off. A rolling output buffer
 * ({@link OUTPUT_BUFFER_BYTES}) is replayed on reattach so xterm shows
 * recent output instead of just a fresh prompt.
 *
 * After {@link IDLE_REAP_MS} with no socket attached, the PTY is
 * killed. This is the safety valve.
 *
 * Architecture for PTY session management.
 */

import { randomUUID } from "node:crypto";
import * as nodePty from "node-pty";
import { config } from "./config.js";

export interface SpawnOptions {
  shell?: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
  /** Stable client-side identifier for this terminal tab. */
  tabId: string;
  /** Project id this PTY is scoped to. */
  projectId: string;
}

export interface ManagedPty {
  ptyId: string;
  tabId: string;
  projectId: string;
  process: nodePty.IPty;
  cwd: string;
}

const OUTPUT_BUFFER_BYTES = 256 * 1024; // 256 KB
const IDLE_REAP_MS = 10 * 60 * 1000; // 10 minutes
const SIGKILL_GRACE_MS = 2_000;

interface Entry {
  managed: ManagedPty;
  dataDisposable: nodePty.IDisposable | undefined;
  closeActiveSocket: (() => void) | undefined;
  idleTimer: NodeJS.Timeout | undefined;
  buffer: Buffer[];
  bufferBytes: number;
}

const ptys = new Map<string, Entry>();

function defaultShell(): string {
  return process.env.SHELL ?? "/bin/sh";
}

export function findPtyByTabId(tabId: string, projectId: string): ManagedPty | undefined {
  for (const entry of ptys.values()) {
    if (entry.managed.tabId !== tabId) continue;
    if (entry.managed.projectId !== projectId) continue;
    return entry.managed;
  }
  return undefined;
}

export function spawnPty(opts: SpawnOptions): ManagedPty {
  const shell = opts.shell ?? defaultShell();
  const cols = opts.cols ?? 80;
  const rows = opts.rows ?? 24;
  const env = opts.env ?? process.env;

  const proc = nodePty.spawn(shell, [], {
    name: "xterm-color",
    cols,
    rows,
    cwd: opts.cwd,
    env: { ...env, TERM: "xterm-256color" },
  });

  const ptyId = randomUUID();
  const managed: ManagedPty = {
    ptyId,
    tabId: opts.tabId,
    projectId: opts.projectId,
    process: proc,
    cwd: opts.cwd,
  };

  const entry: Entry = {
    managed,
    dataDisposable: undefined,
    closeActiveSocket: undefined,
    idleTimer: undefined,
    buffer: [],
    bufferBytes: 0,
  };
  ptys.set(ptyId, entry);

  // Always-on output capture — accumulates rolling buffer even
  // when no socket is attached, so reattach replays recent output.
  const captureDisposable = proc.onData((chunk) => {
    appendToBuffer(entry, chunk);
  });

  proc.onExit(() => {
    captureDisposable.dispose();
    ptys.delete(ptyId);
    if (entry.idleTimer !== undefined) clearTimeout(entry.idleTimer);
  });

  return managed;
}

/**
 * Attach a data sink to a managed PTY.
 * Replays the rolling output buffer, then forwards every subsequent
 * `onData` chunk. Returns a detach function the caller MUST invoke
 * on socket close.
 *
 * Cancels any pending idle reaper — the PTY is back in active use.
 */
export function attachSink(
  ptyId: string,
  onData: (chunk: Buffer) => void,
  replayBytes: number = OUTPUT_BUFFER_BYTES,
  closeActiveSocket?: () => void,
): (() => void) | undefined {
  const entry = ptys.get(ptyId);
  if (entry === undefined) return undefined;

  if (entry.idleTimer !== undefined) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
  }

  // Dispose previous data sink
  if (entry.dataDisposable !== undefined) {
    entry.dataDisposable.dispose();
    entry.dataDisposable = undefined;
  }

  // Close previously attached socket, if any
  if (entry.closeActiveSocket !== undefined) {
    try {
      entry.closeActiveSocket();
    } catch {
      // already gone
    }
    entry.closeActiveSocket = undefined;
  }
  entry.closeActiveSocket = closeActiveSocket;

  // Replay output buffer
  if (replayBytes > 0 && entry.bufferBytes > 0) {
    let remaining = Math.min(replayBytes, entry.bufferBytes);
    const tail: Buffer[] = [];
    for (let i = entry.buffer.length - 1; i >= 0 && remaining > 0; i--) {
      const chunk = entry.buffer[i]!;
      if (chunk.byteLength <= remaining) {
        tail.unshift(chunk);
        remaining -= chunk.byteLength;
      } else {
        tail.unshift(chunk.subarray(chunk.byteLength - remaining));
        remaining = 0;
      }
    }
    for (const chunk of tail) onData(chunk);
  }

  const live = entry.managed.process.onData((chunk: string) => {
    onData(Buffer.from(chunk, "utf8"));
  });
  entry.dataDisposable = live;

  return () => {
    if (entry.dataDisposable === live) {
      live.dispose();
      entry.dataDisposable = undefined;
      if (entry.closeActiveSocket === closeActiveSocket) {
        entry.closeActiveSocket = undefined;
      }
    }
    // Start idle reaper
    if (entry.idleTimer === undefined && ptys.has(ptyId)) {
      entry.idleTimer = setTimeout(() => {
        entry.idleTimer = undefined;
        killPty(ptyId);
      }, IDLE_REAP_MS);
    }
  };
}

function appendToBuffer(entry: Entry, chunk: string): void {
  const buf = Buffer.from(chunk, "utf8");
  entry.buffer.push(buf);
  entry.bufferBytes += buf.byteLength;
  while (entry.bufferBytes > OUTPUT_BUFFER_BYTES && entry.buffer.length > 0) {
    const head = entry.buffer.shift()!;
    entry.bufferBytes -= head.byteLength;
  }
}

export function getPty(ptyId: string): ManagedPty | undefined {
  return ptys.get(ptyId)?.managed;
}

export function killPty(ptyId: string): boolean {
  const entry = ptys.get(ptyId);
  if (entry === undefined) return false;
  ptys.delete(ptyId);
  if (entry.idleTimer !== undefined) clearTimeout(entry.idleTimer);
  if (entry.dataDisposable !== undefined) entry.dataDisposable.dispose();

  let killed = false;
  const exitDisposable = entry.managed.process.onExit(() => {
    killed = true;
  });
  try {
    entry.managed.process.kill("SIGTERM");
  } catch {
    return true;
  }
  setTimeout(() => {
    exitDisposable.dispose();
    if (killed) return;
    try {
      entry.managed.process.kill("SIGKILL");
    } catch {
      // already exited
    }
  }, SIGKILL_GRACE_MS).unref();
  return true;
}

export function ptyCount(): number {
  return ptys.size;
}

export function disposeAllPtys(): void {
  for (const ptyId of Array.from(ptys.keys())) {
    killPty(ptyId);
  }
}

let exitHandlerInstalled = false;
export function installPtyExitHandler(): void {
  if (exitHandlerInstalled) return;
  exitHandlerInstalled = true;
  process.on("exit", () => {
    for (const entry of ptys.values()) {
      try {
        entry.managed.process.kill("SIGTERM");
      } catch {
        // already gone
      }
    }
    ptys.clear();
  });
}
