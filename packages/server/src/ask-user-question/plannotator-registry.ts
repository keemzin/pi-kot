import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";

export interface PendingPlanReview {
  requestId: string;
  sessionId: string;
  planFilePath: string;
  planContent: string;
  cwd: string;
  createdAt: Date;
}

export interface PlanReviewDecision {
  approved: boolean;
  feedback?: string;
  updatedContent?: string;
}

export interface PlanReviewToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

export type PlanReviewEvent =
  | {
      type: "plannotator_plan_review_requested";
      sessionId: string;
      requestId: string;
      planFilePath: string;
      planContent: string;
    }
  | {
      type: "plannotator_plan_review_resolved";
      sessionId: string;
      requestId: string;
      approved: boolean;
      reason: "answered" | "cancelled" | "aborted" | "superseded";
    };

interface Entry extends PendingPlanReview {
  resolve: (result: PlanReviewToolResult) => void;
}

const byRequestId = new Map<string, Entry>();
const bySessionId = new Map<string, string>();

type Listener = (event: PlanReviewEvent) => void;
const listeners = new Set<Listener>();

export function subscribePlanReview(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(event: PlanReviewEvent): void {
  for (const fn of listeners) {
    try {
      fn(event);
    } catch {
      // best-effort
    }
  }
}

export function registerPendingPlanReview(args: {
  sessionId: string;
  planFilePath: string;
  planContent: string;
  cwd: string;
  signal?: AbortSignal;
}): { requestId: string; result: Promise<PlanReviewToolResult> } {
  const requestId = randomUUID();

  // If there is already a pending review for this session, supersede it
  const existingId = bySessionId.get(args.sessionId);
  if (existingId !== undefined) {
    const existing = byRequestId.get(existingId);
    if (existing !== undefined) {
      byRequestId.delete(existingId);
      bySessionId.delete(args.sessionId);
      existing.resolve({
        content: [{ type: "text", text: "Replaced by a new plan review submission." }],
        details: { approved: false, cancelled: true, error: "superseded" },
      });
      notify({
        type: "plannotator_plan_review_resolved",
        sessionId: args.sessionId,
        requestId: existingId,
        approved: false,
        reason: "superseded",
      });
    }
  }

  let resolveFn!: (r: PlanReviewToolResult) => void;
  const result = new Promise<PlanReviewToolResult>((resolve) => {
    resolveFn = resolve;
  });

  const entry: Entry = {
    requestId,
    sessionId: args.sessionId,
    planFilePath: args.planFilePath,
    planContent: args.planContent,
    cwd: args.cwd,
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
          type: "plannotator_plan_review_resolved",
          sessionId: args.sessionId,
          requestId,
          approved: false,
          reason: "aborted",
        });
        resolveFn({
          content: [{ type: "text", text: "The plan review was cancelled or the agent was aborted." }],
          details: { approved: false, cancelled: true, error: "aborted" },
        });
      }
    };
    if (args.signal.aborted) onAbort();
    else args.signal.addEventListener("abort", onAbort, { once: true });
  }

  notify({
    type: "plannotator_plan_review_requested",
    sessionId: args.sessionId,
    requestId,
    planFilePath: args.planFilePath,
    planContent: args.planContent,
  });

  return { requestId, result };
}

function removeEntry(requestId: string): void {
  const e = byRequestId.get(requestId);
  if (e === undefined) return;
  byRequestId.delete(requestId);
  bySessionId.delete(e.sessionId);
}

export async function resolvePendingPlanReview(
  requestId: string,
  expectedSessionId: string,
  decision: PlanReviewDecision,
): Promise<boolean> {
  const e = byRequestId.get(requestId);
  if (e === undefined) return false;
  if (e.sessionId !== expectedSessionId) return false;

  removeEntry(requestId);

  // If the user edited the plan directly before deciding, save changes to disk
  if (typeof decision.updatedContent === "string" && decision.updatedContent.length > 0) {
    try {
      const fullPath = resolve(e.cwd, e.planFilePath);
      await writeFile(fullPath, decision.updatedContent, "utf-8");
    } catch (err) {
      console.error(`Failed to save updated plan to ${e.planFilePath}:`, err);
    }
  }

  notify({
    type: "plannotator_plan_review_resolved",
    sessionId: e.sessionId,
    requestId,
    approved: decision.approved,
    reason: "answered",
  });

  const doneMsg = "After completing each step, include [DONE:n] in your response where n is the step number.";
  const feedback = decision.feedback?.trim();

  if (decision.approved) {
    if (feedback) {
      e.resolve({
        content: [
          {
            type: "text",
            text: `Plan approved with notes! You now have full tool access (read, bash, edit, write). Execute the plan in ${e.planFilePath}. ${doneMsg}\n\n## Implementation Notes\n\nThe user approved your plan but added the following notes to consider during implementation:\n\n${feedback}\n\nProceed with implementation, incorporating these notes where applicable.`,
          },
        ],
        details: { approved: true, feedback },
      });
    } else {
      e.resolve({
        content: [
          {
            type: "text",
            text: `Plan approved. You now have full tool access (read, bash, edit, write). Execute the plan in ${e.planFilePath}. ${doneMsg}`,
          },
        ],
        details: { approved: true },
      });
    }
  } else {
    const feedbackText =
      feedback ||
      "The user requested revisions to this plan. Please review your draft, address any questions, and update the plan file before resubmitting.";
    e.resolve({
      content: [
        {
          type: "text",
          text: `YOUR PLAN WAS NOT APPROVED.\n\nYou MUST revise the plan to address ALL of the feedback below before calling plannotator_submit_plan again.\n\nRules:\n- Your plan is saved at: ${e.planFilePath}\n  You can edit this file to make targeted changes, then pass its path to plannotator_submit_plan.\n- Do not resubmit the same plan unchanged.\n- Do NOT change the plan title (first # heading) unless the user explicitly asks you to.\n\n${feedbackText}`,
        },
      ],
      details: { approved: false, feedback: feedbackText },
    });
  }

  return true;
}

export function getPendingPlanReviewsForSession(sessionId: string): PendingPlanReview[] {
  const id = bySessionId.get(sessionId);
  if (id === undefined) return [];
  const e = byRequestId.get(id);
  if (e === undefined) return [];
  return [
    {
      requestId: e.requestId,
      sessionId: e.sessionId,
      planFilePath: e.planFilePath,
      planContent: e.planContent,
      cwd: e.cwd,
      createdAt: e.createdAt,
    },
  ];
}
