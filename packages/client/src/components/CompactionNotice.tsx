import { memo, useEffect, useState } from "react";
import { Layers } from "lucide-react";
import type { ActiveCompaction } from "../stores/session-store";

const REASON_CONFIG: Record<
  ActiveCompaction["reason"],
  { icon: string; label: string; description: string }
> = {
  overflow: {
    icon: "🧠",
    label: "Auto-compacting",
    description: "Context overflow detected. Compressing older messages to make room...",
  },
  threshold: {
    icon: "⚙️",
    label: "Auto-compacting",
    description: "Context usage threshold reached. Compressing older messages...",
  },
  manual: {
    icon: "🗜️",
    label: "Compacting",
    description: "Compressing session context...",
  },
};

/**
 * An inline notice rendered in the chat during active compaction.
 * Shows what's happening and why — no cancel button for auto-compaction
 * since it's a necessary operation during context overflow.
 */
export const CompactionNotice = memo(function CompactionNotice({
  compaction,
}: {
  compaction: ActiveCompaction;
}) {
  const isComplete = compaction.completedAt !== undefined;
  const cfg = REASON_CONFIG[compaction.reason];
  const [elapsed, setElapsed] = useState(() =>
    Math.floor(((compaction.completedAt ?? Date.now()) - compaction.startedAt) / 1000),
  );

  useEffect(() => {
    if (isComplete) return; // no ticking once done
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - compaction.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [compaction.startedAt, isComplete]);

  // Completed state — show result summary
  if (isComplete) {
    const title = compaction.aborted
      ? "Compaction cancelled"
      : compaction.errorMessage
        ? "Compaction failed"
        : "Compacted";

    return (
      <div className="message-row system">
        <div className="compaction-notice compaction-notice--done">
          <div className="compaction-notice-header">
            {compaction.aborted ? (
              <span className="compaction-notice-icon">⛔</span>
            ) : compaction.errorMessage ? (
              <span className="compaction-notice-icon">⚠️</span>
            ) : (
              <Layers size={14} className="compaction-notice-icon" />
            )}
            <span className="compaction-notice-title">{title}</span>
          </div>
          {compaction.errorMessage && (
            <div className="compaction-notice-desc compaction-notice-desc--error">
              {compaction.errorMessage}
            </div>
          )}
          {!compaction.aborted && !compaction.errorMessage && (
            <div className="compaction-notice-stats">
              {compaction.tokensBefore !== undefined && (
                <span>
                  -{compaction.tokensBefore.toLocaleString()} tokens
                </span>
              )}
              {compaction.estimatedTokensAfter !== undefined && (
                <span>
                  → ~{compaction.estimatedTokensAfter.toLocaleString()} tokens
                </span>
              )}
              <span className="compaction-notice-timer">
                {elapsed < 60
                  ? `${elapsed}s`
                  : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Running state
  return (
    <div className="message-row system">
      <div className="compaction-notice">
        <span className="compaction-notice-icon">{cfg.icon}</span>
        <div className="compaction-notice-body">
          <div className="compaction-notice-title">{cfg.label}</div>
          <div className="compaction-notice-desc">{cfg.description}</div>
          <div className="compaction-notice-timer">
            {elapsed < 60
              ? `${elapsed}s`
              : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`}
          </div>
        </div>
        {/* Animated progress dots */}
        <span className="compaction-notice-dots" aria-hidden="true">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </div>
    </div>
  );
});
