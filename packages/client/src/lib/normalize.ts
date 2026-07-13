/** Update the state of a tool-call part by toolCallId. */
export function updateToolCallState(
  msg: UIMessage,
  toolCallId: string,
  state: "input-available" | "running" | "success" | "error",
): UIMessage {
  return {
    ...msg,
    parts: msg.parts.map((p) => {
      if (p.type === "tool-call" && p.toolCallId === toolCallId) {
        return { ...p, state };
      }
      return p;
    }),
  };
}

/**
 * Normalize SDK agent messages into a parts-based model for UI rendering.
 *
 * The SDK sends messages in OpenAI-compatible format with content blocks:
 *   AssistantMessage.content = (TextContent | ThinkingContent | ToolCall)[]
 *   ToolResultMessage        = separate message with toolCallId
 *
 * This module normalizes them into a flat parts[] model so the UI can
 * simply map over parts without pairing or deriving.
 */

/* ── Part types ─────────────────────────────────────────────────────────── */

export type TextPart = {
  type: "text";
  text: string;
  state: "streaming" | "done";
};

export type ThinkingPart = {
  type: "thinking";
  text: string;
  state: "streaming" | "done";
};

export type ToolCallPart = {
  type: "tool-call";
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  state: "input-available" | "running" | "success" | "error";
  output?: string;
  errorText?: string;
};

export type ImagePart = {
  type: "image";
  mimeType: string;
  data: string;
  /** True for optimistic blob URLs that may be revoked. */
  __blobUrl?: boolean;
};

export type BashExecPart = {
  type: "bash-exec";
  command: string;
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  state: "running" | "done";
};

export type BranchSummaryPart = {
  type: "branch-summary";
  summary: string;
  fromId: string;
  timestamp?: number;
};

export type CustomMessagePart = {
  type: "custom";
  customType: string;
  content: string | Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  display?: boolean;
  details?: unknown;
  timestamp?: number;
};

export type UIPart = TextPart | ThinkingPart | ToolCallPart | ImagePart | BashExecPart | BranchSummaryPart | CustomMessagePart;

/* ── UI Message (what the UI renders) ──────────────────────────────────── */

export interface UIMessage {
  id: string;
  role: "user" | "assistant";
  parts: UIPart[];
  /** Original message index in the raw messages array (for compaction kept-window logic). */
  rawIndex: number;
  /** Model that generated this message (assistant messages only). */
  model?: string;
  /** Provider that generated this message (assistant messages only). */
  provider?: string;
  /** Token usage (assistant messages only). */
  usage?: { input?: number; output?: number; cacheRead?: number };
  /** SDK timestamp. */
  timestamp?: number;
  /** Arbitrary metadata from the SDK (steer flag, etc.). */
  metadata?: Record<string, unknown>;
}

/* ── Normalization helpers ──────────────────────────────────────────────── */

/** SDK message content block shapes. */
interface SdkTextBlock {
  type: "text";
  text: string;
}

interface SdkThinkingBlock {
  type: "thinking";
  thinking: string;
}

interface SdkToolCallBlock {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface SdkImageBlock {
  type: "image";
  data: string;
  mimeType: string;
  __blobUrl?: boolean;
}

/** A tool result from the SDK (separate message with role: "toolResult"). */
interface SdkToolResult {
  toolCallId: string;
  content?: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
}

/** Raw SDK agent message. */
interface SdkAgentMessage {
  role?: string;
  type?: string;
  content?: unknown;
  toolCallId?: string;
  toolName?: string;
  id?: string;
  [key: string]: unknown;
}

/** Normalize a branch summary message into UI parts. */
function normalizeBranchSummaryMessage(
  msg: SdkAgentMessage,
  rawIndex: number,
): UIMessage {
  const summary = (msg.summary as string) ?? "";
  const fromId = (msg.fromId as string) ?? "";
  const timestamp = msg.timestamp as number | undefined;

  return {
    id: (msg.id as string) ?? `branch-summary-${rawIndex}`,
    role: "assistant",
    parts: [
      {
        type: "branch-summary",
        summary,
        fromId,
        timestamp,
      },
    ],
    rawIndex,
    timestamp,
  };
}

/** Normalize a custom message into UI parts. */
function normalizeCustomMessage(
  msg: SdkAgentMessage,
  rawIndex: number,
): UIMessage {
  const customType = (msg.customType as string) ?? "custom";
  const content = msg.content as
    | string
    | Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>
    | undefined;
  const display = msg.display as boolean | undefined;
  const details = msg.details;
  const timestamp = msg.timestamp as number | undefined;

  return {
    id: (msg.id as string) ?? `custom-${rawIndex}`,
    role: "assistant",
    parts: [
      {
        type: "custom",
        customType,
        content: content ?? "",
        display,
        details,
        timestamp,
      },
    ],
    rawIndex,
    timestamp,
  };
}

/** Normalize a compaction summary message into UI parts. */
function normalizeCompactionSummaryMessage(
  msg: SdkAgentMessage,
  rawIndex: number,
): UIMessage {
  const summary = (msg.summary as string) ?? "";
  const tokensBefore = (msg.tokensBefore as number) ?? 0;
  const timestamp = msg.timestamp as number | undefined;

  return {
    id: (msg.id as string) ?? `compaction-summary-${rawIndex}`,
    role: "assistant",
    parts: [
      {
        type: "text",
        text: `[Compaction Summary] ${summary} (tokens before: ${tokensBefore})`,
        state: "done",
      },
    ],
    rawIndex,
    timestamp,
  };
}

/* ── Normalize a single SDK content block into a part ──────────────────── */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function normalizeContentBlock(
  block: Record<string, unknown>,
): UIPart | undefined {
  const type = block.type;
  if (type === "text" && typeof block.text === "string") {
    return { type: "text", text: block.text, state: "done" };
  }
  if (type === "thinking" && typeof block.thinking === "string") {
    return { type: "thinking", text: block.thinking, state: "done" };
  }
  if (type === "toolCall" && typeof block.name === "string") {
    return {
      type: "tool-call",
      toolName: block.name as string,
      toolCallId: typeof block.id === "string" ? block.id : "",
      args: isObject(block.arguments) ? (block.arguments as Record<string, unknown>) : {},
      state: "input-available",
    };
  }
  if (type === "image" && typeof block.data === "string") {
    return {
      type: "image",
      mimeType: (block.mimeType as string) ?? "image/png",
      data: block.data as string,
      __blobUrl: block.__blobUrl === true,
    };
  }
  return undefined;
}

/** Extract text from an SDK message's content, concatenating text blocks. */
function extractContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: Record<string, unknown>) => {
        if (block.type === "text") return (block.text as string) ?? "";
        if (block.type === "thinking" || block.type === "reasoning") return "";
        return "";
      })
      .join("");
  }
  return String(content ?? "");
}

/* ── Normalize a single SDK assistant message into parts ───────────────── */

function normalizeAssistantContent(
  content: unknown,
  toolResultForId?: (id: string) => SdkToolResult | undefined,
): UIPart[] {
  if (!Array.isArray(content)) {
    const text = typeof content === "string" ? content : String(content ?? "");
    return text.length > 0 ? [{ type: "text" as const, text, state: "done" as const }] : [];
  }

  const parts: UIPart[] = [];
  for (const block of content) {
    if (!isObject(block)) continue;
    const blockType = block.type;

    if (blockType === "text" && typeof block.text === "string") {
      parts.push({ type: "text", text: block.text, state: "done" });
    } else if (blockType === "thinking" && typeof block.thinking === "string") {
      parts.push({ type: "thinking", text: block.thinking, state: "done" });
    } else if (blockType === "toolCall" && typeof block.name === "string") {
      const id = typeof block.id === "string" ? block.id : "";
      const args = isObject(block.arguments)
        ? (block.arguments as Record<string, unknown>)
        : {};
      const result = id ? toolResultForId?.(id) : undefined;
      if (result !== undefined) {
        const outputText = extractContentText(result.content);
        parts.push({
          type: "tool-call",
          toolName: block.name as string,
          toolCallId: id,
          args,
          state: result.isError ? "error" : "success",
          output: outputText.length > 0 ? outputText : undefined,
          errorText: result.isError ? (outputText || "Tool returned error") : undefined,
        });
      } else {
        parts.push({
          type: "tool-call",
          toolName: block.name as string,
          toolCallId: id,
          args,
          state: "input-available",
        });
      }
    }
    // Images in assistant messages are handled where needed
  }
  return parts;
}

/* ── Main normalization entry points ───────────────────────────────────── */

export type ToolResultMap = Map<string, SdkToolResult>;

/**
 * Normalize an assistant SDK message into UI parts, merging tool results.
 *
 * @param msg - The raw SDK assistant message
 * @param toolResults - Map of toolCallId → tool result data
 */
export function normalizeAssistantMessage(
  msg: SdkAgentMessage,
  toolResults: ToolResultMap,
  rawIndex: number,
): UIMessage {
  const content = msg.content;
  const usage = msg.usage as { input?: number; output?: number; cacheRead?: number } | undefined;

  const toolResultForId = (id: string): SdkToolResult | undefined => toolResults.get(id);

  const parts = normalizeAssistantContent(content, toolResultForId);

  return {
    id: (msg.id as string) ?? `assistant-${rawIndex}`,
    role: "assistant",
    parts,
    rawIndex,
    model: msg.model as string | undefined,
    provider: msg.provider as string | undefined,
    usage: usage ?? undefined,
    timestamp: msg.timestamp as number | undefined,
    metadata: msg.metadata as Record<string, unknown> | undefined,
  };
}

/**
 * Normalize a user SDK message into UI parts.
 */
export function normalizeUserMessage(
  msg: SdkAgentMessage,
  rawIndex: number,
): UIMessage {
  const parts: UIPart[] = [];
  const content = msg.content;

  if (typeof content === "string" && content.length > 0) {
    parts.push({ type: "text" as const, text: content, state: "done" as const });
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!isObject(block)) continue;
      if (block.type === "text" && typeof block.text === "string") {
        parts.push({ type: "text", text: block.text, state: "done" });
      } else if (block.type === "image" && typeof block.data === "string") {
        parts.push({
          type: "image",
          mimeType: (block.mimeType as string) ?? "image/png",
          data: block.data as string,
          __blobUrl: block.__blobUrl === true,
        });
      }
    }
  }

  return {
    id: (msg.id as string) ?? `user-${rawIndex}`,
    role: "user",
    parts,
    rawIndex,
    timestamp: msg.timestamp as number | undefined,
    metadata: msg.metadata as Record<string, unknown> | undefined,
  };
}

/**
 * Normalize a bash execution message into UI parts.
 */
export function normalizeBashExecMessage(
  msg: SdkAgentMessage,
  rawIndex: number,
): UIMessage {
  return {
    id: (msg.id as string) ?? `bash-${rawIndex}`,
    role: "assistant",
    parts: [
      {
        type: "bash-exec",
        command: (msg.command as string) ?? "",
        output: (msg.output as string) ?? "",
        exitCode: msg.exitCode as number | undefined,
        cancelled: msg.cancelled === true,
        truncated: msg.truncated === true,
        state: (msg as Record<string, unknown>)._pendingExec ? "running" : "done",
      },
    ],
    rawIndex,
    timestamp: msg.timestamp as number | undefined,
  };
}

/**
 * Normalize an array of SDK messages into UI messages.
 *
 * Tool results (role === "toolResult") are merged into the preceding
 * assistant message's tool-call parts. Bash execution messages
 * (role === "bashExecution") get their own UIMessage. Compaction
 * summaries are filtered out (rendered separately by CompactionCard).
 */
export function normalizeMessages(
  msgs: readonly SdkAgentMessage[],
): UIMessage[] {
  // First pass: collect tool results by toolCallId
  const toolResults: ToolResultMap = new Map();
  for (const m of msgs) {
    if (m.role === "toolResult" && typeof m.toolCallId === "string") {
      toolResults.set(m.toolCallId, m as unknown as SdkToolResult);
    }
  }

  // Second pass: build UI messages
  const result: UIMessage[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];

    // Skip tool results (merged into assistant messages)
    if (m.role === "toolResult") continue;

    if (m.role === "user") {
      result.push(normalizeUserMessage(m, i));
    } else if (m.role === "assistant") {
      result.push(normalizeAssistantMessage(m, toolResults, i));
    } else if (m.type === "bashExecution" || m.role === "bashExecution") {
      result.push(normalizeBashExecMessage(m, i));
    } else if (m.role === "branchSummary") {
      result.push(normalizeBranchSummaryMessage(m, i));
    } else if (m.role === "custom") {
      result.push(normalizeCustomMessage(m, i));
    } else if (m.role === "compactionSummary") {
      // Compaction summaries are handled separately by CompactionCard
      // but we still normalize them for completeness
      result.push(normalizeCompactionSummaryMessage(m, i));
    }
    // Other types are silently skipped
  }

  return result;
}

/**
 * Normalize a partial assistant message (from SSE message_update) into a
 * streaming UIMessage. Tool results are NOT included — they arrive later
 * via tool_execution_end events.
 */
export function normalizePartialMessage(
  partial: SdkAgentMessage,
  rawIndex: number,
): UIMessage {
  const content = partial.content;
  const parts: UIPart[] = [];

  if (Array.isArray(content)) {
    for (const block of content) {
      if (!isObject(block)) continue;
      const blockType = block.type;

      if (blockType === "text" && typeof block.text === "string") {
        parts.push({ type: "text", text: block.text, state: "streaming" });
      } else if (blockType === "thinking" && typeof block.thinking === "string") {
        parts.push({ type: "thinking", text: block.thinking, state: "streaming" });
      } else if (blockType === "toolCall" && typeof block.name === "string") {
        const id = typeof block.id === "string" ? block.id : "";
        const args = isObject(block.arguments)
          ? (block.arguments as Record<string, unknown>)
          : {};
        // During streaming, tool calls may have partial args
        parts.push({
          type: "tool-call",
          toolName: block.name as string,
          toolCallId: id,
          args,
          state: "input-available",
        });
      } else if (blockType === "image" && typeof block.data === "string") {
        parts.push({
          type: "image",
          mimeType: (block.mimeType as string) ?? "image/png",
          data: block.data as string,
          __blobUrl: block.__blobUrl === true,
        });
      }
    }
  } else if (typeof content === "string" && content.length > 0) {
    parts.push({ type: "text", text: content, state: "streaming" });
  }

  return {
    id: (partial.id as string) ?? `streaming-${rawIndex}`,
    role: "assistant",
    parts,
    rawIndex,
    model: partial.model as string | undefined,
    provider: partial.provider as string | undefined,
    usage: undefined,
    timestamp: partial.timestamp as number | undefined,
  };
}

/**
 * Mark all streaming parts in a UIMessage as 'done'.
 * Called when message_end is received.
 */
export function finalizeMessage(msg: UIMessage): UIMessage {
  return {
    ...msg,
    parts: msg.parts.map((p) => {
      if (p.type === "text" && p.state === "streaming") {
        return { ...p, state: "done" as const };
      }
      if (p.type === "thinking" && p.state === "streaming") {
        return { ...p, state: "done" as const };
      }
      return p;
    }),
  };
}

/**
 * Attach a tool result to a tool-call part in a UIMessage.
 * Returns a new message with the updated parts, or the original if not found.
 */
export function attachToolResult(
  msg: UIMessage,
  toolCallId: string,
  result: unknown,
  isError: boolean,
): UIMessage {
  const outputText =
    typeof result === "string"
      ? result
      : isObject(result) && "content" in result
        ? extractContentText((result as Record<string, unknown>).content)
        : JSON.stringify(result, null, 2);

  return {
    ...msg,
    parts: msg.parts.map((p) => {
      if (p.type === "tool-call" && p.toolCallId === toolCallId) {
        return {
          ...p,
          state: isError ? ("error" as const) : ("success" as const),
          output: outputText.length > 0 ? outputText : p.output,
          errorText: isError ? (outputText || "Tool returned error") : undefined,
        };
      }
      return p;
    }),
  };
}
