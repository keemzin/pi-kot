import { useEffect, useMemo, useRef, useState } from "react";
import { ChatMarkdown } from "./ChatMarkdown";
import { ChatEditDiff } from "./ChatEditDiff";
import { toolPreviewFromArgs } from "../lib/tool-call-pairing";
import { usePreferencesStore } from "../stores/preferences-store";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { useI18n } from "../hooks/useI18n";

/* ── Types ─────────────────────────────────────────────────────────────── */

/** Local mirror of tool-result message shape (SDK toolResult role). */
export interface PairableMessage {
	role?: string;
	type?: string;
	content?: unknown;
	toolCallId?: unknown;
	details?: unknown;
	isError?: boolean;
	[key: string]: unknown;
}

export type ToolGroupEntry =
	| {
			kind: "tool";
			block: Record<string, unknown>;
			result?: PairableMessage | undefined;
	  }
	| { kind: "thinking"; text: string }
	| { kind: "justification"; text: string };

export type TrailSegment = {
	entries: ToolGroupEntry[];
	/** Stable id of the first tool call — used as a React key so the card
	 *  instance survives as more tools stream in and join the group. */
	firstToolId?: string;
};

export type GroupedTurn = {
	/** Trail runs, each rendered as one ToolGroupCard. */
	segments: TrailSegment[];
	/** Tool calls handled by a registered custom renderer (break out of the trail). */
	customTools: {
		name: string;
		id: string;
		args: Record<string, unknown>;
		result?: PairableMessage | undefined;
		msgId?: string;
	}[];
	/** Non-assistant role messages (bashExecution, branchSummary, custom…). */
	specials: Record<string, unknown>[];
	/** Text/thinking after the last tool call — the actual answer. */
	finalParts: { type: "text" | "thinking"; text: string }[];
};

/** Noise tools that never surface as trail rows (openkot skips these too). */
const SKIP_TOOL_NAMES = new Set([
	"step-start",
	"step_start",
	"reasoning",
	"thinking",
	"snapshot",
]);

/**
 * Split SDK assistant messages of one turn into trail segments + final answer.
 * Pure function — testable without React.
 *
 * Rules (mirroring openkot's ChatMessages trail slicing):
 *  - text blocks between tool calls → `justification` entries in the trail
 *  - text after the LAST tool call → `finalParts` (the answer)
 *  - thinking/reasoning blocks → `thinking` entries (rendered only if showThinking)
 *  - custom-rendered tools break the trail into a new segment
 *  - non-assistant role messages are collected as `specials`
 */
export function buildGroupedTurn(
	msgs: Record<string, unknown>[],
	getResult: (id: string) => PairableMessage | undefined,
	isCustomTool: (name: string) => boolean,
): GroupedTurn {
	const segments: TrailSegment[] = [];
	const customTools: GroupedTurn["customTools"] = [];
	const specials: Record<string, unknown>[] = [];
	let current: ToolGroupEntry[] | undefined;
	let currentFirstToolId: string | undefined;
	let prose: { type: "text" | "thinking"; text: string }[] = [];

	const pushSegment = (): void => {
		if (current !== undefined && current.length > 0) {
			segments.push({ entries: current, firstToolId: currentFirstToolId });
		}
		current = undefined;
		currentFirstToolId = undefined;
	};

	const flushProseToTrail = (): void => {
		if (prose.length === 0) return;
		if (current === undefined) current = [];
		for (const p of prose) {
			current.push(
				p.type === "text"
					? { kind: "justification", text: p.text }
					: { kind: "thinking", text: p.text },
			);
		}
		prose = [];
	};

	for (const m of msgs) {
		const role = m.role as string | undefined;
		if (role !== "assistant") {
			// bashExecution / branchSummary / custom / unknown roles
			pushSegment();
			specials.push(m);
			continue;
		}

		const content = m.content;
		if (!Array.isArray(content)) {
			const text = typeof content === "string" ? content : "";
			if (text.trim().length > 0) prose.push({ type: "text", text });
			continue;
		}

		for (const chunk of content as Record<string, unknown>[]) {
			const blockType = chunk.type as string | undefined;

			if (blockType === "toolCall") {
				const toolName = String(chunk.name ?? "tool");
				const id = String(chunk.id ?? "");
				const args = (chunk.arguments ?? {}) as Record<string, unknown>;

				if (SKIP_TOOL_NAMES.has(toolName.toLowerCase())) {
					// Noise tool — drop it but keep surrounding prose in the trail
					continue;
				}

				flushProseToTrail();

				if (isCustomTool(toolName)) {
					pushSegment();
					customTools.push({
						name: toolName,
						id,
						args,
						result: id ? getResult(id) : undefined,
						msgId: String(m.id ?? ""),
					});
				} else {
					if (current === undefined) current = [];
					if (!currentFirstToolId && id) currentFirstToolId = id;
					current.push({
						kind: "tool",
						block: { name: toolName, arguments: args, id },
						result: id ? getResult(id) : undefined,
					});
				}
			} else if (
				blockType === "text" &&
				typeof chunk.text === "string" &&
				chunk.text.trim() !== ""
			) {
				prose.push({ type: "text", text: chunk.text as string });
			} else if (
				(blockType === "thinking" || blockType === "reasoning") &&
				typeof chunk.thinking === "string" &&
				chunk.thinking.trim() !== ""
			) {
				prose.push({ type: "thinking", text: chunk.thinking as string });
			}
		}
	}

	// Prose remaining after the last tool call = the answer
	const finalParts = prose;
	pushSegment();

	return { segments, customTools, specials, finalParts };
}

/* ── Tool presentation helpers (openkot-style friendly names/icons) ────── */

export function getToolDisplayName(toolName: string): string {
	const t = toolName.toLowerCase();
	const map: Record<string, string> = {
		edit: "Edited",
		apply_patch: "Edited",
		str_replace: "Edited",
		multiedit: "Edited",
		write: "Wrote",
		create: "Wrote",
		file_write: "Wrote",
		read: "Read",
		view: "Read",
		cat: "Read",
		file_read: "Read",
		bash: "Shell Command",
		shell: "Shell Command",
		cmd: "Shell Command",
		terminal: "Shell Command",
		list: "Listed",
		ls: "Listed",
		dir: "Listed",
		list_files: "Listed",
		grep: "Searched",
		search: "Searched",
		ripgrep: "Searched",
		find: "Found",
		glob: "Found",
		webfetch: "Fetched",
		fetch: "Fetched",
		fetch_content: "Fetched",
		curl: "Fetched",
		wget: "Fetched",
		websearch: "Searched Web",
		web_search: "Searched Web",
		web_fetch: "Fetched",
		searxng_searxng_web_search: "Searched",
		codesearch: "Searched",
		todowrite: "Updated Todos",
		todoread: "Read Todos",
		ask_user_question: "Asked",
		plan_mode_question: "Asked",
		task: "Delegated Task",
		javascript_repl: "Repl",
	};
	if (map[t]) return map[t];
	if (t.startsWith("ctx_"))
		return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
	if (t.startsWith("git"))
		return (
			"Git " +
			t
				.slice(3)
				.replace(/_/g, " ")
				.replace(/\b\w/g, (c) => c.toUpperCase())
		);
	// MCP-style / default: snake_case → Title Case
	return toolName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** SVG path for a tool's icon (openkot-style). */
export function getToolIconPath(toolName: string): string {
	const t = toolName.toLowerCase();
	if (
		t === "edit" ||
		t === "multiedit" ||
		t === "apply_patch" ||
		t === "str_replace"
	)
		return "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z";
	if (t === "write" || t === "create" || t === "file_write")
		return "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-6M9 15h6";
	if (t === "read" || t === "view" || t === "file_read" || t === "cat")
		return "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8";
	if (t === "bash" || t === "shell" || t === "cmd" || t === "terminal")
		return "M4 17l6-6-6-6M12 19h8";
	if (t === "list" || t === "ls" || t === "dir" || t === "list_files")
		return "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z";
	if (t === "grep" || t === "search" || t === "find" || t === "ripgrep")
		return "M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM10 7v3m0 0v3m0-3h3m-3 0H7";
	if (t === "glob") return "M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z";
	if (
		t === "webfetch" ||
		t === "fetch" ||
		t === "fetch_content" ||
		t === "curl" ||
		t === "wget"
	)
		return "M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z";
	if (
		t.includes("web_search") ||
		t.includes("searxng") ||
		t === "websearch" ||
		t === "codesearch"
	)
		return "M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z";
	if (t === "todowrite" || t === "todoread")
		return "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11";
	if (t === "task")
		return "M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zM12 8v4l3 3";
	if (
		t === "ask_user_question" ||
		t === "plan_mode_question" ||
		t.includes("question")
	)
		return "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01";
	if (t.startsWith("git"))
		return "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9";
	// default wrench
	return "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z";
}

/** One-line description of a tool call derived from its input args. */
export function getToolDescription(
	toolName: string,
	args: Record<string, unknown>,
): string {
	const t = toolName.toLowerCase();
	if (t === "bash" || t === "shell" || t === "cmd" || t === "terminal") {
		const cmd = args.command ?? args.cmd ?? "";
		return typeof cmd === "string" ? cmd.split("\n")[0]!.slice(0, 80) : "";
	}
	if (
		t === "read" ||
		t === "view" ||
		t === "cat" ||
		t === "write" ||
		t === "create" ||
		t === "edit" ||
		t === "apply_patch" ||
		t === "multiedit"
	) {
		const p = args.filePath ?? args.file_path ?? args.path ?? args.file ?? "";
		if (typeof p === "string" && p) {
			const parts = p.replace(/\\/g, "/").split("/");
			return parts[parts.length - 1] ?? p;
		}
	}
	if (t === "grep" || t === "search" || t === "find" || t === "ripgrep") {
		const q = args.pattern ?? args.query ?? "";
		return typeof q === "string" ? `"${q.slice(0, 60)}"` : "";
	}
	if (t === "glob") {
		const p = args.pattern ?? args.glob ?? "";
		return typeof p === "string" ? `"${p.slice(0, 60)}"` : "";
	}
	if (
		t === "webfetch" ||
		t === "fetch" ||
		t === "fetch_content" ||
		t === "curl" ||
		t === "wget"
	) {
		const url = args.url ?? args.URL ?? "";
		return typeof url === "string" ? url.slice(0, 80) : "";
	}
	if (
		t.includes("web_search") ||
		t.includes("searxng") ||
		t === "websearch" ||
		t === "codesearch"
	) {
		const q = args.query ?? args.q ?? "";
		return typeof q === "string" ? `"${q.slice(0, 60)}"` : "";
	}
	if (t === "ask_user_question" || t === "plan_mode_question") {
		const qs = args.questions;
		if (Array.isArray(qs) && qs.length > 0) {
			const first = qs[0] as Record<string, unknown>;
			const q = typeof first?.question === "string" ? first.question : "";
			return q.slice(0, 80);
		}
	}
	if (t.startsWith("ctx_")) {
		const queries = args.queries;
		if (Array.isArray(queries) && queries.length > 0)
			return `"${String(queries[0]).slice(0, 60)}"`;
		const path = args.path ?? args.source;
		if (typeof path === "string") return path.slice(0, 80);
	}
	const fallback =
		args.url ?? args.query ?? args.pattern ?? args.path ?? args.filePath ?? "";
	return typeof fallback === "string" ? fallback.slice(0, 80) : "";
}

/* ── Tool icon (emoji) + filename/diff helpers ─────────────────────────── */

/** Map a tool name to a descriptive emoji icon. */
export function getToolIcon(name: string): string {
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
export function extractFilename(
	message: Record<string, unknown>,
): string | undefined {
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
export function countDiffLines(diff: string): { adds: number; dels: number } {
	let adds = 0;
	let dels = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) adds += 1;
		else if (line.startsWith("-")) dels += 1;
	}
	return { adds, dels };
}

/* ── ToolCallEntry — single tool call + result as a timeline node ──────── */

export function ToolCallEntry({
	block,
	result,
	initialExpanded = false,
	displayName,
	previewOverride,
	icon,
	suppressRunning = false,
	isActive,
	isLastInTurn,
}: {
	block: Record<string, unknown>;
	result: PairableMessage | undefined;
	initialExpanded?: boolean;
	/** Friendly label override (grouped mode shows "Read"/"Wrote"/…). */
	displayName?: string;
	/** One-line description override (grouped mode derives from args). */
	previewOverride?: string;
	/** Custom icon node (grouped mode uses SVG paths). */
	icon?: React.ReactNode;
	/** When true, a missing result is treated as cancelled/aborted rather than
	 *  running (used after the turn stopped streaming). */
	suppressRunning?: boolean;
	isActive: boolean;
	isLastInTurn: boolean;
}) {
	const { t } = useI18n();
	// Local override for expanded state. If undefined, we follow the global preference.
	const [localExpanded, setLocalExpanded] = useState<boolean | undefined>();
	const [detailsOpen, setDetailsOpen] = useState(initialExpanded);
	const [justCompleted, setJustCompleted] = useState(false);
	const wasRunning = useRef(result === undefined);
	const argsPreRef = useRef<HTMLPreElement>(null);
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
	const isRunning = result === undefined && !suppressRunning;

	// Auto-scroll the args pane to bottom while the tool is streaming.
	// Dep array is intentional: run only when running/open state changes, not
	// every render — missing it caused a layout reflow per SSE tick per entry.
	useEffect(() => {
		if (isRunning && detailsOpen && argsPreRef.current) {
			argsPreRef.current.scrollTop = argsPreRef.current.scrollHeight;
		}
	}, [isRunning, detailsOpen]);

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

	const preview =
		previewOverride ?? getToolDescription(name, args as Record<string, unknown>) ?? undefined;
	const iconNode = icon ?? <TrailIcon toolName={name} />;

	// For `edit`, prefer the unified diff string the SDK puts on
	// result.details (details.diff). When absent (e.g. some providers),
	// fall back to outputText so the diff card still renders.
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
	const hasDetails = argsText.length > 2 || outputText.length > 0;

	return (
		<div
			className={`tool-timeline-node ${isRunning ? " running" : isError ? " error" : " success"}`}
		>
			<span
				className={`tool-timeline-icon${isRunning ? " running" : isError ? " error" : " success"}${justCompleted ? " just-completed" : ""}`}
				aria-hidden="true"
			>
				{iconNode}
			</span>
			<div className="tool-timeline-content">
				<div 
					className={`tool-timeline-row ${hasDetails ? "clickable" : ""}`}
					onClick={hasDetails ? () => setDetailsOpen(o => !o) : undefined}
					role={hasDetails ? "button" : undefined}
					tabIndex={hasDetails ? 0 : undefined}
				>
					<span className="tool-timeline-name">{displayName ?? getToolDisplayName(name)}</span>
					{preview && (
						<span className="tool-timeline-arg" title={preview}>
							{preview}
						</span>
					)}
					{!isRunning && !detailsOpen && outputPreview.length > 0 && (
						<span 
							className="tool-timeline-arg" 
							title={outputPreview}
							style={{ color: "var(--text-ghost)", fontStyle: "italic" }}
						>
							— {isError ? "✖ " : "✓ "} {outputPreview}
						</span>
					)}
					{isRunning && (
						<span className="tool-timeline-running" aria-label="running">
							{t("chat.running")}
						</span>
					)}
					{hasDetails && (
						<span className={`tool-timeline-chevron-toggle ${detailsOpen ? "open" : ""}`}>
							›
						</span>
					)}
				</div>
				{/* Expanded details pane */}
				{detailsOpen && (
					<div className="tool-timeline-details">
						{argsText.length > 2 && (
							<div>
								<div className="tool-timeline-section-label">{t("chat.toolInput")}</div>
								<pre className="tool-timeline-code" ref={argsPreRef}>
									{argsText}
								</pre>
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

/* ── Thinking row (only rendered when showThinking is on) ───────────────── */

function TrailThinkingRow({ text }: { text: string }) {
	const { t } = useI18n();
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
				<span className="thinking-block-chevron">▶</span>
				<span className="thinking-block-label">{t("chat.thinking")}</span>
			</summary>
			<div className="thinking-block-content">{text}</div>
		</details>
	);
}

/* ── Justification row — collapsed preview of in-between agent text ────── */

const JUSTIFICATION_PREVIEW_LEN = 120;

function JustificationRow({
	text,
	open,
	onToggle,
}: {
	text: string;
	open: boolean;
	onToggle: () => void;
}) {
	const { t } = useI18n();
	const stripped = text
		.replace(/#+\s+/g, "") // remove headers like "## "
		.replace(/[*_~`]/g, "") // remove bold, italic, strikethrough, code ticks
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // markdown links -> just text
		.replace(/<[^>]+>/g, "") // HTML tags
		.trim()
		.replace(/\s+/g, " ");
	const truncated = stripped.length > JUSTIFICATION_PREVIEW_LEN;
	const preview = truncated
		? stripped.slice(0, JUSTIFICATION_PREVIEW_LEN) + "…"
		: stripped;
	return (
		<div className={`trail-justification${open ? " expanded" : " collapsed"}`}>
			<button
				type="button"
				onClick={onToggle}
				className="trail-justification-header"
				title={open ? "Collapse this step" : "Expand this step"}
				aria-expanded={open}
			>
				<div className="trail-justification-title-wrapper">
					<span className="trail-justification-icon-box">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<circle cx="12" cy="12" r="10" />
						</svg>
					</span>
					{open ? (
						<span className="trail-justification-label">{t("chat.toolJustification")}</span>
					) : (
						<span className="trail-justification-preview" title={preview}>
							{preview || t("chat.toolJustification")}
						</span>
					)}
				</div>
				<span className="trail-justification-chevron">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="m6 9 6 6 6-6" />
					</svg>
				</span>
			</button>
		</div>
	);
}

/* ── ToolGroupCard — the "Trail" ────────────────────────────────────────── */

const JUSTIFY_COLLAPSE_THRESHOLD = 3;

/**
 * Live "follow the agent" rule for the Justify view: while the turn is
 * still streaming and the trail is in Justify, only the NEWEST
 * justification chunk stays expanded. When the next chunk arrives it
 * takes over and the previous one collapses — so the step the agent
 * is currently working on is never hidden behind older steps.
 * Manual expansions/collapses survive until the next chunk arrives
 * (this only fires when streaming/view/chunk-count change).
 */
export function nextOpenChunks(
	current: Set<number>,
	chunkCount: number,
	isStreaming: boolean,
	view: "full" | "justify",
): Set<number> {
	if (isStreaming && view === "justify" && chunkCount > 0) {
		return new Set([chunkCount - 1]);
	}
	return current;
}

/** Groups entries into chunks: each justification + the tools/thinking that follow it. */
function groupChunks(entries: ToolGroupEntry[]): {
	leading: ToolGroupEntry[];
	chunks: { just: ToolGroupEntry; tools: ToolGroupEntry[] }[];
} {
	const chunks: { just: ToolGroupEntry; tools: ToolGroupEntry[] }[] = [];
	let current: { just: ToolGroupEntry; tools: ToolGroupEntry[] } | null = null;
	for (const e of entries) {
		if (e.kind === "justification") {
			if (
				current &&
				current.just.kind === "justification" &&
				current.just.text === "Working..." &&
				!current.tools.some((t) => t.kind === "tool")
			) {
				current.just = e;
			} else {
				if (current) chunks.push(current);
				current = { just: e, tools: [] };
			}
		} else {
			if (!current) {
				current = {
					just: { kind: "justification", text: "Working..." },
					tools: [],
				};
			}
			current.tools.push(e);
		}
	}
	if (current) chunks.push(current);
	return { leading: [], chunks };
}

function groupConsecutiveTools(
	tools: ToolGroupEntry[],
): (ToolGroupEntry | ToolGroupEntry[])[] {
	const result: (ToolGroupEntry | ToolGroupEntry[])[] = [];
	let currentGroup: ToolGroupEntry[] = [];
	let currentToolName = "";

	for (const entry of tools) {
		if (entry.kind === "tool") {
			const toolName = String(entry.block.name ?? "tool");
			if (toolName === currentToolName) {
				currentGroup.push(entry);
			} else {
				if (currentGroup.length > 0) {
					result.push(currentGroup.length === 1 ? currentGroup[0] : currentGroup);
				}
				currentGroup = [entry];
				currentToolName = toolName;
			}
		} else {
			if (currentGroup.length > 0) {
				result.push(currentGroup.length === 1 ? currentGroup[0] : currentGroup);
				currentGroup = [];
				currentToolName = "";
			}
			result.push(entry);
		}
	}
	if (currentGroup.length > 0) {
		result.push(currentGroup.length === 1 ? currentGroup[0] : currentGroup);
	}
	return result;
}

function ConsecutiveToolGroup({
	entries,
	view,
	isStreaming,
	startIndex,
	renderEntry,
}: {
	entries: ToolGroupEntry[];
	view: "full" | "justify";
	isStreaming: boolean;
	startIndex: number;
	renderEntry: (entry: ToolGroupEntry, idx: number) => React.ReactNode;
}) {
	const { t } = useI18n();
	const [isOpen, setIsOpen] = useState(false);

	const anyRunning =
		isStreaming &&
		entries.some((e) => e.kind === "tool" && e.result === undefined);
	const anyError = entries.some(
		(e) => e.kind === "tool" && e.result?.isError === true,
	);

	const expanded = view === "full" || isOpen || anyRunning || anyError;

	const firstTool = entries[0];
	if (firstTool.kind !== "tool") return null;

	const name = String(firstTool.block.name ?? "tool");
	const count = entries.length;
	const displayName = getToolDisplayName(name);

	const isRunning = anyRunning;
	const isError = anyError;

	return (
		<div className="consecutive-tools-group" style={{ marginBottom: "2px" }}>
			<div
				className={`tool-timeline-node ${isRunning ? " running" : isError ? " error" : " success"}`}
			>
				<span
					className={`tool-timeline-icon${isRunning ? " running" : isError ? " error" : " success"}`}
					aria-hidden="true"
				>
					<TrailIcon toolName={name} />
				</span>
				<div className="tool-timeline-content">
					<div
						className="tool-timeline-row clickable"
						onClick={() => setIsOpen(!isOpen)}
						role="button"
						tabIndex={0}
					>
						<span className="tool-timeline-name" style={{ fontWeight: 600 }}>
							{count} × {displayName}
						</span>
						{!expanded && (
						<div className="tool-timeline-summary">
							<span className="tool-timeline-arg">{t("chat.groupedTools")}</span>
						</div>)}
						{isRunning && (
							<span className="tool-timeline-running" aria-label="running">
								{t("chat.running")}
							</span>
						)}
						<span className={`tool-timeline-chevron-toggle ${expanded ? "open" : ""}`}>
							›
						</span>
					</div>
				</div>
			</div>
			{expanded && (
				<div
					className="consecutive-tools-list"
					style={{
						paddingLeft: "10px",
						borderLeft: "2px solid var(--border)",
						marginLeft: "5px",
						marginTop: "4px",
						marginBottom: "8px",
						display: "flex",
						flexDirection: "column",
						gap: "1px",
					}}
				>
					{entries.map((e, i) => renderEntry(e, startIndex + i))}
				</div>
			)}
		</div>
	);
}

export function ToolGroupCard({
	entries,
	isStreaming = false,
}: {
	entries: ToolGroupEntry[];
	isStreaming?: boolean;
}) {
	const { t } = useI18n();
	const hasJustifications = entries.some((e) => e.kind === "justification");
	// Default resting view for a trail comes from the user preference.
	const trailDefaultView = usePreferencesStore((s) => s.trailDefaultView);
	// Two-state view: "justify" (collapsed) ↔ "full" (everything expanded).
	// Justify works for all turns: tool-only turns show collapsed tool rows;
	// turns with justifications show per-chunk expandable previews.
	const [view, setView] = useState<"full" | "justify">(trailDefaultView);
	// Which chunks are expanded in Justify view (indices into chunks array).
	const [openChunks, setOpenChunks] = useState<Set<number>>(() => new Set());
	const [showAllChunks, setShowAllChunks] = useState(false);

	// Track streaming state transitions
	const prevStreaming = useRef(isStreaming);
	const prevDefaultView = useRef(trailDefaultView);
	const hasJustificationsRef = useRef(hasJustifications);
	hasJustificationsRef.current = hasJustifications;

	useEffect(() => {
		if (isStreaming && !prevStreaming.current) {
			setView(trailDefaultView);
		}
		if (!isStreaming && prevStreaming.current) {
			// Streaming stopped — settle on the user's default view: Justify
			// collapses each step into a preview, Full keeps it expanded.
			const timer = setTimeout(() => {
				setView(trailDefaultView);
				setOpenChunks(new Set());
			}, 3000);
			prevStreaming.current = isStreaming;
			return () => clearTimeout(timer);
		}
		
		// Sync all non-streaming cards if user changes global settings
		if (!isStreaming && trailDefaultView !== prevDefaultView.current) {
			setView(trailDefaultView);
			if (trailDefaultView === "justify") setOpenChunks(new Set());
		}

		prevStreaming.current = isStreaming;
		prevDefaultView.current = trailDefaultView;
	}, [isStreaming, trailDefaultView]);

	const anyRunning =
		isStreaming &&
		entries.some((e) => e.kind === "tool" && e.result === undefined);

	// Memoize chunk grouping so it doesn't recompute on every SSE delta.
	// entries is only a new reference when the outer useMemo in ChatView
	// rebuilds — which is already gated on message/toolResult changes.
	const { chunks, leading } = useMemo(() => groupChunks(entries), [entries]);

	// Live-turn "only the step being worked on" focus: while the turn is
	// streaming in Justify view, the newest chunk expands automatically
	// and older expanded chunks collapse as new justifications arrive -
	// the current agent step is never hidden behind collapsed older ones.
	const chunkCount = chunks.length;
	useEffect(() => {
		setOpenChunks((prev) =>
			nextOpenChunks(prev, chunkCount, isStreaming, view),
		);
	}, [isStreaming, view, chunkCount]);

	const toggleChunk = (idx: number) =>
		setOpenChunks((prev) => {
			const next = new Set(prev);
			if (next.has(idx)) next.delete(idx);
			else next.add(idx);
			return next;
		});

	const cycle = () => {
		if (view === "full") {
			setView("justify");
			setOpenChunks(new Set());
		} else {
			setView("full");
		}
	};

	const viewLabel = view === "full" ? "Collapse All" : "Expand All";

	const scrollRef = useRef<HTMLDivElement>(null);
	// Scroll to bottom when in full view during streaming.
	// Use rAF to avoid forcing a synchronous layout reflow on every SSE event
	// (scrollTop = scrollHeight forces layout; batching it to the paint frame
	// prevents blocking input events during heavy tool calling).
	useEffect(() => {
		if (!isStreaming || view !== "full") return;
		const raf = requestAnimationFrame(() => {
			if (scrollRef.current) {
				scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
			}
		});
		return () => cancelAnimationFrame(raf);
	}, [entries.length, isStreaming, view]);

	/** Render a single entry in Full view (tools, thinking, or full prose). */
	const renderEntry = (entry: ToolGroupEntry, idx: number): React.ReactNode => {
		if (entry.kind === "tool") {
			const name = String(entry.block.name ?? "tool");
			const args = (entry.block.arguments ?? {}) as Record<string, unknown>;
			return (
				<ToolCallEntry
					key={`tool-${idx}-${String(entry.block.id ?? "")}`}
					block={entry.block}
					result={entry.result}
					displayName={getToolDisplayName(name)}
					previewOverride={getToolDescription(name, args) || undefined}
					icon={<TrailIcon toolName={name} />}
					suppressRunning={!isStreaming}
					isActive={isStreaming && entry.result === undefined}
					isLastInTurn={idx === entries.length - 1}
				/>
			);
		}
		if (entry.kind === "thinking") {
			return <TrailThinkingRow key={`think-${idx}`} text={entry.text} />;
		}
		return (
			<div key={`fullprose-${idx}`} className="trail-full-prose">
				<ChatMarkdown text={entry.text.trim()} />
			</div>
		);
	};

	/** Render a chunk in Justify view: header preview + expandable content. */
	const renderChunk = (
		chunk: { just: ToolGroupEntry; tools: ToolGroupEntry[] },
		chunkIdx: number,
		keyPrefix: string,
		visibleIdx: number
	) => {
		const isOpen = view === "full" || openChunks.has(chunkIdx);
		const isLast = chunkIdx === chunks.length - 1;
		return (
			<div key={keyPrefix} className={`trail-chunk${isOpen ? " open" : ""}${visibleIdx === 0 && !collapseActive ? " connects-to-header" : ""}`}>
				<JustificationRow
					text={(chunk.just as { text: string }).text}
					open={isOpen}
					onToggle={() => toggleChunk(chunkIdx)}
				/>
				{/* Always mounted: the 0fr↔1fr grid animation (see themes.css)
				    animates the body in and out, so a closed step's collapse
				    is as smooth as the new step's expansion — no snap between
				    justifications during heavy tool calling. */}
				<div className="trail-chunk-body" aria-hidden={!isOpen}>
					<div className="trail-chunk-content">
						<div className="trail-full-prose">
							<ChatMarkdown
								text={(chunk.just as { text: string }).text.trim()}
							/>
						</div>
						{(() => {
							let globalIndex = 0;
							return groupConsecutiveTools(chunk.tools).map((g, i) => {
								if (Array.isArray(g)) {
									const startIdx = globalIndex;
									globalIndex += g.length;
									return (
										<ConsecutiveToolGroup
											key={`group-${i}`}
											entries={g}
											view={view}
											isStreaming={isStreaming}
											startIndex={startIdx}
											renderEntry={renderEntry}
										/>
									);
								} else {
									const idx = globalIndex++;
									return renderEntry(g, idx);
								}
							});
						})()}
					</div>
				</div>
			</div>
		);
	};

	const shouldCollapseChunks = chunks.length > JUSTIFY_COLLAPSE_THRESHOLD;
	const collapseActive = view !== "full" && shouldCollapseChunks && !showAllChunks;
	const visibleChunks = collapseActive
			? chunks.slice(-JUSTIFY_COLLAPSE_THRESHOLD)
			: chunks;
	const chunkIdxOffset = collapseActive
			? chunks.length - JUSTIFY_COLLAPSE_THRESHOLD
			: 0;

	return (
		<div className="trail-group">
			<div className="trail-header">
				<button
					type="button"
					className="trail-toggle"
					title={`Trail view: ${view}. Click to toggle Expand All ↔ Auto`}
					onClick={cycle}
				>
					<span className="trail-toggle-icon">
						{anyRunning ? (
							<ThinkingIndicator style={{ width: "12px", height: "12px", color: "var(--accent)", margin: "1px" }} />
						) : (
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="var(--bg-solid)"
								strokeWidth="2"
								style={{ stroke: "currentColor" }}
							>
								<circle cx="12" cy="12" r="10" />
							</svg>
						)}
					</span>
					<span className="trail-toggle-label">{t("chat.trail")}</span>
					<span className="trail-toggle-view">{viewLabel}</span>
					{anyRunning && <span className="trail-running-label">{t("chat.runningShort")}</span>}
				</button>
			</div>

			<div className="trail-body trail-body-justify" ref={scrollRef}>
				<div className="trail-list">
					{collapseActive && (
						<button
							type="button"
							className="trail-earlier"
							onClick={() => setShowAllChunks(true)}
						>
							▼ {chunks.length - JUSTIFY_COLLAPSE_THRESHOLD} earlier steps
						</button>
					)}
					{visibleChunks.map((chunk, i) =>
						renderChunk(
							chunk,
							chunkIdxOffset + i,
							`chunk-${chunkIdxOffset + i}`,
							i
						),
					)}
				</div>
			</div>
		</div>
	);
}

function TrailIcon({ toolName }: { toolName: string }) {
	return (
		<svg
			width="11"
			height="11"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			style={{ flexShrink: 0 }}
		>
			<path d={getToolIconPath(toolName)} />
		</svg>
	);
}
