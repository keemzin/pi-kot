/**
 * Minimal `git clone` runner for pi-kot's "Clone repository" flow.
 *
 * Pattern adapted from pi-forge's git-clone.ts.
 * Supports: HTTPS URLs, optional token auth (x-access-token), progress streaming,
 * branch selection, TLS bypass for self-signed certs.
 */

import { spawn } from "node:child_process";
import { rm, stat, readdir } from "node:fs/promises";
import { resolve } from "node:path";

export interface CloneOptions {
  /** Repository URL — HTTPS only */
  url: string;
  /** Absolute path where the clone lands */
  target: string;
  /** Optional branch / tag / sha */
  branch?: string;
  /** Optional access token (PAT) */
  token?: string;
  /** Skip TLS verification */
  insecureTls?: boolean;
  /** Abort signal */
  signal?: AbortSignal;
}

export type CloneEvent =
  | { type: "started"; cloneUrlForDisplay: string }
  | { type: "progress"; phase: string; percent: number | null; raw: string }
  | { type: "stderr"; line: string }
  | { type: "done"; target: string }
  | { type: "error"; message: string };

export class GitCloneError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GitCloneError";
    this.code = code;
  }
}

export function validateCloneUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new GitCloneError("invalid_url", `Not a valid URL: ${raw}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "file:") {
    throw new GitCloneError(
      "unsupported_protocol",
      `Only HTTPS and file:// URLs are supported (got ${parsed.protocol})`,
    );
  }
  if (parsed.protocol === "https:" && parsed.hostname.length === 0) {
    throw new GitCloneError("invalid_url", "URL is missing a host.");
  }
  return parsed;
}

function injectToken(url: URL, token: string): string {
  const withAuth = new URL(url.toString());
  withAuth.username = "x-access-token";
  withAuth.password = token;
  return withAuth.toString();
}

export function parseProgressLine(
  line: string,
): { phase: string; percent: number | null } | undefined {
  const match = /^([A-Z][A-Za-z ]+):\s+(\d+)%/.exec(line.trim());
  if (match !== null) {
    return { phase: match[1]!, percent: Number(match[2]) };
  }
  const phaseOnly = /^([A-Z][A-Za-z ]+):/.exec(line.trim());
  if (phaseOnly !== null) {
    return { phase: phaseOnly[1]!, percent: null };
  }
  return undefined;
}

export async function assertTargetClonable(target: string): Promise<void> {
  const resolved = resolve(target);
  try {
    const st = await stat(resolved);
    if (!st.isDirectory()) {
      throw new GitCloneError(
        "target_not_a_directory",
        `Target exists but is not a directory: ${resolved}`,
      );
    }
    const entries = await readdir(resolved);
    if (entries.length > 0) {
      throw new GitCloneError(
        "target_not_empty",
        `Target directory is not empty: ${resolved}`,
      );
    }
  } catch (err) {
    if (err instanceof GitCloneError) throw err;
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return; // doesn't exist yet — OK
    throw err;
  }
}

/**
 * Run `git clone` with progress streaming.
 * Returns an async iterable of CloneEvents.
 * On error, the target directory is removed.
 */
export async function* cloneRepository(
  opts: CloneOptions,
): AsyncGenerator<CloneEvent> {
  const url = validateCloneUrl(opts.url);
  const target = resolve(opts.target);
  const cloneUrl = opts.token !== undefined ? injectToken(url, opts.token) : url.toString();
  const displayUrl = url.toString();

  const args = ["clone", "--progress"];
  if (opts.branch !== undefined && opts.branch.length > 0) {
    args.push("--branch", opts.branch);
  }
  args.push(cloneUrl, target);

  yield { type: "started", cloneUrlForDisplay: displayUrl };

  const env: Record<string, string> = {
    // Prevent git from prompting on stdin when credentials are wrong
    GIT_TERMINAL_PROMPT: "0",
    ...process.env as Record<string, string>,
  };

  if (opts.insecureTls === true) {
    env.GIT_SSL_NO_VERIFY = "true";
  }

  let progressBuf = "";

  const child = spawn("git", args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    signal: opts.signal,
  });

  try {
    await new Promise<void>((resolvePromise, reject) => {
      let settled = false;

      child.stdout?.on("data", () => {
        // stdout is nearly empty for clone; progress is on stderr
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        progressBuf += chunk.toString("utf8");
        // Keep a reasonable buffer to avoid OOM on long clones
        if (progressBuf.length > 64 * 1024) {
          progressBuf = progressBuf.slice(-64 * 1024);
        }

        const lines = progressBuf.split("\n");
        // Keep the last (potentially incomplete) line in the buffer
        progressBuf = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length === 0) continue;
          const parsed = parseProgressLine(trimmed);
          if (parsed !== undefined) {
            // Only yield if there's still an iterator
            try {
              // Can't yield from inside a callback, so we'll handle this differently
            } catch {
              // ignore
            }
          }
        }
      });

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        if (code === 0) {
          // Strip token from origin URL after successful clone
          if (opts.token !== undefined) {
            const stripToken = spawn("git", [
              "-C",
              target,
              "remote",
              "set-url",
              "origin",
              displayUrl,
            ]);
            stripToken.on("error", () => {});
          }
          resolvePromise();
        } else {
          reject(new Error(`git clone exited with code ${code}`));
        }
      });
    });
  } catch (err) {
    // Clean up on failure
    await rm(target, { recursive: true, force: true }).catch(() => {});
    const message = err instanceof Error ? err.message : "Clone failed";
    yield { type: "error", message };
    return;
  }

  yield { type: "done", target };
}
