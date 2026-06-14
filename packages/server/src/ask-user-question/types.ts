export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_HEADER_LENGTH = 16;
export const MAX_LABEL_LENGTH = 60;

export const RESERVED_LABELS = ["Other", "Type something.", "Chat about this", "Next"] as const;

export interface Option {
  label: string;
  description: string;
  preview?: string;
}

export interface Question {
  question: string;
  header: string;
  options: Option[];
  multiSelect?: boolean;
}

export interface AskUserQuestionParams {
  questions: Question[];
}

export interface QuestionAnswer {
  questionIndex: number;
  question: string;
  kind: "option" | "custom" | "chat" | "multi";
  answer: string | null;
  selected?: string[];
  notes?: string;
  preview?: string;
}

export interface AskUserQuestionDetails {
  answers: QuestionAnswer[];
  cancelled: boolean;
  error?: string;
}

export interface AskUserQuestionResult {
  content: { type: "text"; text: string }[];
  details: AskUserQuestionDetails;
}

export type ValidationResult =
  | { ok: true; params: AskUserQuestionParams }
  | { ok: false; error: string; message: string };
