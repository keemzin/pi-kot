import { useEffect, useState, useCallback } from "react";
import { getProjectSystemPrompt, setProjectSystemPrompt } from "../lib/api-client";

const MAX_BYTES = 20_000;

interface Props {
  projectId: string;
}

export function SystemPromptTab({ projectId }: Props) {
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const byteLength = new Blob([text]).size;
  const overLimit = byteLength > MAX_BYTES;
  const dirty = text !== savedText;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    getProjectSystemPrompt(projectId)
      .then(({ addendum }) => {
        if (cancelled) return;
        setText(addendum);
        setSavedText(addendum);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  const handleSave = useCallback(async () => {
    if (!dirty || overLimit) return;
    setSaving(true);
    setError(undefined);
    try {
      await setProjectSystemPrompt(projectId, text);
      setSavedText(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [dirty, overLimit, text, projectId]);

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "var(--bg-glass)", fontSize: "13px", color: "var(--text)",
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 14px 6px", display: "flex", justifyContent: "space-between",
        alignItems: "center", flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--text)" }}>
          System Prompt Addendum
        </span>
        <span style={{
          fontSize: "11px", color: overLimit ? "var(--danger)" : "var(--text-dim)",
        }}>
          {byteLength.toLocaleString()} / {MAX_BYTES.toLocaleString()} B
        </span>
      </div>

      {/* Description */}
      <p style={{
        margin: "2px 14px 6px", fontSize: "11px", lineHeight: 1.5,
        color: "var(--text-dim)", flexShrink: 0,
      }}>
        Text entered here is appended to the agent's base system prompt for every
        session in this project. Useful for project-specific conventions, rules,
        or context.
      </p>

      {/* Error banner */}
      {error !== undefined && (
        <div style={{
          margin: "0 14px 6px", padding: "6px 10px", borderRadius: "6px",
          background: "color-mix(in srgb, var(--danger) 15%, transparent)",
          color: "var(--danger)", fontSize: "12px", flexShrink: 0,
        }}>
          {error}
        </div>
      )}

      {/* Textarea */}
      <div style={{ flex: 1, padding: "0 14px 8px", display: "flex", minHeight: 0 }}>
        {loading ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: "12px" }}>
            Loading…
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Always run tests before telling the user the code is ready."
            style={{
              flex: 1, width: "100%", resize: "none", outline: "none",
              background: "var(--bg-solid)", color: "var(--text)",
              border: "1px solid var(--border)", borderRadius: "6px",
              padding: "10px 12px", fontSize: "13px", lineHeight: 1.6,
              fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
            }}
          />
        )}
      </div>

      {/* Footer actions */}
      <div style={{
        padding: "6px 14px 10px", display: "flex", gap: "8px",
        alignItems: "center", flexShrink: 0, justifyContent: "space-between",
      }}>
        <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>
          {dirty ? "• Unsaved changes" : ""}
        </span>
        <button
          onClick={handleSave}
          disabled={!dirty || saving || overLimit}
          style={{
            padding: "6px 16px", fontSize: "12px", fontWeight: 600,
            border: "none", borderRadius: "6px", cursor: "pointer",
            background: dirty && !overLimit
              ? "var(--accent)"
              : "var(--bg-solid)",
            color: dirty && !overLimit
              ? "var(--accent-text)"
              : "var(--text-dim)",
            opacity: !dirty || saving ? 0.5 : 1,
            transition: "all 0.12s ease",
            lineHeight: 1,
          }}
          type="button"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
