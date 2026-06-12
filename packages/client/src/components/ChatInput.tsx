import { type FormEvent, useRef, useEffect } from "react";
import { useSessionStore } from "../stores/session-store";

interface Props {
  sessionId: string;
}

export function ChatInput({ sessionId }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useSessionStore((s) => s.streamState.isStreaming);
  const sendPrompt = useSessionStore((s) => s.sendPrompt);
  const abort = useSessionStore((s) => s.abort);

  // Auto-resize textarea
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
    // Ctrl/Cmd + Enter to send
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        gap: "8px",
        padding: "12px",
        borderTop: "1px solid #e0e0e0",
        background: "#fff",
      }}
    >
      <textarea
        ref={textareaRef}
        onKeyDown={handleKeyDown}
        onInput={() => {
          const el = textareaRef.current;
          if (el !== null) {
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
          }
        }}
        placeholder="Type a message... (Ctrl+Enter to send)"
        disabled={isStreaming}
        rows={1}
        style={{
          flex: 1,
          resize: "none",
          borderRadius: "8px",
          border: "1px solid #d0d0d0",
          padding: "10px 12px",
          fontSize: "14px",
          fontFamily: "inherit",
          lineHeight: "1.4",
          outline: "none",
        }}
      />
      {isStreaming ? (
        <button
          type="button"
          onClick={abort}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            border: "1px solid #e74c3c",
            background: "#e74c3c",
            color: "#fff",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "14px",
            whiteSpace: "nowrap",
          }}
        >
          Abort
        </button>
      ) : (
        <button
          type="submit"
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            border: "1px solid #4a90d9",
            background: "#4a90d9",
            color: "#fff",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "14px",
            whiteSpace: "nowrap",
          }}
        >
          Send
        </button>
      )}
    </form>
  );
}
