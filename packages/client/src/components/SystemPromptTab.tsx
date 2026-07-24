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
      background: "transparent", fontSize: "13px", color: "var(--text-primary)",
    }}>
      {/* Hint text */}
      <p style={{
        margin: "12px 16px 8px", fontSize: "12px", lineHeight: 1.6,
        color: "var(--text-dim)", flexShrink: 0,
      }}>
        Appended to the agent's base system prompt for every session in this project.
        <span style={{ display: "block", marginTop: "2px", color: overLimit ? "var(--error)" : "var(--text-ghost)", fontSize: "11px" }}>
          {byteLength.toLocaleString()} / {MAX_BYTES.toLocaleString()} B used
        </span>
      </p>

      {/* Error banner */}
      {error !== undefined && (
        <div style={{
          margin: "0 16px 8px", padding: "6px 10px", borderRadius: "var(--radius-sm)",
          background: "color-mix(in srgb, var(--error) 12%, transparent)",
          color: "var(--error)", fontSize: "12px", flexShrink: 0,
        }}>
          {error}
        </div>
      )}

      {/* Textarea — fills remaining height */}
      <div style={{ flex: 1, padding: "0 16px 8px", display: "flex", flexDirection: "column", minHeight: 0 }}>
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
              background: "var(--input-bg)", color: "var(--text-primary)",
              border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
              padding: "12px 14px", fontSize: "13px", lineHeight: 1.7,
              fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
              transition: "border-color 0.12s ease",
            }}
            onFocus={(e) => { e.target.style.borderColor = "var(--border-bright)"; }}
            onBlur={(e) => { e.target.style.borderColor = "var(--border)"; }}
          />
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: "8px 16px 14px", display: "flex", gap: "8px",
        alignItems: "center", flexShrink: 0, justifyContent: "space-between",
        borderTop: "1px solid var(--border)",
      }}>
        <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>
          {dirty ? "• Unsaved changes" : "All changes saved"}
        </span>
        <button
          onClick={handleSave}
          disabled={!dirty || saving || overLimit}
          style={{
            padding: "7px 20px", fontSize: "13px", fontWeight: 600,
            border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer",
            background: dirty && !overLimit ? "var(--accent)" : "var(--bg-glass-strong)",
            color: dirty && !overLimit ? "white" : "var(--text-dim)",
            opacity: !dirty || saving ? 0.6 : 1,
            transition: "all 0.12s ease",
          }}
          type="button"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
