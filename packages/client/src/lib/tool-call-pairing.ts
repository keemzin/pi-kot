/**
 * Tool call pairing — matches toolCall blocks in assistant messages
 * with toolResult messages by toolCallId.
 *
 * Ported from pi-forge/packages/client/src/lib/tool-call-pairing.ts
 */

export interface PairableMessage {
  role?: string;
  type?: string;
  content?: unknown;
  toolCallId?: unknown;
  [key: string]: unknown;
}

export interface ToolCallPairing {
  /** Tool results keyed by the assistant-side tool call id. */
  toolResultsById: Map<string, PairableMessage>;
  /** Assistant-side tool call ids that have a matched standalone result. */
  pairedIds: Set<string>;
  /** Result message objects that have been paired (skip standalone render). */
  pairedResultMessages: Set<PairableMessage>;
}

export function buildToolCallPairing(
  messages: readonly PairableMessage[],
): ToolCallPairing {
  const toolResultsById = new Map<string, PairableMessage>();
  const pairedIds = new Set<string>();
  const pairedResultMessages = new Set<PairableMessage>();

  // Collect all tool call IDs from assistant messages
  const callIds = new Set<string>();
  for (const m of messages) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const block of m.content as Record<string, unknown>[]) {
      if (!isToolCallBlock(block)) continue;
      const id = getToolCallId(block);
      if (id !== undefined) callIds.add(id);
    }
  }

  // Match tool results to call IDs
  for (const m of messages) {
    if (m.role !== "toolResult" || typeof m.toolCallId !== "string") continue;
    if (!callIds.has(m.toolCallId)) continue;
    toolResultsById.set(m.toolCallId, m);
    pairedIds.add(m.toolCallId);
    pairedResultMessages.add(m);
  }

  return { toolResultsById, pairedIds, pairedResultMessages };
}

export function isPairedToolResult(
  pairing: ToolCallPairing,
  message: PairableMessage,
): boolean {
  return pairing.pairedResultMessages.has(message);
}

export function isToolCallBlock(
  block: Record<string, unknown> | undefined,
): block is Record<string, unknown> {
  return block?.type === "toolCall";
}

export function getToolCallId(block: Record<string, unknown>): string | undefined {
  return typeof block.id === "string" && block.id.length > 0 ? block.id : undefined;
}

/* ── Tool batch segmentation (from forge's ChatView.tsx) ── */

export type ToolBatchEntry =
  | { kind: "tool"; block: Record<string, unknown>; result: PairableMessage | undefined }
  | { kind: "thinking"; block: Record<string, unknown> };

export interface AssistantRenderSegment {
  kind: "assistant" | "tools";
  /** For assistant segments: the content blocks to render as prose. */
  content?: Record<string, unknown>[];
  /** For tools segments: the tool/thinking entries. */
  entries?: ToolBatchEntry[];
  /** Whether this tools segment can be batched into a single collapsible card. */
  batchable?: boolean;
}

const NON_BATCHABLE_TOOL_NAMES = new Set(["edit", "write"]);
const MAX_TOOL_BATCH_SIZE = Number.POSITIVE_INFINITY;

function isBatchableToolCall(block: Record<string, unknown> | undefined): boolean {
  return isToolCallBlock(block) && !NON_BATCHABLE_TOOL_NAMES.has(String(block.name ?? ""));
}

function isToolBatchThinkingBlock(block: Record<string, unknown> | undefined): boolean {
  return block?.type === "thinking";
}

function isToolBatchWhitespaceBlock(block: Record<string, unknown> | undefined): boolean {
  return block?.type === "text" && typeof block.text === "string" && block.text.trim().length === 0;
}

function isToolCall(block: Record<string, unknown> | undefined): boolean {
  return isToolCallBlock(block);
}

function takeTrailingToolRunContext(
  prose: Record<string, unknown>[],
): ToolBatchEntry[] {
  const trailing: ToolBatchEntry[] = [];
  while (prose.length > 0) {
    const block = prose[prose.length - 1]!;
    if (isToolBatchWhitespaceBlock(block)) {
      prose.pop();
      continue;
    }
    if (!isToolBatchThinkingBlock(block)) break;
    trailing.unshift({ kind: "thinking", block });
    prose.pop();
  }
  return trailing;
}

function countToolBatchCalls(entries: ToolBatchEntry[]): number {
  return entries.filter((entry) => entry.kind === "tool").length;
}

/**
 * Split an assistant message's content array into segments.
 *
 * ToolCall blocks are extracted from prose bubbles and grouped into
 * collapsible batch cards. Thinking blocks immediately preceding
 * tool calls are grouped with the tools. Non-batchable tools (edit,
 * write) get individual entries.
 *
 * Returns undefined when the message has no tool calls at all (no
 * segmentation needed).
 */
export function splitAssistantToolSegments(
  content: Record<string, unknown>[],
  toolResultsById: Map<string, PairableMessage> | undefined,
): AssistantRenderSegment[] | undefined {
  const segments: AssistantRenderSegment[] = [];
  let prose: Record<string, unknown>[] = [];
  let sawToolSegment = false;
  const flushProse = (): void => {
    if (prose.length === 0) return;
    segments.push({ kind: "assistant", content: prose });
    prose = [];
  };

  let i = 0;
  while (i < content.length) {
    const block = content[i]!;
    if (!isToolCall(block)) {
      prose.push(block);
      i += 1;
      continue;
    }

    const leadingContext = takeTrailingToolRunContext(prose);
    flushProse();
    sawToolSegment = true;

    // Non-batchable tool (edit, write) — individual entry
    if (!isBatchableToolCall(block)) {
      const id = getToolCallId(block);
      segments.push({
        kind: "tools",
        batchable: false,
        entries: [
          ...leadingContext,
          {
            kind: "tool",
            block,
            result: id !== undefined ? toolResultsById?.get(id) : undefined,
          },
        ],
      });
      i += 1;
      continue;
    }

    // Batchable tools — group consecutive tools + thinking
    const entries: ToolBatchEntry[] = [...leadingContext];
    while (i < content.length && countToolBatchCalls(entries) < MAX_TOOL_BATCH_SIZE) {
      const current = content[i];
      if (current === undefined) break;
      if (isToolBatchThinkingBlock(current)) {
        entries.push({ kind: "thinking", block: current });
        i += 1;
        continue;
      }
      if (isToolBatchWhitespaceBlock(current)) {
        i += 1;
        continue;
      }
      if (!isBatchableToolCall(current)) break;
      const id = getToolCallId(current);
      entries.push({
        kind: "tool",
        block: current,
        result: id !== undefined ? toolResultsById?.get(id) : undefined,
      });
      i += 1;
    }
    segments.push({ kind: "tools", batchable: true, entries });
  }
  flushProse();

  return sawToolSegment ? segments : undefined;
}

/** Extract a one-line preview from tool arguments. */
export function toolPreviewFromArgs(
  name: string,
  args: unknown,
): string | undefined {
  const argsObj =
    typeof args === "object" && args !== null
      ? (args as Record<string, unknown>)
      : undefined;

  if (name === "bash" && typeof argsObj?.command === "string") return argsObj.command;
  if (
    (name === "read" || name === "write" || name === "edit") &&
    typeof argsObj?.path === "string"
  )
    return argsObj.path;
  if (name === "grep" && typeof argsObj?.pattern === "string") return argsObj.pattern;
  if (name === "glob" && typeof argsObj?.pattern === "string") return argsObj.pattern;
  if (name === "web_search" && typeof argsObj?.query === "string") return argsObj.query;
  if (name === "web_fetch" && typeof argsObj?.url === "string") return argsObj.url;

  return undefined;
}

/** Count +/- lines in a diff string. */
export function countDiffLines(diff: string): { adds: number; dels: number } {
  const adds = (diff.match(/^\+/gm) ?? []).length;
  const dels = (diff.match(/^\-/gm) ?? []).length;
  return { adds, dels };
}
