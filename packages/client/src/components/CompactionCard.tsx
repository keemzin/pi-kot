import { memo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Layers } from "lucide-react";
import { ChatMarkdown } from "./ChatMarkdown";
import type { CompactionEvent } from "../lib/api-client";

const NEAR_BOTTOM_PX = 96;

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
}

function findScrollParent(start: Element | null): HTMLElement | undefined {
  let node = start;
  while (node instanceof HTMLElement) {
    const style = window.getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return undefined;
}

/**
 * Inline marker card rendered between chat messages at every point
 * where pi compacted the context. Collapsed default — shows a single
 * line "Compacted" with summary, token count, and timestamp. Click to
 * expand and see the archived messages.
 *
 * Uses pi-kot's theme CSS variables (--accent, --bg-glass, --border,
 * --text-*) so it integrates with any theme.
 */
export function CompactionCard({
  event,
  renderArchived,
}: {
  event: CompactionEvent;
  /** Lazy renderer for archived messages — parent passes this so the
   *  archived messages are only rendered into a self-contained component
   *  when the card is expanded. Keeps the main ChatView render loop
   *  fast by avoiding markdown-heavy archived messages on every tick. */
  renderArchived?: () => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const when = new Date(event.timestamp);
  const timeLabel = `${when.toLocaleDateString()} ${when.toLocaleTimeString()}`;
  const archivedCount = event.archivedMessages.length;
  // Strip SDK prefix like "Goal:" or "Summary:" — the card already says "Compacted"
  const summaryText = event.summary.replace(/^(Goal|Summary):\s*/i, "");
  const rootRef = useRef<HTMLDivElement>(null);

  const toggleOpen = (nextOpen: boolean): void => {
    const scroller = findScrollParent(rootRef.current);
    const wasPinnedToBottom = scroller !== undefined && isNearBottom(scroller);
    setOpen(nextOpen);
    if (nextOpen && wasPinnedToBottom) {
      window.requestAnimationFrame(() => {
        scroller.scrollTop = scroller.scrollHeight;
      });
    }
  };

  const collapseBtn = (pos: "top" | "bottom"): React.ReactNode => (
    <button
      type="button"
      onClick={() => toggleOpen(false)}
      style={{
        display: "flex",
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
        gap: "4px",
        padding: "6px 8px",
        fontSize: "10px",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: "var(--text-dim)",
        background: "transparent",
        border: "none",
        borderRadius: "var(--radius-sm)",
        cursor: "pointer",
      }}
      title="Collapse archived messages"
      aria-label={`Collapse compaction summary from ${pos}`}
    >
      <ChevronDown size={11} />
      Collapse
    </button>
  );

  return (
    <div
      ref={rootRef}
      style={{
        margin: "8px 0",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border)",
        background: "var(--bg-glass)",
        overflow: "hidden",
      }}
    >
      {open && (
        <div
          style={{
            borderBottom: "1px solid var(--border)",
            padding: "12px",
          }}
        >
          {collapseBtn("top")}

          {/* Full SDK summary */}
          {event.summary.length > 0 && (
            <div
              style={{
                margin: "12px 0",
                padding: "8px 10px",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg-glass-strong)",
                fontSize: "11px",
                lineHeight: "1.6",
                color: "var(--text-secondary)",
                whiteSpace: "pre-wrap",
              }}
            >
              {summaryText}
            </div>
          )}

          {/* Archived messages — rendered lazily via parent callback */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              opacity: 0.85,
            }}
          >
            {renderArchived?.()}
          </div>

          <div style={{ marginTop: "12px" }}>{collapseBtn("bottom")}</div>
        </div>
      )}

      {/* Collapsed header */}
      <button
        type="button"
        onClick={() => toggleOpen(!open)}
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          gap: "8px",
          padding: "8px 12px",
          textAlign: "left",
          fontSize: "12px",
          color: "var(--text-secondary)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          transition: "background var(--duration) var(--ease)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = "var(--bg-glass-hover)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
        title={
          open
            ? "Hide archived messages"
            : `Expand ${archivedCount} archived message${archivedCount === 1 ? "" : "s"}`
        }
      >
        {open ? (
          <ChevronUp size={12} style={{ color: "var(--accent)" }} />
        ) : (
          <ChevronRight size={12} style={{ color: "var(--accent)" }} />
        )}
        <Layers size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
        <span
          style={{
            flex: 1,
            fontWeight: 600,
            color: "var(--text-primary)",
            fontFeatureSettings: "'tnum'",
          }}
        >
          Compacted
        </span>
        <span
          style={{
            fontFamily: "monospace",
            fontSize: "10px",
            color: "var(--text-dim)",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          -{archivedCount} msg · -{event.tokensBefore.toLocaleString()} tok
          {event.estimatedTokensAfter !== undefined && (
            <>
              <span style={{ margin: "0 2px", color: "var(--border)" }}>→</span>
              ~{event.estimatedTokensAfter.toLocaleString()} tok
            </>
          )}
        </span>
        <span
          style={{
            fontSize: "10px",
            color: "var(--text-dim)",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {timeLabel}
        </span>
      </button>

      {/* Summary preview when collapsed — one line, truncated */}
      {!open && event.summary.length > 0 && (
        <div
          style={{
            padding: "0 12px 8px 12px",
            fontSize: "11px",
            lineHeight: "1.4",
            color: "var(--text-dim)",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {summaryText}
        </div>
      )}
    </div>
  );
}


