import { useEffect, useRef, useState, useMemo, useCallback } from "react";
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

  const preview = toolPreviewFromArgs(name, args);
  const borderColor = result === undefined
    ? "var(--accent)"
    : isError
      ? "var(--error)"
      : "var(--border)";

  return (
    <div className="tool-call-chip" style={{ borderColor }}>
      <div className="tool-call-header">
        <span className="tool-dot" />
        <span className="tool-name">{name}</span>
        {preview && (
          <span className="tool-preview" title={preview}>{preview}</span>
        )}
        {result === undefined && (
          <span className="tool-running">running…</span>
        )}
      </div>
      <div className="tool-input-area">
        <button
          type="button"
          onClick={() => setInputOpen((o) => !o)}
          className="tool-toggle"
        >
          {inputOpen ? "▾" : "▸"} Input
        </button>
        {inputOpen && (
          <div className="tool-args">{argsText.length > 2000 ? argsText.slice(0, 2000) + "\n…(truncated)" : argsText}</div>
        )}
      </div>
      {result !== undefined && outputText.length > 0 && (
        <div className="tool-output-area">
          <button
            type="button"
            onClick={() => setOutputOpen((o) => !o)}
            className="tool-toggle"
          >
            {outputOpen ? "▾" : "▸"} {isError ? "Error" : "Output"}
          </button>
          {outputOpen && (
            <div className="tool-output-text">{outputText.length > 4000 ? outputText.slice(0, 4000) + "\n…(truncated)" : outputText}</div>
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

  const counts = new Map<string, number>();
  for (const e of toolEntries) {
    const n = String(e.block.name ?? "tool");
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const countSummary = [...counts].map(([n, c]) => `${n} ×${c}`).join(" · ");

  const previews = toolEntries
    .map((e) => {
      const n = String(e.block.name ?? "tool");
      const args = e.block.arguments ?? e.block.input ?? {};
      const p = toolPreviewFromArgs(n, args);
      return p === undefined ? n : `${n}: ${p}`;
    })
    .slice(0, 3);

  return (
    <details
      open={open}
      className="tool-call-chip tool-batch"
    >
      <summary
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        className="tool-batch-summary"
      >
        <div className="tool-batch-header-row">
          <span style={{ color: "var(--text-dim)" }}>→</span>
          <span className="tool-name">tools</span>
          <span style={{ color: "var(--text-dim)", fontSize: "11px" }}>
            ×{toolCount} {toolCount === 1 ? "call" : "calls"}
          </span>
          {countSummary && (
            <span className="tool-batch-count" title={countSummary}>{countSummary}</span>
          )}
          {inFlight > 0 && (
            <span className="tool-badge">{inFlight} running…</span>
          )}
          {errored && (
            <span className="tool-badge tool-badge-error">error</span>
          )}
        </div>
        {previews.length > 0 && (
          <div className="tool-batch-previews">
            {previews.join(" · ")}{toolCount > previews.length && " · …"}
          </div>
        )}
      </summary>
      <div className="tool-batch-body">
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
    return <ToolCallEntry block={toolEntry.block} result={toolEntry.result} />;
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
            maxHeight: !expanded ? "3.2em" : "2000px",
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

/* ── Main ChatView ── */

const MAX_TOOL_BATCH_TOOLS = 100;

export function ChatView({ sessionId, modelName, providerName }: Props) {
  const messages = useSessionStore((s) => s.messages);
  const streamText = useSessionStore((s) => s.streamState.text);
  const isStreaming = useSessionStore((s) => s.streamState.isStreaming);
  const activeToolName = useSessionStore((s) => s.streamState.activeToolName);
  const error = useSessionStore((s) => s.error);
  const clearError = useSessionStore((s) => s.clearError);

  const stickyUserHeader = usePreferencesStore((s) => s.stickyUserHeader);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isFollowingBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const NEAR_BOTTOM_PX = 24;

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (el === null) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const scrolledUp = el.scrollTop < lastScrollTopRef.current - 1;
    isFollowingBottomRef.current = !scrolledUp && distance <= NEAR_BOTTOM_PX;
    lastScrollTopRef.current = el.scrollTop;
  };

  useEffect(() => {
    const el = scrollRef.current;
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
          </div>,
        );
      } else {
        // Non-sticky mode: render user message normally
        out.push(
          <div key={`user-${userIdx}`} className="message-row user" data-message-index={userIdx}>
            <div className="message-bubble user">{text}</div>
          </div>,
        );
        if (assistantMsgs.length > 0) {
          out.push(...renderAssistantMsgs(assistantMsgs, ti));
        }
      }
    }

    return out;
  }, [messages, pairing, stickyUserHeader]);

  return (
    <div className="messages-container">
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
        <div ref={scrollRef} onScroll={onScroll} className="chat-scroll">
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
