import React from "react";
import type { ToolRendererProps } from "../lib/tool-registry";
import { usePlanReviewStore } from "../stores/plan-review-store";
import { Check, ExternalLink } from "lucide-react";

export const PlanSubmittedCard: React.FC<ToolRendererProps> = ({ part }) => {
  const filePath = String(part.args?.filePath ?? "PLAN.md");
  const details = part.details as { approved?: boolean; feedback?: string } | undefined;
  const isPending = part.state === "running" || (part.state as string) === "input-available";
  const isApproved = details?.approved === true;
  const isRejected = details?.approved === false;

  const openFileReview = usePlanReviewStore((s) => s.openFileReview);
  const submitDecision = usePlanReviewStore((s) => s.submitDecision);
  const submitting = usePlanReviewStore((s) => s.submitting);

  const handleOpenReview = () => {
    openFileReview(filePath);
  };

  const handleQuickApprove = () => {
    submitDecision({ approved: true });
  };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md, 8px)",
        background: "var(--bg-glass)",
        padding: "14px 18px",
        margin: "10px 0",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px" }}>📋</span>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
              Plan Submitted for Review
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-dim)", fontFamily: "var(--font-mono, monospace)" }}>
              {filePath}
            </div>
          </div>
        </div>

        <span
          style={{
            fontSize: "11px",
            fontWeight: 600,
            padding: "3px 9px",
            borderRadius: "12px",
            background: isPending
              ? "rgba(234, 179, 8, 0.15)"
              : isApproved
              ? "rgba(34, 197, 94, 0.15)"
              : "rgba(239, 68, 68, 0.15)",
            color: isPending
              ? "#eab308"
              : isApproved
              ? "#22c55e"
              : "#ef4444",
            border: isPending
              ? "1px solid rgba(234, 179, 8, 0.3)"
              : isApproved
              ? "1px solid rgba(34, 197, 94, 0.3)"
              : "1px solid rgba(239, 68, 68, 0.3)",
          }}
        >
          {isPending
            ? "Awaiting Review"
            : isApproved
            ? "Plan Approved"
            : isRejected
            ? "Revisions Requested"
            : "Plan Saved"}
        </span>
      </div>

      {details?.feedback && (
        <div
          style={{
            fontSize: "12px",
            padding: "8px 12px",
            borderRadius: "6px",
            background: "var(--bg-glass-strong, rgba(128, 128, 128, 0.08))",
            color: "var(--text-secondary)",
            fontStyle: "italic",
            border: "1px solid var(--border)",
          }}
        >
          &ldquo;{details.feedback}&rdquo;
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px" }}>
        <button
          type="button"
          onClick={handleOpenReview}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "6px 14px",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: 500,
            cursor: "pointer",
            background: isPending ? "var(--accent, #3b82f6)" : "var(--bg-glass)",
            color: isPending ? "#fff" : "var(--text-primary)",
            border: isPending ? "none" : "1px solid var(--border)",
            transition: "all 0.15s ease",
          }}
        >
          <ExternalLink size={13} />
          <span>{isPending ? "Review Plan in Side Panel" : "View Plan"}</span>
        </button>

        {isPending && (
          <button
            type="button"
            onClick={handleQuickApprove}
            disabled={submitting}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "6px 14px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              background: "#16a34a",
              color: "#fff",
              border: "none",
              transition: "all 0.15s ease",
            }}
          >
            <Check size={13} strokeWidth={2.5} />
            <span>Quick Approve</span>
          </button>
        )}
      </div>
    </div>
  );
};
