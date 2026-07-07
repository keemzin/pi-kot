/**
 * SkillEditor — inline skill editor that replaces the skills list
 * inside the settings panel, below .settings-header.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { getSkillDetail, updateSkill } from "../lib/api-client";
import type { SkillSummary } from "../lib/api-client/types";

interface Props {
  skill: SkillSummary;
  onBack: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}

export function SkillEditor({ skill, onBack, onSaved, onError: onErrorProp }: Props) {
  const onErrorRef = useRef(onErrorProp);
  onErrorRef.current = onErrorProp;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load skill content on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getSkillDetail(skill.name)
      .then((detail) => {
        if (cancelled) return;
        setDescription(detail.md.description ?? "");
        setInstructions(detail.md.instructions);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = `Failed to load skill: ${err instanceof Error ? err.message : String(err)}`;
        setError(msg);
        onErrorRef.current(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [skill.name]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await updateSkill(skill.name, { description, instructions });
      onSavedRef.current();
      onBack();
    } catch (err) {
      const msg = `Failed to save: ${err instanceof Error ? err.message : String(err)}`;
      setError(msg);
      onErrorRef.current(msg);
    } finally {
      setSaving(false);
    }
  }, [skill.name, description, instructions, onBack]);

  // ── Simple markdown render ────────────────────────────────────────

  const renderMarkdown = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/^### (.+)$/gm, '<h3 style="margin:12px 0 4px;font-size:15px;font-weight:600">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 style="margin:14px 0 6px;font-size:17px;font-weight:600">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 style="margin:16px 0 8px;font-size:19px;font-weight:600">$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, '<code style="background:var(--bg-glass);padding:1px 4px;border-radius:3px;font-family:var(--font-mono,monospace);font-size:0.9em">$1</code>')
      .replace(/^- (.+)$/gm, '<li style="margin-left:16px">$1</li>')
      .replace(/\n/g, "<br/>");

  // ── Loading state ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--text-dim)" }}>
        Loading…
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <p style={{ color: "var(--danger, #e74c3c)", marginBottom: 12 }}>{error}</p>
        <button onClick={onBack} className="settings-btn" style={{ fontSize: 12 }}>
          ← Back to skills
        </button>
      </div>
    );
  }

  // ── Editor ────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "0 12px 12px",
      }}
    >
      {/* Inline header: back button + skill name */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          marginBottom: 8,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          style={{
            padding: "3px 8px",
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 4,
            border: "1px solid var(--border-color)",
            background: "transparent",
            color: "var(--text-secondary)",
            cursor: "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          ← Back
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {skill.name}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
            {skill.filePath.length > 70 ? "…" + skill.filePath.slice(-67) : skill.filePath}
          </div>
        </div>
      </div>

      {/* Description */}
      <div style={{ marginBottom: 6, flexShrink: 0 }}>
        <label
          style={{
            display: "block",
            fontSize: 11,
            fontWeight: 600,
            marginBottom: 4,
            color: "var(--text-primary)",
          }}
        >
          Description <span style={{ color: "var(--danger, #e74c3c)" }}>*</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this skill do?"
          rows={2}
          style={{
            width: "100%",
            resize: "none",
            minHeight: 38,
            padding: "6px 10px",
            fontSize: 12,
            fontFamily: "inherit",
            border: "1px solid var(--border-color)",
            borderRadius: 6,
            background: "var(--bg-glass)",
            color: "var(--text-primary)",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Instructions */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
            flexShrink: 0,
          }}
        >
          <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)" }}>
            Instructions
          </label>
          <button
            onClick={() => setShowPreview((p) => !p)}
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 4,
              border: "1px solid var(--border-color)",
              background: showPreview ? "var(--accent-bg)" : "transparent",
              color: showPreview ? "white" : "var(--text-dim)",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {showPreview ? "Edit" : "Preview"}
          </button>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            border: "1px solid var(--border-color)",
            borderRadius: 6,
            overflow: "hidden",
            background: "var(--bg-glass)",
          }}
        >
          {showPreview ? (
            <div
              style={{
                padding: "12px 16px",
                fontSize: 12,
                lineHeight: 1.5,
                color: "var(--text-primary)",
                overflow: "auto",
                height: "100%",
                whiteSpace: "pre-wrap",
              }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(instructions) }}
            />
          ) : (
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Skill instructions (Markdown)…"
              style={{
                width: "100%",
                height: "100%",
                resize: "none",
                padding: "12px 16px",
                fontSize: 12,
                fontFamily: "var(--font-mono, monospace)",
                border: "none",
                background: "transparent",
                color: "var(--text-primary)",
                lineHeight: 1.5,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          paddingTop: 10,
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={onBack}
          style={{
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 6,
            border: "1px solid var(--border-color)",
            background: "transparent",
            color: "var(--text-secondary)",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !description.trim()}
          style={{
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 6,
            border: "none",
            background: saving ? "var(--bg-glass)" : "var(--accent-bg, #3b82f6)",
            color: "white",
            cursor: saving ? "default" : "pointer",
            opacity: saving || !description.trim() ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
