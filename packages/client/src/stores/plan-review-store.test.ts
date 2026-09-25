import { describe, it, expect, beforeEach, vi } from "vitest";
import { usePlanReviewStore } from "./plan-review-store";
import * as apiClient from "../lib/api-client";

describe("plan-review-store & state differentiation", () => {
  beforeEach(() => {
    usePlanReviewStore.setState({
      isOpen: false,
      activeReview: null,
      viewMode: "preview",
      editedContent: "",
      submitting: false,
      error: null,
      planModeActive: false,
    });
    vi.restoreAllMocks();
  });

  it("identifies drafting mode when planModeActive is true and no requestId", () => {
    usePlanReviewStore.setState({
      isOpen: true,
      activeReview: {
        sessionId: "sess-1",
        planFilePath: "PLAN.md",
        planContent: "# Plan Draft",
      },
      planModeActive: true,
    });

    const s = usePlanReviewStore.getState();
    const isPendingReview = Boolean(s.activeReview?.requestId);
    const isDrafting = s.planModeActive && !isPendingReview;
    const isApproved = !s.planModeActive && !isPendingReview;

    expect(isPendingReview).toBe(false);
    expect(isDrafting).toBe(true);
    expect(isApproved).toBe(false);
  });

  it("identifies formal pending review when requestId exists", () => {
    usePlanReviewStore.setState({
      isOpen: true,
      activeReview: {
        requestId: "req-123",
        sessionId: "sess-1",
        planFilePath: "PLAN.md",
        planContent: "# Plan Ready",
      },
      planModeActive: true,
    });

    const s = usePlanReviewStore.getState();
    const isPendingReview = Boolean(s.activeReview?.requestId);
    const isDrafting = s.planModeActive && !isPendingReview;
    const isApproved = !s.planModeActive && !isPendingReview;

    expect(isPendingReview).toBe(true);
    expect(isDrafting).toBe(false);
    expect(isApproved).toBe(false);
  });

  it("identifies approved state only when planModeActive is false and no requestId", () => {
    usePlanReviewStore.setState({
      isOpen: true,
      activeReview: {
        sessionId: "sess-1",
        planFilePath: "PLAN.md",
        planContent: "# Approved Plan",
      },
      planModeActive: false,
    });

    const s = usePlanReviewStore.getState();
    const isPendingReview = Boolean(s.activeReview?.requestId);
    const isDrafting = s.planModeActive && !isPendingReview;
    const isApproved = !s.planModeActive && !isPendingReview;

    expect(isPendingReview).toBe(false);
    expect(isDrafting).toBe(false);
    expect(isApproved).toBe(true);
  });

  it("sets review state properly via openReview", () => {
    usePlanReviewStore.getState().openReview({
      requestId: "req-abc",
      sessionId: "sess-xyz",
      planFilePath: "PLAN.md",
      planContent: "# Content",
    });

    const state = usePlanReviewStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.activeReview?.requestId).toBe("req-abc");
    expect(state.editedContent).toBe("# Content");
    expect(state.viewMode).toBe("preview");
  });

  it("clears stale requestId when fetchPlanModeStatus finds no pending reviews", async () => {
    usePlanReviewStore.setState({
      activeReview: {
        requestId: "old-req",
        sessionId: "sess-1",
        planFilePath: "PLAN.md",
        planContent: "# Content",
      },
    });

    vi.spyOn(apiClient, "getPlanModeStatus").mockResolvedValue({
      planModeActive: false,
      phase: "idle",
    });
    vi.spyOn(apiClient, "getPendingPlanReviews").mockResolvedValue([]);

    await usePlanReviewStore.getState().fetchPlanModeStatus("sess-1");

    const state = usePlanReviewStore.getState();
    expect(state.planModeActive).toBe(false);
    expect(state.activeReview?.requestId).toBeUndefined();
  });
});
