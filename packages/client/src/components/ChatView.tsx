import { type ReactNode, useEffect, useRef } from "react";
import { useSessionStore } from "../stores/session-store";

interface Props {
  sessionId: string;
}

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  toolCallId?: string;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: ContentBlock) => (block.type === "text" ? block.text ?? "" : ""))
      .join("");
  }
  return String(content ?? "");
}

function getToolCalls(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter((b: ContentBlock) => b.type === "tool_use");
}

/** Collapsible tool call chip — shows name only by default. */
function ToolCallChip({ name, input }: { name: string; input?: Record<string, unknown> }) {
  const inputPreview =
    input !== undefined ? JSON.stringify(input).slice(0, 300) : undefined;

  return (
    <details
      style={{
        borderRadius: "6px",
        background: "#e3f2fd",
        fontSize: "12px",
        fontFamily: "monospace",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          padding: "6px 10px",
          color: "#1565c0",
          fontWeight: 600,
          userSelect: "none",
        }}
      >
        🔧 {name}
      </summary>
      {inputPreview !== undefined && (
        <div
          style={{
            padding: "0 10px 6px",
            color: "#0d47a1",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {inputPreview}
        </div>
      )}
    </details>
  );
}

/** Collapsible tool result card — shows name + status by default. */
function ToolResultCard({
  toolName,
  isError,
  content,
}: {
  toolName: string;
  isError: boolean;
  content: string;
}) {
  return (
    <details
      style={{
        borderRadius: "8px",
        background: isError ? "#fff5f5" : "#f8f9fa",
        border: `1px solid ${isError ? "#f5c6cb" : "#e0e0e0"}`,
        fontSize: "13px",
        fontFamily: "monospace",
        lineHeight: "1.4",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          padding: "8px 12px",
          color: isError ? "#721c24" : "#555",
          fontWeight: 600,
          userSelect: "none",
        }}
      >
        {isError ? "⚠️" : "🔧"} {toolName}
        <span style={{ fontWeight: 400, marginLeft: "8px", color: "#999" }}>
          {content.length > 0 ? `${content.length} chars` : "done"}
        </span>
      </summary>
      {content.length > 0 && (
        <div
          style={{
            padding: "0 12px 8px",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: isError ? "#721c24" : "#555",
          }}
        >
          {content.slice(0, 2000)}
          {content.length > 2000 ? "…" : ""}
        </div>
      )}
    </details>
  );
}

export function ChatView({ sessionId }: Props) {
  const messages = useSessionStore((s) => s.messages);
  const streamText = useSessionStore((s) => s.streamState.text);
  const isStreaming = useSessionStore((s) => s.streamState.isStreaming);
  const activeToolName = useSessionStore((s) => s.streamState.activeToolName);
  const error = useSessionStore((s) => s.error);
  const clearError = useSessionStore((s) => s.clearError);

  const bottomRef = useRef<HTMLDivElement>(null);

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
      {/* Error banner */}
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

      {/* Empty state */}
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

      {/* Message list */}
      {messages.map((msg, i) => {
        const m = msg as Record<string, unknown>;
        const role = m.role as string;
        const content = m.content;

        // ── User message ──
        if (role === "user") {
          return (
            <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
              <div
                style={{
                  maxWidth: "80%",
                  padding: "10px 14px",
                  borderRadius: "12px",
                  background: "#4a90d9",
                  color: "#fff",
                  fontSize: "14px",
                  lineHeight: "1.5",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {extractText(content)}
              </div>
            </div>
          );
        }

        // ── Tool result (collapsible) ──
        if (role === "toolResult" || role === "tool") {
          const toolName = (m.toolName as string) ?? (m.name as string) ?? "tool";
          const isError = m.isError === true;
          const resultText = extractText(content);

          return (
            <div key={i} style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{ maxWidth: "80%", width: "100%" }}>
                <ToolResultCard
                  toolName={toolName}
                  isError={isError}
                  content={resultText}
                />
              </div>
            </div>
          );
        }

        // ── Assistant message ──
        if (role === "assistant") {
          const text = extractText(content);
          const toolCalls = getToolCalls(content);

          if (text.length === 0 && toolCalls.length === 0) return null;

          return (
            <div key={i} style={{ display: "flex", justifyContent: "flex-start" }}>
              <div
                style={{
                  maxWidth: "80%",
                  padding: "10px 14px",
                  borderRadius: "12px",
                  background: "#f0f0f0",
                  color: "#333",
                  fontSize: "14px",
                  lineHeight: "1.5",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                {text.length > 0 && (
                  <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {text}
                  </div>
                )}
                {toolCalls.map((tc, j) => (
                  <ToolCallChip
                    key={j}
                    name={tc.name ?? "tool"}
                    input={tc.input as Record<string, unknown> | undefined}
                  />
                ))}
              </div>
            </div>
          );
        }

        return null;
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
              <div
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
              </div>
            )}
            {streamText}
            <span style={{ animation: "blink 1s infinite" }}>▊</span>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
