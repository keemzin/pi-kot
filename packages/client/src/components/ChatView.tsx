import {
	useEffect,
	useRef,
	useState,
	useMemo,
	memo,
} from "react";
import { Copy, Check, CornerUpLeft, ImageDown } from "lucide-react";
import { useExtensions } from "../hooks/use-extensions";
import { invokeExtensionCommand, cancelExec } from "../lib/api-client";
import type { CompactionEvent } from "../lib/api-client";
import { toPng } from "html-to-image";
import { ChatMarkdown } from "./ChatMarkdown";
import { CompactionCard } from "./CompactionCard";
import { CompactionNotice } from "./CompactionNotice";
import type { ActiveCompaction } from "../stores/session-store";
import { ChatEditDiff, ChatDiffViewProvider } from "./ChatEditDiff";
import { toolRegistry } from "../lib/tool-registry";
import { ReplSandbox } from "./ReplSandbox";

// Register custom tool renderers
toolRegistry.register("javascript_repl", ({ part }) => (
	<ReplSandbox
		code={(part.args?.code as string) ?? ""}
		title={(part.args?.title as string) ?? ""}
		serverOutput={
			part.state !== "input-available" && part.state !== "running"
				? (part.output ?? "")
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
/** Shape of a tool-call part derived from paired SDK ToolCall + ToolResultMessage. */
interface ToolCallPart {
	type: "tool-call";
	toolName: string;
	toolCallId: string;
	args: Record<string, unknown>;
	state: "input-available" | "running" | "success" | "error";
	output?: string;
	errorText?: string;
	details?: unknown;
}

/** Shape passed to custom tool renderers (tool-registry.tsx). */
export type { ToolCallPart as ToolCallPartExport } from "../lib/tool-registry";

/** Local mirror of tool-call-pairing types (for ToolCallEntry/ToolCallBatchCard compat). */
interface PairableMessage {
	role?: string;
	type?: string;
	content?: unknown;
	toolCallId?: unknown;
	details?: unknown;
	isError?: boolean;
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
/** Extract text from an SDK content array, concatenating text blocks. */
function extractContentText(content: unknown): string {
	if (!Array.isArray(content))
		return typeof content === "string" ? content : "";
	return content
		.filter((c: Record<string, unknown>) => c.type === "text")
		.map((c: Record<string, unknown>) => String(c.text ?? ""))
		.join("\n\n");
}

function extractImages(
	content: unknown,
): { mimeType: string; data: string; __blobUrl?: boolean }[] {
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
function UserImages({
	images,
}: {
	images: { mimeType: string; data: string; __blobUrl?: boolean }[];
}) {
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
							background: isUser ? "var(--user-bubble)" : "transparent",
							border: isUser ? "1px solid var(--user-bubble-border)" : "none",
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

/* ── Tool Call Components ── */

/** Map a tool name to a descriptive emoji icon. */
function getToolIcon(name: string): string {
	const n = name.toLowerCase();
	if (
		n.includes("bash") ||
		n.includes("shell") ||
		n.includes("exec") ||
		n.includes("run")
	)
		return "⚡";
	if (
		n.includes("read") ||
		n.includes("cat") ||
		n.includes("view") ||
		n.includes("get")
	)
		return "📄";
	if (
		n.includes("write") ||
		n.includes("create") ||
		n.includes("save") ||
		n.includes("put")
	)
		return "✏️";
	if (
		n.includes("edit") ||
		n.includes("patch") ||
		n.includes("update") ||
		n.includes("replace")
	)
		return "🔧";
	if (
		n.includes("search") ||
		n.includes("grep") ||
		n.includes("find") ||
		n.includes("ls") ||
		n.includes("list")
	)
		return "🔍";
	if (n.includes("delete") || n.includes("remove") || n.includes("rm"))
		return "🗑️";
	if (n.includes("move") || n.includes("rename") || n.includes("mv"))
		return "📦";
	if (n.includes("git") || n.includes("commit") || n.includes("branch"))
		return "🌿";
	if (
		n.includes("web") ||
		n.includes("fetch") ||
		n.includes("http") ||
		n.includes("url")
	)
		return "🌐";
	if (n.includes("test") || n.includes("spec")) return "🧪";
	if (n.includes("ask") || n.includes("question") || n.includes("prompt"))
		return "💬";
	return "🔩";
}

/**
 * Extract a human-friendly filename from a tool result/block for display
 * in the tool entry header. Reads from `details` or `input` since the
 * SDK stores it on different fields depending on the tool and version.
 */
function extractFilename(message: Record<string, unknown>): string | undefined {
	const details = message.details as
		| {
				path?: unknown;
				filename?: unknown;
				file?: unknown;
				file_path?: unknown;
		  }
		| undefined;
	const input = message.input as
		| {
				path?: unknown;
				filename?: unknown;
				file?: unknown;
				file_path?: unknown;
		  }
		| undefined;
	for (const src of [details, input]) {
		if (src === undefined) continue;
		if (typeof src.path === "string") return src.path;
		if (typeof src.filename === "string") return src.filename;
		if (typeof src.file === "string") return src.file;
		if (typeof src.file_path === "string") return src.file_path;
	}
	return undefined;
}

/**
 * Cheap +/- counter for a unified diff string. Skips `---`/`+++` header lines
 * so only actual additions/deletions are counted.
 */
function countDiffLines(diff: string): { adds: number; dels: number } {
	let adds = 0;
	let dels = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) adds += 1;
		else if (line.startsWith("-")) dels += 1;
	}
	return { adds, dels };
}

/** Render the thinking block content. */
function ThinkingBlock({ text }: { text: string }) {
	const showThinking = usePreferencesStore((s) => s.showThinking);
	const [open, setOpen] = useState(false);

	if (!showThinking) return null;

	return (
		<details open={open} className="thinking-block">
			<summary
				onClick={(e) => {
					e.preventDefault();
					setOpen((o) => !o);
				}}
			>
				{open ? "▾" : "▸"} Thinking…
			</summary>
			{open && <pre className="thinking-content">{text}</pre>}
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
	const [justCompleted, setJustCompleted] = useState(false);
	const wasRunning = useRef(result === undefined);
	useEffect(() => {
		if (wasRunning.current && result !== undefined) {
			setJustCompleted(true);
			const t = setTimeout(() => setJustCompleted(false), 600);
			return () => clearTimeout(t);
		}
		wasRunning.current = result === undefined;
	}, [result]);
	const name = String(block.name ?? "tool");
	const args = block.arguments ?? block.input ?? {};
	const argsText =
		typeof args === "string" ? args : JSON.stringify(args, null, 2);

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
	const outputPreview =
		outputText.split("\n").find((l) => l.trim().length > 0) ?? "";

	const preview = toolPreviewFromArgs(name, args);
	const icon = getToolIcon(name);

	// For `edit`, prefer the unified diff string the SDK puts on
	// result.details (details.diff). When absent (e.g. some providers),
	// fall back to
	// outputText so the diff card still renders.
	const editDiff =
		name === "edit" && result !== undefined
			? (() => {
					const d = (result.details as { diff?: unknown } | undefined)?.diff;
					return typeof d === "string" ? d : outputText;
				})()
			: undefined;
	const editFn =
		name === "edit" && result !== undefined
			? extractFilename(result)
			: undefined;
	const editStats =
		editDiff !== undefined ? countDiffLines(editDiff) : undefined;

	return (
		<div
			className={`tool-timeline-node ${isRunning ? " running" : isError ? " error" : " success"}`}
		>
			<span
				className={`tool-timeline-icon${isRunning ? " running" : isError ? " error" : " success"}${justCompleted ? " just-completed" : ""}`}
				aria-hidden="true"
			>
				{icon}
			</span>
			<div className="tool-timeline-content">
				<div className="tool-timeline-row">
					<span className="tool-timeline-name">{name}</span>
					{preview && (
						<span className="tool-timeline-arg" title={preview}>
							{preview}
						</span>
					)}
					{isRunning && (
						<span className="tool-timeline-running" aria-label="running">
							running…
						</span>
					)}
					{(argsText.length > 2 || outputText.length > 0) && (
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
						{isError ? "✖ " : "✓ "}
						{outputPreview}
					</div>
				)}
				{/* Expanded details pane */}
				{detailsOpen && (
					<div className="tool-timeline-details">
						{argsText.length > 2 && (
							<div>
								<div className="tool-timeline-section-label">input</div>
								<pre className="tool-timeline-code">{argsText}</pre>
							</div>
						)}
						{editDiff !== undefined && editStats !== undefined ? (
							<div className="overflow-hidden px-3 pb-2">
								<ChatEditDiff
									diff={editDiff}
									filename={editFn}
									adds={editStats.adds}
									dels={editStats.dels}
								/>
							</div>
						) : outputText.length > 0 ? (
							<div>
								<div className="tool-timeline-section-label">
									{isError ? "error" : "output"}
									{editStats !== undefined && !isError && (
										<span className="ml-2 font-mono text-[10px]">
											<span className="text-emerald-400 light:text-emerald-700">
												+{editStats.adds}
											</span>{" "}
											<span className="text-red-400 light:text-red-700">
												-{editStats.dels}
											</span>
											{editFn !== undefined && (
												<span className="ml-1 text-neutral-500">{editFn}</span>
											)}
										</span>
									)}
								</div>
								<pre className="tool-timeline-code">{outputText}</pre>
							</div>
						) : null}
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
	const completedCount = toolEntries.filter(
		(e) => e.result !== undefined && !e.result?.isError,
	).length;
	const erroredCount = toolEntries.filter((e) => e.result?.isError === true).length;
	const errored = erroredCount > 0;
	const runningCount = toolEntries.filter((e) => e.result === undefined).length;
	const allDone = runningCount === 0 && toolCount > 0;

	// Unique tool names for the inline preview
	const names = [
		...new Set(toolEntries.map((e) => String(e.block.name ?? "tool"))),
	];
	const previewText =
		names.slice(0, 4).join(" · ") + (names.length > 4 ? " · …" : "");

	return (
		<details open={open} className="tool-timeline" style={{ marginLeft: 0 }}>
			<summary
				className="tool-timeline-header"
				onClick={(e) => {
					e.preventDefault();
					setOpen((o) => !o);
				}}
				aria-label={`${toolCount} tool ${toolCount === 1 ? "call" : "calls"}: ${previewText}`}
			>
				<span className="tool-timeline-chevron" aria-hidden="true">
					{open ? "▾" : "▸"}
				</span>
				<span className="tool-timeline-batch-label">
					↳ {toolCount} {toolCount === 1 ? "tool" : "tools"}
				</span>
				{toolCount > 1 && (
					<span className="tool-timeline-batch-count">
						{allDone ? (
							<>
								{completedCount > 0 && <span className="done">✓ {completedCount}</span>}
								{erroredCount > 0 && <span className="tool-timeline-badge error">✖ {erroredCount}</span>}
							</>
						) : (
							<>
								{completedCount > 0 && (
									<span className="done">✓ {completedCount}</span>
								)}
								{erroredCount > 0 && (
									<span className="tool-timeline-badge error" style={{ marginLeft: "4px" }}>✖ {erroredCount}</span>
								)}
								{runningCount > 0 && (
									<span className="pending"> ⟳ {runningCount}</span>
								)}
							</>
						)}
					</span>
				)}
				<span className="tool-timeline-batch-preview">{previewText}</span>
				{errored && toolCount === 1 && (
					<span className="tool-timeline-badge error" aria-label="error">
						error
					</span>
				)}
			</summary>
			<div className="tool-timeline-track">
				{entries.map((entry, j) =>
					entry.kind === "thinking" ? (
						<ThinkingBlock
							key={j}
							text={(entry.block.thinking as string) ?? ""}
						/>
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

function UserMessageBubble({
	text,
	isSteer,
	images,
}: {
	text: string;
	isSteer?: boolean;
	images?: { mimeType: string; data: string; __blobUrl?: boolean }[];
}) {
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
					style={
						{
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
						} as React.CSSProperties
					}
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
		const writeAsync = navigator.clipboard?.writeText?.bind(
			navigator.clipboard,
		);
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
			if (child === footer) {
				pastFooter = true;
				continue;
			}
			if (!pastFooter) continue;
			if (child.classList.contains("message-row")) {
				const bubble = child.querySelector<HTMLElement>(
					".message-bubble.assistant",
				);
				if (bubble) {
					// Only take the last assistant bubble (closest to footer) — tool calls come before
					sourceBubbles.push(bubble);
					break;
				}
				continue;
			}
			if (
				child.classList.contains("message-row") &&
				child.classList.contains("user")
			) {
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
				clone
					.querySelectorAll<HTMLElement>(
						".copy-msg-btn, .rewind-btn, .code-copy-btn, .tool-timeline-details-btn",
					)
					.forEach((el) => {
						el.style.display = "none";
					});

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

function BashExecBubble({
	msg,
	sessionId,
}: {
	msg: BashExecMessage;
	sessionId: string;
}) {
	const [expanded, setExpanded] = useState(false);
	const [cancelling, setCancelling] = useState(false);
	const [cancelFailed, setCancelFailed] = useState(false);

	const isPending =
		(msg as unknown as Record<string, unknown>)._pendingExec === true;
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
			<div
				className="message-bubble user"
				style={{ borderLeft: "3px solid var(--accent-text)", maxWidth: "100%" }}
			>
				<div
					role={hasOutput ? "button" : undefined}
					tabIndex={hasOutput ? 0 : undefined}
					onClick={() => {
						if (!isRunning && hasOutput) setExpanded((v) => !v);
					}}
					onKeyDown={(e) => {
						if (
							(e.key === "Enter" || e.key === " ") &&
							!isRunning &&
							hasOutput
						) {
							e.preventDefault();
							setExpanded((v) => !v);
						}
					}}
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
						<span
							style={{
								fontSize: 9,
								opacity: 0.5,
								width: 12,
								textAlign: "center",
								flexShrink: 0,
							}}
						>
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
						<span
							style={{
								fontSize: 9,
								padding: "0 4px",
								borderRadius: 3,
								background: "var(--bg-subtle)",
								opacity: 0.5,
							}}
						>
							local only
						</span>
					)}
					{/* Cancel button on running exec */}
					{isPending && isRunning && !cancelling && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								setCancelling(true);
								cancelExec(sessionId);
							}}
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

function TokenUsageBadge({ msg }: { msg?: Record<string, unknown> }) {
	const usage = msg?.usage as
		| { input?: number; output?: number; cacheRead?: number }
		| undefined;
	const input = usage?.input;
	const output = usage?.output;
	if (input == null && output == null) return null;

	return (
		<span style={{ display: "flex", alignItems: "center", gap: 6 }}>
			{input != null && (
				<span style={{ fontSize: 10, color: "var(--text-secondary)" }}>
					↑{input.toLocaleString()}
				</span>
			)}
			{output != null && (
				<span style={{ fontSize: 10, color: "var(--text-secondary)" }}>
					↓{output.toLocaleString()}
				</span>
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

function ModelBadge({
	msg,
	fallbackModel,
	fallbackProvider,
}: {
	msg?: Record<string, unknown>;
	fallbackModel?: string;
	fallbackProvider?: string;
}) {
	const modelName =
		(typeof msg?.model === "string" ? msg.model : undefined) ?? fallbackModel;
	const providerName =
		(typeof msg?.provider === "string" ? msg.provider : undefined) ??
		fallbackProvider;
	if (!modelName) return null;
	return (
		<span className="assistant-msg-model">
			{providerName ? `${providerName} / ` : ""}
			{modelName}
		</span>
	);
}

/** Render content blocks from a raw SDK streaming message (no tool-call parts — those go in ToolCallBatchCard). */
function renderStreamingContent(msg: Record<string, unknown>): React.ReactNode {
	const content = msg.content;
	if (!Array.isArray(content)) {
		const text = typeof content === "string" ? content : "";
		return text ? <ChatMarkdown text={text} /> : null;
	}
	return (
		<>
			{content.map((chunk: Record<string, unknown>, i: number) => {
				if (chunk.type === "text" && typeof chunk.text === "string") {
					return <ChatMarkdown key={i} text={chunk.text} />;
				}
				if (
					(chunk.type === "thinking" || chunk.type === "reasoning") &&
					typeof chunk.thinking === "string"
				) {
					return <ThinkingBlock key={i} text={chunk.thinking} />;
				}
				return null;
			})}
		</>
	);
}

/* ── Main ChatView ── */

const MAX_TOOL_BATCH_TOOLS = 100;

export function ChatView({ sessionId, modelName, providerName }: Props) {
	const messages = useSessionStore((s) => s.messages);
	const streamingMessage = useSessionStore((s) => s.streamingMessage);
	const isStreaming = useSessionStore((s) => s.isStreaming);
	const rawCompactions = useSessionStore(
		(s) => s.compactionsBySession[sessionId] ?? EMPTY_COMPACTIONS,
	);
	const activeCompaction = useSessionStore((s) => s.activeCompaction);
	const rawMessages = useSessionStore((s) => s.messages);
	// Compaction cards render if we have data — no need to check
	// `messages[0]?.role === "compactionSummary"` as a guard. That
	// check fails in a timing race when manual compaction (via
	// compactAndReload) loads compactions before messages are refetched.
	const compactions = rawCompactions;
	const queued = useSessionStore((s) => s.queuedBySession[sessionId]);
	const error = useSessionStore((s) => s.error);
	const clearError = useSessionStore((s) => s.clearError);
	const sendPrompt = useSessionStore((s) => s.sendPrompt);
	const { rewind: rewindAvailable } = useExtensions();

	const stickyUserHeader = usePreferencesStore((s) => s.stickyUserHeader);
	const showTokenUsage = usePreferencesStore((s) => s.showTokenUsage);

	// Build tool-result lookup at render time from messages (SDK has separate toolResult messages)
	const buildToolResultMap = (
		msgs: unknown[],
	): Map<string, Record<string, unknown>> => {
		const map = new Map<string, Record<string, unknown>>();
		for (const m of msgs) {
			const msg = m as Record<string, unknown>;
			if (msg.role === "toolResult" && typeof msg.toolCallId === "string") {
				map.set(msg.toolCallId, msg);
			}
		}
		return map;
	};

	// Push artifacts to the Artifacts Panel
	const pushArtifact = useLayoutStore((s) => s.pushArtifact);
	const seenArtifactIds = useRef(new Set<string>());
	useEffect(() => {
		const allMsgs = [
			...messages,
			...(streamingMessage ? [streamingMessage] : []),
		];
		for (const msg of allMsgs) {
			const m = msg as Record<string, unknown>;
			const contents = m.content;
			if (!Array.isArray(contents)) continue;

			for (const chunk of contents) {
				const c = chunk as Record<string, unknown>;
				// ── Tool outputs ──
				if (c.type === "toolCall") {
					const toolCallId = typeof c.id === "string" ? c.id : "";
					if (seenArtifactIds.current.has(toolCallId)) continue;
					seenArtifactIds.current.add(toolCallId);

					// Find the paired result for output
					const resultMap = buildToolResultMap(messages);
					const result = resultMap.get(toolCallId);
					const outputText = extractContentText(result?.content);
					const trimmed = outputText.trim();

					let artType: string | undefined;
					const artTitle = typeof c.name === "string" ? c.name : "Tool Output";

					if (
						/^\s*<!doctype\s+html/i.test(trimmed) ||
						/^\s*<html/i.test(trimmed)
					) {
						artType = "html";
					} else if (/^\s*<svg/i.test(trimmed) && trimmed.includes("</svg>")) {
						artType = "svg";
					} else if (/^data:image\//.test(trimmed)) {
						artType = "image";
					} else if (/^\s*[[{]/.test(trimmed)) {
						try {
							JSON.parse(trimmed);
							artType = "json";
						} catch {}
					}

					if (artType) {
						pushArtifact({
							title: artTitle,
							type: artType as any,
							content: outputText,
							sessionId,
						});
					}
				}
				// ── Assistant text — extract fenced code blocks ──
				if (c.type === "text" && typeof c.text === "string") {
					const fenceRe =
						/```(svg|html|json|markdown|md|text|plain|txt|image)\s*\n([\s\S]*?)```/gi;
					let match: RegExpExecArray | null;
					while ((match = fenceRe.exec(c.text)) !== null) {
						const rawLang = match[1].toLowerCase();
						const content = match[2].trim();
						// Use message id + text position as stable artifact key
						const artifactId = `${(m.id as string) ?? ""}-text-${match.index}`;
						if (seenArtifactIds.current.has(artifactId)) continue;
						seenArtifactIds.current.add(artifactId);

						let type: string;
						let title: string;
						switch (rawLang) {
							case "svg":
								type = "svg";
								title = "SVG";
								break;
							case "html":
								type = "html";
								title = "HTML";
								break;
							case "json":
								type = "json";
								title = "JSON";
								break;
							case "markdown":
							case "md":
								type = "markdown";
								title = "Markdown";
								break;
							case "text":
							case "plain":
							case "txt":
								type = "text";
								title = "Text";
								break;
							case "image":
								type = "image";
								title = "Image";
								break;
							default:
								type = "text";
								title = "Text";
						}
						pushArtifact({ title, type: type as any, content, sessionId });
					}
				}
			}
		}
	}, [messages, streamingMessage, pushArtifact, sessionId]);

	const scrollRef = useRef<HTMLDivElement>(null);
	const isFollowingBottomRef = useRef(true);
	const lastScrollTopRef = useRef(0);
	const prevStreamingRef = useRef<Record<string, unknown> | undefined>(undefined);

	const NEAR_BOTTOM_PX = 24;

	// onScroll: releases auto-follow when user scrolls up past the
	// bottom zone, and re-engages when they scroll back down into it.
	// The ResizeObserver corrects scrollTop before the scroll event
	// fires, so content growth never falsely reads as "scrolled up".
	const onScroll = (): void => {
		const el = scrollRef.current;
		if (el === null) return;
		const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
		const scrolledUp = el.scrollTop < lastScrollTopRef.current - 1;
		const nearBottom = distance <= NEAR_BOTTOM_PX;
		if (scrolledUp && !nearBottom) {
			isFollowingBottomRef.current = false;
		} else if (!scrolledUp && nearBottom) {
			isFollowingBottomRef.current = true;
		}
		lastScrollTopRef.current = el.scrollTop;
	};

	// ResizeObserver: fires after layout and before paint on EVERY content
	// size change — streaming text growth, tool results expanding, code
	// highlighting landing, etc. This makes auto-follow truly sticky.
	// Unlike useLayoutEffect (which only fires when the deps change), this
	// catches layout changes from any source, even inside memo'd children.
	useEffect(() => {
		const el = scrollRef.current;
		if (!el || typeof ResizeObserver === 'undefined') return;

		const streamingJustEnded =
			prevStreamingRef.current !== undefined && streamingMessage === undefined;
		prevStreamingRef.current = streamingMessage;

		// When streaming just ended, skip the first ResizeObserver callback
		// (the finalized messages replace streaming content at same height).
		let settled = false;
		let active = true;
		const ro = new ResizeObserver(() => {
			if (!active) return; // stale callback after cleanup
			if (streamingJustEnded && !settled) {
				settled = true;
				return;
			}
			if (isFollowingBottomRef.current) {
				el.scrollTop = el.scrollHeight;
				lastScrollTopRef.current = el.scrollTop;
			}
		});
		ro.observe(el);
		const inner = el.firstElementChild;
		if (inner instanceof Element) ro.observe(inner);

		return () => {
			active = false;
			ro.disconnect();
		};
	}, [rawMessages, streamingMessage]);

	// On session change (project switch, initial load), pin to bottom.
	useEffect(() => {
		if (rawMessages.length === 0 && streamingMessage === undefined) return;
		isFollowingBottomRef.current = true;
	}, [sessionId]);

	// Derive active tool name from the streaming message's tool call content blocks
	// paired with pendingToolCalls from state.
	const activeToolName = useMemo(() => {
		if (!streamingMessage) return undefined;
		const content = (streamingMessage as Record<string, unknown>).content;
		if (!Array.isArray(content)) return undefined;
		// Any toolCall in the streaming message that has no result yet = running
		const toolCall = content.find(
			(c: Record<string, unknown>) => c.type === "toolCall",
		);
		return toolCall ? String(toolCall.name ?? "tool") : undefined;
	}, [streamingMessage]);

	// Render loop: iterate messages by flat index so
	// Build tool-result map at render time for pairing tool calls with results
	const toolResults = useMemo(() => {
		const map = new Map<string, Record<string, unknown>>();
		for (const m of messages) {
			const msg = m as Record<string, unknown>;
			if (msg.role === "toolResult" && typeof msg.toolCallId === "string") {
				map.set(msg.toolCallId, msg);
			}
		}
		return map;
	}, [messages]);

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

		const pushCardsAt = (rawIdx: number): void => {
			const events = compactionsAt.get(rawIdx);
			if (events === undefined) return;
			for (const ev of events) {
				out.push(
					<CompactionCard
						key={`compaction-${ev.id}`}
						event={ev}
						renderArchived={() => renderArchived(ev)}
					/>,
				);
			}
		};

		const latestCard =
			compactions.length > 0 ? compactions[compactions.length - 1] : undefined;
		const keptWindowEnd = latestCard?.insertBeforeIndex ?? 0;

		// Extract images from raw SDK message content
		const userImagesFromMsg = (
			msg: Record<string, unknown>,
		): { mimeType: string; data: string; __blobUrl?: boolean }[] =>
			extractImages(msg.content);

		// Combine text from raw SDK message content
		const combineTextFromMsg = (msg: Record<string, unknown>): string =>
			extractContentText(msg.content);

		// Render a list of assistant messages by their SDK content blocks.
		// - text blocks   → ChatMarkdown (accumulated in prose, then flushed)
		// - thinking      → ThinkingBlock (trailing thinking bundled INTO tool batch)
		// - toolCall      → ToolCallBatchCard (paired with toolResults map)
		const renderAssistantParts = (
			msgs: Record<string, unknown>[],
		): React.ReactNode[] => {
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

			const flushProse = (
				msgId: string,
				parts: { type: string; text?: string }[],
			) => {
				if (parts.length === 0) return;
				flushToolBatch(`pretool-${msgId}-${contentSerial}`);
				const serial = contentSerial++;
				elements.push(
					<div
						key={`prose-${msgId}-${serial}`}
						className="message-row assistant"
					>
						<div className="message-bubble assistant">
							<div className="assistant-blocks">
								{parts.map((p, i) =>
									p.type === "text" ? (
										<ChatMarkdown key={i} text={p.text ?? ""} />
									) : (
										<ThinkingBlock key={i} text={p.text ?? ""} />
									),
								)}
							</div>
						</div>
					</div>,
				);
			};

			// Extract trailing thinking blocks from prose. Bundled INTO tool batch.
			const extractTrailingThinking = (
				prose: { type: string; text?: string }[],
			): ToolBatchEntry[] => {
				const result: ToolBatchEntry[] = [];
				while (prose.length > 0) {
					const last = prose[prose.length - 1]!;
					if (last.type !== "thinking") break;
					prose.pop();
					result.unshift({
						kind: "thinking",
						block: { type: "thinking", thinking: last.text } as Record<
							string,
							unknown
						>,
					});
				}
				return result;
			};

			for (const m of msgs) {
				// Handle non-assistant message types at the message level
				const role = m.role as string | undefined;
				if (role === "bashExecution") {
					elements.push(
						<BashExecBubble
							key={`bash-${String(m.timestamp ?? m.command ?? "")}`}
							msg={m as unknown as BashExecMessage}
							sessionId={sessionId}
						/>,
					);
					continue;
				}
				if (role === "branchSummary") {
					const summary = (m.summary as string) ?? "";
					const fromId = m.fromId as string | undefined;
					elements.push(
						<div
							key={`branch-${String(m.id ?? "")}`}
							className="message-row assistant"
						>
							<div className="message-bubble assistant">
								<div className="branch-summary-block">
									<div className="branch-summary-label">Branch Summary</div>
									<ChatMarkdown text={summary} />
									{fromId && (
										<div className="branch-summary-from" title={fromId}>
											from {fromId.slice(0, 8)}...
										</div>
									)}
								</div>
							</div>
						</div>,
					);
					continue;
				}
				if (role === "custom") {
					const customType = (m.customType as string) ?? "custom";
					const customContent = m.content;
					const details = m.details;
					let renderedContent: React.ReactNode;
					if (typeof customContent === "string") {
						renderedContent = <ChatMarkdown text={customContent} />;
					} else if (Array.isArray(customContent)) {
						renderedContent = (
							<div>
								{customContent.map(
									(block: Record<string, unknown>, i: number) =>
										block.type === "text" ? (
											<ChatMarkdown key={i} text={String(block.text ?? "")} />
										) : block.type === "image" ? (
											<img
												key={i}
												src={`data:${String(block.mimeType ?? "image/png")};base64,${String(block.data ?? "")}`}
												alt="Custom message image"
												style={{ maxWidth: "100%", height: "auto" }}
											/>
										) : null,
								)}
							</div>
						);
					} else {
						renderedContent = null;
					}
					elements.push(
						<div
							key={`custom-msg-${String(m.id ?? "")}`}
							className="message-row assistant"
						>
							<div className="message-bubble assistant">
								<div className="custom-message-block">
									{customType !== "custom" && (
										<div className="custom-message-type">{customType}</div>
									)}
									{renderedContent}
									{details != null && (
										<details className="custom-message-details">
											<summary>Details</summary>
											<pre>{JSON.stringify(details, null, 2)}</pre>
										</details>
									)}
								</div>
							</div>
						</div>,
					);
					continue;
				}

				// Assistant messages — render content[] blocks
				const content = m.content;
				if (!Array.isArray(content)) {
					const text = typeof content === "string" ? content : "";
					if (text)
						flushProse((m.id as string) ?? "", [{ type: "text", text }]);
					continue;
				}

				const prose: { type: string; text?: string }[] = [];

				for (const chunk of content) {
					const c = chunk as Record<string, unknown>;
					const blockType = c.type as string | undefined;

					if (blockType === "toolCall") {
						const trailing = extractTrailingThinking(prose);
						flushProse((m.id as string) ?? "", prose);
						prose.length = 0;

						const toolName = String(c.name ?? "tool");
						const toolCallId = String(c.id ?? "");
						const args = (c.arguments ?? {}) as Record<string, unknown>;
						const result = toolCallId ? toolResults.get(toolCallId) : undefined;

						// Build compat ToolCallPart for custom renderers
						const toolCallPart: ToolCallPart = {
							type: "tool-call",
							toolName,
							toolCallId,
							args,
							state: result
								? result.isError === true
									? "error"
									: "success"
								: "running",
							output: result ? extractContentText(result.content) : undefined,
							errorText:
								result && result.isError === true
									? extractContentText(result.content) || "Tool returned error"
									: undefined,
							details: result?.details,
						};

						const CustomRenderer = toolRegistry.get(toolName);

						if (CustomRenderer) {
							flushToolBatch(
								`precustom-${(m.id as string) ?? ""}-${toolCallId}`,
							);
							elements.push(
								<div
									key={`custom-${(m.id as string) ?? ""}-${toolCallId}`}
									className="message-row assistant"
								>
									<div className="message-bubble assistant">
										<CustomRenderer
											part={toolCallPart}
											messageId={(m.id as string) ?? ""}
										/>
									</div>
								</div>,
							);
							continue;
						}

						toolEntries.push(...trailing);
						toolEntries.push({
							kind: "tool",
							block: {
								name: toolName,
								arguments: args,
								id: toolCallId,
							} as Record<string, unknown>,
							result: result ?? undefined,
						} as ToolBatchEntry);
					} else if (
						blockType === "text" &&
						typeof c.text === "string" &&
						c.text.trim() !== ""
					) {
						prose.push({ type: "text", text: c.text as string });
					} else if (
						(blockType === "thinking" || blockType === "reasoning") &&
						typeof c.thinking === "string" &&
						c.thinking.trim() !== ""
					) {
						prose.push({ type: "thinking", text: c.thinking as string });
					}
				}

				// Flush remaining prose at message boundary (flushes tools first)
				flushProse(String(m.id ?? ""), prose);
				// Tools are NOT flushed here — they accumulate across messages
			}

			// Flush remaining tools at end of turn
			flushToolBatch(`toolbatch-end`);
			return elements;
		};

		// ── Turn-grouped rendering ──
		let turnIdx = 0;
		let currentUser: Record<string, unknown> | undefined;
		let currentAssistants: Record<string, unknown>[] = [];

		const flushTurn = (): void => {
			if (currentUser === undefined) return;
			const turnKey = currentUser.id ?? `turn-${turnIdx}`;
			turnIdx++;
			const text = extractContentText(currentUser.content);
			const combinedAssistantText = currentAssistants
				.map((m) => extractContentText(m.content))
				.filter((t) => t.length > 0)
				.join("\n\n");

			const isSteer =
				(currentUser.metadata as { steer?: boolean } | undefined)?.steer ===
				true;
			const lastAssistant = currentAssistants[currentAssistants.length - 1];

			if (stickyUserHeader && text.length > 0) {
				out.push(
					<div key={`turn-${turnKey}`} style={{ position: "relative" }}>
						<div
							style={{
								position: "sticky",
								top: 0,
								zIndex: 10,
								background: "var(--bg-solid)",
								overflowAnchor: "none",
							}}
						>
							<UserMessageBubble
								text={text}
								isSteer={isSteer}
								images={extractImages(currentUser.content)}
							/>
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
									<TokenUsageBadge
										msg={lastAssistant as unknown as Record<string, unknown>}
									/>
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
					<div key={`user-${turnKey}`} className="message-row user">
						<div className="message-bubble user">
							{isSteer && <span className="steer-tag">steer</span>}
							<UserImages images={extractImages(currentUser.content)} />
							{text}
						</div>
					</div>,
				);
				if (text.length > 0) {
					out.push(
						<div
							key={`user-${turnKey}-copy`}
							className="assistant-msg-footer user"
						>
							<CopyMsgButton getText={() => text} />
							{rewindAvailable && <RewindMsgButton sessionId={sessionId} />}
						</div>,
					);
				}
				if (currentAssistants.length > 0)
					out.push(...renderAssistantParts(currentAssistants));
				if (combinedAssistantText.length > 0) {
					out.push(
						<div key={`turn-${turnKey}-copy`} className="assistant-msg-footer">
							<CopyMsgButton getText={() => combinedAssistantText} />
							<SaveAsPngButton getText={() => combinedAssistantText} />
							{showTokenUsage && (
								<TokenUsageBadge
									msg={lastAssistant as unknown as Record<string, unknown>}
								/>
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

		// ── Iterate raw SDK messages ──
		pushCardsAt(0);
		let msgIdx = 0;
		for (const msg of rawMessages as Record<string, unknown>[]) {
			const role = msg.role as string | undefined;
			const idx = msgIdx++;

			if (role === "compactionSummary") {
				continue;
			}

			// Suppress kept-window messages — they live in the latest
			// compaction card's archivedMessages drawer. Without this,
			// the archived conversation renders both inside the card
			// AND as inline bubbles below the card, making compaction
			// appear to have accomplished nothing.
			// Index 0 is compactionSummary (already skipped above).
			// Indices [1, keptWindowEnd) are the kept window.
			if (idx >= 1 && idx < keptWindowEnd) {
				flushTurn();
				continue;
			}

			if (role === "user" || role === "user-with-attachments") {
				flushTurn();
				currentUser = msg;
			} else if (role === "toolResult") {
			} else {
				// Assistant / bashExecution / branchSummary / custom
				if (currentUser !== undefined) {
					currentAssistants.push(msg);
				} else {
					out.push(...renderAssistantParts([msg]));
				}
			}
		}

		// Inject streaming message into currentAssistants when it has
		// tool-call content blocks, so they render inside ToolCallBatchCard.
		if (
			streamingMessage !== undefined &&
			currentUser !== undefined &&
			isStreaming
		) {
			currentAssistants.push(
				streamingMessage as unknown as Record<string, unknown>,
			);
		}

		flushTurn();

		// Trailing compaction cards
		const lastRawIdx = rawMessages.length;
		pushCardsAt(lastRawIdx);

		return out;
	}, [
		messages,
		toolResults,
		streamingMessage,
		isStreaming,
		stickyUserHeader,
		compactions,
		sessionId,
		rewindAvailable,
		rawMessages,
	]);

	return (
		<ChatDiffViewProvider>
			<div
				className="messages-container"
				style={stickyUserHeader ? { paddingTop: 50 } : undefined}
			>
				{error !== undefined && (
					<div onClick={clearError} className="error-banner">
						{error} — click to dismiss
					</div>
				)}

				{rawMessages.length === 0 && !isStreaming ? (
					<div className="welcome">
						<div className="welcome-icon">💬</div>
						<div className="welcome-text">Send a message to start chatting</div>
						<div className="welcome-hint">with the pi coding agent</div>
					</div>
				) : (
					<div
						ref={scrollRef}
						onScroll={onScroll}
						style={stickyUserHeader ? { paddingTop: 0 } : undefined}
						className="chat-scroll"
					>
						<div className="chat-message-list">
							{renderedRows}

							{isStreaming && streamingMessage !== undefined && (() => {
							// Streaming content is always rendered inside renderedRows via
							// currentAssistants injection. No standalone row needed.
							return null;
							return (
								<div className="message-row assistant streaming-row">
									<div className="message-bubble assistant streaming-bubble">
										{activeToolName && (
											<div className="tool-badge">
												<span className="tool-badge-dot" />
												{activeToolName}
											</div>
										)}
										{renderStreamingContent(
											streamingMessage as Record<string, unknown>,
										)}
									</div>
								</div>
							);
						})()}

							{isStreaming && streamingMessage === undefined && (
								<div className="message-row assistant streaming-row">
									<div className="message-bubble assistant thinking-bubble">
										{activeToolName ? (
											<span className="thinking-running">
												<span className="tool-badge-dot" />
												running{" "}
												<code className="thinking-code">{activeToolName}</code>
											</span>
										) : (
											<span className="pi-thinking-dots" aria-hidden="true">
												<span>.</span>
												<span>.</span>
												<span>.</span>
											</span>
										)}
									</div>
								</div>
							)}

							{activeCompaction !== null && (
								<CompactionNotice compaction={activeCompaction} />
							)}

							{queued !== undefined &&
								(queued.steering.length > 0 || queued.followUp.length > 0) && (
									<div className="queued-msgs">
										{[
											...queued.steering.map((t) => ({
												kind: "steer" as const,
												text: t,
											})),
											...queued.followUp.map((t) => ({
												kind: "followUp" as const,
												text: t,
											})),
										].map((q, i) => (
											<div key={i} className="queued-msg-item">
												<span className={`queued-badge ${q.kind}`}>
													{q.kind === "steer" ? "steer" : "follow-up"}
												</span>
												<span className="queued-msg-text" title={q.text}>
													{q.text}
												</span>
											</div>
										))}
									</div>
								)}
						</div>
					</div>
				)}
			</div>
		</ChatDiffViewProvider>
	);
}
