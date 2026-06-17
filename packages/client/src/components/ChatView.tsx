import { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback } from "react";
import { Copy, Check, CornerUpLeft } from "lucide-react";
import { useExtensions } from "../hooks/use-extensions";
import { invokeExtensionCommand } from "../lib/api-client";
import { ChatMarkdown } from "./ChatMarkdown";
import { useSessionStore } from "../stores/session-store";
import { usePreferencesStore } from "../stores/preferences-store";
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

/* ── Tool Call Components (ported from forge, styled with theme vars) ── */

/** Map a tool name to a descriptive emoji icon. */
function getToolIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("bash") || n.includes("shell") || n.includes("exec") || n.includes("run")) return "⚡";
  if (n.includes("read") || n.includes("cat") || n.includes("view") || n.includes("get")) return "📄";
  if (n.includes("write") || n.includes("create") || n.includes("save") || n.includes("put")) return "✏️";
  if (n.includes("edit") || n.includes("patch") || n.includes("update") || n.includes("replace")) return "🔧";
  if (n.includes("search") || n.includes("grep") || n.includes("find") || n.includes("ls") || n.includes("list")) return "🔍";
  if (n.includes("delete") || n.includes("remove") || n.includes("rm")) return "🗑️";
  if (n.includes("move") || n.includes("rename") || n.includes("mv")) return "📦";
  if (n.includes("git") || n.includes("commit") || n.includes("branch")) return "🌿";
  if (n.includes("web") || n.includes("fetch") || n.includes("http") || n.includes("url")) return "🌐";
  if (n.includes("test") || n.includes("spec")) return "🧪";
  if (n.includes("ask") || n.includes("question") || n.includes("prompt")) return "💬";
  return "🔩";
}

/** Render the thinking block content. */
function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      className="thinking-block"
    >
      <summary
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
      >
        {open ? "▾" : "▸"} Thinking…
      </summary>
      {open && (
        <pre className="thinking-content">{text}</pre>
      )}
    </details>
  );
}

/** Render a single tool call + its result as a timeline node. */
function ToolCallEntry({
  block,
  result,
}: {
  block: Record<string, unknown>;
  result: PairableMessage | undefined;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const name = String(block.name ?? "tool");
  const args = block.arguments ?? block.input ?? {};
  const argsText = typeof args === "string" ? args : JSON.stringify(args, null, 2);

  const isError = result?.isError === true;
  const isRunning = result === undefined;
  const resultContent = Array.isArray(result?.content) ? result?.content : [];
  const outputText = resultContent
    .filter((c): c is { type: "text"; text: string } => {
      const o = c as { type?: unknown; text?: unknown };
      return o.type === "text" && typeof o.text === "string";
    })
    .map((c) => c.text)
    .join("\n");

  // Smart disclosure: first line of output shown inline
  const outputPreview = outputText.split("\n").find((l) => l.trim().length > 0) ?? "";

  const preview = toolPreviewFromArgs(name, args);
  const icon = getToolIcon(name);

  return (
    <div className="tool-timeline-node">
      <span
        className={`tool-timeline-icon${isRunning ? " running" : isError ? " error" : ""}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="tool-timeline-content">
        <div className="tool-timeline-row">
          <span className="tool-timeline-name">{name}</span>
          {preview && <span className="tool-timeline-arg" title={preview}>{preview}</span>}
          {isRunning && <span className="tool-timeline-running" aria-label="running">running…</span>}
          {!isRunning && outputText.length > 0 && (
            <button
              type="button"
              className="tool-timeline-details-btn"
              onClick={() => setDetailsOpen((o) => !o)}
              aria-expanded={detailsOpen}
              aria-label={detailsOpen ? "Hide details" : "Show details"}
            >
              {detailsOpen ? "hide" : "details"}
            </button>
          )}
        </div>
        {/* Smart-disclosure output preview (always shown when not expanded) */}
        {!isRunning && !detailsOpen && outputPreview.length > 0 && (
          <div className={`tool-timeline-output-preview${isError ? " error-preview" : ""}`} title={outputPreview}>
            {isError ? "✖ " : ""}{outputPreview}
          </div>
        )}
        {/* Expanded details pane */}
        {detailsOpen && (
          <div className="tool-timeline-details">
            {argsText.length > 2 && (
              <div>
                <div className="tool-timeline-section-label">input</div>
                <pre className="tool-timeline-code">
                  {argsText.length > 2000 ? argsText.slice(0, 2000) + "\n…(truncated)" : argsText}
                </pre>
              </div>
            )}
            {outputText.length > 0 && (
              <div>
                <div className="tool-timeline-section-label">{isError ? "error" : "output"}</div>
                <pre className="tool-timeline-code">
                  {outputText.length > 4000 ? outputText.slice(0, 4000) + "\n…(truncated)" : outputText}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Render a batch of tool calls as a collapsible timeline group. */
function ToolCallBatchCard({ entries }: { entries: ToolBatchEntry[] }) {
  const [open, setOpen] = useState(false);
  const toolEntries = entries.filter((entry) => entry.kind === "tool");
  const toolCount = toolEntries.length;
  const inFlight = toolEntries.filter((e) => e.result === undefined).length;
  const errored = toolEntries.some((e) => e.result?.isError === true);

  // Unique tool names for the inline preview
  const names = [...new Set(toolEntries.map((e) => String(e.block.name ?? "tool")))];
  const previewText = names.slice(0, 4).join(" · ") + (names.length > 4 ? " · …" : "");

  return (
    <details
      open={open}
      className="tool-timeline"
      style={{ marginLeft: 0 }}
    >
      <summary
        className="tool-timeline-header"
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        aria-label={`${toolCount} tool ${toolCount === 1 ? "call" : "calls"}: ${previewText}`}
      >
        <span className="tool-timeline-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="tool-timeline-batch-label">
          ↳ {toolCount} {toolCount === 1 ? "tool" : "tools"}
        </span>
        <span className="tool-timeline-batch-preview">{previewText}</span>
        {inFlight > 0 && (
          <span className="tool-timeline-badge" aria-label={`${inFlight} running`}>
            {inFlight} running
          </span>
        )}
        {errored && (
          <span className="tool-timeline-badge error" aria-label="error">error</span>
        )}
      </summary>
      <div className="tool-timeline-track">
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
    return <ChatMarkdown text={block.text} />;
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
      <div className="assistant-blocks">
        {blocks.map((block: Record<string, unknown>, i: number) => (
          <AssistantBlock key={i} block={block} />
        ))}
      </div>
    );
  }

  const entries = segment.entries;
  if (!entries) return null;
  const toolEntry = entries.find((entry: ToolBatchEntry) => entry.kind === "tool");
  const hasThinking = entries.some((entry: ToolBatchEntry) => entry.kind === "thinking");
  const toolCount = entries.filter((e: ToolBatchEntry) => e.kind === "tool").length;

  if (toolCount === 1 && !hasThinking && toolEntry !== undefined) {
    return (
      <div className="tool-timeline">
        <ToolCallEntry block={toolEntry.block} result={toolEntry.result} />
      </div>
    );
  }
  return <ToolCallBatchCard entries={entries} />;
}

/* ── Sticky user message component ── */

function UserMessageBubble({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [isLong, setIsLong] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const check = () => {
      if (!expanded) {
        setIsLong(el.scrollHeight > el.clientHeight);
      }
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, expanded]);

  return (
    <div className="message-row user">
      <div className="message-bubble user">
        <div
          ref={textRef}
          style={{
            overflow: "hidden",
            transition: "max-height 0.25s ease",
            maxHeight: !expanded ? "4em" : "2000px",
            ...(!expanded
              ? {
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }
              : {}),
          } as React.CSSProperties}
        >
          {text}
        </div>
        {isLong && (
          <div
            onClick={() => setExpanded((e) => !e)}
            style={{
              marginTop: 6,
              fontSize: 12,
              color: "var(--accent-text)",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            {expanded ? "▲ Show less" : "▼ Show more"}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Copy button for assistant messages ── */

function CopyMsgButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  const onClick = (): void => {
    const text = getText();
    if (text.length === 0) return;
    const writeAsync = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (writeAsync !== undefined) {
      void writeAsync(text)
        .then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        })
        .catch(() => fallback(text));
    } else {
      fallback(text);
    }
  };
  const fallback = (text: string): void => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable — user can still select + Ctrl+C.
    }
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className="copy-msg-btn"
      title="Copy message"
      aria-label="Copy message"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

/* ── Rewind button ── */

function RewindMsgButton({ sessionId }: { sessionId: string }) {
  const [invoking, setInvoking] = useState(false);
  return (
    <button
      type="button"
      disabled={invoking}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setInvoking(true);
        try {
          await invokeExtensionCommand(sessionId, "rewind");
        } catch {
          setInvoking(false);
        }
      }}
      className="copy-msg-btn rewind-btn"
      title="Rewind to checkpoint (requires pi-rewind)"
      aria-label="Rewind"
    >
      <CornerUpLeft size={12} />
    </button>
  );
}

/* ── Main ChatView ── */

const MAX_TOOL_BATCH_TOOLS = 100;

export function ChatView({ sessionId, modelName, providerName }: Props) {
  const messages = useSessionStore((s) => s.messages);
  const streamText = useSessionStore((s) => s.streamState.text);
  const isStreaming = useSessionStore((s) => s.streamState.isStreaming);
  const activeToolName = useSessionStore((s) => s.streamState.activeToolName);
  const error = useSessionStore((s) => s.error);
  const clearError = useSessionStore((s) => s.clearError);
  const sendPrompt = useSessionStore((s) => s.sendPrompt);
  const { rewind: rewindAvailable } = useExtensions();

  const stickyUserHeader = usePreferencesStore((s) => s.stickyUserHeader);

  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isFollowingBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const NEAR_BOTTOM_PX = 24;
  const prevSessionRef = useRef<string | null>(null);

  // Helper: get the actual scroll container (messages-container, not chat-scroll
  // which has overflow: visible)
  const getScrollEl = (): HTMLElement | null => {
    // Try containerRef first (the messages-container element)
    if (containerRef.current !== null && containerRef.current.scrollHeight > containerRef.current.clientHeight + 1) {
      return containerRef.current;
    }
    // Fallback to scrollRef (chat-scroll — may not scroll due to overflow:visible)
    return scrollRef.current;
  };

  // Scroll to bottom immediately when switching to a new session with messages
  useLayoutEffect(() => {
    if (messages.length === 0) return;
    if (sessionId === prevSessionRef.current && prevSessionRef.current !== undefined) return;
    prevSessionRef.current = sessionId;
    const el = getScrollEl();
    if (el === null) return;
    const target = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = target;
    lastScrollTopRef.current = el.scrollTop;
    isFollowingBottomRef.current = true;
  }, [sessionId, messages.length]);

  const onScroll = (): void => {
    const el = containerRef.current;
    if (el === null) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const scrolledUp = el.scrollTop < lastScrollTopRef.current - 1;
    isFollowingBottomRef.current = !scrolledUp && distance <= NEAR_BOTTOM_PX;
    lastScrollTopRef.current = el.scrollTop;
  };

  useEffect(() => {
    const el = getScrollEl();
    if (el === null || !isFollowingBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
    lastScrollTopRef.current = el.scrollTop;
  }, [messages, streamText]);

  // Build tool pairing once per render cycle
  const pairing = useMemo(() => buildToolCallPairing(messages as PairableMessage[]), [messages]);

  // Render loop: group messages into turns (user + following assistant),
  // support sticky user header (pins user msg at top while scrolling reply)
  const renderedRows = useMemo(() => {
    const { toolResultsById } = pairing;
    const out: React.ReactNode[] = [];

    // Build turns from messages
    type Turn = { userIdx: number; userMsg: PairableMessage; assistantMsgs: PairableMessage[] };
    const turns: Turn[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i] as PairableMessage;
      if (isPairedToolResult(pairing, m)) continue;
      if (m.role === "user") {
        turns.push({ userIdx: i, userMsg: m, assistantMsgs: [] });
      } else if (m.role === "assistant" && turns.length > 0) {
        turns[turns.length - 1].assistantMsgs.push(m);
      }
    }

    // Common helper: render all assistant messages in a turn
    const renderAssistantMsgs = (msgs: PairableMessage[], turnIdx: number) => {
      const elements: React.ReactNode[] = [];
      const pendingBatch: ToolBatchEntry[] = [];
      let renderedBatchSerial = 0;

      const flushPendingBatch = () => {
        if (pendingBatch.length === 0) return;
        const chunk = [...pendingBatch];
        pendingBatch.length = 0;
        const batchKey = `turn-${turnIdx}-batch-${renderedBatchSerial}`;
        elements.push(
          <div key={batchKey}>
            <ToolCallBatchCard entries={chunk} />
          </div>,
        );
        renderedBatchSerial += 1;
      };

      for (const m of msgs) {
        if (Array.isArray(m.content)) {
          const segments = splitAssistantToolSegments(
            m.content as Record<string, unknown>[],
            toolResultsById,
          );
          if (segments !== undefined) {
            for (const seg of segments) {
              if (seg.kind === "tools" && seg.entries) {
                pendingBatch.push(...seg.entries);
                continue;
              }
              flushPendingBatch();
              elements.push(
                <div key={`turn-${turnIdx}-seg-${elements.length}`} className="message-row assistant">
                  <div className="message-bubble assistant">
                    <AssistantRenderSegmentView segment={seg} />
                  </div>
                </div>,
              );
            }
            continue;
          }
        }

        flushPendingBatch();
        const text = extractText(m.content);
        if (text.length > 0) {
          elements.push(
            <div key={`turn-${turnIdx}-text-${elements.length}`} className="message-row assistant">
              <div className="message-bubble assistant">
                <ChatMarkdown text={text} />
              </div>
            </div>,
          );
        }
      }
      flushPendingBatch();
      return elements;
    };

    for (let ti = 0; ti < turns.length; ti++) {
      const { userIdx, userMsg, assistantMsgs } = turns[ti];
      const isLastTurn = ti === turns.length - 1;
      const text = extractText(userMsg.content);

      // Combined assistant text for the copy button (once per turn)
      const combinedAssistantText = assistantMsgs
        .map(m => extractText(m.content))
        .filter(t => t.length > 0)
        .join("\n\n");

      if (stickyUserHeader && text.length > 0) {
        // Sticky mode: wrap user message in a sticky container
        out.push(
          <div key={`turn-${ti}`} style={{ position: "relative" }}>
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 10,
                background: "var(--bg-solid)",
                overflowAnchor: "none",
              }}
            >
              <UserMessageBubble text={text} />
              {text.length > 0 && (
                <div className="assistant-msg-footer user">
                  <CopyMsgButton getText={() => text} />
                  {rewindAvailable && <RewindMsgButton sessionId={sessionId} />}
                </div>
              )}
              <div
                aria-hidden="true"
                style={{
                  pointerEvents: "none",
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: "100%",
                  zIndex: 0,
                  height: 12,
                  background:
                    "linear-gradient(to bottom, var(--bg-solid), transparent)",
                }}
              />
            </div>
            {assistantMsgs.length > 0 && renderAssistantMsgs(assistantMsgs, ti)}
            {combinedAssistantText.length > 0 && (
              <div className="assistant-msg-footer">
                <CopyMsgButton getText={() => combinedAssistantText} />
              </div>
            )}
          </div>,
        );
      } else {
        // Non-sticky mode: render user message normally
        out.push(
          <div key={`user-${userIdx}`} className="message-row user" data-message-index={userIdx}>
            <div className="message-bubble user">{text}</div>
          </div>,
        );
        // Copy button below the user message
        if (text.length > 0) {
          out.push(
            <div key={`user-${userIdx}-copy`} className="assistant-msg-footer user">
              <CopyMsgButton getText={() => text} />
              {rewindAvailable && <RewindMsgButton sessionId={sessionId} />}
            </div>,
          );
        }
        if (assistantMsgs.length > 0) {
          out.push(...renderAssistantMsgs(assistantMsgs, ti));
        }
        // Copy button below the entire assistant response for this turn
        if (combinedAssistantText.length > 0) {
          out.push(
            <div key={`turn-${ti}-copy`} className="assistant-msg-footer">
              <CopyMsgButton getText={() => combinedAssistantText} />
            </div>,
          );
        }
      }
    }

    return out;
  }, [messages, pairing, stickyUserHeader]);

  return (
    <div ref={containerRef} onScroll={onScroll} className="messages-container" style={stickyUserHeader ? { paddingTop: 50 } : undefined}>
      {error !== undefined && (
        <div onClick={clearError} className="error-banner">
          {error} — click to dismiss
        </div>
      )}

      {messages.length === 0 && !isStreaming ? (
        <div className="welcome">
          <div className="welcome-icon">💬</div>
          <div className="welcome-text">Send a message to start chatting</div>
          <div className="welcome-hint">with the pi coding agent</div>
        </div>
      ) : (
        <div ref={scrollRef} style={stickyUserHeader ? { overflow: "visible", paddingTop: 0 } : { overflow: "visible" }} className="chat-scroll">
          <div className="chat-message-list">
            {renderedRows}

            {isStreaming && streamText.length > 0 && (
              <div className="message-row assistant streaming-row">
                <div className="message-bubble assistant streaming-bubble">
                  {activeToolName && (
                    <div className="tool-badge">
                      <span className="tool-badge-dot" />
                      {activeToolName}
                    </div>
                  )}
                  <div className="streaming-text">
                    <ChatMarkdown text={streamText} />
                    <span className="streaming-cursor">▊</span>
                  </div>
                </div>
              </div>
            )}

            {isStreaming && streamText.length === 0 && (
              <div className="message-row assistant streaming-row">
                <div className="message-bubble assistant thinking-bubble">
                  {activeToolName ? (
                    <span className="thinking-running">
                      <span className="tool-badge-dot" />
                      running <code className="thinking-code">{activeToolName}</code>
                    </span>
                  ) : (
                    <span className="pi-thinking-dots" aria-hidden="true">
                      <span>.</span><span>.</span><span>.</span>
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
