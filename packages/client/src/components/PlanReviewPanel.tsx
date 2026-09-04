import React, { useState, useRef, useCallback, useEffect } from "react";
import { usePlanReviewStore } from "../stores/plan-review-store";
import { ChatMarkdown } from "./ChatMarkdown";
import { useLayoutStore, VIEWER_MIN_WIDTH } from "../stores/layout-store";
import { Check, Edit3, Eye, LogOut, MessageSquare, RotateCcw, Save, X } from "lucide-react";

interface Props {
  onClose?: () => void;
}

export const PlanReviewPanel: React.FC<Props> = ({ onClose }) => {
  const isOpen = usePlanReviewStore((s) => s.isOpen);
  const activeReview = usePlanReviewStore((s) => s.activeReview);
  const viewMode = usePlanReviewStore((s) => s.viewMode);
  const editedContent = usePlanReviewStore((s) => s.editedContent);
  const submitting = usePlanReviewStore((s) => s.submitting);
  const error = usePlanReviewStore((s) => s.error);
  const planModeActive = usePlanReviewStore((s) => s.planModeActive);

  const setViewMode = usePlanReviewStore((s) => s.setViewMode);
  const setEditedContent = usePlanReviewStore((s) => s.setEditedContent);
  const closeReview = usePlanReviewStore((s) => s.closeReview);
  const submitDecision = usePlanReviewStore((s) => s.submitDecision);
  const savePlanContent = usePlanReviewStore((s) => s.savePlanContent);
  const exitPlanMode = usePlanReviewStore((s) => s.exitPlanMode);

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("pi.planReview.width");
      return saved ? Number.parseInt(saved, 10) : 580;
    } catch {
      return 580;
    }
  });

  const [notesOpen, setNotesOpen] = useState(false);
  const [notesText, setNotesText] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const layoutIsMobile = useLayoutStore((s) => s.isMobile);
  const [windowMobile, setWindowMobile] = useState<boolean>(() => {
    return typeof window !== "undefined" && window.innerWidth <= 640;
  });

  useEffect(() => {
    const onResize = () => setWindowMobile(window.innerWidth <= 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const isMobile = layoutIsMobile || windowMobile;

  const resizeRef = useRef<{ startX: number; startW: number } | undefined>(undefined);
  const [isResizing, setIsResizing] = useState(false);

  // Resize handling
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (isMobile) return;
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startW: panelWidth };
    setIsResizing(true);
  }, [panelWidth, isMobile]);

  useEffect(() => {
    if (!isResizing) return;
    const handleMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = resizeRef.current.startX - e.clientX;
      const newWidth = Math.max(VIEWER_MIN_WIDTH, Math.min(window.innerWidth * 0.85, resizeRef.current.startW + delta));
      setPanelWidth(newWidth);
    };
    const handleUp = () => {
      setIsResizing(false);
      resizeRef.current = undefined;
      try {
        localStorage.setItem("pi.planReview.width", String(panelWidth));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isResizing, panelWidth]);

  if (!isOpen || !activeReview) {
    return null;
  }

  const isPendingReview = Boolean(activeReview.requestId);
  const hasEditedChanges = editedContent.trim() !== activeReview.planContent.trim();

  const handleApprove = async () => {
    try {
      await submitDecision({ approved: true });
      onClose?.();
    } catch {
      // Error handled in store
    }
  };

  const handleApproveWithNotes = async () => {
    if (!notesText.trim()) return;
    try {
      await submitDecision({ approved: true, feedback: notesText.trim() });
      setNotesOpen(false);
      setNotesText("");
      onClose?.();
    } catch {
      // Error handled in store
    }
  };

  const handleReject = async () => {
    if (!rejectFeedback.trim()) return;
    try {
      await submitDecision({ approved: false, feedback: rejectFeedback.trim() });
      setRejectOpen(false);
      setRejectFeedback("");
      onClose?.();
    } catch {
      // Error handled in store
    }
  };

  const handleSaveEdits = async () => {
    try {
      await savePlanContent();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch {
      // Error handled in store
    }
  };

  const handleExitPlanMode = async () => {
    try {
      await exitPlanMode();
    } catch {
      // Error handled in store
    }
  };

  const handleClose = () => {
    closeReview();
    onClose?.();
  };

  return (
    <aside
      className="plan-review-panel"
      style={{
        width: isMobile ? "100%" : `${panelWidth}px`,
        flexBasis: isMobile ? "100%" : `${panelWidth}px`,
        maxWidth: isMobile ? "100vw" : undefined,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        height: isMobile ? "calc(100dvh - 50px)" : "100%",
        borderLeft: isMobile ? "none" : "1px solid var(--border)",
        background: "var(--bg-solid)",
        color: "var(--text-primary)",
        position: isMobile ? "fixed" : "relative",
        top: isMobile ? 50 : undefined,
        left: isMobile ? 0 : undefined,
        right: isMobile ? 0 : undefined,
        bottom: isMobile ? 0 : undefined,
        zIndex: isMobile ? 125 : 20,
        paddingTop: isMobile ? 0 : "50px", // Account for fixed 50px app header
        boxSizing: "border-box",
      }}
    >
      {/* Drag handle for resizing (desktop only) */}
      {!isMobile && (
        <div
          className="fv-resize-handle"
          onMouseDown={handleResizeStart}
          style={{
            position: "absolute",
            left: -3,
            top: 0,
            bottom: 0,
            width: 6,
            cursor: "col-resize",
            zIndex: 30,
          }}
        />
      )}

      {/* Header */}
      <header
        className="plan-review-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: isMobile ? "8px 12px" : "10px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-glass)",
          flexShrink: 0,
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: "16px", flexShrink: 0 }}>📋</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              className="plan-review-header-title"
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: isMobile ? "140px" : undefined,
              }}
              title={activeReview.planFilePath}
            >
              {activeReview.planFilePath}
            </div>
            <div
              style={{
                fontSize: "11px",
                color: isPendingReview ? "var(--accent, #3b82f6)" : "#22c55e",
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {isPendingReview ? "Awaiting Your Review" : "✓ Plan Approved & Saved"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
          {/* Mode Switcher: Preview / Edit */}
          <div
            style={{
              display: "flex",
              borderRadius: "6px",
              background: "var(--bg-glass-strong, rgba(128, 128, 128, 0.12))",
              padding: "2px",
              border: "1px solid var(--border)",
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode("preview")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: isMobile ? "4px 8px" : "4px 10px",
                fontSize: "12px",
                fontWeight: viewMode === "preview" ? 600 : 500,
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                background: viewMode === "preview" ? "var(--accent, #3b82f6)" : "transparent",
                color: viewMode === "preview" ? "#fff" : "var(--text-secondary)",
                transition: "all 0.12s ease",
              }}
              title="Preview plan"
            >
              <Eye size={13} />
              {!isMobile && <span>Preview</span>}
            </button>
            <button
              type="button"
              onClick={() => setViewMode("edit")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: isMobile ? "4px 8px" : "4px 10px",
                fontSize: "12px",
                fontWeight: viewMode === "edit" ? 600 : 500,
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                background: viewMode === "edit" ? "var(--accent, #3b82f6)" : "transparent",
                color: viewMode === "edit" ? "#fff" : "var(--text-secondary)",
                transition: "all 0.12s ease",
              }}
              title="Edit plan"
            >
              <Edit3 size={13} />
              {!isMobile && <span>Edit</span>}
            </button>
          </div>

          <button
            type="button"
            onClick={handleClose}
            title="Close plan review"
            aria-label="Close plan review"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-dim)",
              cursor: "pointer",
              padding: "6px",
              minWidth: "32px",
              minHeight: "32px",
              borderRadius: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: "8px 16px",
            background: "rgba(239, 68, 68, 0.12)",
            color: "#ef4444",
            fontSize: "12px",
            borderBottom: "1px solid rgba(239, 68, 68, 0.25)",
          }}
        >
          {error}
        </div>
      )}

      {/* Body Area */}
      <div
        className="plan-review-body"
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: isMobile ? "12px 14px" : "16px 20px",
          minHeight: 0,
          background: "var(--bg-solid)",
          color: "var(--text-primary)",
          wordBreak: "break-word",
          overflowWrap: "break-word",
        }}
      >
        {viewMode === "preview" ? (
          <div
            className="plan-preview-content"
            style={{
              fontSize: "14px",
              lineHeight: 1.65,
              color: "var(--text-primary)",
            }}
          >
            <ChatMarkdown text={editedContent} />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "8px" }}>
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span>✏️</span>
                <span>Edit plan in-place:</span>
              </span>
              {hasEditedChanges && (
                <span style={{ color: "#eab308", fontSize: "11px", fontWeight: 600 }}>
                  ● Unsaved edits
                </span>
              )}
            </div>
            <textarea
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              placeholder="Edit your markdown plan here..."
              spellCheck={false}
              style={{
                flex: 1,
                width: "100%",
                background: "var(--bg-glass-strong, rgba(128, 128, 128, 0.05))",
                color: "var(--text-primary)",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "13px",
                lineHeight: 1.55,
                padding: "14px",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                resize: "none",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}
      </div>

      {/* Notes Popover */}
      {notesOpen && (
        <div
          style={{
            padding: "12px 16px",
            background: "var(--bg-glass)",
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>
            Implementation Guidance Notes:
          </div>
          <textarea
            value={notesText}
            onChange={(e) => setNotesText(e.target.value)}
            placeholder="Add guidance or constraints for implementation..."
            rows={2}
            style={{
              width: "100%",
              background: "var(--bg-solid)",
              color: "var(--text-primary)",
              fontSize: "12px",
              padding: "8px 10px",
              borderRadius: "4px",
              border: "1px solid var(--border)",
              resize: "none",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
            <button
              type="button"
              onClick={() => setNotesOpen(false)}
              style={{
                padding: "4px 10px",
                fontSize: "12px",
                background: "transparent",
                color: "var(--text-secondary)",
                border: "none",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApproveWithNotes}
              disabled={submitting || !notesText.trim()}
              style={{
                padding: "5px 12px",
                fontSize: "12px",
                fontWeight: 500,
                background: "var(--accent, #3b82f6)",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Approve with Notes
            </button>
          </div>
        </div>
      )}

      {/* Reject / Request Changes Popover */}
      {rejectOpen && (
        <div
          style={{
            padding: "12px 16px",
            background: "rgba(239, 68, 68, 0.08)",
            borderTop: "1px solid rgba(239, 68, 68, 0.25)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#ef4444" }}>
            Request Plan Revisions:
          </div>
          <textarea
            value={rejectFeedback}
            onChange={(e) => setRejectFeedback(e.target.value)}
            placeholder="Tell the agent what to revise in the plan..."
            rows={3}
            style={{
              width: "100%",
              background: "var(--bg-solid)",
              color: "var(--text-primary)",
              fontSize: "12px",
              padding: "8px 10px",
              borderRadius: "4px",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              resize: "none",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
            <button
              type="button"
              onClick={() => setRejectOpen(false)}
              style={{
                padding: "4px 10px",
                fontSize: "12px",
                background: "transparent",
                color: "var(--text-secondary)",
                border: "none",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={submitting || !rejectFeedback.trim()}
              style={{
                padding: "5px 12px",
                fontSize: "12px",
                fontWeight: 500,
                background: "#dc2626",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Send Revision Feedback
            </button>
          </div>
        </div>
      )}

      {/* Footer Action Bar */}
      <footer
        className="plan-review-footer"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px",
          padding: isMobile ? "10px 12px" : "12px 16px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg-glass)",
          flexShrink: 0,
        }}
      >
        {isPendingReview ? (
          /* Active Pending Review State */
          <>
            <div
              className="plan-review-footer-group"
              style={{
                display: "flex",
                gap: "8px",
                flexWrap: "wrap",
                flex: isMobile ? "1 1 100%" : "0 1 auto",
              }}
            >
              <button
                type="button"
                className="plan-review-footer-btn"
                onClick={() => {
                  setRejectOpen(!rejectOpen);
                  setNotesOpen(false);
                }}
                disabled={submitting}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  padding: "7px 12px",
                  fontSize: "12px",
                  fontWeight: 500,
                  background: "transparent",
                  color: "#ef4444",
                  border: "1px solid rgba(239, 68, 68, 0.35)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  flex: isMobile ? "1 1 auto" : undefined,
                }}
              >
                <RotateCcw size={13} />
                Request Changes
              </button>
              <button
                type="button"
                className="plan-review-footer-btn"
                onClick={() => {
                  setNotesOpen(!notesOpen);
                  setRejectOpen(false);
                }}
                disabled={submitting}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  padding: "7px 12px",
                  fontSize: "12px",
                  fontWeight: 500,
                  background: "var(--bg-glass)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  flex: isMobile ? "1 1 auto" : undefined,
                }}
              >
                <MessageSquare size={13} />
                Approve with Notes...
              </button>
            </div>

            <button
              type="button"
              className="plan-review-footer-btn"
              onClick={handleApprove}
              disabled={submitting}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                padding: "8px 18px",
                fontSize: "13px",
                fontWeight: 600,
                background: "#16a34a",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.15)",
                flex: isMobile ? "1 1 100%" : undefined,
                width: isMobile ? "100%" : undefined,
              }}
            >
              <Check size={15} strokeWidth={2.5} />
              {submitting ? "Approving..." : "Approve & Execute"}
            </button>
          </>
        ) : (
          /* Already Approved / On-Demand View Mode */
          <>
            <div
              className="plan-review-footer-group"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                flexWrap: "wrap",
                flex: isMobile ? "1 1 100%" : "0 1 auto",
              }}
            >
              <button
                type="button"
                className="plan-review-footer-btn"
                onClick={() => {
                  setRejectOpen(!rejectOpen);
                  setNotesOpen(false);
                }}
                disabled={submitting}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: 500,
                  background: "transparent",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  flex: isMobile ? "1 1 auto" : undefined,
                }}
              >
                <RotateCcw size={13} />
                Request Revisions
              </button>
              {planModeActive && (
                <button
                  type="button"
                  className="plan-review-footer-btn"
                  onClick={handleExitPlanMode}
                  title="Unlock code file editing for the agent"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                    padding: "6px 12px",
                    fontSize: "12px",
                    fontWeight: 500,
                    background: "rgba(234, 179, 8, 0.15)",
                    color: "#eab308",
                    border: "1px solid rgba(234, 179, 8, 0.35)",
                    borderRadius: "6px",
                    cursor: "pointer",
                    flex: isMobile ? "1 1 auto" : undefined,
                  }}
                >
                  <LogOut size={13} />
                  Exit Plan Mode
                </button>
              )}
            </div>

            <div
              className="plan-review-footer-group"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                flexWrap: "wrap",
                flex: isMobile ? "1 1 100%" : "0 1 auto",
                justifyContent: isMobile ? "stretch" : "flex-end",
              }}
            >
              {saveSuccess && (
                <span style={{ fontSize: "11px", color: "#22c55e", fontWeight: 600, width: isMobile ? "100%" : undefined, textAlign: isMobile ? "center" : undefined }}>
                  ✓ Saved to disk
                </span>
              )}
              {hasEditedChanges ? (
                <button
                  type="button"
                  className="plan-review-footer-btn"
                  onClick={handleSaveEdits}
                  disabled={submitting}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "5px",
                    padding: "7px 16px",
                    fontSize: "12px",
                    fontWeight: 600,
                    background: "var(--accent, #3b82f6)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    flex: isMobile ? "1 1 auto" : undefined,
                  }}
                >
                  <Save size={13} />
                  Save Edits
                </button>
              ) : (
                <span
                  className="plan-review-footer-btn"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "5px",
                    padding: "6px 12px",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#22c55e",
                    background: "rgba(34, 197, 94, 0.12)",
                    borderRadius: "6px",
                    flex: isMobile ? "1 1 auto" : undefined,
                  }}
                >
                  <Check size={14} strokeWidth={2.5} />
                  Plan Approved
                </span>
              )}
              <button
                type="button"
                className="plan-review-footer-btn"
                onClick={handleClose}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "7px 14px",
                  fontSize: "12px",
                  fontWeight: 500,
                  background: "var(--bg-glass)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  cursor: "pointer",
                  flex: isMobile ? "1 1 auto" : undefined,
                }}
              >
                Close
              </button>
            </div>
          </>
        )}
      </footer>
    </aside>
  );
};
