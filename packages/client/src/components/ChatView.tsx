import { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback, memo } from "react";
import { Copy, Check, CornerUpLeft, ImageDown } from "lucide-react";
import { useExtensions } from "../hooks/use-extensions";
import { invokeExtensionCommand, cancelExec } from "../lib/api-client";
import type { CompactionEvent } from "../lib/api-client";
import { toPng } from "html-to-image";
import { ChatMarkdown } from "./ChatMarkdown";
import { CompactionCard } from "./CompactionCard";
import { toolRegistry } from "../lib/tool-registry";
import { ReplSandbox } from "./ReplSandbox";

// Register custom tool renderers
toolRegistry.register("javascript_repl", ({ part }) => (
  <ReplSandbox
    code={(part.args?.code as string) ?? ""}
    title={(part.args?.title as string) ?? ""}
    serverOutput={
      part.state !== "input-available" && part.state !== "running"
        ? part.output ?? ""
        : undefined
    }
    isRunning={part.state === "running"}
    isError={part.state === "error"}
  />
));
import { useLayoutStore } from "../stores/layout-store";
import { useSessionStore, EMPTY_COMPACTIONS } from "../stores/session-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { toolPreviewFromArgs } from "../lib/tool-call-pairing";
import {
  type UIMessage,
  type UIPart,
  type TextPart,
  type ThinkingPart,
  type ToolCallPart,
  type BashExecPart,
  type ImagePart,
} from "../lib/normalize";

/** Local mirror of old tool-call-pairing types (for ToolCallEntry/ToolCallBatchCard compat). */
interface PairableMessage {
  role?: string;
  type?: string;
  content?: unknown;
  toolCallId?: unknown;
  [key: string]: unknown;
}
interface ToolBatchEntry {
  kind: "tool" | "thinking";
  block: Record<string, unknown>;
  result?: PairableMessage | undefined;
}

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
  const showThinking = usePreferencesStore((s) => s.showThinking);
  const [open, setOpen] = useState(false);

  if (!showThinking) return null;

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

/* ── Save as PNG button for assistant messages ── */

function SaveAsPngButton({ getText: _getText }: { getText: () => string }) {
  const [saving, setSaving] = useState(false);

  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (saving) return;

    // Find the .message-row.assistant siblings before the footer
    const btn = e.currentTarget as HTMLElement;
    const footer = btn.closest(".assistant-msg-footer") as HTMLElement | null;
    if (!footer) return;
    const turnContainer = footer.parentElement;
    if (!turnContainer) return;

    const sourceBubbles: HTMLElement[] = [];
    let pastFooter = false;
    for (let i = turnContainer.children.length - 1; i >= 0; i--) {
      const child = turnContainer.children[i] as HTMLElement;
      if (child === footer) { pastFooter = true; continue; }
      if (!pastFooter) continue;
      if (child.classList.contains("message-row")) {
        const bubble = child.querySelector<HTMLElement>(".message-bubble.assistant");
        if (bubble) {
          // Only take the last assistant bubble (closest to footer) — tool calls come before
          sourceBubbles.push(bubble);
          break;
        }
        continue;
      }
      if (child.classList.contains("message-row") && child.classList.contains("user")) {
        break;
      }
    }
    if (sourceBubbles.length === 0) return;

    setSaving(true);
    try {
      const rootStyle = window.getComputedStyle(document.documentElement);
      const bgColor =
        rootStyle.getPropertyValue("--bg-solid").trim() ||
        rootStyle.getPropertyValue("--surface-background").trim() ||
        window.getComputedStyle(document.body).backgroundColor ||
        "#1a1a1a";
      const paddingSize = 40;

      const wrapper = document.createElement("div");
      wrapper.style.cssText = `
        padding: ${paddingSize}px;
        background-color: ${bgColor};
        display: inline-block;
        width: 680px;
      `;

      for (const originalBubble of sourceBubbles) {
        const computedStyle = window.getComputedStyle(originalBubble);
        const clone = originalBubble.cloneNode(true) as HTMLElement;
        // Inline the root element's computed styles + disable transform/contain that interfere with SVG
        clone.style.cssText = `
          ${computedStyle.cssText}
          transform: none;
          contain: none;
          overflow: visible;
          scrollbar-width: none;
          -ms-overflow-style: none;
        `;

        // Strip scrollbars from all child elements too (Firefox + legacy Edge)
        clone.querySelectorAll<HTMLElement>("*").forEach((el) => {
          el.style.scrollbarWidth = "none";
        });

        // Inject a tiny style to suppress WebKit scrollbars (Chrome, Safari)
        const webkitStyle = document.createElement("style");
        webkitStyle.textContent = `
          .png-clone::-webkit-scrollbar,
          .png-clone *::-webkit-scrollbar {
            display: none;
          }
        `;
        clone.classList.add("png-clone");
        clone.insertBefore(webkitStyle, clone.firstChild);

        // In the PNG, code blocks must wrap text (no scrolling in a still image)
        clone.querySelectorAll<HTMLElement>("pre, pre code").forEach((el) => {
          el.style.whiteSpace = "pre-wrap";
          el.style.wordBreak = "break-word";
          el.style.overflowWrap = "break-word";
          el.style.overflow = "visible";
        });

        // Hide interactive elements by data-attr or class
        clone.querySelectorAll<HTMLElement>(
          ".copy-msg-btn, .rewind-btn, .code-copy-btn, .tool-timeline-details-btn"
        ).forEach((el) => { el.style.display = "none"; });

        wrapper.appendChild(clone);
      }

      document.body.appendChild(wrapper);

      const dataUrl = await toPng(wrapper, {
        quality: 1,
        pixelRatio: 3,
        backgroundColor: bgColor,
        // Skip web font embedding — html-to-image can't read CSS rules
        // from cross-origin stylesheets (Google Fonts via fonts.googleapis.com).
        // The PNG will use system fallback fonts, which is fine for screenshots.
        skipFonts: true,
      });

      document.body.removeChild(wrapper);

      // Convert data URL to blob to avoid Chromium's
      // "loaded over an insecure connection" warning for HTTP origins.
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.download = `message-${Date.now()}.png`;
      link.href = blobUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Failed to save message as PNG:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="copy-msg-btn save-png-btn"
      title="Save message as PNG"
      aria-label="Save message as PNG"
      disabled={saving}
    >
      <ImageDown size={12} />
    </button>
  );
}

/* ── Bash execution bubble ── */

function BashExecBubble({ msg, sessionId }: { msg: BashExecMessage; sessionId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelFailed, setCancelFailed] = useState(false);

  const isPending = (msg as unknown as Record<string, unknown>)._pendingExec === true;
  const isRunning = isPending && msg.exitCode === undefined;
  const hasOutput = msg.output.length > 0;

  // Auto-expand when command transitions from running → finished.
  // On fresh mount (page refresh/reloadMessages), stays collapsed.
  const wasRunning = useRef(isRunning);
  useEffect(() => {
    if (wasRunning.current && !isRunning) {
      setExpanded(true);
    }
    wasRunning.current = isRunning;
  }, [isRunning]);

  // Safety timeout: if we've been in cancelling state for 3s without
  // the command actually stopping (no exec_end SSE), force-show an
  // error so the user isn't stuck forever.
  useEffect(() => {
    if (!cancelling) return;
    const timeout = setTimeout(() => {
      setCancelling(false);
      setCancelFailed(true);
    }, 3000);
    return () => clearTimeout(timeout);
  }, [cancelling]);

  let icon: string;
  let status: string;
  if (msg.cancelled) {
    icon = "⛔";
    status = "cancelled";
  } else if (cancelFailed) {
    icon = "⚠️";
    status = "cancel timed out";
  } else if (cancelling) {
    icon = "⏳";
    status = "cancelling…";
  } else if (isRunning) {
    icon = "⟳";
    status = "running";
  } else if (msg.exitCode === 0) {
    icon = "✅";
    status = "success";
  } else {
    icon = "❌";
    status = `exit ${msg.exitCode ?? "?"}`;
  }

  return (
    <div className="message-row user">
      <div className="message-bubble user" style={{ borderLeft: "3px solid var(--accent-text)", maxWidth: "100%" }}>
        <div
          role={hasOutput ? "button" : undefined}
          tabIndex={hasOutput ? 0 : undefined}
          onClick={() => { if (!isRunning && hasOutput) setExpanded((v) => !v); }}
          onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !isRunning && hasOutput) { e.preventDefault(); setExpanded((v) => !v); } }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            cursor: hasOutput && !isRunning ? "pointer" : "default",
            userSelect: "none",
          }}
        >
          {hasOutput && !isRunning && (
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
          {/* Cancel button on running exec */}
          {isPending && isRunning && !cancelling && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setCancelling(true); cancelExec(sessionId); }}
              style={{
                marginLeft: "auto",
                background: "var(--bg-glass-active)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: "1px 6px",
                fontSize: 10,
                cursor: "pointer",
                color: "var(--text-secondary)",
              }}
            >
              cancel
            </button>
          )}
          {/* Cancelling feedback while server shortens the timeout */}
          {cancelling && isPending && (
            <span style={{ fontSize: 9, opacity: 0.5, marginLeft: "auto" }}>
              cancelling…
            </span>
          )}
          {/* Byte size when collapsed */}
          {hasOutput && !expanded && !isRunning && (
            <span style={{ fontSize: 9, opacity: 0.4, marginLeft: "auto" }}>
              {msg.output.length < 1024
                ? `${msg.output.length} B`
                : `${(msg.output.length / 1024).toFixed(1)} KB`}
            </span>
          )}
        </div>
        {/* Live output — always visible when running */}
        {isRunning && (
          <pre
            style={{
              fontSize: 11,
              fontFamily: "monospace",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              margin: "6px 0 0",
              maxHeight: 400,
              overflow: "auto",
              opacity: 0.85,
            }}
          >
            {msg.output || ""}
            <span style={{ animation: "blink 1s step-end infinite" }}>█</span>
          </pre>
        )}
        {/* Final output — collapsible */}
        {!isRunning && hasOutput && expanded && (
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
  const partsMessages = useSessionStore((s) => s.partsMessages);
  const streamingMessage = useSessionStore((s) => s.streamingMessage);
  const isStreaming = useSessionStore((s) => s.isStreaming);
  const rawCompactions = useSessionStore((s) => s.compactionsBySession[sessionId] ?? EMPTY_COMPACTIONS);
  // Only show compaction cards when the current leaf is AT a compaction
  // point (messages[0] is the SDK-synthesized compactionSummary). If you
  // navigate to a pre-compaction leaf, messages[0] is a normal user
  // message and compaction cards should be hidden.
  const rawMessages = useSessionStore((s) => s.messages);
  const compactions = (rawMessages as Record<string, unknown>[])[0]?.role === "compactionSummary"
    ? rawCompactions
    : EMPTY_COMPACTIONS;
  const queued = useSessionStore((s) => s.queuedBySession[sessionId]);
  const error = useSessionStore((s) => s.error);
  const clearError = useSessionStore((s) => s.clearError);
  const sendPrompt = useSessionStore((s) => s.sendPrompt);
  const { rewind: rewindAvailable } = useExtensions();

  const stickyUserHeader = usePreferencesStore((s) => s.stickyUserHeader);
  const showTokenUsage = usePreferencesStore((s) => s.showTokenUsage);

  // Push artifacts to the Artifacts Panel — scans both tool outputs AND
  // assistant text (fenced code blocks like ```svg, ```html, ```json, ```md)
  const pushArtifact = useLayoutStore((s) => s.pushArtifact);
  const seenArtifactIds = useRef(new Set<string>());
  useEffect(() => {
    const allMsgs = [...partsMessages, ...(streamingMessage ? [streamingMessage] : [])];
    for (const msg of allMsgs) {
      for (const part of msg.parts) {
        // ── Tool outputs ──
        if (part.type === "tool-call") {
          if (part.state === "running" || part.state === "input-available") continue;
          if (seenArtifactIds.current.has(part.toolCallId)) continue;
          const output = part.output ?? "";
          const trimmed = output.trim();

          // Detect artifact type from tool output content
          let artType: string | undefined;
          let artTitle: string = part.toolName === "javascript_repl"
            ? ((part.args?.title as string) || "REPL Output")
            : part.toolName;

          if (/^\s*<!doctype\s+html/i.test(trimmed) || /^\s*<html/i.test(trimmed)) {
            artType = "html";
          } else if (/^\s*<svg/i.test(trimmed) && trimmed.includes("</svg>")) {
            artType = "svg";
          } else if (/^data:image\//.test(trimmed)) {
            artType = "image";
          } else if (/^\s*[\[\{]/.test(trimmed)) {
            try { JSON.parse(trimmed); artType = "json"; } catch {}
          }

          if (artType) {
            seenArtifactIds.current.add(part.toolCallId);
            pushArtifact({ title: artTitle, type: artType as any, content: output, sessionId });
            if (isStreaming) {
              useLayoutStore.getState().setExplorerTab("artifacts");
            }
          }
        }
        // ── Assistant text — extract fenced code blocks ──
        if (part.type === "text") {
          const fenceRe = /```(svg|html|json|markdown|md|text|plain|txt|image)\s*\n([\s\S]*?)```/gi;
          let match: RegExpExecArray | null;
          while ((match = fenceRe.exec(part.text)) !== null) {
            const rawLang = match[1].toLowerCase();
            const content = match[2].trim();
            const artifactId = `${msg.id}-text-${match.index}`;
            if (seenArtifactIds.current.has(artifactId)) continue;
            seenArtifactIds.current.add(artifactId);

            // Normalize language to artifact type
            let type: string;
            let title: string;
            switch (rawLang) {
              case "svg":
                type = "svg"; title = "SVG"; break;
              case "html":
                type = "html"; title = "HTML"; break;
              case "json":
                type = "json"; title = "JSON"; break;
              case "markdown": case "md":
                type = "markdown"; title = "Markdown"; break;
              case "text": case "plain": case "txt":
                type = "text"; title = "Text"; break;
              case "image":
                type = "image"; title = "Image"; break;
              default:
                type = "text"; title = "Text";
            }

            pushArtifact({ title, type: type as any, content, sessionId });
            if (isStreaming) {
              useLayoutStore.getState().setExplorerTab("artifacts");
            }
          }
        }
      }
    }
  }, [partsMessages, streamingMessage, pushArtifact, sessionId]);

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
  // before the user sees anything.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const hasContent = partsMessages.length > 0 || streamingMessage !== undefined;
    if (el === null || !hasContent) return;
    if (isFollowingBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      lastScrollTopRef.current = el.scrollTop;
    } else {
      el.scrollTop = lastScrollTopRef.current;
    }
  }, [partsMessages, streamingMessage]);

  // Derive active tool name from the streaming message's running tool calls
  const activeToolName = useMemo(() => {
    if (!streamingMessage) return undefined;
    const running = streamingMessage.parts.find(
      (p): p is ToolCallPart => p.type === "tool-call" && p.state === "running",
    );
    return running?.toolName;
  }, [streamingMessage]);

  // Render loop: iterate messages by flat index so
  const renderedRows = useMemo(() => {
    const out: React.ReactNode[] = [];

    // Group compactions by insertBeforeIndex for O(1) lookup.
    const compactionsAt = new Map<number, CompactionEvent[]>();
    for (const ev of compactions) {
      const list = compactionsAt.get(ev.insertBeforeIndex) ?? [];
      list.push(ev);
      compactionsAt.set(ev.insertBeforeIndex, list);
    }

    const renderArchived = (ev: CompactionEvent): React.ReactNode => (
      <ArchivedMessages messages={ev.archivedMessages} />
    );

    // Push all compaction cards for a given raw message index.
    const pushCardsAt = (rawIdx: number): void => {
      const events = compactionsAt.get(rawIdx);
      if (events === undefined) return;
      for (const ev of events) {
        out.push(<CompactionCard key={`compaction-${ev.id}`} event={ev} renderArchived={() => renderArchived(ev)} />);
      }
    };

    // Kept-window: messages with rawIndex in [1, latestCard.insertBeforeIndex)
    // are hidden from inline rendering (shown inside CompactionCard expand).
    const latestCard =
      compactions.length > 0 ? compactions[compactions.length - 1] : undefined;
    const keptWindowEnd = latestCard?.insertBeforeIndex ?? 0;

    // Extract images from a UIMessage's parts
    const userImagesFromMsg = (msg: UIMessage): { mimeType: string; data: string; __blobUrl?: boolean }[] =>
      msg.parts
        .filter((p): p is ImagePart => p.type === "image")
        .map((p) => ({ mimeType: p.mimeType, data: p.data, __blobUrl: p.__blobUrl }));

    // Combine text from text parts
    const combineText = (parts: UIPart[]): string =>
      parts
        .filter((p): p is TextPart => p.type === "text")
        .map((p) => p.text)
        .join("\n\n");

    // Render a list of assistant messages by their parts.
    // Matches the old code's accumulation pattern from 1a37982:
    //   - Thinking blocks are pushed to prose, then TRAILING thinking
    //     before a tool call is extracted and bundled INTO the tool batch
    //   - Tools accumulate across messages via toolEntries
    //   - Prose segments flush the tool batch first (tools before text)
    const renderAssistantParts = (msgs: UIMessage[]): React.ReactNode[] => {
      const elements: React.ReactNode[] = [];
      const toolEntries: ToolBatchEntry[] = [];
      let contentSerial = 0;

      const flushToolBatch = (key: string) => {
        if (toolEntries.length === 0) return;
        const snapshot = toolEntries.slice();
        elements.push(
          <div key={key} className="message-row assistant">
            <div className="message-bubble assistant">
              <ToolCallBatchCard entries={snapshot as any} />
            </div>
          </div>,
        );
        toolEntries.length = 0;
      };

      // Render a group of text/thinking parts inside a single bubble.
      // Flushes accumulated tools BEFORE rendering prose (matching old
      // splitAssistantToolSegments: tools segments come before prose).
      const flushProse = (msgId: string, parts: (TextPart | ThinkingPart)[]) => {
        if (parts.length === 0) return;
        flushToolBatch(`pretool-${msgId}-${contentSerial}`);
        const serial = contentSerial++;
        elements.push(
          <div key={`prose-${msgId}-${serial}`} className="message-row assistant">
            <div className="message-bubble assistant">
              <div className="assistant-blocks">
                {parts.map((p, i) =>
                  p.type === "text" ? (
                    <ChatMarkdown key={i} text={p.text} />
                  ) : (
                    <ThinkingBlock key={i} text={p.text} />
                  ),
                )}
              </div>
            </div>
          </div>,
        );
      };

      // Extract trailing thinking blocks from prose (matching old
      // takeTrailingToolRunContext). These get bundled INTO the tool batch.
      const extractTrailingThinking = (prose: (TextPart | ThinkingPart)[]): ToolBatchEntry[] => {
        const result: ToolBatchEntry[] = [];
        while (prose.length > 0) {
          const last = prose[prose.length - 1]!;
          if (last.type !== "thinking") break;
          prose.pop();
          result.unshift({ kind: "thinking", block: { type: "thinking", thinking: last.text } as Record<string, unknown> });
        }
        return result;
      };

      for (const m of msgs) {
        const prose: (TextPart | ThinkingPart)[] = [];

        for (const part of m.parts) {
          if (part.type === "bash-exec") {
            flushProse(m.id, prose);
            prose.length = 0;
            flushToolBatch(`prebash-${m.id}`);

            const msgForBubble: BashExecMessage & { _pendingExec?: boolean } = {
              role: "bashExecution",
              command: part.command,
              output: part.output,
              exitCode: part.exitCode,
              cancelled: part.cancelled,
              truncated: part.truncated,
              timestamp: Date.now(),
              _pendingExec: part.state === "running",
            };
            elements.push(
              <BashExecBubble key={`bash-${m.id}`} msg={msgForBubble} sessionId={sessionId} />,
            );
          } else if (part.type === "tool-call") {
            // Extract trailing thinking from prose (bundles INTO batch)
            const trailing = extractTrailingThinking(prose);
            // Flush remaining text-only prose (flushes tools first)
            flushProse(m.id, prose);
            prose.length = 0;

            const CustomRenderer = toolRegistry.get(part.toolName);

            if (CustomRenderer) {
              flushToolBatch(`precustom-${m.id}-${part.toolCallId}`);
              elements.push(
                <div key={`custom-${m.id}-${part.toolCallId}`} className="message-row assistant">
                  <div className="message-bubble assistant">
                    <CustomRenderer part={part} messageId={m.id} />
                  </div>
                </div>,
              );
              continue;
            }

            // Add trailing thinking + tool to accumulated entries
            toolEntries.push(...trailing);
            toolEntries.push({
              kind: "tool",
              block: {
                name: part.toolName,
                arguments: part.args,
                id: part.toolCallId,
              } as Record<string, unknown>,
              result:
                part.state !== "input-available" && part.state !== "running"
                  ? ({
                      content: [{ type: "text", text: part.output ?? "" }],
                      isError: part.state === "error",
                    } as unknown as Record<string, unknown>)
                  : undefined,
            } as ToolBatchEntry);
          } else {
            // text or thinking — accumulate in prose array
            prose.push(part as TextPart | ThinkingPart);
          }
        }

        // Flush remaining prose at message boundary (flushes tools first)
        flushProse(m.id, prose);
        // Tools are NOT flushed here — they accumulate across messages
      }

      // Flush remaining tools at end of turn
      flushToolBatch(`toolbatch-end`);
      return elements;
    };

    // ── Turn-grouped rendering ──
    let currentUser: UIMessage | undefined;
    let currentAssistants: UIMessage[] = [];

    const flushTurn = (): void => {
      if (currentUser === undefined) return;
      const text = combineText(currentUser.parts);
      const combinedAssistantText = currentAssistants
        .map((m) => combineText(m.parts))
        .filter((t) => t.length > 0)
        .join("\n\n");

      const isSteer =
        (currentUser.metadata as { steer?: boolean } | undefined)?.steer === true;
      const lastAssistant = currentAssistants[currentAssistants.length - 1];

      if (stickyUserHeader && text.length > 0) {
        out.push(
          <div key={`turn-${currentUser.id}`} style={{ position: "relative" }}>
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 10,
                background: "var(--bg-solid)",
                overflowAnchor: "none",
              }}
            >
              <UserMessageBubble text={text} isSteer={isSteer} images={userImagesFromMsg(currentUser)} />
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
            {renderAssistantParts(currentAssistants)}
            {combinedAssistantText.length > 0 && (
              <div className="assistant-msg-footer">
                <CopyMsgButton getText={() => combinedAssistantText} />
                <SaveAsPngButton getText={() => combinedAssistantText} />
                {showTokenUsage && (
                  <TokenUsageBadge msg={lastAssistant as unknown as Record<string, unknown>} />
                )}
                <ModelBadge
                  msg={lastAssistant as unknown as Record<string, unknown>}
                  fallbackModel={modelName}
                  fallbackProvider={providerName}
                />
              </div>
            )}
          </div>,
        );
      } else {
        // Non-sticky mode
        out.push(
          <div
            key={`user-${currentUser.id}`}
            className="message-row user"
            data-message-raw-index={currentUser.rawIndex}
          >
            <div className="message-bubble user">
              {isSteer && <span className="steer-tag">steer</span>}
              <UserImages images={userImagesFromMsg(currentUser)} />
              {text}
            </div>
          </div>,
        );
        if (text.length > 0) {
          out.push(
            <div key={`user-${currentUser.id}-copy`} className="assistant-msg-footer user">
              <CopyMsgButton getText={() => text} />
              {rewindAvailable && <RewindMsgButton sessionId={sessionId} />}
            </div>,
          );
        }
        if (currentAssistants.length > 0) out.push(...renderAssistantParts(currentAssistants));
        if (combinedAssistantText.length > 0) {
          out.push(
            <div key={`turn-${currentUser.id}-copy`} className="assistant-msg-footer">
              <CopyMsgButton getText={() => combinedAssistantText} />
              <SaveAsPngButton getText={() => combinedAssistantText} />
              {showTokenUsage && (
                <TokenUsageBadge msg={lastAssistant as unknown as Record<string, unknown>} />
              )}
              <ModelBadge
                msg={lastAssistant as unknown as Record<string, unknown>}
                fallbackModel={modelName}
                fallbackProvider={providerName}
              />
            </div>,
          );
        }
      }

      currentUser = undefined;
      currentAssistants = [];
    };

    // ── Iterate normalized parts messages ──
    // 🔔 Insert compaction cards at rawIndex=0 (compactionSummary was
    // filtered out by normalizeMessages, so no msg has rawIndex=0).
    pushCardsAt(0);
    for (const msg of partsMessages) {
      // Insert compaction cards based on the raw message index
      pushCardsAt(msg.rawIndex);

      // Kept-window: messages with rawIndex in [1, keptWindowEnd) are archived
      if (latestCard !== undefined && msg.rawIndex >= 1 && msg.rawIndex < keptWindowEnd) {
        continue;
      }

      if (msg.role === "user") {
        flushTurn();
        currentUser = msg;
      } else {
        // Assistant message (may contain bash-exec, text, thinking, tool-call parts)
        if (currentUser !== undefined) {
          currentAssistants.push(msg);
        } else {
          // Orphan assistant (kept-window edge case)
          out.push(...renderAssistantParts([msg]));
        }
      }
    }

    flushTurn();

    // Trailing compaction cards
    const lastRawIdx =
      partsMessages.length > 0
        ? partsMessages[partsMessages.length - 1].rawIndex + 1
        : rawMessages.length;
    pushCardsAt(lastRawIdx);

    return out;
  }, [
    partsMessages,
    streamingMessage,
    stickyUserHeader,
    compactions,
    sessionId,
    rewindAvailable,
    rawMessages,
  ]);

  return (
    <div className="messages-container" style={stickyUserHeader ? { paddingTop: 50 } : undefined}>
      {error !== undefined && (
        <div onClick={clearError} className="error-banner">
          {error} — click to dismiss
        </div>
      )}

      {partsMessages.length === 0 && !isStreaming ? (
        <div className="welcome">
          <div className="welcome-icon">💬</div>
          <div className="welcome-text">Send a message to start chatting</div>
          <div className="welcome-hint">with the pi coding agent</div>
        </div>
      ) : (
        <div ref={scrollRef} onScroll={onScroll} style={stickyUserHeader ? { paddingTop: 0 } : undefined} className="chat-scroll">
          <div className="chat-message-list">
            {renderedRows}

            {isStreaming && streamingMessage !== undefined && (
              <div className="message-row assistant streaming-row">
                <div className="message-bubble assistant streaming-bubble">
                  {activeToolName && (
                    <div className="tool-badge">
                      <span className="tool-badge-dot" />
                      {activeToolName}
                    </div>
                  )}
                  {streamingMessage.parts.map((part, i) => {
                    if (part.type === "text") {
                      return <ChatMarkdown key={i} text={(part as TextPart).text} />;
                    }
                    if (part.type === "thinking") {
                      return <ThinkingBlock key={i} text={(part as ThinkingPart).text} />;
                    }
                    return null;
                  })}
                </div>
              </div>
            )}

            {isStreaming && streamingMessage === undefined && (
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
