import { useState, useMemo, type MouseEvent } from "react";
import { Brain, ChevronRight, Copy, Check } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import { usePreferencesStore } from "../stores/preferences-store";

interface Props {
  text: string;
  initialOpen?: boolean;
  className?: string;
  showThinking?: boolean;
}

/**
 * Modern Minimalist Thinking Block (Direction 1)
 *
 * Replaces the chunky "input box" appearance with an ultra-clean,
 * lightweight metacognitive fold featuring Lucide icons, word count metadata,
 * smooth chevron toggle, copy button, and a left-accented typography gutter.
 */
export function ThinkingBlock({
  text,
  initialOpen = false,
  className = "",
  showThinking: propShowThinking,
}: Props) {
  const { t } = useI18n();
  const storeShowThinking = usePreferencesStore((s) => s.showThinking);
  const showThinking = propShowThinking ?? storeShowThinking;
  const [open, setOpen] = useState(initialOpen);
  const [copied, setCopied] = useState(false);

  const wordCount = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  }, [text]);

  if (!showThinking || !text.trim()) return null;

  const handleCopy = (e: MouseEvent) => {
    e.stopPropagation();
    if (!text) return;
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={`thinking-block ${open ? "open" : "collapsed"} ${className}`.trim()}>
      <div
        className="thinking-header"
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <div className="thinking-header-left">
          <ChevronRight size={13} className={`thinking-chevron ${open ? "rotated" : ""}`} />
          <Brain size={13} className="thinking-icon" />
          <span className="thinking-label">{t("chat.thinking") || "Thinking"}</span>
          {wordCount > 0 && (
            <span className="thinking-badge">
              {wordCount} {wordCount === 1 ? "word" : "words"}
            </span>
          )}
        </div>

        {open && (
          <button
            type="button"
            className="thinking-copy-btn"
            onClick={handleCopy}
            title="Copy thought process"
            aria-label="Copy thought process"
          >
            {copied ? (
              <>
                <Check size={11} className="thinking-copy-check" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy size={11} />
                <span>Copy</span>
              </>
            )}
          </button>
        )}
      </div>

      {open && (
        <div className="thinking-body">
          <div className="thinking-text">{text}</div>
        </div>
      )}
    </div>
  );
}
