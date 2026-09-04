import { describe, it, expect } from "vitest";
import {
  registerPendingPlanReview,
  resolvePendingPlanReview,
  getPendingPlanReviewsForSession,
  subscribePlanReview,
} from "./plannotator-registry.js";
import {
  createPlannotatorSubmitPlanTool,
  PLANNOTATOR_SUBMIT_PLAN_TOOL_NAME,
} from "./plannotator-submit-plan-tool.js";

describe("Plannotator Plan Review Registry & Tool", () => {
  it("should have correct tool name and schema", () => {
    const tool = createPlannotatorSubmitPlanTool("test-session");
    expect(tool.name).toBe("plannotator_submit_plan");
    expect(tool.name).toBe(PLANNOTATOR_SUBMIT_PLAN_TOOL_NAME);
    expect(tool.parameters).toHaveProperty("required", ["filePath"]);
  });

  it("should register pending review, emit event, and resolve on approve", async () => {
    const sessionId = "session-1";
    let eventFired = false;

    const unsubscribe = subscribePlanReview((ev) => {
      if (ev.type === "plannotator_plan_review_requested" && ev.sessionId === sessionId) {
        eventFired = true;
      }
    });

    const { requestId, result } = registerPendingPlanReview({
      sessionId,
      planFilePath: "PLAN.md",
      planContent: "# My Plan\n- [ ] Step 1",
      cwd: "/tmp",
    });

    expect(eventFired).toBe(true);

    const pendingList = getPendingPlanReviewsForSession(sessionId);
    expect(pendingList).toHaveLength(1);
    expect(pendingList[0].requestId).toBe(requestId);
    expect(pendingList[0].planFilePath).toBe("PLAN.md");

    // Resolve as approved
    const resolved = await resolvePendingPlanReview(requestId, sessionId, {
      approved: true,
      feedback: "Looks good!",
    });
    expect(resolved).toBe(true);

    const toolResult = await result;
    expect(toolResult.details.approved).toBe(true);
    expect(toolResult.details.feedback).toBe("Looks good!");
    expect(toolResult.content[0].text).toContain("Plan approved with notes!");

    expect(getPendingPlanReviewsForSession(sessionId)).toHaveLength(0);
    unsubscribe();
  });

  it("should resolve with feedback when denied", async () => {
    const sessionId = "session-2";
    const { requestId, result } = registerPendingPlanReview({
      sessionId,
      planFilePath: "PLAN.md",
      planContent: "# Draft Plan",
      cwd: "/tmp",
    });

    const resolved = await resolvePendingPlanReview(requestId, sessionId, {
      approved: false,
      feedback: "Please add step 2 and error handling.",
    });
    expect(resolved).toBe(true);

    const toolResult = await result;
    expect(toolResult.details.approved).toBe(false);
    expect(toolResult.details.feedback).toBe("Please add step 2 and error handling.");
    expect(toolResult.content[0].text).toContain("YOUR PLAN WAS NOT APPROVED");
  });
});
