import type { FastifyPluginAsync } from "fastify";
import { getSession } from "../session-store.js";
import { getPendingPlanReviewsForSession, resolvePendingPlanReview, type PlanReviewDecision } from "../ask-user-question/plannotator-registry.js";
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

      // If approved, clear the in-memory plan status and notify Plannotator
      if (req.body.approved) {
        setSessionStatus(req.params.id, "plannotator", undefined);
        try {
          const session = live.session as unknown as { events?: { emit?: (event: string, data: unknown) => void } };
          if (session.events && typeof session.events.emit === "function") {
            session.events.emit("plannotator:request", {
              action: "plan-mode",
              payload: { mode: "exit" },
              respond: () => {},
            });
          }
        } catch (err) {
          req.log.warn({ err }, "Could not notify plannotator of exit on approval");
        }
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
};
