import { useEffect, useState } from "react";
import { answerAskQuestion, getPendingAskQuestions, type AskQuestion } from "../lib/api-client";
import { useAskUserQuestionStore, type PendingAskQuestion } from "../stores/ask-user-question-store";

interface Props {
  sessionId: string;
}

export function AskUserQuestionPanel({ sessionId }: Props) {
  const pending = useAskUserQuestionStore((s) => s.pendingBySession[sessionId]);
  if (pending === undefined) return null;
  return <PanelBody key={pending.requestId} pending={pending} />;
}

interface PendingAnswer {
  selectedLabel?: string;
  customText?: string;
  multiLabels?: string[];
}

function PanelBody({ pending }: { pending: PendingAskQuestion }) {
  const clearPending = useAskUserQuestionStore((s) => s.clearPending);
  const [tab, setTab] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [drafts, setDrafts] = useState<(PendingAnswer | null)[]>(() =>
    pending.questions.map(() => null),
  );

  const current = pending.questions[tab];
  if (current === undefined) return null;

  const isLast = tab === pending.questions.length - 1;

  const saveDraft = (answer: PendingAnswer): void => {
    setDrafts((prev) => {
      const next = [...prev];
      next[tab] = answer;
      return next;
    });
  };

  const getDraft = (): PendingAnswer => drafts[tab] ?? {};

  const buildAnswers = () => {
    return pending.questions.map((q, i) => {
      const draft = drafts[i];
      if (draft === null) {
        return {
          questionIndex: i,
          question: q.question,
          kind: "chat" as const,
          answer: null,
        };
      }
      if (draft.customText !== undefined) {
        return {
          questionIndex: i,
          question: q.question,
          kind: "custom" as const,
          answer: draft.customText,
        };
      }
      if (q.multiSelect) {
        return {
          questionIndex: i,
          question: q.question,
          kind: "multi" as const,
          answer: null,
          selected: draft.multiLabels ?? [],
        };
      }
      return {
        questionIndex: i,
        question: q.question,
        kind: "option" as const,
        answer: draft.selectedLabel ?? null,
      };
    });
  };

  const submit = async (cancelled = false) => {
    setSubmitting(true);
    setError(undefined);
    try {
      const answers = cancelled ? [] : buildAnswers();
      await answerAskQuestion(pending.sessionId, pending.requestId, answers, cancelled);
      clearPending(pending.sessionId, pending.requestId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleNext = () => {
    setTab((t) => Math.min(t + 1, pending.questions.length - 1));
  };

  const handlePrev = () => {
    setTab((t) => Math.max(t - 1, 0));
  };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--bg-glass-strong)",
        padding: 16,
        margin: "8px auto",
        maxWidth: 800,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
          {current.header}
        </span>
        {pending.questions.length > 1 && (
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {tab + 1} / {pending.questions.length}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => void submit(true)}
          disabled={submitting}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-tertiary)",
            cursor: "pointer",
            fontSize: 12,
            padding: "2px 6px",
            borderRadius: 4,
          }}
          title="Chat about this instead"
        >
          ✕ Chat about it
        </button>
      </div>

      {/* Question */}
      <div style={{ fontSize: 14, color: "var(--text-primary)", marginBottom: 12, lineHeight: 1.5 }}>
        {current.question}
      </div>

      {/* Options */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {current.multiSelect ? (
          <MultiSelectOptions
            options={current.options}
            selected={getDraft().multiLabels ?? []}
            onChange={(labels) => saveDraft({ multiLabels: labels })}
          />
        ) : (
          <SingleSelectOptions
            options={current.options}
            selected={getDraft().selectedLabel}
            onSelect={(label) => saveDraft({ selectedLabel: label, customText: undefined })}
          />
        )}

        {/* Custom input */}
        {!current.multiSelect && (
          <div style={{ marginTop: 8 }}>
            <input
              type="text"
              placeholder="Type something..."
              value={getDraft().customText ?? ""}
              onChange={(e) =>
                saveDraft({ customText: e.target.value, selectedLabel: undefined })
              }
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--input-border)",
                background: "var(--input-bg)",
                color: "var(--text-primary)",
                fontSize: 13,
                fontFamily: "inherit",
                outline: "none",
              }}
            />
          </div>
        )}
      </div>

      {/* Error */}
      {error !== undefined && (
        <div style={{ fontSize: 12, color: "var(--error)", marginTop: 8 }}>{error}</div>
      )}

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 12,
          gap: 8,
        }}
      >
        <div>
          {tab > 0 && (
            <button
              onClick={handlePrev}
              disabled={submitting}
              style={btnStyle}
            >
              ← Back
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {isLast ? (
            <button
              onClick={() => void submit(false)}
              disabled={submitting}
              style={{ ...btnStyle, background: "var(--accent)", color: "#fff" }}
            >
              {submitting ? "Submitting..." : "Submit"}
            </button>
          ) : (
            <button
              onClick={handleNext}
              disabled={submitting}
              style={btnStyle}
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-glass-hover)",
  color: "var(--text-primary)",
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
};

function SingleSelectOptions({
  options,
  selected,
  onSelect,
}: {
  options: AskQuestion["options"];
  selected?: string;
  onSelect: (label: string) => void;
}) {
  return (
    <>
      {options.map((opt) => (
        <button
          key={opt.label}
          onClick={() => onSelect(opt.label)}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            padding: "8px 12px",
            borderRadius: 8,
            border: `1px solid ${selected === opt.label ? "var(--accent)" : "var(--border)"}`,
            background:
              selected === opt.label ? "var(--accent-subtle)" : "var(--bg-glass)",
            color: "var(--text-primary)",
            cursor: "pointer",
            textAlign: "left",
            fontSize: 13,
            fontFamily: "inherit",
            transition: "all 0.15s",
          }}
        >
          <span style={{ fontWeight: 500 }}>{opt.label}</span>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {opt.description}
          </span>
        </button>
      ))}
    </>
  );
}

function MultiSelectOptions({
  options,
  selected,
  onChange,
}: {
  options: AskQuestion["options"];
  selected: string[];
  onChange: (labels: string[]) => void;
}) {
  const toggle = (label: string) => {
    if (selected.includes(label)) {
      onChange(selected.filter((l) => l !== label));
    } else {
      onChange([...selected, label]);
    }
  };

  return (
    <>
      {options.map((opt) => {
        const isChecked = selected.includes(opt.label);
        return (
          <label
            key={opt.label}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "8px 12px",
              borderRadius: 8,
              border: `1px solid ${isChecked ? "var(--accent)" : "var(--border)"}`,
              background: isChecked ? "var(--accent-subtle)" : "var(--bg-glass)",
              cursor: "pointer",
              fontSize: 13,
              fontFamily: "inherit",
              transition: "all 0.15s",
            }}
          >
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => toggle(opt.label)}
              style={{ marginTop: 2, accentColor: "var(--accent-text)" }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontWeight: 500 }}>{opt.label}</span>
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {opt.description}
              </span>
            </div>
          </label>
        );
      })}
    </>
  );
}
