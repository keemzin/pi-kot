/**
 * RewindModal — checkpoint picker + restore mode selection.
 * Opens when the ↩️ rewind button is clicked.
 * Fetches checkpoints from the server and lets the user pick one to restore.
 */

import { useEffect, useState } from "react";
import {
  fetchCheckpoints,
  rewindSession,
  type CheckpointEntry,
  type CheckpointFileChange,
} from "../lib/api-client";

interface Props {
  sessionId: string;
  onClose: () => void;
  onRewindComplete: (checkpointId: string) => void;
}

type Step = "loading" | "pick" | "confirm" | "restoring" | "done" | "error";

export function RewindModal({ sessionId, onClose, onRewindComplete }: Props) {
  const [step, setStep] = useState<Step>("loading");
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([]);
  const [selected, setSelected] = useState<CheckpointEntry | null>(null);
  const [mode, setMode] = useState<"code" | "conversation" | "both">("both");
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Fetch checkpoints on mount
  useEffect(() => {
    fetchCheckpoints(sessionId)
      .then((res) => {
        setCheckpoints(res.checkpoints);
        setStep(res.checkpoints.length > 0 ? "pick" : "done");
      })
      .catch((err) => {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setStep("error");
      });
  }, [sessionId]);

  const handleRewind = async () => {
    if (selected === null) return;
    setStep("restoring");
    try {
      const result = await rewindSession(sessionId, {
        checkpointId: selected.id,
        mode,
      });
      if (result.success) {
        setStep("done");
        onRewindComplete(selected.id);
      } else {
        setErrorMsg(result.error ?? "Rewind failed");
        setStep("error");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel rewind-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 560, maxWidth: "92vw", height: "auto", minHeight: 200, maxHeight: "80vh" }}
      >
        <header className="settings-header">
          <span style={{ fontSize: 14, fontWeight: 600 }}>↩️ Rewind</span>
          <button onClick={onClose} className="settings-close" title="Close">
            ✕
          </button>
        </header>

        <div className="settings-body" style={{ padding: "12px 16px" }}>
          {step === "loading" && (
            <div style={{ fontSize: 12, color: "var(--text-dim)", padding: 20, textAlign: "center" }}>
              Loading checkpoints…
            </div>
          )}

          {step === "pick" && (
            <>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 8 }}>
                Select a checkpoint to rewind to:
              </div>
              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                {checkpoints.map((cp, i) => (
                  <CheckpointRow
                    key={cp.id}
                    cp={cp}
                    index={i}
                    selected={selected?.id === cp.id}
                    onSelect={() => {
                      setSelected(cp);
                      setStep("confirm");
                    }}
                  />
                ))}
              </div>
            </>
          )}

          {step === "confirm" && selected && (
            <>
              {/* Warning card */}
              <div
                style={{
                  background: "rgba(224, 108, 117, 0.1)",
                  borderRadius: 8,
                  border: "1px solid rgba(224, 108, 117, 0.3)",
                  padding: "14px",
                  marginBottom: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span style={{ fontSize: 18, lineHeight: 1 }}>⚠️</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>
                      Rewind to &ldquo;{truncatePrompt(selected.prompt, 60)}&rdquo;?
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      {selected.fileCount > 0
                        ? `This will undo changes to ${selected.fileCount} file(s) and roll back the conversation to this point.`
                        : "This will roll back the conversation to this point (no file changes)."}
                    </div>
                    <button
                      onClick={() => { setSelected(null); setStep("pick"); }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--accent-text)",
                        fontSize: 11,
                        textDecoration: "underline",
                        marginTop: 6,
                        padding: 0,
                        fontFamily: "inherit",
                      }}
                    >
                      Pick a different checkpoint
                    </button>
                  </div>
                </div>
              </div>

              {/* File changes summary */}
              {selected.fileChanges.length > 0 && (
                <div
                  style={{
                    background: "var(--bg-glass)",
                    borderRadius: 6,
                    padding: "6px 8px",
                    marginBottom: 14,
                    maxHeight: 100,
                    overflowY: "auto",
                    fontSize: 10,
                    fontFamily: "monospace",
                  }}
                >
                  <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>
                    {selected.beforeCommit.slice(0, 8)} → {selected.afterCommit.slice(0, 8)}
                  </div>
                  {selected.fileChanges.map((fc, i) => (
                    <div key={i} style={{ color: "var(--text-secondary)", lineHeight: 1.8 }}>
                      <span style={{ color: "var(--accent-grn, #22c55e)" }}>+{fc.added}</span>
                      {" "}
                      <span style={{ color: "var(--accent-red, #ef4444)" }}>-{fc.removed}</span>
                      {" "}
                      {fc.path}
                    </div>
                  ))}
                </div>
              )}

              {/* Restore mode */}
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 6 }}>
                Restore mode:
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginBottom: 16,
                  flexWrap: "wrap",
                }}
              >
                <ModeButton
                  active={mode === "both"}
                  label="Code + Conversation"
                  desc="Restore files and chat"
                  onClick={() => setMode("both")}
                />
                {selected.fileCount > 0 && (
                  <ModeButton
                    active={mode === "code"}
                    label="Code only"
                    desc="Restore files only"
                    onClick={() => setMode("code")}
                  />
                )}
                <ModeButton
                  active={mode === "conversation"}
                  label="Conversation only"
                  desc="Roll back chat only"
                  onClick={() => setMode("conversation")}
                />
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => { setSelected(null); setStep("pick"); }}
                  className="settings-tab"
                  style={{ padding: "6px 14px", fontSize: 12 }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleRewind}
                  className="settings-tab settings-tab-active"
                  style={{
                    padding: "6px 14px",
                    fontSize: 12,
                    background: "var(--accent-red, #e06c75)",
                    color: "#fff",
                    border: "none",
                  }}
                >
                  ↩️ Rewind
                </button>
              </div>
            </>
          )}

          {step === "restoring" && (
            <div style={{ fontSize: 12, color: "var(--text-dim)", padding: 20, textAlign: "center" }}>
              Restoring… (git checkout + session navigation)
            </div>
          )}

          {step === "done" && (
            <div style={{ fontSize: 12, color: "var(--text-dim)", padding: 20, textAlign: "center" }}>
              {checkpoints.length === 0
                ? "No checkpoints found for this session."
                : "✅ Rewind complete!"}
              <div style={{ marginTop: 12 }}>
                <button
                  onClick={onClose}
                  className="settings-tab settings-tab-active"
                  style={{ padding: "6px 14px", fontSize: 12 }}
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {step === "error" && (
            <div style={{ fontSize: 12, color: "var(--accent-red)", padding: 20, textAlign: "center" }}>
              Error: {errorMsg}
              <div style={{ marginTop: 12 }}>
                <button
                  onClick={onClose}
                  className="settings-tab"
                  style={{ padding: "6px 14px", fontSize: 12 }}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function CheckpointRow({
  cp,
  index,
  selected,
  onSelect,
}: {
  cp: CheckpointEntry;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      style={{
        display: "flex",
        width: "100%",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 6,
        border: selected ? "1px solid var(--accent-border)" : "1px solid transparent",
        background: selected ? "var(--accent-subtle)" : "none",
        cursor: "pointer",
        transition: "background 0.15s",
        textAlign: "left",
        fontSize: 11,
        fontFamily: "inherit",
        color: "var(--text-primary)",
        marginBottom: 3,
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = "var(--bg-glass)";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = "none";
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "var(--bg-glass-hover)",
          color: "var(--text-dim)",
          fontSize: 10,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {index + 1}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {cp.prompt}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
          {cp.fileCount > 0
            ? `${cp.fileCount} file(s) · ${cp.beforeCommit.slice(0, 8)}`
            : "Conversation only"}
        </div>
      </div>
      {cp.fileChanges.length > 0 && (
        <div style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0, textAlign: "right" }}>
          {cp.fileChanges.reduce((a, f) => a + f.added, 0) > 0 && (
            <span style={{ color: "var(--accent-grn, #22c55e)" }}>
              +{cp.fileChanges.reduce((a, f) => a + f.added, 0)}
            </span>
          )}{" "}
          {cp.fileChanges.reduce((a, f) => a + f.removed, 0) > 0 && (
            <span style={{ color: "var(--accent-red, #ef4444)" }}>
              -{cp.fileChanges.reduce((a, f) => a + f.removed, 0)}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

function ModeButton({
  active,
  label,
  desc,
  onClick,
}: {
  active: boolean;
  label: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        minWidth: 140,
        padding: "8px 10px",
        borderRadius: 8,
        border: active ? "2px solid var(--accent-border)" : "1px solid var(--border-color)",
        background: active ? "var(--accent-subtle)" : "var(--bg-glass)",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)" }}>
        {active ? "✓ " : ""}{label}
      </div>
      <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{desc}</div>
    </button>
  );
}

function truncatePrompt(text: string, max = 80): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}
