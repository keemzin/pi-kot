import { create } from "zustand";
import { submitPlanReviewDecision, filesRead, filesWrite } from "../lib/api-client";
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
      const [res, pendingRes] = await Promise.all([
        fetch(`/api/v1/sessions/${encodeURIComponent(sid)}/plan-mode`),
        fetch(`/api/v1/sessions/${encodeURIComponent(sid)}/plan-review/pending`),
      ]);
      if (res.ok) {
        const data = (await res.json()) as { planModeActive?: boolean };
        if (typeof data.planModeActive === "boolean") {
          set({ planModeActive: data.planModeActive });
        }
      }
      if (pendingRes.ok) {
        const pData = (await pendingRes.json()) as {
          pending?: Array<{
            requestId: string;
            planFilePath: string;
            planContent: string;
          }>;
        };
        if (Array.isArray(pData.pending) && pData.pending.length > 0) {
          const first = pData.pending[0];
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
          if (current && current.sessionId !== sid) {
            set({ activeReview: null, isOpen: false, editedContent: "" });
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
    const { activeReview } = get();
    // If an active review already exists for this file, just ensure panel is open
    if (activeReview && activeReview.planFilePath === filePath) {
      set({ isOpen: true, viewMode: "preview" });
      return;
    }

    const sid = sessionId ?? useSessionStore.getState().activeSessionId;
    const projectId = useSessionStore.getState().activeProjectId ?? "default";

    try {
      const res = await filesRead(projectId, filePath);
      set({
        activeReview: {
          sessionId: sid ?? "",
          planFilePath: filePath,
          planContent: res.content,
        },
        editedContent: res.content,
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
      const { invokeExtensionCommand } = await import("../lib/api-client");
      await invokeExtensionCommand(sid, "plannotator-plan-mode").catch(() => {});
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

        // Transition Plannotator out of plan mode on approval
        if (approved && sid) {
          const { invokeExtensionCommand } = await import("../lib/api-client");
          await invokeExtensionCommand(sid, "plannotator-plan-mode").catch(() => {});
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
            const { invokeExtensionCommand } = await import("../lib/api-client");
            await invokeExtensionCommand(sid, "plannotator-plan-mode").catch(() => {});
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
