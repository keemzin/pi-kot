import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { config } from "../config.js";
import { LogChannel, processLogDir } from "./log-store.js";
import { buildMatchEvent, compileWatches, evaluateWatches, type CompiledWatch } from "./watches.js";
import {
  LIVE_STATUSES,
  type KillResult,
  type ManagerEvent,
  type ProcessInfo,
  type ProcessStatus,
  type StartOptions,
  type WriteResult,
} from "./types.js";

const GRACE_MS = 5_000;
const SIGKILL_TIMEOUT_MS = 2_000;

interface ManagedProcess {
  info: ProcessInfo;
  child: ChildProcessWithoutNullStreams;
  stdout: LogChannel;
  stderr: LogChannel;
  watches: CompiledWatch[];
  killSent: "SIGTERM" | "SIGKILL" | null;
  killTimer: NodeJS.Timeout | null;
}

interface SessionState {
  sessionId: string;
  processes: Map<string, ManagedProcess>;
}

type Listener = (event: ManagerEvent) => void;

function sanitizeEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  // Clean sensitive server credentials from child process environment
  delete env.API_KEY;
  delete env.UI_PASSWORD;
  delete env.JWT_SECRET;
  return env;
}

export class ProcessManager {
  private readonly bySession = new Map<string, SessionState>();
  private readonly listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(event: ManagerEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch {
        // Listener errors must not crash manager
      }
    }
  }

  private getOrCreateSession(sessionId: string): SessionState {
    let s = this.bySession.get(sessionId);
    if (s === undefined) {
      s = { sessionId, processes: new Map() };
      this.bySession.set(sessionId, s);
    }
    return s;
  }

  /**
   * Spawn a new background process bound to a session.
   */
  start(
    sessionId: string,
    name: string,
    command: string,
    cwd: string,
    opts: StartOptions = {},
  ): ProcessInfo {
    const session = this.getOrCreateSession(sessionId);
    const id = randomBytes(4).toString("hex");
    const logDir = processLogDir(config.forgeDataDir, sessionId, id);
    const stdoutFile = join(logDir, "stdout.log");
    const stderrFile = join(logDir, "stderr.log");

    // Spawn under `/bin/sh -c` with detached: true so kill(-pid) kills the whole process group
    const child = spawn("/bin/sh", ["-c", command], {
      cwd,
      env: sanitizeEnvironment(opts.toolEnv),
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

    const info: ProcessInfo = {
      id,
      name,
      pid: child.pid ?? -1,
      command,
      cwd,
      startTime: Date.now(),
      endTime: null,
      status: "running",
      exitCode: null,
      success: null,
      stdoutFile,
      stderrFile,
      alertOnSuccess: opts.alertOnSuccess === true,
      alertOnFailure: opts.alertOnFailure !== false, // default true
      alertOnKill: opts.alertOnKill === true,
    };

    const managed: ManagedProcess = {
      info,
      child,
      stdout: new LogChannel(stdoutFile),
      stderr: new LogChannel(stderrFile),
      watches: compileWatches(opts.logWatches),
      killSent: null,
      killTimer: null,
    };
    session.processes.set(id, managed);

    const wireUp = (source: "stdout" | "stderr"): void => {
      const stream = source === "stdout" ? child.stdout : child.stderr;
      const channel = source === "stdout" ? managed.stdout : managed.stderr;

      stream.on("data", (chunk: Buffer) => {
        channel.append(chunk, (line) => {
          const hits = evaluateWatches(managed.watches, source, line);
          for (const w of hits) {
            this.notify({
              type: "process_watch_matched",
              sessionId,
              match: buildMatchEvent(w, id, name, command, source, line),
            });
          }
        });
        this.notify({ type: "process_output_changed", sessionId, id });
      });
    };

    wireUp("stdout");
    wireUp("stderr");

    child.on("error", (err) => {
      const text = `[spawn error] ${err.message}\n`;
      managed.stderr.append(Buffer.from(text, "utf8"));
      info.endTime = Date.now();
      info.exitCode = -1;
      info.success = false;
      info.status = "exited";

      this.notify({ type: "process_ended", sessionId, info });
      this.notify({ type: "processes_changed", sessionId });
      if (info.alertOnFailure) {
        this.notify({
          type: "process_alert",
          sessionId,
          info,
          reason: "failure",
        });
      }
      void this.finalize(managed);
    });

    child.on("close", (code, signal) => {
      info.endTime = Date.now();
      info.exitCode = typeof code === "number" ? code : null;

      const killedByUs = managed.killSent !== null;
      const killedExternally = !killedByUs && signal !== null;
      const wasKilled = killedByUs || killedExternally;

      info.status = wasKilled ? "killed" : "exited";
      info.success = info.exitCode === 0 && !wasKilled;

      if (managed.killTimer !== null) {
        clearTimeout(managed.killTimer);
        managed.killTimer = null;
      }

      this.notify({ type: "process_ended", sessionId, info });
      this.notify({ type: "processes_changed", sessionId });

      // Determine alert notifications
      if (info.success && info.alertOnSuccess) {
        this.notify({
          type: "process_alert",
          sessionId,
          info,
          reason: "success",
        });
      } else if (!info.success && !wasKilled && info.alertOnFailure) {
        this.notify({
          type: "process_alert",
          sessionId,
          info,
          reason: "failure",
        });
      } else if (killedExternally && info.alertOnKill) {
        this.notify({
          type: "process_alert",
          sessionId,
          info,
          reason: "killed",
        });
      }

      void this.finalize(managed);
    });

    this.notify({ type: "process_started", sessionId, info });
    this.notify({ type: "processes_changed", sessionId });

    return info;
  }

  private async finalize(managed: ManagedProcess): Promise<void> {
    try {
      await Promise.all([managed.stdout.close(), managed.stderr.close()]);
    } catch {
      // best-effort
    }
  }

  /**
   * List all processes for a session.
   */
  list(sessionId: string): ProcessInfo[] {
    const session = this.bySession.get(sessionId);
    if (!session) return [];
    return Array.from(session.processes.values())
      .map((m) => ({ ...m.info }))
      .sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * Get a single process info by ID.
   */
  get(sessionId: string, id: string): ProcessInfo | undefined {
    return this.bySession.get(sessionId)?.processes.get(id)?.info;
  }

  /**
   * Get recent stdout/stderr output lines for a process.
   */
  getOutput(
    sessionId: string,
    id: string,
    lineCount: number = 200,
  ): { stdout: string[]; stderr: string[]; status: ProcessStatus } | undefined {
    const managed = this.bySession.get(sessionId)?.processes.get(id);
    if (!managed) return undefined;
    return {
      stdout: managed.stdout.tail(lineCount),
      stderr: managed.stderr.tail(lineCount),
      status: managed.info.status,
    };
  }

  /**
   * Get on-disk log file paths for a process.
   */
  getLogFiles(
    sessionId: string,
    id: string,
  ): { stdoutFile: string; stderrFile: string } | undefined {
    const managed = this.bySession.get(sessionId)?.processes.get(id);
    if (!managed) return undefined;
    return {
      stdoutFile: managed.info.stdoutFile,
      stderrFile: managed.info.stderrFile,
    };
  }

  /**
   * Terminate a process: SIGTERM -> wait GRACE_MS -> SIGKILL.
   */
  async kill(sessionId: string, id: string): Promise<KillResult> {
    const managed = this.bySession.get(sessionId)?.processes.get(id);
    if (!managed) return { ok: false, info: undefined, reason: "not_found" };

    if (!LIVE_STATUSES.has(managed.info.status)) {
      return { ok: true, info: managed.info };
    }

    managed.info.status = "terminating";
    managed.killSent = "SIGTERM";
    this.notify({ type: "processes_changed", sessionId });

    const sendSignal = (sig: "SIGTERM" | "SIGKILL"): void => {
      const pid = managed.child.pid;
      if (pid === undefined) return;
      try {
        // Signal the whole process group (detached process)
        process.kill(-pid, sig);
      } catch {
        try {
          managed.child.kill(sig);
        } catch {
          // already exited
        }
      }
    };

    sendSignal("SIGTERM");

    return new Promise<KillResult>((resolve) => {
      let resolved = false;

      const finish = (result: KillResult): void => {
        if (resolved) return;
        resolved = true;
        if (managed.killTimer !== null) {
          clearTimeout(managed.killTimer);
          managed.killTimer = null;
        }
        resolve(result);
      };

      managed.child.once("close", () => {
        finish({ ok: true, info: managed.info });
      });

      managed.killTimer = setTimeout(() => {
        if (!LIVE_STATUSES.has(managed.info.status)) return;
        managed.info.status = "terminate_timeout";
        managed.killSent = "SIGKILL";
        this.notify({ type: "processes_changed", sessionId });

        sendSignal("SIGKILL");

        managed.killTimer = setTimeout(() => {
          finish({ ok: false, info: managed.info, reason: "timeout" });
        }, SIGKILL_TIMEOUT_MS);
      }, GRACE_MS);
    });
  }

  /**
   * Write to process stdin.
   */
  write(sessionId: string, id: string, input: string, end: boolean = false): WriteResult {
    const managed = this.bySession.get(sessionId)?.processes.get(id);
    if (!managed) return { ok: false, reason: "not_found" };

    if (!LIVE_STATUSES.has(managed.info.status)) {
      return { ok: false, reason: "process_exited" };
    }

    const stdin = managed.child.stdin;
    if (!stdin || stdin.destroyed || stdin.writableEnded) {
      return { ok: false, reason: "stdin_closed" };
    }

    try {
      stdin.write(input);
      if (end) stdin.end();
      return { ok: true };
    } catch {
      return { ok: false, reason: "write_error" };
    }
  }

  /**
   * Remove finished / exited / killed processes from the session state.
   */
  clearFinished(sessionId: string): number {
    const session = this.bySession.get(sessionId);
    if (!session) return 0;

    let cleared = 0;
    for (const [id, proc] of session.processes.entries()) {
      if (!LIVE_STATUSES.has(proc.info.status)) {
        session.processes.delete(id);
        cleared++;
      }
    }

    if (cleared > 0) {
      this.notify({ type: "processes_changed", sessionId });
    }
    return cleared;
  }

  /**
   * Kill all processes and clean up when a session is disposed.
   */
  async disposeSession(sessionId: string): Promise<void> {
    const session = this.bySession.get(sessionId);
    if (!session) return;

    const liveProcesses = Array.from(session.processes.values()).filter((p) =>
      LIVE_STATUSES.has(p.info.status),
    );

    await Promise.all(
      liveProcesses.map(async (proc) => {
        try {
          await this.kill(sessionId, proc.info.id);
        } catch {
          // best-effort cleanup
        }
      }),
    );

    this.bySession.delete(sessionId);
  }
}

export const processManager = new ProcessManager();
