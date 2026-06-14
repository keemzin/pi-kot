import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerPending } from "./registry.js";
import { validateQuestionnaire } from "./validate.js";
import { buildResult } from "./envelope.js";
import { PROMPT_GUIDELINES, PROMPT_SNIPPET, TOOL_DESCRIPTION } from "./prompt-strings.js";
import { MAX_HEADER_LENGTH, MAX_LABEL_LENGTH, MAX_OPTIONS, MAX_QUESTIONS, MIN_OPTIONS } from "./types.js";

export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";

const inputSchema = {
  type: "object",
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      maxItems: MAX_QUESTIONS,
      items: {
        type: "object",
        required: ["question", "header", "options"],
        properties: {
          question: { type: "string", minLength: 1 },
          header: { type: "string", minLength: 1, maxLength: MAX_HEADER_LENGTH },
          multiSelect: { type: "boolean" },
          options: {
            type: "array",
            minItems: MIN_OPTIONS,
            maxItems: MAX_OPTIONS,
            items: {
              type: "object",
              required: ["label", "description"],
              properties: {
                label: { type: "string", minLength: 1, maxLength: MAX_LABEL_LENGTH },
                description: { type: "string", minLength: 1 },
                preview: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

export function createAskUserQuestionTool(sessionId: string): ToolDefinition {
  return {
    name: ASK_USER_QUESTION_TOOL_NAME,
    label: "Ask User Question",
    description: TOOL_DESCRIPTION,
    promptSnippet: PROMPT_SNIPPET,
    promptGuidelines: [PROMPT_GUIDELINES],
    parameters: inputSchema,
    async execute(_toolCallId: string, params: unknown, signal: AbortSignal | undefined) {
      const validation = validateQuestionnaire(params);
      if (!validation.ok) {
        return buildResult([], { cancelled: true, questionCount: 0 });
      }
      try {
        const { result } = registerPending({
          sessionId,
          questions: validation.params.questions,
          signal,
        });
        return await result;
      } catch {
        return buildResult([], { cancelled: true, questionCount: 0 });
      }
    },
  } as unknown as ToolDefinition;
}
