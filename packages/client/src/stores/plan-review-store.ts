import { create } from "zustand";
import { submitPlanReviewDecision, filesRead, filesWrite, getPendingPlanReviews, getPlanModeStatus } from "../lib/api-client";
import { useSessionStore } from "./session-store";

export interface ActivePlanReview {
  requestId?: string;
  sessionId: string;
  planFilePath: string;
  planContent: string;
}

interface PlanReviewState {
  isOpen: boolean;
  activeReview: ActivePlanReview | null;
  viewMode: "preview" | "edit";
  editedContent: string;
  submitting: boolean;
  error: string | null;
  planModeActive: boolean;

  openReview: (review: ActivePlanReview) => void;
  openFileReview: (filePath?: string, sessionId?: string) => Promise<void>;
  closeReview: () => void;
  setViewMode: (mode: "preview" | "edit") => void;
  setEditedContent: (content: string) => void;
  setPlanModeActive: (active: boolean) => void;
  resolveReview: (requestId: string) => void;
  savePlanContent: () => Promise<void>;
  exitPlanMode: () => Promise<void>;
  fetchPlanModeStatus: (sessionId?: string) => Promise<void>;

  submitDecision: (decision: {
    approved: boolean;
    feedback?: string;
  }) => Promise<void>;
}

export const usePlanReviewStore = create<PlanReviewState>((set, get) => ({
  isOpen: false,
  activeReview: null,
  viewMode: "preview",
  editedContent: "",
  submitting: false,
  error: null,
  planModeActive: false,

  fetchPlanModeStatus: async (sessionId?: string) => {
    const sid = sessionId ?? useSessionStore.getState().activeSessionId;
    if (!sid) return;
    try {
      const [modeRes, pendingRes] = await Promise.all([
        getPlanModeStatus(sid).catch(() => null),
        getPendingPlanReviews(sid).catch(() => null),
      ]);
      if (modeRes && typeof modeRes.planModeActive === "boolean") {
        set({ planModeActive: modeRes.planModeActive });
      }
      if (Array.isArray(pendingRes)) {
        if (pendingRes.length > 0) {
          const first = pendingRes[0];
          set({
            activeReview: {
              requestId: first.requestId,
              sessionId: sid,
              planFilePath: first.planFilePath,
              planContent: first.planContent,
            },
            editedContent: first.planContent,
            isOpen: true,
            planModeActive: true,
          });
        } else {
          const current = get().activeReview;
          if (current) {
            if (current.sessionId !== sid) {
              set({ activeReview: null, isOpen: false, editedContent: "" });
            } else if (current.requestId) {
              // The pending review request was resolved/completed. Clear requestId so it's not treated as pending.
              set({
                activeReview: {
                  ...current,
                  requestId: undefined,
                },
              });
            }
          }
        }
      }
    } catch {
      // Best effort
    }
  },

  openReview: (review) => {
    set({
      activeReview: review,
      editedContent: review.planContent,
      isOpen: true,
      error: null,
      viewMode: "preview",
    });
  },

  openFileReview: async (filePath = "PLAN.md", sessionId?: string) => {
    const sid = sessionId ?? useSessionStore.getState().activeSessionId;
    const projectId = useSessionStore.getState().activeProjectId ?? "default";
    const current = get().activeReview;

    let pendingRequestId: string | undefined = undefined;
    let pendingContent: string | undefined;

    if (sid) {
      try {
        const [pendingRes, modeRes] = await Promise.all([
          getPendingPlanReviews(sid).catch(() => []),
          getPlanModeStatus(sid).catch(() => null),
        ]);

        if (modeRes && typeof modeRes.planModeActive === "boolean") {
          set({ planModeActive: modeRes.planModeActive });
        }

        if (Array.isArray(pendingRes) && pendingRes.length > 0) {
          const match = pendingRes.find((p) => {
            if (p.planFilePath === filePath) return true;
            const pNorm = p.planFilePath.replace(/\\/g, "/");
            const fNorm = filePath.replace(/\\/g, "/");
            return pNorm.endsWith(`/${fNorm}`) || fNorm.endsWith(`/${pNorm}`) || pNorm === fNorm;
          }) ?? (pendingRes.length === 1 ? pendingRes[0] : undefined);

          if (match) {
            pendingRequestId = match.requestId;
            pendingContent = match.planContent;
          }
        }
      } catch {
        // Best effort
      }
    }

    try {
      let content = pendingContent;
      if (!content) {
        const res = await filesRead(projectId, filePath);
        content = res.content;
      }

      const hasUserEdited = current && current.planContent.trim() !== get().editedContent.trim();
      const updatedEditedContent = hasUserEdited ? get().editedContent : content;

      set({
        activeReview: {
          requestId: pendingRequestId,
          sessionId: sid ?? "",
          planFilePath: filePath,
          planContent: content,
        },
        editedContent: updatedEditedContent,
        isOpen: true,
        viewMode: "preview",
        error: null,
      });
    } catch (err) {
      set({
        isOpen: true,
        error: `Could not load ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  },

  closeReview: () => {
    set({ isOpen: false, error: null });
  },

  setViewMode: (viewMode) => set({ viewMode }),

  setEditedContent: (editedContent) => set({ editedContent }),

  setPlanModeActive: (planModeActive) => set({ planModeActive }),

  resolveReview: (requestId) => {
    const { activeReview } = get();
    if (activeReview && activeReview.requestId === requestId) {
      set({ activeReview: null, isOpen: false, error: null, editedContent: "" });
    }
  },

  savePlanContent: async () => {
    const { activeReview, editedContent } = get();
    if (!activeReview) return;
    const projectId = useSessionStore.getState().activeProjectId ?? "default";
    await filesWrite(projectId, activeReview.planFilePath, editedContent);
    set({
      activeReview: {
        ...activeReview,
        planContent: editedContent,
      },
    });
  },

  exitPlanMode: async () => {
    const sid = useSessionStore.getState().activeSessionId;
    if (sid) {
      const { setPlanMode } = await import("../lib/api-client");
      await setPlanMode(sid, false).catch(() => {});
    }
    set({ planModeActive: false });
  },

  submitDecision: async ({ approved, feedback }) => {
    const { activeReview, editedContent, submitting } = get();
    if (!activeReview || submitting) return;

    set({ submitting: true, error: null });

    try {
      const hasContentChanged = editedContent.trim() !== activeReview.planContent.trim();
      const sid = activeReview.sessionId || useSessionStore.getState().activeSessionId;
      const projectId = useSessionStore.getState().activeProjectId ?? "default";

      // If edits were made and there's no pending tool call (or to ensure disk is updated immediately)
      if (hasContentChanged) {
        await filesWrite(projectId, activeReview.planFilePath, editedContent).catch(() => {});
      }

      if (activeReview.requestId) {
        // Formal review tool call from agent
        await submitPlanReviewDecision(
          activeReview.sessionId,
          activeReview.requestId,
          {
            approved,
            feedback,
            updatedContent: hasContentChanged ? editedContent : undefined,
          },
        );

        // Transition out of plan mode on approval
        if (approved && sid) {
          const { setPlanMode } = await import("../lib/api-client");
          await setPlanMode(sid, false).catch(() => {});
          set({ planModeActive: false });
        }
      } else if (sid) {
        // Manual review: send chat steer / prompt to the agent
        if (approved) {
          const notes = feedback ? `\n\nImplementation Notes:\n${feedback}` : "";
          await useSessionStore.getState().sendPrompt(
            `Plan approved!${notes}\nPlease proceed with executing the implementation steps in ${activeReview.planFilePath}.`,
          );
          if (get().planModeActive) {
            const { setPlanMode } = await import("../lib/api-client");
            await setPlanMode(sid, false).catch(() => {});
            set({ planModeActive: false });
          }
        } else {
          await useSessionStore.getState().sendPrompt(
            `Please revise ${activeReview.planFilePath} based on the following feedback:\n${feedback || "Please address the review comments."}`,
          );
        }
      }

      set({
        submitting: false,
        isOpen: false,
        activeReview: null,
        editedContent: "",
      });
    } catch (err) {
      set({
        submitting: false,
        error: err instanceof Error ? err.message : "Failed to submit plan decision",
      });
      throw err;
    }
  },
}));
