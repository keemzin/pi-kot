import { randomUUID } from "node:crypto";
import type { AskUserQuestionResult, Question } from "./types.js";

/**
 * In-memory registry of pending ask_user_question requests.
 * One pending per session (SDK serialises tool calls per session).
 * The tool factory registers a pending entry, the answer route
 * resolves it, and the SSE bridge re-emits on reconnect.
 */

export interface PendingAskUserQuestion {
  requestId: string;
  sessionId: string;
  questions: Question[];
  createdAt: Date;
}

interface Entry extends PendingAskUserQuestion {
  resolve: (result: AskUserQuestionResult) => void;
}

const byRequestId = new Map<string, Entry>();
const bySessionId = new Map<string, string>();

export type AskQuestionEvent =
  | { type: "ask_user_question"; sessionId: string; requestId: string; questions: Question[] }
  | { type: "ask_user_question_cancelled"; sessionId: string; requestId: string; reason: string };

type Listener = (event: AskQuestionEvent) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(event: AskQuestionEvent): void {
  for (const fn of listeners) {
    try { fn(event); } catch { /* best-effort */ }
  }
}

export function registerPending(args: {
  sessionId: string;
  questions: Question[];
  signal?: AbortSignal;
}): { requestId: string; result: Promise<AskUserQuestionResult> } {
  const requestId = randomUUID();

  // If there's already a pending entry for this session, resolve it
  // as cancelled first (shouldn't happen with serialised tools, but
  // be safe).
  const existingId = bySessionId.get(args.sessionId);
  if (existingId !== undefined) {
    const existing = byRequestId.get(existingId);
    if (existing !== undefined) {
      byRequestId.delete(existingId);
      bySessionId.delete(args.sessionId);
      existing.resolve({
        content: [{ type: "text", text: "Replaced by a new question." }],
        details: { answers: [], cancelled: true, error: "superseded" },
      });
      notify({
        type: "ask_user_question_cancelled",
        sessionId: args.sessionId,
        requestId: existingId,
        reason: "superseded",
      });
    }
  }

  let resolveFn!: (r: AskUserQuestionResult) => void;
  const result = new Promise<AskUserQuestionResult>((resolve) => {
    resolveFn = resolve;
  });

  const entry: Entry = {
    requestId,
    sessionId: args.sessionId,
    questions: args.questions,
    createdAt: new Date(),
    resolve: resolveFn,
  };

  byRequestId.set(requestId, entry);
  bySessionId.set(args.sessionId, requestId);

  if (args.signal !== undefined) {
    const onAbort = (): void => {
      if (byRequestId.has(requestId)) {
        removeEntry(requestId);
        notify({
          type: "ask_user_question_cancelled",
          sessionId: args.sessionId,
          requestId,
          reason: "aborted",
        });
        resolveFn({
          content: [{ type: "text", text: "The agent was aborted." }],
          details: { answers: [], cancelled: true, error: "aborted" },
        });
      }
    };
    if (args.signal.aborted) onAbort();
    else args.signal.addEventListener("abort", onAbort, { once: true });
  }

  notify({
    type: "ask_user_question",
    sessionId: args.sessionId,
    requestId,
    questions: args.questions,
  });

  return { requestId, result };
}

function removeEntry(requestId: string): void {
  const e = byRequestId.get(requestId);
  if (e === undefined) return;
  byRequestId.delete(requestId);
  bySessionId.delete(e.sessionId);
}

export function answerPending(
  requestId: string,
  expectedSessionId: string,
  result: AskUserQuestionResult,
): boolean {
  const e = byRequestId.get(requestId);
  if (e === undefined) return false;
  if (e.sessionId !== expectedSessionId) return false;
  removeEntry(requestId);
  notify({
    type: "ask_user_question_cancelled",
    sessionId: e.sessionId,
    requestId,
    reason: "answered",
  });
  e.resolve(result);
  return true;
}

export function getPendingForSession(sessionId: string): PendingAskUserQuestion[] {
  const id = bySessionId.get(sessionId);
  if (id === undefined) return [];
  const e = byRequestId.get(id);
  if (e === undefined) return [];
  return [{
    requestId: e.requestId,
    sessionId: e.sessionId,
    questions: e.questions,
    createdAt: e.createdAt,
  }];
}

export function _resetForTests(): void {
  byRequestId.clear();
  bySessionId.clear();
  listeners.clear();
}
