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
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="input-area">
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
        className="chat-input"
      />
      {isStreaming ? (
        <button type="button" onClick={abort} className="btn btn-abort">
          Abort
        </button>
      ) : (
        <button type="submit" className="btn btn-send">
          Send
        </button>
      )}
    </form>
  );
}
