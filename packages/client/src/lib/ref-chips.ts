/**
 * Parse `@path` / `@path#L5-12` / `@"path with spaces"#L2-4` markers out of
 * chat-input text so the UI can render them as removable file chips.
 *
 * This mirrors (a subset of) the server's path-ref resolution so the chip bar
 * stays in sync with what will actually be attached — a chip appears whenever
 * a well-formed marker is present, at the exact span it occupies.
 */

export interface RefChip {
  /** Unique-ish key derived from position in the text. */
  key: string;
  /** Character offset where the marker starts (the `@`). */
  start: number;
  /** Character offset one past the marker end. */
  end: number;
  /** Path as written (may be empty / a directory). */
  path: string;
  /** 1-based inclusive start line, if a `#L..` range was given. */
  startLine?: number;
  /** 1-based inclusive end line (=== startLine when a single line). */
  endLine?: number;
  /** The raw marker text (`@path#L1-3`). */
  raw: string;
}

const RANGE_RE = /^#L(\d+)(?:-L?(\d+))?/;

const KNOWN_EXTENSIONLESS_FILES = new Set([
  "dockerfile",
  "makefile",
  "license",
  "readme",
  "procfile",
  "gemfile",
  "rakefile",
  "containerfile",
]);

export function looksLikeFilePath(path: string): boolean {
  if (!path || path.length === 0) return false;
  // Path with directory separators (e.g. src/foo, .pi/settings.json)
  if (path.includes("/") || path.includes("\\")) return true;
  // Has a file extension (e.g. settings.json, foo.ts, a.py, .gitignore)
  if (/\.[a-zA-Z0-9_-]+$/.test(path) && path !== "." && path !== "..") return true;
  // Known extensionless files
  if (KNOWN_EXTENSIONLESS_FILES.has(path.toLowerCase())) return true;
  return false;
}

/**
 * Scan `value` for all `@` file markers. Returns chips in document order.
 * Handles quoted forms (`@"my dir/file.ts"#L2-4`) and bare forms
 * (`@src/foo.ts#L12-24` or `@src/foo.ts`), with or without a line range.
 */
export function parseRefChips(value: string): RefChip[] {
  const out: RefChip[] = [];
  const n = value.length;
  for (let i = 0; i < n; i++) {
    if (value[i] !== "@") {
      continue;
    }
    // Avoid matching ordinary occurrences like email addresses or
    // `user@something` or `func(@arg)`: @ must be at start of string or preceded by whitespace.
    if (i > 0 && !/\s/.test(value[i - 1])) {
      continue;
    }

    let j = i + 1;
    if (j >= n) continue;

    // Reject @ immediately followed by (, {, [, -, or whitespace
    // (PowerShell/Python/Java syntax: @(...), @{...}, @[...], CLI flags @--flag)
    const firstChar = value[j];
    if (firstChar === "(" || firstChar === "{" || firstChar === "[" || firstChar === "-" || /\s/.test(firstChar)) {
      continue;
    }

    let path = "";
    let startLine: number | undefined;
    let endLine: number | undefined;

    if (firstChar === '"') {
      const qStart = j + 1;
      let qEnd = qStart;
      while (qEnd < n && value[qEnd] !== '"' && value[qEnd] !== "\n" && value[qEnd] !== "\r") {
        qEnd++;
      }
      if (qEnd >= n || value[qEnd] !== '"') {
        continue; // unterminated quote or multi-line
      }
      const rawPath = value.slice(qStart, qEnd);
      // Quotes with commas (e.g. @"a, b" or argument list) are not file references
      if (rawPath.length === 0 || rawPath.includes(",")) {
        continue;
      }
      path = rawPath;
      j = qEnd + 1; // past closing quote

      // If immediately followed by a comma (e.g. @"foo", @"bar"), it's code/list, not a file tag
      if (j < n && value[j] === ",") {
        continue;
      }

      const m = value.slice(j).match(RANGE_RE);
      if (m) {
        startLine = Number(m[1]);
        endLine = m[2] !== undefined ? Number(m[2]) : startLine;
        j += m[0].length;
      }

      // After optional line range, if followed by a comma, it's code syntax
      if (j < n && value[j] === ",") {
        continue;
      }
    } else {
      const tStart = j;
      while (j < n && !/\s/.test(value[j])) {
        j++;
      }
      let tok = value.slice(tStart, j);

      // Strip trailing sentence punctuation (?,;:!)]) that may be attached at the end of sentence
      const trailingMatch = tok.match(/[?,;:!)\]]+$/);
      if (trailingMatch) {
        tok = tok.slice(0, -trailingMatch[0].length);
        j -= trailingMatch[0].length;
      }

      // Bare token hardening:
      // Must not start with - or $
      if (tok.startsWith("-") || tok.startsWith("$")) {
        continue;
      }

      // Must not contain (, ), {, }, [, ], ,, ", ', ;, =, $, *, <, >, |
      if (/[(){}[\],"';=$*<>|]/.test(tok)) {
        continue;
      }

      const m = tok.match(/^(.*?)#L(\d+)(?:-L?(\d+))?$/);
      if (m) {
        path = m[1] ?? "";
        startLine = Number(m[2]);
        endLine = m[3] !== undefined ? Number(m[3]) : startLine;
      } else {
        path = tok;
      }

      // Bare tokens must look like a file path (have an extension, slash, or line range).
      // Bare identifiers like @ServerArgs, @args, @Override, @param are code syntax, not file tags.
      if (startLine === undefined && !looksLikeFilePath(path)) {
        continue;
      }
    }

    if (path.length === 0) {
      continue;
    }

    const raw = value.slice(i, j);
    out.push({ key: `${i}:${raw}`, start: i, end: j, path, startLine, endLine, raw });
    i = j - 1;
  }
  return out;
}