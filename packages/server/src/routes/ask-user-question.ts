import type { FastifyPluginAsync } from "fastify";
import { getSession } from "../session-store.js";
import { answerPending, getPendingForSession } from "../ask-user-question/registry.js";
import { buildResult } from "../ask-user-question/envelope.js";
import type { QuestionAnswer } from "../ask-user-question/types.js";

const answerBodySchema = {
  type: "object",
  required: ["requestId"],
  additionalProperties: false,
  properties: {
    requestId: { type: "string", minLength: 1 },
    cancelled: { type: "boolean" },
    answers: {
      type: "array",
      items: {
        type: "object",
        required: ["questionIndex", "question", "kind"],
        properties: {
          questionIndex: { type: "integer", minimum: 0 },
          question: { type: "string" },
          kind: { type: "string", enum: ["option", "custom", "chat", "multi"] },
          answer: { type: ["string", "null"] },
          selected: { type: "array", items: { type: "string" } },
          notes: { type: "string" },
          preview: { type: "string" },
        },
      },
    },
  },
} as const;

interface AnswerBody {
  requestId: string;
  cancelled?: boolean;
  answers?: QuestionAnswer[];
}

export const askUserQuestionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { id: string } }>(
    "/sessions/:id/ask-user-question/pending",
    {
      schema: {
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
                  required: ["requestId", "questions"],
                  properties: {
                    requestId: { type: "string" },
                    questions: { type: "array" },
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
      const pending = getPendingForSession(req.params.id).map((p) => ({
        requestId: p.requestId,
        questions: p.questions,
      }));
      return { pending };
    },
  );

  fastify.post<{ Params: { id: string }; Body: AnswerBody }>(
    "/sessions/:id/ask-user-question/answer",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: answerBodySchema,
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
      const cancelled = req.body.cancelled === true;
      const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
      const pending = getPendingForSession(req.params.id).find(
        (p) => p.requestId === req.body.requestId,
      );
      const questionCount = pending?.questions.length ?? answers.length;
      const envelope = buildResult(answers, { cancelled, questionCount });
      const ok = answerPending(req.body.requestId, req.params.id, envelope);
      if (!ok) {
        return reply.code(404).send({ error: "request_not_found" });
      }
      return reply.code(204).send();
    },
  );
};
