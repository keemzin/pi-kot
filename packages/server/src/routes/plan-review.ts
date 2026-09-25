import type { FastifyPluginAsync } from "fastify";
import { getSession } from "../session-store.js";
import { getPendingPlanReviewsForSession, resolvePendingPlanReview, type PlanReviewDecision } from "../ask-user-question/plan-review-registry.js";
import { isSessionInPlanMode } from "../event-stream.js";
import { setSessionStatus } from "../extension-ui-bridge.js";

const decisionBodySchema = {
  type: "object",
  required: ["approved"],
  additionalProperties: false,
  properties: {
    approved: { type: "boolean" },
    feedback: { type: "string" },
    updatedContent: { type: "string" },
  },
} as const;

export const planReviewRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id/plan-review/pending",
    {
      schema: {
        description: "List pending plan reviews for this session",
        tags: ["plan-review"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["pending"],
            properties: {
              pending: {
                type: "array",
                items: {
                  type: "object",
                  required: ["requestId", "planFilePath", "planContent"],
                  properties: {
                    requestId: { type: "string" },
                    planFilePath: { type: "string" },
                    planContent: { type: "string" },
                  },
                },
              },
            },
          },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const live = getSession(req.params.id);
      if (live === undefined) {
        return reply.code(404).send({ error: "session_not_found" });
      }
      const pending = getPendingPlanReviewsForSession(req.params.id).map((p) => ({
        requestId: p.requestId,
        planFilePath: p.planFilePath,
        planContent: p.planContent,
      }));
      return { pending };
    },
  );

  fastify.post<{ Params: { id: string; requestId: string }; Body: PlanReviewDecision }>(
    "/sessions/:id/plan-review/:requestId/decision",
    {
      schema: {
        description: "Submit approval or change request for a pending plan review",
        tags: ["plan-review"],
        params: {
          type: "object",
          required: ["id", "requestId"],
          properties: {
            id: { type: "string" },
            requestId: { type: "string" },
          },
        },
        body: decisionBodySchema,
        response: {
          204: { type: "null" },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const live = getSession(req.params.id);
      if (live === undefined) {
        return reply.code(404).send({ error: "session_not_found" });
      }

      const ok = await resolvePendingPlanReview(
        req.params.requestId,
        req.params.id,
        req.body,
      );

      if (!ok) {
        return reply.code(404).send({ error: "plan_review_not_found" });
      }

      // If approved, clear the plan status and update session state
      if (req.body.approved) {
        live.planModeActive = false;
        try {
          live.sessionManager.appendCustomEntry?.("plan-mode", { active: false, phase: "idle" });
        } catch {
          // best-effort
        }
        setSessionStatus(req.params.id, "plan-mode", undefined);
      }

      return reply.code(204).send();
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id/plan-mode",
    async (req, reply) => {
      const live = getSession(req.params.id);
      if (live === undefined) {
        return reply.code(404).send({ error: "session_not_found" });
      }

      const planModeActive = isSessionInPlanMode(live);
      const phase = planModeActive ? "planning" : "idle";

      return { phase, planModeActive };
    },
  );

  fastify.post<{
    Params: { id: string };
    Body: { active?: boolean };
  }>(
    "/sessions/:id/plan-mode",
    {
      schema: {
        description: "Toggle or explicitly set Plan Mode on or off for this session",
        tags: ["plan-review"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          properties: {
            active: { type: "boolean" },
          },
        },
      },
    },
    async (req, reply) => {
      const live = getSession(req.params.id);
      if (live === undefined) {
        return reply.code(404).send({ error: "session_not_found" });
      }

      const currentActive = isSessionInPlanMode(live);
      const nextActive = typeof req.body?.active === "boolean" ? req.body.active : !currentActive;
      const phase = nextActive ? "planning" : "idle";

      live.planModeActive = nextActive;
      try {
        live.sessionManager.appendCustomEntry?.("plan-mode", { active: nextActive, phase });
      } catch {
        // best-effort
      }

      setSessionStatus(req.params.id, "plan-mode", nextActive ? "📋 Plan Mode" : undefined);

      return { ok: true, planModeActive: nextActive, phase };
    },
  );
};
