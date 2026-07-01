import { extname, join } from "node:path";
import { readFile } from "./file-manager.js";
import { stat, open as fsOpen } from "node:fs/promises";

/**
 * Process `@<path>` references in user input. The chat input's
 * `@`-autocomplete inserts these markers; this helper transforms them
 * server-side before the prompt reaches pi's `session.prompt()`.
 *
 * Threshold-based design: small files get inlined as fenced code blocks
 * (the model has the content immediately, no tool round-trip); large
 * files stay as the literal `@<path>` reference (the model loads what
 * it needs via its read/grep/find tools, no context-burn on a 50 MB
 * log we'd otherwise inhale wholesale).
 *
 * The chat UI renders BOTH forms as collapsed file badges in the user
 * message bubble, so visually the user sees a chip either way; the
 * difference is purely whether the LLM has the content in-prompt or
 * has to fetch it.
 *
 * Behaviour:
 * - Markers must be at start-of-string OR preceded by whitespace
 *   (avoid expanding `email@example.com`).
 * - Two path forms accepted:
 *     `@<path>`               — greedy non-whitespace; common case.
 *     `@"<path with spaces>"` — anything that isn't a `"` or newline.
 * - Resolved against the project's workspace root via file-manager's
 *   path-traversal-safe `checkFileReference`. Four outcomes:
 *     inline    → file ≤ INLINE_THRESHOLD; replace marker with a
 *                  fenced code block. Language hint derived from
 *                  extension.
 *     defer     → file > INLINE_THRESHOLD; leave the literal `@<path>`
 *                  reference for the model to load on demand.
 *     directory → path is a directory; preserve the marker normalized
 *                  with a trailing `/` (e.g. `@src/components/`) so
 *                  the model can ls/find/grep it via its tools.
 *     error     → missing / outside root / binary. Replace marker
 *                  with `[@<path> not included: <reason>]`.
 *
 * Multiple markers in one prompt are classified independently, then
 * inline candidates compete for a shared aggregate budget. See
 * `AGGREGATE_INLINE_BUDGET_BYTES` for the cap and the smallest-first
 * walk that keeps the degradation graceful.
 */

/** Per-file inlining cutoff. 128 KB ≈ 32K tokens. */
const INLINE_THRESHOLD_BYTES = 128 * 1024;

/** Aggregate cap on TOTAL bytes inlined across every `@<path>` in one prompt. 512 KB ≈ 128K tokens. */
const AGGREGATE_INLINE_BUDGET_BYTES = 512 * 1024;

/**
 * Regex shared by `findRefs` and `parseFileReferences`. Match `@` at
 * start-or-after-whitespace then either a `"path with spaces"` quoted
 * form or a bare non-whitespace token.
 */
const REF_RE = /(^|\s)@(?:"([^"\n]+)"|([^\s]+?))(?=[?,;:!)\]]?(?:\s|$))/g;

interface RefMatch {
  start: number;
  end: number;
  path: string;
  lead: string;
}

function findRefs(text: string): RefMatch[] {
  const matches: RefMatch[] = [];
  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(text)) !== null) {
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      lead: m[1] ?? "",
      path: m[2] ?? m[3] ?? "",
    });
  }
  return matches;
}

/** Parse `@<path>` references out of a text without touching it. */
export function parseFileReferences(text: string): string[] {
  return findRefs(text).map((m) => m.path);
}

export async function expandFileReferences(text: string, workspacePath: string): Promise<string> {
  const matches = findRefs(text);
  if (matches.length === 0) return text;

  type Classification =
    | { kind: "inlineCandidate"; size: number; abs: string }
    | { kind: "deferLarge" }
    | { kind: "directory" }
    | { kind: "error"; reason: string };

  // Phase 1: classify every marker in parallel
  const classifications: Classification[] = await Promise.all(
    matches.map(async (mm): Promise<Classification> => {
      try {
        const abs = join(workspacePath, mm.path);
        const st = await stat(abs).catch(() => undefined);
        if (st === undefined) return { kind: "error", reason: "file not found" };
        if (st.isDirectory()) return { kind: "directory" };

        // Binary sniff — read first 8 KB
        const fh = await fsOpen(abs, "r");
        try {
          const buf = Buffer.alloc(8000);
          const { bytesRead } = await fh.read(buf, 0, 8000, 0);
          const binary = looksBinary(buf.subarray(0, bytesRead));
          if (binary) return { kind: "error", reason: "binary file" };
        } finally {
          await fh.close();
        }

        if (st.size > INLINE_THRESHOLD_BYTES) return { kind: "deferLarge" };
        return { kind: "inlineCandidate", size: st.size, abs };
      } catch (err) {
        const e = err as Error & { code?: string };
        if (e.name === "NotFoundError" || e.code === "ENOENT") {
          return { kind: "error", reason: "file not found" };
        }
        if (e.name === "PathOutsideRootError") {
          return { kind: "error", reason: "path is outside allowed roots" };
        }
        return { kind: "error", reason: "unreadable" };
      }
    }),
  );

  // Phase 2: aggregate-budget walk, smallest-first
  const inlineSet = new Set<number>();
  const candidateIndices: { i: number; size: number }[] = [];
  for (let i = 0; i < classifications.length; i += 1) {
    const c = classifications[i];
    if (c?.kind === "inlineCandidate") candidateIndices.push({ i, size: c.size });
  }
  candidateIndices.sort((a, b) => a.size - b.size);
  let remaining = AGGREGATE_INLINE_BUDGET_BYTES;
  for (const { i, size } of candidateIndices) {
    if (size <= remaining) {
      inlineSet.add(i);
      remaining -= size;
    }
  }

  type Outcome =
    | { kind: "inline"; text: string }
    | { kind: "defer" }
    | { kind: "directory" }
    | { kind: "error"; reason: string };

  // Phase 3: read content for budget survivors
  const outcomes: Outcome[] = await Promise.all(
    classifications.map(async (c, i): Promise<Outcome> => {
      if (c.kind === "directory") return { kind: "directory" };
      if (c.kind === "error") return { kind: "error", reason: c.reason };
      if (c.kind === "deferLarge") return { kind: "defer" };
      if (!inlineSet.has(i)) return { kind: "defer" };
      try {
        const result = await readFile(c.abs, workspacePath);
        if (result.binary) return { kind: "error", reason: "binary file" };
        const mm = matches[i];
        if (mm === undefined) return { kind: "defer" };
        return { kind: "inline", text: formatExpansion(mm.path, result.content) };
      } catch (err) {
        const e = err as Error & { code?: string };
        if (e.name === "FileTooLargeError" || e.name === "NotFoundError" || e.code === "ENOENT") {
          return { kind: "defer" };
        }
        return { kind: "error", reason: "unreadable" };
      }
    }),
  );

  // Walk in reverse so earlier indices stay valid
  let out = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    const outcome = outcomes[i];
    const mm = matches[i];
    if (outcome === undefined || mm === undefined) continue;
    const before = out.slice(0, mm.start) + mm.lead;
    const after = out.slice(mm.end);
    const marker = /\s/.test(mm.path) ? `@"${mm.path}"` : `@${mm.path}`;
    if (outcome.kind === "inline") {
      out = `${before}${marker}\n${outcome.text}\n${after}`;
    } else if (outcome.kind === "defer") {
      out = `${before}${marker}${after}`;
    } else if (outcome.kind === "directory") {
      const dirPath = mm.path.endsWith("/") ? mm.path : `${mm.path}/`;
      const dirMarker = /\s/.test(dirPath) ? `@"${dirPath}"` : `@${dirPath}`;
      out = `${before}${dirMarker}${after}`;
    } else {
      out = `${before}[${marker} not included: ${outcome.reason}]${after}`;
    }
  }
  return out;
}

function formatExpansion(path: string, content: string): string {
  const lang = languageHintForPath(path);
  const fence = pickFence(content);
  return `${fence}${lang} file: ${path}\n${content}\n${fence}`;
}

function pickFence(content: string): string {
  let max = 0;
  let run = 0;
  for (const ch of content) {
    if (ch === "`") {
      run += 1;
      if (run > max) max = run;
    } else {
      run = 0;
    }
  }
  return "`".repeat(Math.max(3, max + 1));
}

function looksBinary(buf: Buffer): boolean {
  const limit = Math.min(buf.length, 8000);
  for (let i = 0; i < limit; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".jsx": "jsx",
  ".mjs": "js",
  ".cjs": "js",
  ".json": "json",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".md": "markdown",
  ".html": "html",
  ".css": "css",
  ".scss": "scss",
  ".sql": "sql",
  ".xml": "xml",
};

export function languageHintForPath(path: string): string {
  const ext = extname(path).toLowerCase();
  return LANG_BY_EXT[ext] ?? "";
}
