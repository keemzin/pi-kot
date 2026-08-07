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
    // `user@something` unless the `@` is at start / after whitespace / `(`.
    if (i > 0 && !/[\s(]/.test(value[i - 1])) {
      continue;
    }

    let j = i + 1;
    let path = "";
    let startLine: number | undefined;
    let endLine: number | undefined;

    if (value[j] === '"') {
      const jPrev = j++;
      const qStart = j;
      while (j < n && value[j] !== '"') {
        j++;
      }
      if (j >= n) {
        continue; // unterminated quote — not (yet) a complete marker
      }
      path = value.slice(qStart, j);
      j++; // past closing quote
      const m = value.slice(j).match(RANGE_RE);
      if (m) {
        startLine = Number(m[1]);
        endLine = m[2] !== undefined ? Number(m[2]) : startLine;
        j += m[0].length;
      }
      void jPrev;
    } else {
      const tStart = j;
      while (j < n && !/\s/.test(value[j])) {
        j++;
      }
      const tok = value.slice(tStart, j);
      const m = tok.match(/^(.*?)#L(\d+)(?:-L?(\d+))?$/);
      if (m) {
        path = m[1] ?? "";
        startLine = Number(m[2]);
        endLine = m[3] !== undefined ? Number(m[3]) : startLine;
      } else {
        path = tok;
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