import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const ROLLING_LINES_CAP = 200;

export function processLogDir(baseDir: string, sessionId: string, processId: string): string {
  return join(baseDir, "processes", sessionId, processId);
}

/**
 * Manages an on-disk append-only log file alongside an in-memory
 * rolling line tail for fast output retrieval.
 */
export class LogChannel {
  private stream: WriteStream | null = null;
  private pendingInit: Promise<void> | null = null;
  private lineRemainder = "";
  private readonly lines: string[] = [];

  constructor(public readonly filePath: string) {}

  private async ensureStream(): Promise<WriteStream> {
    if (this.stream !== null) return this.stream;
    if (this.pendingInit === null) {
      this.pendingInit = (async () => {
        await mkdir(dirname(this.filePath), { recursive: true });
        this.stream = createWriteStream(this.filePath, { flags: "a", encoding: "utf8" });
      })();
    }
    await this.pendingInit;
    return this.stream!;
  }

  append(chunk: Buffer, onLine?: (line: string) => void): void {
    const text = chunk.toString("utf8");
    void this.ensureStream().then((s) => s.write(text));

    const combined = this.lineRemainder + text;
    const parts = combined.split("\n");
    this.lineRemainder = parts.pop() ?? "";

    for (const line of parts) {
      this.pushLine(line);
      onLine?.(line);
    }
  }

  private pushLine(line: string): void {
    this.lines.push(line);
    if (this.lines.length > ROLLING_LINES_CAP) {
      this.lines.shift();
    }
  }

  tail(count: number = ROLLING_LINES_CAP): string[] {
    const res = [...this.lines];
    if (this.lineRemainder.length > 0) {
      res.push(this.lineRemainder);
    }
    return res.slice(-count);
  }

  async close(): Promise<void> {
    if (this.lineRemainder.length > 0) {
      this.pushLine(this.lineRemainder);
      this.lineRemainder = "";
    }
    if (this.stream !== null) {
      await new Promise<void>((resolve) => {
        this.stream!.end(() => resolve());
      });
      this.stream = null;
    }
  }
}

/**
 * Read the tail of a log file directly from disk (fallback/utility).
 */
export async function readTailFromFile(filePath: string, maxLines: number = 200): Promise<string[]> {
  try {
    const content = await readFile(filePath, "utf8");
    const lines = content.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}
