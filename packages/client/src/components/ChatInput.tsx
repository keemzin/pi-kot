import { type FormEvent, useRef, useEffect } from "react";
import { useSessionStore } from "../stores/session-store";

interface Props {
  sessionId: string;
  showOrch?: boolean;
  setShowOrch?: (v: boolean) => void;
}

export function ChatInput({ sessionId, showOrch, setShowOrch }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useSessionStore((s) => s.streamState.isStreaming);
  const sendPrompt = useSessionStore((s) => s.sendPrompt);
  const abort = useSessionStore((s) => s.abort);

  useEffect(() => {
    const el = textareaRef.current;
    if (el !== null) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const el = textareaRef.current;
    if (el === null) return;
    const text = el.value.trim();
    if (text.length === 0) return;
    el.value = "";
    el.style.height = "auto";
    sendPrompt(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="ti-area">
      <div className="ti-left">
        <button
          type="button"
          className="ti-icon-btn"
          onClick={() => setShowOrch?.(!showOrch)}
          title="Orchestration (supervisor mode)"
          tabIndex={-1}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" style={{ fill: showOrch ? "currentColor" : "none" }} />
          </svg>
        </button>
      </div>
      <div className="ti-bubble">
        <textarea
          ref={textareaRef}
          className="ti-input"
          onKeyDown={handleKeyDown}
          onInput={() => {
            const el = textareaRef.current;
            if (el !== null) {
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
            }
          }}
          placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
          disabled={isStreaming}
          rows={1}
        />
      </div>
      <div className="ti-actions">
        {isStreaming ? (
          <button type="button" onClick={abort} className="ti-abort-btn" title="Abort" tabIndex={-1}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
          </button>
        ) : (
          <button type="submit" className="ti-send-btn" title="Send" tabIndex={-1}>
            <span className="ti-send-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </span>
          </button>
        )}
      </div>
    </form>
  );
}
