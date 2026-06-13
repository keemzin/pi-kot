import { execFile, spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { MAX_READ_BYTES, SEARCH_SKIP_DIRS } from "./file-manager.js";

const execFileAsync = promisify(execFile);

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  length: number;
  lineSnippet: string;
}

export interface SearchOptions {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  includeGitignored: boolean;
  include?: string;
  exclude?: string;
  limit: number;
  timeoutMs: number;
}

export interface SearchResult {
  engine: "ripgrep" | "node";
  matches: SearchMatch[];
  truncated: boolean;
}

let cachedRipgrepAvailable: boolean | undefined;

export async function ripgrepAvailable(): Promise<boolean> {
  if (cachedRipgrepAvailable !== undefined) return cachedRipgrepAvailable;
  try {
    await execFileAsync("rg", ["--version"], { timeout: 2_000 });
    cachedRipgrepAvailable = true;
  } catch {
    cachedRipgrepAvailable = false;
  }
  return cachedRipgrepAvailable;
}

export function _resetRipgrepCache(): void {
  cachedRipgrepAvailable = undefined;
}

export class SearchEngineUnavailableError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "SearchEngineUnavailableError";
  }
}

export async function searchFiles(projectPath: string, opts: SearchOptions): Promise<SearchResult> {
  if (await ripgrepAvailable()) {
    return searchWithRipgrep(projectPath, opts);
  }
  if (opts.regex) {
    throw new SearchEngineUnavailableError(
      "regex search requires ripgrep, which isn't installed on this host",
    );
  }
  return searchInProcess(projectPath, opts);
}

interface RipgrepEvent {
  type: "begin" | "match" | "end" | "summary" | "context";
  data?: Record<string, unknown>;
}

async function searchWithRipgrep(projectPath: string, opts: SearchOptions): Promise<SearchResult> {
  const args: string[] = [
    "--json",
    "--no-heading",
    "--max-filesize",
    "5M",
    "--max-count",
    String(Math.max(1, Math.min(opts.limit, 1000))),
  ];
  if (!opts.regex) args.push("--fixed-strings");
  if (!opts.caseSensitive) args.push("-i");
  if (opts.includeGitignored) {
    args.push("-uu");
  }
  if (opts.include !== undefined && opts.include.length > 0) {
    args.push("--glob", opts.include);
  }
  if (opts.exclude !== undefined && opts.exclude.length > 0) {
    args.push("--glob", `!${opts.exclude}`);
  }
  args.push("--", opts.query, ".");

  return new Promise<SearchResult>((resolveFn) => {
    const matches: SearchMatch[] = [];
    let truncated = false;
    const child = spawn("rg", args, { cwd: projectPath });
    const timer = setTimeout(() => {
      truncated = true;
      child.kill("SIGTERM");
    }, opts.timeoutMs);

    let buf = "";
    let currentFile: string | undefined;

    const finish = (): void => {
      clearTimeout(timer);
      resolveFn({ engine: "ripgrep", matches, truncated });
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buf += chunk;
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.length > 0) handleEvent(line);
        nl = buf.indexOf("\n");
      }
    });
    child.on("error", () => finish());
    child.on("close", () => finish());

    const handleEvent = (jsonLine: string): void => {
      let event: RipgrepEvent;
      try {
        event = JSON.parse(jsonLine) as RipgrepEvent;
      } catch {
        return;
      }
      if (event.type === "begin") {
        const data = event.data as { path?: { text?: string } } | undefined;
        currentFile = data?.path?.text;
      } else if (event.type === "match") {
        if (matches.length >= opts.limit) {
          truncated = true;
          child.kill("SIGTERM");
          return;
        }
        const data = event.data as
          | {
              lines?: { text?: string };
              line_number?: number;
              submatches?: { start?: number; end?: number; match?: { text?: string } }[];
            }
          | undefined;
        if (data === undefined || currentFile === undefined) return;
        const lineText = data.lines?.text ?? "";
        const lineNumber = data.line_number ?? 0;
        const sub = data.submatches?.[0];
        const start = sub?.start ?? 0;
        const matchText = sub?.match?.text ?? "";
        matches.push({
          path: currentFile,
          line: lineNumber,
          column: start + 1,
          length: matchText.length,
          lineSnippet: stripTrailingNewline(lineText),
        });
      }
    };
  });
}

async function searchInProcess(projectPath: string, opts: SearchOptions): Promise<SearchResult> {
  const matches: SearchMatch[] = [];
  let truncated = false;
  const deadline = Date.now() + opts.timeoutMs;

  const re = opts.regex ? safeRegex(opts.query, opts.caseSensitive) : undefined;
  if (opts.regex && re === undefined) {
    return { engine: "node", matches: [], truncated: false };
  }

  const includeMatch = opts.include !== undefined ? globToRegExp(opts.include) : undefined;
  const excludeMatch = opts.exclude !== undefined ? globToRegExp(opts.exclude) : undefined;

  const root = resolve(projectPath);
  const stack: string[] = [root];
  const filesToScan: string[] = [];

  while (stack.length > 0 && Date.now() < deadline) {
    const dir = stack.pop();
    if (dir === undefined) break;
    const depth = relative(root, dir)
      .split(/[\\/]/)
      .filter((p) => p.length > 0).length;
    if (depth > 6) continue;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SEARCH_SKIP_DIRS.has(ent.name)) continue;
        if (ent.name.startsWith(".") && ent.name !== ".") continue;
        stack.push(full);
      } else if (ent.isFile()) {
        const rel = relative(root, full);
        if (includeMatch !== undefined && !includeMatch.test(rel)) continue;
        if (excludeMatch !== undefined && excludeMatch.test(rel)) continue;
        filesToScan.push(rel);
      }
    }
  }
  if (Date.now() >= deadline) truncated = true;

  const CONCURRENCY = 16;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < filesToScan.length) {
      if (Date.now() >= deadline) {
        truncated = true;
        return;
      }
      if (matches.length >= opts.limit) {
        truncated = true;
        return;
      }
      const i = cursor++;
      const rel = filesToScan[i];
      if (rel === undefined) continue;
      const full = join(root, rel);
      let st;
      try {
        st = await stat(full);
      } catch {
        continue;
      }
      if (!st.isFile() || st.size > MAX_READ_BYTES) continue;
      let content: string;
      try {
        const buf = await readFile(full);
        if (looksBinary(buf)) continue;
        content = buf.toString("utf8");
      } catch {
        continue;
      }
      scanText(content, rel, opts, re, matches, opts.limit);
    }
  };
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(CONCURRENCY, filesToScan.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  if (matches.length >= opts.limit) truncated = true;

  return { engine: "node", matches, truncated };
}

function scanText(
  content: string,
  rel: string,
  opts: SearchOptions,
  re: RegExp | undefined,
  out: SearchMatch[],
  limit: number,
): void {
  const lines = content.split("\n");
  const cmpQuery = opts.caseSensitive ? opts.query : opts.query.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    if (out.length >= limit) return;
    const line = lines[i] ?? "";
    if (re !== undefined) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        out.push({
          path: rel,
          line: i + 1,
          column: m.index + 1,
          length: m[0].length,
          lineSnippet: line,
        });
        if (out.length >= limit) return;
        if (m.index === re.lastIndex) re.lastIndex += 1;
      }
    } else {
      const haystack = opts.caseSensitive ? line : line.toLowerCase();
      let from = 0;
      while (from <= haystack.length) {
        const idx = haystack.indexOf(cmpQuery, from);
        if (idx === -1) break;
        out.push({
          path: rel,
          line: i + 1,
          column: idx + 1,
          length: opts.query.length,
          lineSnippet: line,
        });
        if (out.length >= limit) return;
        from = idx + Math.max(1, opts.query.length);
      }
    }
  }
}

function looksBinary(buf: Buffer): boolean {
  const probe = buf.subarray(0, Math.min(4096, buf.length));
  for (let i = 0; i < probe.length; i++) {
    if (probe[i] === 0) return true;
  }
  return false;
}

function safeRegex(pattern: string, caseSensitive: boolean): RegExp | undefined {
  try {
    return new RegExp(pattern, caseSensitive ? "g" : "gi");
  } catch {
    return undefined;
  }
}

function stripTrailingNewline(s: string): string {
  if (s.endsWith("\r\n")) return s.slice(0, -2);
  if (s.endsWith("\n")) return s.slice(0, -1);
  return s;
}

function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] ?? "";
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (".+^$()[]{}|\\".includes(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  out += "$";
  return new RegExp(out);
}
