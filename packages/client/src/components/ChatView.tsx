import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSessionStore } from "../stores/session-store";
import {
  buildToolCallPairing,
  splitAssistantToolSegments,
  isPairedToolResult,
  getToolCallId,
  toolPreviewFromArgs,
  countDiffLines,
  type PairableMessage,
  type ToolCallPairing,
  type ToolBatchEntry,
  type AssistantRenderSegment,
} from "../lib/tool-call-pairing";

interface Props {
  sessionId: string;
  modelName?: string;
  providerName?: string;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: Record<string, unknown>) => {
        const t = block.type as string;
        if (t === "text") return (block.text as string) ?? "";
        if (t === "thinking" || t === "reasoning") return "";
        return "";
      })
      .join("");
  }
  return String(content ?? "");
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

/* ── Tool Call Components (ported from forge) ── */

/** Extract filename from a toolResult message's details. */
function extractFilename(result: PairableMessage): string | undefined {
  if (typeof result.details === "object" && result.details !== null) {
    const d = result.details as Record<string, unknown>;
    if (typeof d.filename === "string") return d.filename;
    if (typeof d.filePath === "string") return d.filePath;
  }
  return undefined;
}

/** Render the thinking block content. */
function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      style={{
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border)",
        padding: "4px 10px",
        fontSize: "12px",
        color: "var(--text-dim)",
      }}
    >
      <summary
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        style={{ cursor: "pointer", userSelect: "none", color: "var(--text-secondary)" }}
      >
        {open ? "▾" : "▸"} Thinking…
      </summary>
      {open && (
        <pre style={{
          marginTop: 4, whiteSpace: "pre-wrap", wordBreak: "break-word",
          fontFamily: "inherit", fontSize: "12px", color: "var(--text-dim)",
        }}>
          {text}
        </pre>
      )}
    </details>
  );
}

/** Render a diff block. */
function DiffBlock({ diff, filename, adds, dels }: {
  diff: string; filename?: string; adds: number; dels: number;
}) {
  return (
    <details className="tool-result" style={{ animation: "toolFadeIn 0.25s ease-out" }}>
      <summary>
        <span style={{ fontWeight: 400, opacity: 0.6 }}>edit</span>
        {filename && <span style={{ marginLeft: 6, fontFamily: "'SF Mono','Menlo','Monaco',monospace" }}>{filename}</span>}
        <span style={{ marginLeft: 8, color: "var(--success)" }}>+{adds}</span>
        <span style={{ marginLeft: 4, color: "var(--error)" }}>−{dels}</span>
      </summary>
      <div className="tool-result-content">
        <pre style={{ fontSize: "11px", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {diff}
        </pre>
      </div>
    </details>
  );
}

/** Render a single tool call + its result. */
function ToolCallEntry({
  block,
  result,
}: {
  block: Record<string, unknown>;
  result: PairableMessage | undefined;
}) {
  const [inputOpen, setInputOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const name = String(block.name ?? "tool");
  const args = block.arguments ?? block.input ?? {};
  const argsText = typeof args === "string" ? args : JSON.stringify(args, null, 2);

  const isError = result?.isError === true;
  const resultContent = Array.isArray(result?.content) ? result?.content : [];
  const outputText = resultContent
    .filter((c): c is { type: "text"; text: string } => {
      const o = c as { type?: unknown; text?: unknown };
      return o.type === "text" && typeof o.text === "string";
    })
    .map((c) => c.text)
    .join("\n");

  // Edit tool renders as a diff
  const editDiff =
    name === "edit" && result !== undefined
      ? (() => {
          const d = (result.details as { diff?: unknown } | undefined)?.diff;
          return typeof d === "string" ? d : outputText;
        })()
      : undefined;
  const editFn = name === "edit" && result !== undefined ? extractFilename(result) : undefined;
  const editStats = editDiff !== undefined ? countDiffLines(editDiff) : undefined;

  const preview = toolPreviewFromArgs(name, args);

  // Single-line header appearance
  const borderColor = result === undefined
    ? "var(--accent)"
    : isError
    ? "var(--error)"
    : "var(--border)";

  if (name === "edit" && editDiff !== undefined) {
    return (
      <DiffBlock
        diff={editDiff}
        filename={editFn ?? extractFilename(result!)}
        adds={editStats?.adds ?? 0}
        dels={editStats?.dels ?? 0}
      />
    );
  }

  return (
    <div className="tool-call-chip" style={{
      borderColor,
      animation: "toolFadeIn 0.25s ease-out",
    }}>
      {/* Header */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "6px 10px",
          cursor: "default", userSelect: "none",
          fontSize: "12px",
        }}
      >
        <span style={{
          width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
          background: result === undefined ? "var(--accent)" : isError ? "var(--error)" : "var(--text-dim)",
          animation: result === undefined ? "pulse 1s ease-in-out infinite" : undefined,
        }} />
        <span style={{ fontWeight: 600, color: "var(--tool-accent-text)" }}>{name}</span>
        {preview && (
          <span style={{
            color: "var(--text-dim)", overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap",
            flex: 1, minWidth: 0,
          }} title={preview}>
            {preview}
          </span>
        )}
        {result === undefined && (
          <span style={{ fontSize: "10px", color: "var(--accent)" }}>running…</span>
        )}
      </div>

      {/* Input (collapsible) */}
      <div style={{ padding: "0 10px" }}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setInputOpen((o) => !o)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setInputOpen((o) => !o); }}
          style={{ cursor: "pointer", userSelect: "none", padding: "2px 0", fontSize: "11px", color: "var(--text-dim)" }}
        >
          {inputOpen ? "▾" : "▸"} Input
        </div>
        {inputOpen && (
          <pre style={{
            fontSize: "11px", margin: 0, padding: "4px 0 6px",
            whiteSpace: "pre-wrap", wordBreak: "break-all",
            color: "var(--tool-accent-text)",
          }}>
            {argsText.length > 2000 ? argsText.slice(0, 2000) + "\n…(truncated)" : argsText}
          </pre>
        )}
      </div>

      {/* Output (collapsible) */}
      {result !== undefined && outputText.length > 0 && (
        <div style={{ padding: "0 10px 6px" }}>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setOutputOpen((o) => !o)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOutputOpen((o) => !o); }}
            style={{ cursor: "pointer", userSelect: "none", padding: "2px 0", fontSize: "11px", color: isError ? "var(--error)" : "var(--text-dim)" }}
          >
            {outputOpen ? "▾" : "▸"} {isError ? "Error" : "Output"}
          </div>
          {outputOpen && (
            <pre style={{
              fontSize: "11px", margin: 0, padding: "4px 0 0",
              whiteSpace: "pre-wrap", wordBreak: "break-all",
              maxHeight: 200, overflow: "auto",
              color: isError ? "var(--error)" : "var(--tool-accent-text)",
            }}>
              {outputText.length > 4000 ? outputText.slice(0, 4000) + "\n…(truncated)" : outputText}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** Render a batch of tool calls in a single collapsible card. */
function ToolCallBatchCard({ entries }: { entries: ToolBatchEntry[] }) {
  const [open, setOpen] = useState(false);
  const toolEntries = entries.filter((entry) => entry.kind === "tool");
  const toolCount = toolEntries.length;
  const inFlight = toolEntries.filter((e) => e.result === undefined).length;
  const errored = toolEntries.some((e) => e.result?.isError === true);

  // Summary: "bash ×2 · read ×1"
  const counts = new Map<string, number>();
  for (const e of toolEntries) {
    const name = String(e.block.name ?? "tool");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const countSummary = [...counts].map(([name, count]) => `${name} ×${count}`).join(" · ");

  // Preview first 3 tools
  const previews = toolEntries
    .map((e) => {
      const name = String(e.block.name ?? "tool");
      const args = e.block.arguments ?? e.block.input ?? {};
      const preview = toolPreviewFromArgs(name, args);
      return preview === undefined ? name : `${name}: ${preview}`;
    })
    .slice(0, 3);

  return (
    <details
      open={open}
      className="tool-call-chip"
      style={{ animation: "toolFadeIn 0.25s ease-out" }}
    >
      <summary
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        style={{ cursor: "pointer" }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          flexWrap: "wrap", width: "100%",
        }}>
          <span style={{ color: "var(--text-dim)" }}>→</span>
          <span style={{ fontWeight: 600, color: "var(--tool-accent-text)" }}>tools</span>
          <span style={{ color: "var(--text-dim)", fontSize: "11px" }}>
            ×{toolCount} {toolCount === 1 ? "call" : "calls"}
          </span>
          {countSummary && (
            <span style={{
              color: "var(--text-dim)", fontSize: "11px",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              flex: 1, minWidth: 0,
            }} title={countSummary}>
              {countSummary}
            </span>
          )}
          {inFlight > 0 && (
            <span style={{
              fontSize: "10px", color: "var(--accent)",
              background: "var(--bg-glass)",
              borderRadius: "var(--radius-sm)", padding: "1px 6px",
              textTransform: "uppercase", letterSpacing: "0.5px",
            }}>
              {inFlight} running…
            </span>
          )}
          {errored && (
            <span style={{
              fontSize: "10px", color: "var(--error)",
              background: "rgba(248,113,113,0.1)",
              borderRadius: "var(--radius-sm)", padding: "1px 6px",
              textTransform: "uppercase", letterSpacing: "0.5px",
            }}>
              error
            </span>
          )}
        </div>
        {previews.length > 0 && (
          <div style={{
            fontSize: "10px", color: "var(--text-dim)", marginTop: 2,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            fontFamily: "'SF Mono','Menlo','Monaco',monospace",
          }}>
            {previews.join(" · ")}
            {toolCount > previews.length && " · …"}
          </div>
        )}
      </summary>
      <div style={{
        borderTop: "1px solid var(--border)", padding: "8px 10px",
        display: "flex", flexDirection: "column", gap: 6,
      }}>
        {entries.map((entry, j) =>
          entry.kind === "thinking" ? (
            <ThinkingBlock key={j} text={entry.block.thinking as string ?? ""} />
          ) : (
            <ToolCallEntry key={j} block={entry.block} result={entry.result} />
          ),
        )}
      </div>
    </details>
  );
}

/** Render an assistant prose/thinking block. */
function AssistantBlock({ block }: { block: Record<string, unknown> }) {
  const type = block.type;
  if (type === "text" && typeof block.text === "string") {
    return <MarkdownContent text={block.text} />;
  }
  if (type === "thinking" && typeof block.thinking === "string") {
    return <ThinkingBlock text={block.thinking} />;
  }
  return null;
}

/** Choose rendering strategy for an assistant render segment. */
function AssistantRenderSegmentView({
  segment,
}: {
  segment: AssistantRenderSegment;
}) {
  if (segment.kind === "assistant" && segment.content !== undefined) {
    const blocks = segment.content;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {blocks.map((block: Record<string, unknown>, i: number) => (
          <AssistantBlock key={i} block={block} />
        ))}
      </div>
    );
  }

  // Tools segment
  const entries = segment.entries;
  if (!entries) return null;
  const toolEntry = entries.find((entry: ToolBatchEntry) => entry.kind === "tool");
  const hasThinking = entries.some((entry: ToolBatchEntry) => entry.kind === "thinking");
  const toolCount = entries.filter((e: ToolBatchEntry) => e.kind === "tool").length;

  // Single tool without thinking → use ToolCallEntry directly
  if (toolCount === 1 && !hasThinking && toolEntry !== undefined) {
    return <ToolCallEntry block={toolEntry.block} result={toolEntry.result} />;
  }

  // Multiple tools or tool + thinking → use batch card
  return <ToolCallBatchCard entries={entries} />;
}

/* ── Main ChatView ── */

export function ChatView({ sessionId, modelName, providerName }: Props) {
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

  // Build tool pairing once per render cycle
  const pairing = useMemo(() => buildToolCallPairing(messages as PairableMessage[]), [messages]);

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
      {(() => {
        const { toolResultsById } = pairing;
        const out: React.ReactNode[] = [];
        let pendingBatch: ToolBatchEntry[] = [];
        let pendingBatchStartIndex = 0;
        let renderedBatchSerial = 0;

        const renderToolEntries = (entries: ToolBatchEntry[], key: string): React.ReactNode => {
          const toolCount = entries.filter((e) => e.kind === "tool").length;
          const toolEntry = entries.find((entry) => entry.kind === "tool");
          const hasThinking = entries.some((entry) => entry.kind === "thinking");
          if (toolCount === 1 && !hasThinking && toolEntry !== undefined) {
            return <ToolCallEntry key={key} block={toolEntry.block} result={toolEntry.result} />;
          }
          return <ToolCallBatchCard key={key} entries={entries} />;
        };

        const flushPendingBatch = (): void => {
          if (pendingBatch.length === 0) return;
          let chunk: ToolBatchEntry[] = [];
          const pushChunk = (): void => {
            if (chunk.length === 0) return;
            const batchKey = `tool-batch-${renderedBatchSerial}`;
            out.push(
              <div key={batchKey}>
                {renderToolEntries(chunk, `${batchKey}-card`)}
              </div>,
            );
            chunk = [];
            renderedBatchSerial += 1;
          };
          for (const entry of pendingBatch) {
            if (entry.kind === "tool" && chunk.filter((e) => e.kind === "tool").length >= 100) {
              pushChunk();
            }
            chunk.push(entry);
          }
          pushChunk();
          pendingBatch = [];
        };

        for (let i = 0; i < messages.length; i++) {
          const m = messages[i] as PairableMessage;

          // Skip tool result messages that are paired with a tool call
          // (they render inline inside the tool card)
          if (isPairedToolResult(pairing, m)) continue;

          // User message
          if (m.role === "user") {
            flushPendingBatch();
            out.push(
              <div key={i} className="message-row user">
                <div className="message-bubble user">{extractText(m.content)}</div>
              </div>,
            );
            continue;
          }

          // Assistant message — segment into prose + tool batches
          if (m.role === "assistant" && Array.isArray(m.content)) {
            const segments = splitAssistantToolSegments(
              m.content as Record<string, unknown>[],
              toolResultsById,
            );
            if (segments !== undefined) {
              for (const seg of segments) {
                if (seg.kind === "tools" && seg.entries) {
                  if (pendingBatch.length === 0) pendingBatchStartIndex = i;
                  pendingBatch.push(...seg.entries);
                  continue;
                }
                flushPendingBatch();
                out.push(
                  <div key={`${i}-seg`} className="message-row assistant">
                    <div className="message-bubble assistant">
                      <AssistantRenderSegmentView segment={seg} />
                    </div>
                  </div>,
                );
              }
              continue;
            }
          }

          // Default: render as simple bubble
          flushPendingBatch();
          const text = extractText(m.content);
          if (text.length > 0) {
            out.push(
              <div key={i} className="message-row assistant">
                <div className="message-bubble assistant">
                  <MarkdownContent text={text} />
                </div>
              </div>,
            );
          }
        }

        flushPendingBatch();
        return out;
      })()}

      {/* Streaming bubble */}
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

      {/* Thinking indicator (streaming, no text yet) */}
      {isStreaming && streamText.length === 0 && (
        <div className="message-row assistant">
          <div
            className="message-bubble assistant"
            style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: "13px", color: "var(--text-dim)", fontStyle: "italic", padding: "12px 16px",
            }}
          >
            {activeToolName ? (
              <>
                <span style={{
                  display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                  background: "var(--accent)", animation: "pulse 1s ease-in-out infinite",
                }} />
                running <code style={{
                  background: "var(--bg-glass)", borderRadius: "var(--radius-sm)",
                  padding: "1px 6px", fontFamily: "'SF Mono','Menlo','Monaco',monospace",
                  fontSize: "11px",
                }}>{activeToolName}</code>
              </>
            ) : (
              <>
                <span className="pi-thinking-dots" aria-hidden="true">
                  <span>.</span><span>.</span><span>.</span>
                </span>
              </>
            )}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
