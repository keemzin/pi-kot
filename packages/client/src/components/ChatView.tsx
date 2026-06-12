import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSessionStore } from "../stores/session-store";
import { ToolGroup } from "./ToolGroup";

interface Props {
  sessionId: string;
  modelName?: string;
  providerName?: string;
}

interface ToolCallBlock {
  type?: string;
  id?: string;
  name?: string;
  tool?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  input?: Record<string, unknown>;
}

interface ToolResultMsg {
  role?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  content?: unknown;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: Record<string, unknown>) => {
        const t = block.type as string;
        if (t === "text") return (block.text as string) ?? "";
        if (t === "thinking" || t === "reasoning") return (block.thinking as string) ?? (block.reasoning as string) ?? "";
        return "";
      })
      .join("");
  }
  return String(content ?? "");
}

/** Extract only the final text (after the last toolCall), for display outside the trail. */
function extractFinalText(content: unknown): string {
  if (!Array.isArray(content)) return extractText(content);
  const textParts: string[] = [];
  let afterLastTool = false;
  // Walk content blocks in reverse to find last toolCall
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i] as Record<string, unknown>;
    if ((block.type as string) === "toolCall") {
      afterLastTool = true;
      break; // found the last tool call — everything after this point is final text
    }
  }
  if (!afterLastTool) {
    // No tool calls — just return all text
    return extractText(content);
  }
  // Collect text blocks that appear after the last toolCall
  let foundLastTool = false;
  for (const block of content) {
    const b = block as Record<string, unknown>;
    if ((b.type as string) === "toolCall") {
      foundLastTool = true;
      continue;
    }
    if (foundLastTool && (b.type as string) === "text") {
      textParts.push((b.text as string) ?? "");
    }
  }
  return textParts.join("");
}

function getToolCalls(content: unknown): ToolCallBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter((b: ToolCallBlock) => b.type === "tool_use" || b.type === "toolCall");
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

export function ChatView({ sessionId, modelName, providerName }: Props & { modelName?: string; providerName?: string }) {
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
        // Map from toolCallId → tool call info (for matching results)
        const toolCallMap = new Map<string, {
          name: string;
          arguments?: Record<string, unknown>;
        }>();

        // Ordered list of unique tool invocations in this turn
        interface ToolEntry {
          type: "tool_call" | "tool_result";
          callId: string;
          name: string;
          status: "running" | "done" | "error";
          input?: unknown;
          output?: string;
          isError?: boolean;
        }
        const tools: ToolEntry[] = [];

        // Track insertion order via callId
        const toolOrder: string[] = [];

        for (const resp of turn.responses) {
          const role = resp.role as string;
          const content = resp.content;

          if (role === "assistant") {
            // Extract tool calls from content blocks
            if (Array.isArray(content)) {
              for (const block of content as ToolCallBlock[]) {
                if (block.type === "toolCall" || block.type === "tool_use") {
                  const callId = block.id ?? `call_${tools.length}`;
                  const name = block.name ?? block.tool ?? block.toolName ?? "tool";
                  const args = block.arguments ?? block.input ?? {};
                  toolCallMap.set(callId, { name, arguments: args as Record<string, unknown> });
                  if (!toolOrder.includes(callId)) {
                    toolOrder.push(callId);
                  }
                  tools.push({
                    type: "tool_call",
                    callId,
                    name,
                    status: "done",
                    input: args,
                  });
                }
              }
            }
          }

          if (role === "toolResult" || role === "tool") {
            const callId = (resp.toolCallId as string) ?? "";
            const toolName = (resp.toolName as string) ?? (resp.name as string) ?? "tool";
            const isErr = resp.isError === true;
            const output = extractText(content);

            // Try to match by callId first
            const existingByCallId = callId
              ? tools.findIndex((t) => t.callId === callId)
              : -1;

            if (existingByCallId >= 0) {
              tools[existingByCallId] = {
                ...tools[existingByCallId],
                type: "tool_result",
                status: isErr ? "error" : "done",
                output,
                isError: isErr,
              };
            } else {
              // Fallback: match by name
              const existingByName = tools.findIndex(
                (t) => t.type === "tool_call" && t.name === toolName,
              );
              if (existingByName >= 0) {
                tools[existingByName] = {
                  ...tools[existingByName],
                  type: "tool_result",
                  status: isErr ? "error" : "done",
                  output,
                  isError: isErr,
                };
              } else {
                // Standalone tool result with a generated callId
                const genCallId = callId || `result_${tools.length}`;
                if (!toolOrder.includes(genCallId)) toolOrder.push(genCallId);
                tools.push({
                  type: "tool_result",
                  callId: genCallId,
                  name: toolName,
                  status: isErr ? "error" : "done",
                  output,
                  isError: isErr,
                });
              }
            }
          }
        }

        // For the streaming turn, add active tool
        if (isLastTurn && isStreaming && activeToolName) {
          const exists = tools.some((t) => t.callId === activeToolName || t.name === activeToolName);
          if (!exists) {
            const genCallId = `streaming_${activeToolName}_${Date.now()}`;
            toolOrder.push(genCallId);
            tools.push({
              type: "tool_call",
              callId: genCallId,
              name: activeToolName,
              status: "running",
            });
          }
        }

        // Sort tools by insertion order
        tools.sort((a, b) => toolOrder.indexOf(a.callId) - toolOrder.indexOf(b.callId));

        // ── Extract final text for this turn (text after last toolCall) ──
        let finalText = "";
        for (const resp of turn.responses) {
          if (resp.role === "assistant") {
            const t = extractFinalText(resp.content);
            if (t.length > 0) finalText = t;
          }
        }

        // Also include streaming text for the last turn
        if (isLastTurn && isStreaming && streamText.length > 0) {
          finalText = streamText;
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

            {/* Tool group (only if there are tool calls or results) */}
            {tools.length > 0 && (
              <div className="message-row assistant">
                <div style={{ maxWidth: "80%", width: "100%" }}>
                  <ToolGroup
                    tools={tools}
                    isStreaming={isLastTurn && isStreaming}
                    modelName={modelName}
                    providerName={providerName}
                  />
                </div>
              </div>
            )}

            {/* Final text response (after tools) */}
            {finalText.length > 0 && (
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
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", display: "flex", flexDirection: "column", gap: 6 }}
          >
            {activeToolName && (
              <div className="tool-badge" style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: "0.75rem", color: "var(--accent)",
                background: "rgba(237,180,73,0.12)",
                border: "1px solid rgba(237,180,73,0.25)",
                borderRadius: 4, padding: "2px 8px", alignSelf: "flex-start",
              }}>
                <span style={{
                  display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                  background: "var(--accent)", animation: "pulse 1s ease-in-out infinite",
                }} />
                {activeToolName}
              </div>
            )}
            <MarkdownContent text={streamText} />
            <span className="streaming-cursor">▊</span>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
