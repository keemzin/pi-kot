import {
  RESERVED_LABELS,
  MAX_HEADER_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MIN_OPTIONS,
  type AskUserQuestionParams,
  type ValidationResult,
} from "./types.js";

export function validateQuestionnaire(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "invalid_input", message: "Expected an object" };
  }
  const input = raw as Record<string, unknown>;
  const questions = input.questions;
  if (!Array.isArray(questions)) {
    return { ok: false, error: "no_questions", message: "Missing questions array" };
  }
  if (questions.length < 1) {
    return { ok: false, error: "no_questions", message: "At least one question required" };
  }
  if (questions.length > MAX_QUESTIONS) {
    return { ok: false, error: "too_many_questions", message: `Max ${MAX_QUESTIONS} questions` };
  }

  for (const q of questions) {
    if (typeof q !== "object" || q === null) {
      return { ok: false, error: "invalid_question", message: "Question must be an object" };
    }
    const qq = q as Record<string, unknown>;
    if (typeof qq.question !== "string" || qq.question.length === 0) {
      return { ok: false, error: "missing_question_text", message: "Question text required" };
    }
    if (typeof qq.header !== "string" || qq.header.length === 0) {
      return { ok: false, error: "missing_header", message: "Header required" };
    }
    if (qq.header.length > MAX_HEADER_LENGTH) {
      return { ok: false, error: "header_too_long", message: `Header max ${MAX_HEADER_LENGTH} chars` };
    }

    const options = qq.options;
    if (!Array.isArray(options)) {
      return { ok: false, error: "too_few_options", message: "Options array required" };
    }
    if (options.length < MIN_OPTIONS) {
      return { ok: false, error: "too_few_options", message: `Min ${MIN_OPTIONS} options` };
    }
    if (options.length > MAX_OPTIONS) {
      return { ok: false, error: "too_many_options", message: `Max ${MAX_OPTIONS} options` };
    }

    const seenLabels = new Set<string>();
    for (const opt of options) {
      if (typeof opt !== "object" || opt === null) {
        return { ok: false, error: "invalid_option", message: "Option must be an object" };
      }
      const oo = opt as Record<string, unknown>;
      if (typeof oo.label !== "string" || oo.label.length === 0) {
        return { ok: false, error: "missing_label", message: "Option label required" };
      }
      if (oo.label.length > MAX_LABEL_LENGTH) {
        return { ok: false, error: "label_too_long", message: `Label max ${MAX_LABEL_LENGTH} chars` };
      }
      if (typeof oo.description !== "string" || oo.description.length === 0) {
        return { ok: false, error: "missing_description", message: "Option description required" };
      }
      if (RESERVED_LABELS.includes(oo.label as typeof RESERVED_LABELS[number])) {
        return { ok: false, error: "reserved_label", message: `Label "${oo.label}" is reserved` };
      }
      if (seenLabels.has(oo.label)) {
        return { ok: false, error: "duplicate_label", message: `Duplicate label "${oo.label}"` };
      }
      seenLabels.add(oo.label);
    }
  }

  return { ok: true, params: input as unknown as AskUserQuestionParams };
}
