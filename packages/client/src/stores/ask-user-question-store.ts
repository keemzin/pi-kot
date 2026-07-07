import { create } from "zustand";
import type { AskQuestion } from "../lib/api-client";

export interface PendingAskQuestion {
  requestId: string;
  sessionId: string;
  questions: AskQuestion[];
}

interface AskUserQuestionState {
  pendingBySession: Record<string, PendingAskQuestion | undefined>;
  setPending: (pending: PendingAskQuestion) => void;
  clearPending: (sessionId: string, requestId?: string) => void;
}

export const useAskUserQuestionStore = create<AskUserQuestionState>((set, get) => ({
  pendingBySession: {},
  setPending: (pending) =>
    set((s) => ({ pendingBySession: { ...s.pendingBySession, [pending.sessionId]: pending } })),
  clearPending: (sessionId, requestId) => {
    const cur = get().pendingBySession[sessionId];
    if (cur === undefined) return;
    if (requestId !== undefined && cur.requestId !== requestId) return;
    set((s) => ({ pendingBySession: { ...s.pendingBySession, [sessionId]: undefined } }));
  },
}));
