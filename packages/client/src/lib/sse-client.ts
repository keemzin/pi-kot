import { clearStoredToken, getStoredToken } from "./api-client";

/**
 * Minimal SSE reader using fetch + ReadableStream so we can send
 * Authorization header (native EventSource doesn't support custom headers).
 *
 * Inspired by a reference template's SSE client.
 */

const MAX_BACKOFF_MS = 30_000;
const TERMINAL_STATUS = new Set([401, 404, 409]);

function backoffDelay(attempt: number): number {
  return Math.min(2 ** attempt * 1000, MAX_BACKOFF_MS);
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface StreamSSEOptions<T> {
  signal?: AbortSignal;
  onEvent: (event: T) => void | Promise<void>;
  onClose?: () => void;
  onReconnect?: (info: { attempt: number; delayMs: number; reason: string }) => void;
  maxReconnects?: number;
}

export interface SSEClient {
  close: () => void;
}

/**
 * Connect to an SSE stream for a session.
 * Returns an SSEClient with a close() method for clean teardown.
 */
export function streamSessionSSE(
  sessionId: string,
  options: StreamSSEOptions<Record<string, unknown>>,
): SSEClient {
  const { signal, onEvent, onClose, onReconnect, maxReconnects = 0 } = options;
  let closed = false;
  let reconnectAttempt = 0;

  const abortController = new AbortController();

  async function connect(): Promise<void> {
    while (!closed && !(signal?.aborted ?? false)) {
      try {
        const url = `/api/v1/sessions/${encodeURIComponent(sessionId)}/stream`;
        const headers: Record<string, string> = {
          Accept: "text/event-stream",
        };
        const token = getStoredToken();
        if (token !== undefined) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const res = await fetch(url, {
          headers,
          signal: abortController.signal,
        });

        if (!res.ok) {
          if (TERMINAL_STATUS.has(res.status)) {
            if (res.status === 401) clearStoredToken();
            throw new Error(`SSE terminated: ${res.status}`);
          }
          throw new Error(`SSE non-ok: ${res.status}`);
        }

        // Reset reconnect count on successful connection
        reconnectAttempt = 0;

        const reader = res.body!
          .pipeThrough(new TextDecoderStream())
          .getReader();

        let buffer = "";

        while (!closed && !(signal?.aborted ?? false)) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += value;
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);

            for (const line of block.split("\n")) {
              if (line.startsWith("data: ")) {
                try {
                  const payload = JSON.parse(line.slice(6));
                  await onEvent(payload);
                } catch {
                  // skip malformed events per forwards-compat
                }
              }
              // Comment lines (: ...) and other non-data lines are ignored
            }
          }
        }
      } catch (err: unknown) {
        if (closed || signal?.aborted) break;

        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith("SSE terminated:")) break;

        reconnectAttempt++;
        if (maxReconnects > 0 && reconnectAttempt > maxReconnects) break;

        const delay = backoffDelay(reconnectAttempt);
        onReconnect?.({
          attempt: reconnectAttempt,
          delayMs: delay,
          reason: msg,
        });

        try {
          await abortableSleep(delay, signal);
        } catch {
          break; // aborted
        }
      }
    }

    onClose?.();
  }

  // Start connecting in the background
  connect().catch(() => {
    // errors are handled internally
  });

  return {
    close: () => {
      closed = true;
      abortController.abort();
    },
  };
}
