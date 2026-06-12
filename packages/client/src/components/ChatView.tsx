import { useEffect, useRef } from "react";
import { useSessionStore } from "../stores/session-store";

interface Props {
  sessionId: string;
}

function formatContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: Record<string, unknown>) => {
        if (block.type === "text") return String(block.text ?? "");
        if (block.type === "tool_use") return `🔧 Tool: ${block.name ?? "unknown"}`;
        return "";
      })
      .join("\n");
  }
  return String(content ?? "");
}

export function ChatView({ sessionId }: Props) {
  const messages = useSessionStore((s) => s.messages);
  const streamText = useSessionStore((s) => s.streamState.text);
  const isStreaming = useSessionStore((s) => s.streamState.isStreaming);
  const activeToolName = useSessionStore((s) => s.streamState.activeToolName);
  const error = useSessionStore((s) => s.error);
  const clearError = useSessionStore((s) => s.clearError);

  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      {error !== undefined && (
        <div
          onClick={clearError}
          style={{
            padding: "8px 12px",
            background: "#fff3cd",
            border: "1px solid #ffc107",
            borderRadius: "8px",
            color: "#856404",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          {error} — click to dismiss
        </div>
      )}

      {messages.length === 0 && !isStreaming && (
        <div
          style={{
            textAlign: "center",
            color: "#999",
            padding: "40px 20px",
            fontSize: "14px",
          }}
        >
          <p style={{ fontSize: "24px", margin: "0 0 8px" }}>pi-kot</p>
          <p>Send a message to start chatting with the coding agent.</p>
        </div>
      )}

      {messages.map((msg, i) => {
        const m = msg as Record<string, unknown>;
        const isUser = m.role === "user";
        const isAssistant = m.role === "assistant" || m.role === "toolResult";
        // Skip tool results in simple view
        if (m.role === "toolResult") return null;

        return (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: isUser ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "80%",
                padding: "10px 14px",
                borderRadius: "12px",
                background: isUser ? "#4a90d9" : "#f0f0f0",
                color: isUser ? "#fff" : "#333",
                fontSize: "14px",
                lineHeight: "1.5",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {formatContent(m.content)}
            </div>
          </div>
        );
      })}

      {/* Streaming message */}
      {isStreaming && (
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <div
            style={{
              maxWidth: "80%",
              padding: "10px 14px",
              borderRadius: "12px",
              background: "#f0f0f0",
              color: "#333",
              fontSize: "14px",
              lineHeight: "1.5",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {activeToolName !== undefined && (
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  marginBottom: "6px",
                  borderRadius: "4px",
                  background: "#e3f2fd",
                  color: "#1565c0",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                🔧 {activeToolName}
              </span>
            )}
            {streamText}
            <span className="cursor-blink" style={{ animation: "blink 1s infinite" }}>
              ▊
            </span>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
