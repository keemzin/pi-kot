import type { LogWatch, LogWatchMatchEvent, LogWatchStream } from "./types.js";

export interface CompiledWatch {
  index: number;
  pattern: string;
  regex: RegExp;
  stream: LogWatchStream;
  repeat: boolean;
  fired: boolean;
}

export function compileWatches(watches?: LogWatch[]): CompiledWatch[] {
  if (!watches || !Array.isArray(watches)) return [];
  const compiled: CompiledWatch[] = [];

  for (let i = 0; i < watches.length; i++) {
    const w = watches[i];
    if (!w || typeof w.pattern !== "string" || w.pattern.trim() === "") continue;
    try {
      const regex = new RegExp(w.pattern);
      compiled.push({
        index: i,
        pattern: w.pattern,
        regex,
        stream: w.stream ?? "both",
        repeat: w.repeat === true,
        fired: false,
      });
    } catch {
      // Ignore invalid regex
    }
  }

  return compiled;
}

export function evaluateWatches(
  watches: CompiledWatch[],
  stream: "stdout" | "stderr",
  line: string,
): CompiledWatch[] {
  const matched: CompiledWatch[] = [];
  for (const w of watches) {
    if (w.fired && !w.repeat) continue;
    if (w.stream !== "both" && w.stream !== stream) continue;

    if (w.regex.test(line)) {
      w.fired = true;
      matched.push(w);
    }
  }
  return matched;
}

export function buildMatchEvent(
  watch: CompiledWatch,
  processId: string,
  processName: string,
  processCommand: string,
  source: "stdout" | "stderr",
  line: string,
): LogWatchMatchEvent {
  return {
    processId,
    processName,
    processCommand,
    source,
    line,
    watch: {
      index: watch.index,
      pattern: watch.pattern,
      stream: watch.stream,
      repeat: watch.repeat,
    },
  };
}
