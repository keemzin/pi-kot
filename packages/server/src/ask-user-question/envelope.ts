import type { QuestionAnswer, AskUserQuestionResult } from "./types.js";

/**
 * Build the tool result envelope from the user's answers.
 * The text block contains a human-readable summary so the agent
 * can see what happened; `details` carries the structured data.
 */
export function buildResult(
  answers: QuestionAnswer[],
  extras: { cancelled: boolean; questionCount: number },
): AskUserQuestionResult {
  const { cancelled, questionCount } = extras;

  const parts: string[] = [];
  if (cancelled) {
    if (answers.length > 0) {
      parts.push(
        `The user cancelled the questionnaire after answering ${answers.length}/${questionCount} questions.`,
      );
    } else {
      parts.push("The user cancelled the questionnaire. No answers were provided.");
    }
  } else {
    parts.push("The user answered the following questions:");
  }

  for (const a of answers) {
    switch (a.kind) {
      case "option":
        parts.push(`- ${a.question}: ${a.answer}`);
        break;
      case "multi":
        parts.push(`- ${a.question}: selected ${a.selected?.join(", ") ?? "nothing"}`);
        break;
      case "custom":
        parts.push(`- ${a.question}: ${a.answer ?? "(no input)"}`);
        break;
      case "chat":
        parts.push(`- ${a.question}: (user chose to chat about this)`);
        break;
    }
  }

  return {
    content: [{ type: "text", text: parts.join("\n") }],
    details: { answers, cancelled, error: undefined },
  };
}
