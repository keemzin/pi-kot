import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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

/** Code block component with copy button. */
function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = typeof children === "string" ? children : "";
  const lang = className?.replace("language-", "") ?? "";

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [code]);

  return (
    <div className="code-block-wrapper" style={{
      position: "relative",
      margin: "8px 0",
      borderRadius: "var(--radius)",
      overflow: "hidden",
      border: "1px solid var(--border)",
      background: "rgba(0,0,0,0.25)",
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "6px 12px",
        background: "var(--bg-glass)",
        borderBottom: "1px solid var(--border)",
        fontSize: "11px",
        color: "var(--text-dim)",
        fontFamily: "'SF Mono','Menlo','Monaco',monospace",
      }}>
        <span>{lang || "code"}</span>
        <button
          onClick={handleCopy}
          style={{
            background: "none",
            border: "none",
            color: copied ? "var(--success)" : "var(--text-dim)",
            cursor: "pointer",
            fontSize: "11px",
            padding: "2px 8px",
            borderRadius: "var(--radius-sm)",
            fontFamily: "inherit",
            transition: "color 0.15s",
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre style={{
        padding: "12px",
        overflowX: "auto",
        fontFamily: "'SF Mono','Menlo','Monaco',monospace",
        fontSize: "12px",
        lineHeight: 1.6,
        margin: 0,
        border: "none",
        borderRadius: 0,
      }}>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

/** Render markdown text with proper components. */
function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const isInline = !className;
            if (isInline) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return <CodeBlock className={className}>{children}</CodeBlock>;
          },
          // Open links in new tab
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function ToolCallChip({ name, input }: { name: string; input?: Record<string, unknown> }) {
  const inputPreview =
    input !== undefined ? JSON.stringify(input).slice(0, 300) : undefined;

  return (
    <details className="tool-call-chip">
      <summary>🔧 {name}</summary>
      {inputPreview !== undefined && (
        <div className="tool-call-input">{inputPreview}</div>
      )}
    </details>
  );
}

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
      className="tool-result"
      style={{ borderColor: isError ? "rgba(248,113,113,0.25)" : undefined }}
    >
      <summary style={{ color: isError ? "var(--error)" : undefined }}>
        {isError ? "⚠️" : "🔧"} {toolName}
        <span style={{ fontWeight: 400, marginLeft: "8px", opacity: 0.6 }}>
          {content.length > 0 ? `${content.length} chars` : "done"}
        </span>
      </summary>
      {content.length > 0 && (
        <div
          className="tool-result-content"
          style={{ color: isError ? "var(--error)" : undefined }}
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
    <div className="messages-container">
      {/* Error banner */}
      {error !== undefined && (
        <div onClick={clearError} className="error-banner">
          {error} — click to dismiss
        </div>
      )}

      {/* Empty state */}
      {messages.length === 0 && !isStreaming && (
        <div className="welcome" style={{ paddingTop: "80px" }}>
          <div className="welcome-icon">💬</div>
          <div className="welcome-text">Send a message to start chatting</div>
          <div className="welcome-hint">with the pi coding agent</div>
        </div>
      )}

      {/* Message list */}
      {messages.map((msg, i) => {
        const m = msg as Record<string, unknown>;
        const role = m.role as string;
        const content = m.content;

        // ── User message (plain text) ──
        if (role === "user") {
          return (
            <div key={i} className="message-row user">
              <div className="message-bubble user">{extractText(content)}</div>
            </div>
          );
        }

        // ── Tool result (collapsible) ──
        if (role === "toolResult" || role === "tool") {
          const toolName = (m.toolName as string) ?? (m.name as string) ?? "tool";
          const isError = m.isError === true;
          const resultText = extractText(content);

          return (
            <div key={i} className="message-row assistant">
              <div style={{ maxWidth: "80%", width: "100%" }}>
                <ToolResultCard toolName={toolName} isError={isError} content={resultText} />
              </div>
            </div>
          );
        }

        // ── Assistant message (rendered markdown) ──
        if (role === "assistant") {
          const text = extractText(content);
          const toolCalls = getToolCalls(content);

          if (text.length === 0 && toolCalls.length === 0) return null;

          return (
            <div key={i} className="message-row assistant">
              <div
                className="message-bubble assistant"
                style={{ display: "flex", flexDirection: "column", gap: "6px" }}
              >
                {text.length > 0 && <MarkdownContent text={text} />}
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

      {/* Streaming message (rendered markdown too) */}
      {isStreaming && (
        <div className="message-row assistant">
          <div
            className="message-bubble assistant"
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {activeToolName !== undefined && (
              <div className="tool-badge">🔧 {activeToolName}</div>
            )}
            {streamText.length > 0 ? (
              <MarkdownContent text={streamText} />
            ) : null}
            <span className="streaming-cursor">▊</span>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
