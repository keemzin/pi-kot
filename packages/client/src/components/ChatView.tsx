import { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback, memo } from "react";
import { Copy, Check, CornerUpLeft } from "lucide-react";
import { useExtensions } from "../hooks/use-extensions";
import { invokeExtensionCommand } from "../lib/api-client";
import type { CompactionEvent } from "../lib/api-client";
import { ChatMarkdown } from "./ChatMarkdown";
import { CompactionCard } from "./CompactionCard";
import { useSessionStore, EMPTY_COMPACTIONS } from "../stores/session-store";
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

/** Shape of a bash execution message from the SDK. */
interface BashExecMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  excludeFromContext?: boolean;
  timestamp: number;
}

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

/** Extract image blocks from an SDK content array, returning { mimeType, data } for rendering. */
function extractImages(content: unknown): { mimeType: string; data: string; __blobUrl?: boolean }[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((block: Record<string, unknown>) => block.type === "image")
    .map((block: Record<string, unknown>) => ({
      mimeType: (block.mimeType as string) ?? "image/png",
      data: (block.data as string) ?? "",
      __blobUrl: (block as { __blobUrl?: boolean }).__blobUrl,
    }));
}

/** Render images inline. Used inside user message bubbles. */
function UserImages({ images }: { images: { mimeType: string; data: string; __blobUrl?: boolean }[] }) {
  if (images.length === 0) return null;
  return (
    <div className="user-images-row">
      {images.map((img, i) => {
        // Optimistic entries use a complete data URL stored in img.data.
        // Canonical entries from the server have raw base64 in img.data.
        const src = img.__blobUrl
          ? img.data
          : `data:${img.mimeType};base64,${img.data}`;
        return (
          <img
            key={i}
            src={src}
            alt={`Attached image ${i + 1}`}
            className="user-image-thumb"
            loading="lazy"
            onError={(e) => {
              // Failed to load — could be blob URL revoked or bad data
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        );
      })}
    </div>
  );
}

/** Archived messages rendered inside a CompactionCard's expand drawer.
 *  Memo'd so it only renders when expanded, not on every ChatView tick. */
const ArchivedMessages = memo(function ArchivedMessages({
  messages,
}: {
  messages: unknown[];
}) {
  return (
    <>
      {messages.map((raw, i) => {
        const m = raw as { role?: string; content?: unknown };
        const text = extractText(m.content);
        const imgs = extractImages(m.content);
        const isUser = m.role === "user";
        return (
          <div
            key={i}
            style={{
              borderRadius: "var(--radius-sm)",
              padding: "8px 10px",
              fontSize: "12px",
              lineHeight: "1.5",
              color: "var(--text-primary)",
              background: isUser
                ? "var(--user-bubble)"
                : "transparent",
              border: isUser
                ? "1px solid var(--user-bubble-border)"
                : "none",
              whiteSpace: isUser ? "pre-wrap" : undefined,
            }}
          >
            {isUser ? (
              <>
                <UserImages images={imgs} />
                {text}
              </>
            ) : (
              <ChatMarkdown text={text} />
            )}
          </div>
        );
      })}
    </>
  );
});

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
        className={`tool-timeline-icon${isRunning ? " running" : isError ? " error" : " success"}`}
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
          <div className="tool-timeline-output-preview" title={outputPreview}>
            {isError ? "✖ " : "✓ "}{outputPreview}
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

function UserMessageBubble({ text, isSteer, images }: { text: string; isSteer?: boolean; images?: { mimeType: string; data: string; __blobUrl?: boolean }[] }) {
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
        {isSteer && <span className="steer-tag">steer</span>}
        {images !== undefined && images.length > 0 && (
          <UserImages images={images} />
        )}
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

/* ── Bash execution bubble ── */

function BashExecBubble({ msg }: { msg: BashExecMessage }) {
  const [expanded, setExpanded] = useState(msg.output.length <= 500);
  const hasOutput = msg.output.length > 0;
  const icon = msg.cancelled ? "⛔" : msg.exitCode === 0 ? "✅" : "❌";
  const status = msg.cancelled
    ? "cancelled"
    : msg.exitCode === 0
      ? "success"
      : `exit ${msg.exitCode ?? "?"}`;
  return (
    <div className="message-row user">
      <div className="message-bubble user" style={{ borderLeft: "3px solid var(--accent-text)", maxWidth: "100%" }}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => hasOutput && setExpanded((v) => !v)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); hasOutput && setExpanded((v) => !v); } }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            cursor: hasOutput ? "pointer" : "default",
            userSelect: "none",
          }}
        >
          {hasOutput && (
            <span style={{ fontSize: 9, opacity: 0.5, width: 12, textAlign: "center", flexShrink: 0 }}>
              {expanded ? "▾" : "▸"}
            </span>
          )}
          <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
            $ {msg.command}
          </span>
          <span style={{ fontSize: 10, opacity: 0.65 }}>
            {icon} {status}
          </span>
          {msg.excludeFromContext && (
            <span style={{ fontSize: 9, padding: "0 4px", borderRadius: 3, background: "var(--bg-subtle)", opacity: 0.5 }}>
              local only
            </span>
          )}
          {hasOutput && !expanded && (
            <span style={{ fontSize: 9, opacity: 0.4, marginLeft: "auto" }}>
              {msg.output.length < 1024
                ? `${msg.output.length} B`
                : `${(msg.output.length / 1024).toFixed(1)} KB`}
            </span>
          )}
        </div>
        {hasOutput && expanded && (
          <pre
            style={{
              fontSize: 11,
              fontFamily: "monospace",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              margin: "6px 0 0",
              maxHeight: 400,
              overflow: "auto",
            }}
          >
            {msg.truncated ? msg.output + "\n…(truncated)" : msg.output}
          </pre>
        )}
      </div>
    </div>
  );
}

/* ── Token usage badge ── */

function TokenUsageBadge({ msg }: {
  msg?: Record<string, unknown>;
}) {
  const usage = msg?.usage as { input?: number; output?: number; cacheRead?: number } | undefined;
  const input = usage?.input;
  const output = usage?.output;
  const cacheRead = usage?.cacheRead;

  if (input == null && output == null && !(cacheRead && cacheRead > 0)) return null;

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {input != null && (
        <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>↑ {input.toLocaleString()} in</span>
      )}
      {output != null && (
        <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>↓ {output.toLocaleString()} out</span>
      )}
      {cacheRead && cacheRead > 0 && (
        <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>⚡ {cacheRead.toLocaleString()} cached</span>
      )}
    </span>
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
          // error handled
        } finally {
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

/* ── Model badge for assistant messages ──
     Reads model/provider from the message object so each response
     shows the model that actually generated it, even after switching. */

function ModelBadge({ msg, fallbackModel, fallbackProvider }: {
  msg?: Record<string, unknown>;
  fallbackModel?: string;
  fallbackProvider?: string;
}) {
  const modelName =
    (typeof msg?.model === "string" ? msg.model : undefined) ?? fallbackModel;
  const providerName =
    (typeof msg?.provider === "string" ? msg.provider : undefined) ?? fallbackProvider;
  if (!modelName) return null;
  return (
    <span className="assistant-msg-model">
      {providerName ? `${providerName} / ` : ""}{modelName}
    </span>
  );
}

/* ── Main ChatView ── */

const MAX_TOOL_BATCH_TOOLS = 100;

export function ChatView({ sessionId, modelName, providerName }: Props) {
  const messages = useSessionStore((s) => s.messages);
  const rawCompactions = useSessionStore((s) => s.compactionsBySession[sessionId] ?? EMPTY_COMPACTIONS);
  // Only show compaction cards when the current leaf is AT a compaction
  // point (messages[0] is the SDK-synthesized compactionSummary). If you
  // navigate to a pre-compaction leaf, messages[0] is a normal user
  // message and compaction cards should be hidden.
  const compactions = (messages as PairableMessage[])[0]?.role === "compactionSummary"
    ? rawCompactions
    : EMPTY_COMPACTIONS;
  const streamText = useSessionStore((s) => s.streamState.text);
  const isStreaming = useSessionStore((s) => s.streamState.isStreaming);
  const activeToolName = useSessionStore((s) => s.streamState.activeToolName);
  const queued = useSessionStore((s) => s.queuedBySession[sessionId]);
  const error = useSessionStore((s) => s.error);
  const clearError = useSessionStore((s) => s.clearError);
  const sendPrompt = useSessionStore((s) => s.sendPrompt);
  const { rewind: rewindAvailable } = useExtensions();

  const stickyUserHeader = usePreferencesStore((s) => s.stickyUserHeader);
  const showTokenUsage = usePreferencesStore((s) => s.showTokenUsage);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isFollowingBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const NEAR_BOTTOM_PX = 24;
  // Track user's scroll intent: isFollowingBottomRef stays true while
  // the user is near the bottom, false when they scroll up.
  const onScroll = (): void => {
    const el = scrollRef.current;
    if (el === null) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const scrolledUp = el.scrollTop < lastScrollTopRef.current - 1;
    isFollowingBottomRef.current = !scrolledUp && distance <= NEAR_BOTTOM_PX;
    lastScrollTopRef.current = el.scrollTop;
  };

  // Layout effect: runs before paint, so scroll-to-bottom happens
  // before the user sees anything. Fires on every message/streaming
  // change — not just session switches. When the user has scrolled up,
  // restores scrollTop to prevent browser scroll anchoring from
  // nudging the viewport when content below them changes.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === null || messages.length === 0) return;
    if (isFollowingBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      lastScrollTopRef.current = el.scrollTop;
    } else {
      // User scrolled up — restore position to prevent browser nudge
      el.scrollTop = lastScrollTopRef.current;
    }
  }, [messages, streamText]);

  // Build tool pairing once per render cycle
  const pairing = useMemo(() => buildToolCallPairing(messages as PairableMessage[]), [messages]);

  // Render loop: iterate messages by flat index so
  // CompactionCards splice at arbitrary insertBeforeIndex positions,
  // not just at user message boundaries. Preserves turn-grouped
  // visual layout (sticky user header, copy/rewind buttons).
  const renderedRows = useMemo(() => {
    const { toolResultsById } = pairing;
    const out: React.ReactNode[] = [];

    // Group compactions by insertBeforeIndex for O(1) lookup.
    const compactionsAt = new Map<number, CompactionEvent[]>();
    for (const ev of compactions) {
      const list = compactionsAt.get(ev.insertBeforeIndex) ?? [];
      list.push(ev);
      compactionsAt.set(ev.insertBeforeIndex, list);
    }

    // Helper: push all compaction cards for a given index.
    const pushCardsAt = (idx: number): void => {
      const events = compactionsAt.get(idx);
      if (events === undefined) return;
      for (const ev of events) {
        out.push(<CompactionCard key={`compaction-${ev.id}`} event={ev} />);
      }
    };

    // Kept-window range: messages in [1, latestCard.insertBeforeIndex)
    // are hidden from inline bubbles; they appear inside the latest
    // CompactionCard's expand drawer instead.
    const latestCard =
      compactions.length > 0 ? compactions[compactions.length - 1] : undefined;
    const keptWindowEnd = latestCard?.insertBeforeIndex ?? 0;

    // Helper: extract images from a user message's content
    const userImages = (m: PairableMessage) => extractImages(m.content);

    // Common helper: assistant message rendering (tool batching etc.)
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

    // Turn-grouped rendering helpers (for sticky user header mode)
    // Collect messages by turn during flat iteration, then flush
    // the accumulated turn as a grouped container.
    let currentUserIdx = -1;
    let currentUserMsg: PairableMessage | undefined;
    const currentAssistantMsgs: PairableMessage[] = [];

    const flushTurn = (): void => {
      if (currentUserMsg === undefined) return;
      const text = extractText(currentUserMsg.content);
      const combinedAssistantText = currentAssistantMsgs
        .map(m => extractText(m.content))
        .filter(t => t.length > 0)
        .join("\n\n");

      const isSteer = (currentUserMsg.metadata as { steer?: boolean } | undefined)?.steer === true;

      // Read model info from the LAST assistant message in this turn
      // so the badge reflects the actual generating model, not the
      // currently-selected one. Falls back to the global props if the
      // message object doesn't carry model info (older sessions).
      const lastAssistantMsg = currentAssistantMsgs.length > 0
        ? (currentAssistantMsgs[currentAssistantMsgs.length - 1] as Record<string, unknown>)
        : undefined;

      if (stickyUserHeader && text.length > 0) {
        out.push(
          <div key={`turn-${currentUserIdx}`} style={{ position: "relative" }}>
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 10,
                background: "var(--bg-solid)",
                overflowAnchor: "none",
              }}
            >
              <UserMessageBubble text={text} isSteer={isSteer} images={userImages(currentUserMsg)} />
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
            {currentAssistantMsgs.length > 0 &&
              renderAssistantMsgs(currentAssistantMsgs, currentUserIdx)}
            {combinedAssistantText.length > 0 && (
              <div className="assistant-msg-footer">
                <CopyMsgButton getText={() => combinedAssistantText} />
                {showTokenUsage && <TokenUsageBadge msg={lastAssistantMsg} />}
                <ModelBadge msg={lastAssistantMsg} fallbackModel={modelName} fallbackProvider={providerName} />
              </div>
            )}
          </div>,
        );
      } else {
        // Non-sticky mode: render user message normally
        out.push(
          <div
            key={`user-${currentUserIdx}`}
            className="message-row user"
            data-message-index={currentUserIdx}
          >
            <div className="message-bubble user">
              {isSteer && <span className="steer-tag">steer</span>}
              <UserImages images={userImages(currentUserMsg)} />
              {text}
            </div>
          </div>,
        );
        if (text.length > 0) {
          out.push(
            <div key={`user-${currentUserIdx}-copy`} className="assistant-msg-footer user">
              <CopyMsgButton getText={() => text} />
              {rewindAvailable && <RewindMsgButton sessionId={sessionId} />}
            </div>,
          );
        }
        if (currentAssistantMsgs.length > 0) {
          out.push(...renderAssistantMsgs(currentAssistantMsgs, currentUserIdx));
        }
        if (combinedAssistantText.length > 0) {
          out.push(
            <div key={`turn-${currentUserIdx}-copy`} className="assistant-msg-footer">
              <CopyMsgButton getText={() => combinedAssistantText} />
              {showTokenUsage && <TokenUsageBadge msg={lastAssistantMsg} />}
              <ModelBadge msg={lastAssistantMsg} fallbackModel={modelName} fallbackProvider={providerName} />
            </div>,
          );
        }
      }

      currentUserMsg = undefined;
      currentAssistantMsgs.length = 0;
    };

    // ── Flat index iteration ──
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i] as PairableMessage;

      // Compaction cards render BEFORE the message at index i.
      pushCardsAt(i);

      // Tool results are rendered inline with their tool call.
      if (isPairedToolResult(pairing, m)) continue;

      // Skip the SDK-synthesized compactionSummary — the same text
      // is inside our CompactionCard.
      if (m.role === "compactionSummary") {
        continue;
      }

      // Kept-window suppression: messages between index 1 and
      // keptWindowEnd were kept verbatim by the latest compaction
      // and appear inside that card's expand drawer.
      if (latestCard !== undefined && i >= 1 && i < keptWindowEnd) {
        continue;
      }

      if (m.role === "user") {
        flushTurn();
        currentUserIdx = i;
        currentUserMsg = m;
      } else if (m.role === "assistant") {
        if (currentUserMsg !== undefined) {
          currentAssistantMsgs.push(m);
        } else {
          // Orphan assistant message (kept-window boundary case where
          // the preceding user was hidden). Render standalone.
          out.push(<div key={`orphan-${i}`} data-message-index={i}>
            {renderAssistantMsgs([m], i)}
          </div>);
        }
      } else if (m.role === "bashExecution") {
        // Bash execution messages (!cmd / !!cmd) render as standalone bubbles
        flushTurn();
        out.push(
          <BashExecBubble key={`bash-${i}`} msg={m as unknown as BashExecMessage} />,
        );
      }
    }

    // Flush the last accumulated turn.
    flushTurn();

    // Trailing cards: insertBeforeIndex === messages.length means
    // the entire current context was archived with no new messages
    // yet. Render the card at the bottom.
    pushCardsAt(messages.length);

    return out;
  }, [messages, pairing, stickyUserHeader, compactions, sessionId, rewindAvailable]);

  return (
    <div className="messages-container" style={stickyUserHeader ? { paddingTop: 50 } : undefined}>
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
        <div ref={scrollRef} onScroll={onScroll} style={stickyUserHeader ? { paddingTop: 0 } : undefined} className="chat-scroll">
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

            {queued !== undefined && (queued.steering.length > 0 || queued.followUp.length > 0) && (
              <div className="queued-msgs">
                {[...queued.steering.map((t) => ({ kind: "steer" as const, text: t })), ...queued.followUp.map((t) => ({ kind: "followUp" as const, text: t }))].map(
                  (q, i) => (
                    <div key={i} className="queued-msg-item">
                      <span className={`queued-badge ${q.kind}`}>{q.kind === "steer" ? "steer" : "follow-up"}</span>
                      <span className="queued-msg-text" title={q.text}>{q.text}</span>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
