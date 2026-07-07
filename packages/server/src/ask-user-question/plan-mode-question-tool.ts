/**
 * pi-kot's own `plan_mode_question` tool, replacing the one from
 * `@narumitw/pi-plan-mode` which relies on `ctx.ui.select()` /
 * `ctx.ui.editor()` (TUI only). pi-kot runs the SDK without a TUI,
 * so `ctx.hasUI` is false and the extension's tool returns
 * `ui_unavailable`.
 *
 * This tool re-routes Plan-mode questions through pi-kot's existing
 * ask-user-question pipeline (in-memory registry + REST endpoint +
 * SSE bridge), letting the web UI user answer directly.
 *
 * Tool name and parameter schema match the pi-plan-mode extension so
 * it plugs in seamlessly. The system-prompt instructions the extension
 * injects (e.g. "if plan_mode_question returns cancelled...") remain
 * compatible because the text/JSON envelope is identical.
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerPending } from "./registry.js";
import type { QuestionAnswer, Question } from "./types.js";

export const PLAN_MODE_QUESTION_TOOL_NAME = "plan_mode_question";

/** Mirrors `@narumitw/pi-plan-mode`'s PlanModeQuestion type. */
interface PlanModeQuestion {
  id: string;
  header: string;
  question: string;
  options: { label: string; description: string }[];
}

/** Mirrors `@narumitw/pi-plan-mode`'s PlanModeQuestionAnswer type. */
interface PlanModeQuestionAnswer {
  id: string;
  header: string;
  question: string;
  answer: string;
  wasCustom: boolean;
  optionIndex?: number;
}

/** Mirrors `@narumitw/pi-plan-mode`'s PlanModeQuestionReason. */
type PlanModeQuestionReason = "cancelled" | "ui_unavailable" | "plan_mode_inactive" | "invalid_input";

/** Input schema — identical to what the pi-plan-mode extension expects. */
const inputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      description:
        "Questions to show the user. Prefer 1 and do not exceed 3.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "header", "question", "options"],
        properties: {
          id: {
            type: "string",
            description: "Stable identifier for mapping answers (snake_case).",
          },
          header: {
            type: "string",
            description:
              "Short header label shown in the UI (12 or fewer chars).",
          },
          question: {
            type: "string",
            description: "Single-sentence prompt shown to the user.",
          },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            description:
              "Provide 2-4 mutually exclusive choices. Put the recommended option first when there is a clear default.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "description"],
              properties: {
                label: {
                  type: "string",
                  description: "User-facing label (1-5 words).",
                },
                description: {
                  type: "string",
                  description:
                    "One short sentence explaining impact/tradeoff if selected.",
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

/**
 * Normalize and validate `plan_mode_question` params. Mirrors the
 * pi-plan-mode extension's validation logic.
 */
function normalizeInput(
  raw: unknown,
): { ok: true; questions: PlanModeQuestion[] } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Expected an object" };
  }
  const input = raw as Record<string, unknown>;
  const rawQuestions = input.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0 || rawQuestions.length > 3) {
    return { ok: false, error: "questions must contain 1-3 items" };
  }

  const questions: PlanModeQuestion[] = [];
  for (let qi = 0; qi < rawQuestions.length; qi++) {
    const q = rawQuestions[qi];
    if (typeof q !== "object" || q === null) {
      return { ok: false, error: `question ${qi + 1} must be an object` };
    }
    const qq = q as Record<string, unknown>;
    const id = typeof qq.id === "string" && qq.id.trim().length > 0 ? qq.id.trim() : undefined;
    const header =
      typeof qq.header === "string" && qq.header.trim().length > 0 ? qq.header.trim() : undefined;
    const question =
      typeof qq.question === "string" && qq.question.trim().length > 0 ? qq.question.trim() : undefined;
    if (!id || !header || !question) {
      return {
        ok: false,
        error: `question ${qi + 1} requires non-empty id, header, and question`,
      };
    }

    const rawOptions = qq.options;
    if (!Array.isArray(rawOptions) || rawOptions.length < 2 || rawOptions.length > 4) {
      return {
        ok: false,
        error: `question ${qi + 1} options must contain 2-4 items`,
      };
    }

    const options: { label: string; description: string }[] = [];
    for (let oi = 0; oi < rawOptions.length; oi++) {
      const o = rawOptions[oi];
      if (typeof o !== "object" || o === null) {
        return { ok: false, error: `question ${qi + 1} option ${oi + 1} must be an object` };
      }
      const oo = o as Record<string, unknown>;
      const label =
        typeof oo.label === "string" && oo.label.trim().length > 0 ? oo.label.trim() : undefined;
      const description =
        typeof oo.description === "string" && oo.description.trim().length > 0
          ? oo.description.trim()
          : undefined;
      if (!label || !description) {
        return {
          ok: false,
          error: `question ${qi + 1} option ${oi + 1} requires label and description`,
        };
      }
      options.push({ label, description });
    }

    questions.push({ id, header, question, options });
  }

  return { ok: true, questions };
}

/**
 * Map a QuestionAnswer from the ask-user-question pipeline back to a
 * PlanModeQuestionAnswer, using the original PlanModeQuestion to
 * recover `id` and `header`.
 */
function mapAnswer(
  answer: QuestionAnswer,
  original: PlanModeQuestion,
): PlanModeQuestionAnswer {
  const base = {
    id: original.id,
    header: original.header,
    question: original.question,
  };

  switch (answer.kind) {
    case "option":
      return {
        ...base,
        answer: answer.answer ?? original.options[0]?.label ?? "",
        wasCustom: false,
        optionIndex: original.options.findIndex((o) => o.label === answer.answer) + 1,
      };
    case "custom":
      return {
        ...base,
        answer: answer.answer ?? "",
        wasCustom: true,
      };
    case "multi":
      return {
        ...base,
        answer: answer.selected?.join(", ") ?? "",
        wasCustom: false,
      };
    case "chat":
      return {
        ...base,
        answer: answer.notes ?? "(user chose to discuss this)",
        wasCustom: true,
      };
  }
}

/** Build the JSON payload string the LLM sees in content text. */
function formatPayload(payload: Record<string, unknown>): string {
  return JSON.stringify(payload, null, 2);
}

/**
 * Create the `plan_mode_question` tool for a given session.
 * Registers with the same tool name the pi-plan-mode extension uses,
 * so the SDK's tool registry favours this one (customTools are loaded
 * after extension tools).
 */
export function createPlanModeQuestionTool(
  sessionId: string,
): ToolDefinition {
  return {
    name: PLAN_MODE_QUESTION_TOOL_NAME,
    label: "Plan question",
    description:
      "Ask the user one to three Plan-mode clarification questions with meaningful options, then wait for the answer. Only available while Plan mode is active.",
    promptSnippet:
      "Ask user decision questions while Plan mode is active",
    promptGuidelines: [
      "In Plan mode, use plan_mode_question for important preferences, tradeoffs, or assumptions that cannot be discovered from read-only exploration.",
    ],
    parameters: inputSchema,
    async execute(
      _toolCallId: string,
      params: unknown,
      signal: AbortSignal | undefined,
    ) {
      const parsed = normalizeInput(params);
      if (!parsed.ok) {
        return {
          content: [
            {
              type: "text" as const,
              text: formatPayload({
                cancelled: true,
                reason: "invalid_input",
                message: `Error: ${parsed.error}`,
              }),
            },
          ],
          details: {
            cancelled: true,
            reason: "invalid_input" as PlanModeQuestionReason,
            questions: [],
          },
        };
      }

      // Map plan_mode_question Question format → ask_user_question Question format
      const registryQuestions: Question[] = parsed.questions.map((q) => ({
        question: q.question,
        header: q.header,
        options: q.options,
      }));

      try {
        const { result } = registerPending({
          sessionId,
          questions: registryQuestions,
          signal,
        });
        const registryResult = await result;
        const details = registryResult.details;

        if (details.cancelled) {
          return {
            content: [
              {
                type: "text" as const,
                text: formatPayload({
                  cancelled: true,
                  reason: "cancelled",
                  message: "User cancelled the Plan-mode question prompt.",
                }),
              },
            ],
            details: {
              cancelled: true,
              reason: "cancelled" as PlanModeQuestionReason,
              questions: parsed.questions,
            },
          };
        }

        // Map answers back to plan_mode_question format
        const planAnswers: PlanModeQuestionAnswer[] = details.answers.map(
          (a, i) => {
            const original = parsed.questions[i];
            return mapAnswer(a, original);
          },
        );

        return {
          content: [
            {
              type: "text" as const,
              text: formatPayload({
                cancelled: false,
                answers: planAnswers,
              }),
            },
          ],
          details: {
            cancelled: false,
            questions: parsed.questions,
            answers: planAnswers,
          },
        };
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: formatPayload({
                cancelled: true,
                reason: "ui_unavailable",
                message:
                  "Unable to ask Plan-mode questions because the question pipeline is not available.",
              }),
            },
          ],
          details: {
            cancelled: true,
            reason: "ui_unavailable" as PlanModeQuestionReason,
            questions: parsed.questions,
          },
        };
      }
    },
  } as unknown as ToolDefinition;
}
