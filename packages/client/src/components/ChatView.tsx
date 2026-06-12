import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSessionStore } from "../stores/session-store";
import { ToolGroup } from "./ToolGroup";

interface Props {
  sessionId: string;
}

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  output?: string;
  toolCallId?: string;
  isError?: boolean;
  toolName?: string;
  content?: unknown;
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
  return content.filter((b: ContentBlock) => b.type === "tool_use" || b.type === "toolCall");
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

/** A turn is: user message → 0+ assistant/toolResult messages */
interface Turn {
  userMsg: Record<string, unknown>;
  responses: Record<string, unknown>[];
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

  // Group messages into turns (user → assistant/toolResult)
  const turns: Turn[] = useMemo(() => {
    const result: Turn[] = [];
    for (const msg of messages) {
      const m = msg as Record<string, unknown>;
      const role = m.role as string;
      if (role === "user") {
        result.push({ userMsg: m, responses: [] });
      } else if (result.length > 0) {
        result[result.length - 1].responses.push(m);
      } else {
        // Orphan assistant/toolResult message (before any user msg)
        result.push({ userMsg: {}, responses: [m] });
      }
    }
    return result;
  }, [messages]);

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

      {/* Turns */}
      {turns.map((turn, ti) => {
        const isLastTurn = ti === turns.length - 1;

        // ── Extract tools from this turn ──
        const tools: Array<{
          type: "tool_call" | "tool_result";
          name: string;
          status: "running" | "done" | "error";
          input?: unknown;
          output?: string;
          isError?: boolean;
        }> = [];

        let finalText = "";
        let hasFinalText = false;

        for (const resp of turn.responses) {
          const role = resp.role as string;
          const content = resp.content;

          if (role === "assistant") {
            // Extract tool calls
            const toolCalls = getToolCalls(content);
            for (const tc of toolCalls) {
              tools.push({
                type: "tool_call",
                name: tc.name ?? tc.toolName ?? "tool",
                status: "done",
                input: tc.input,
              });
            }
            // Accumulate text (only the last text should show)
            const text = extractText(content);
            if (text.length > 0) {
              finalText = text;
              hasFinalText = true;
            }
          }

          if (role === "toolResult" || role === "tool") {
            const toolName = (resp.toolName as string) ?? (resp.name as string) ?? "tool";
            const isErr = resp.isError === true;
            const output = extractText(content);

            // Match with existing tool call or add as standalone
            const existingIdx = tools.findIndex(
              (t) => t.type === "tool_call" && t.name === toolName,
            );
            if (existingIdx >= 0) {
              // Replace the tool call entry with a result
              tools[existingIdx] = {
                type: "tool_result",
                name: toolName,
                status: isErr ? "error" : "done",
                output,
                isError: isErr,
              };
            } else {
              // Standalone tool result (no prior tool call seen)
              tools.push({
                type: "tool_result",
                name: toolName,
                status: isErr ? "error" : "done",
                output,
                isError: isErr,
              });
            }
          }
        }

        // For the streaming turn, add active tool
        if (isLastTurn && isStreaming && activeToolName) {
          const streamingToolName = activeToolName;
          if (!tools.find((t) => t.type === "tool_call" && t.name === streamingToolName)) {
            tools.push({
              type: "tool_call",
              name: streamingToolName,
              status: "running",
            });
          }
        }

        return (
          <div key={ti} style={{ marginBottom: 12 }}>
            {/* User message */}
            {turn.userMsg.role === "user" && (
              <div className="message-row user">
                <div className="message-bubble user">
                  {extractText(turn.userMsg.content)}
                </div>
              </div>
            )}

            {/* Tool group */}
            {tools.length > 0 && (
              <div className="message-row assistant">
                <div style={{ maxWidth: "80%", width: "100%" }}>
                  <ToolGroup
                    tools={tools}
                    isStreaming={isLastTurn && isStreaming}
                  />
                </div>
              </div>
            )}

            {/* Final text response (after tools) */}
            {hasFinalText && (
              <div className="message-row assistant">
                <div className="message-bubble assistant">
                  <MarkdownContent text={finalText} />
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Streaming message (when no turns built yet or text-only response) */}
      {isStreaming && streamText.length > 0 && (
        <div className="message-row assistant">
          <div
            className="message-bubble assistant"
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            <MarkdownContent text={streamText} />
            <span className="streaming-cursor">▊</span>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
