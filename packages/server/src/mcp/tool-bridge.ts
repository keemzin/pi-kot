import { Type } from "typebox";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export function bridgeMcpTool(opts: {
  serverName: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  getClient: () => Client | undefined;
  recoverStaleSession?: () => Promise<boolean>;
}): ToolDefinition {
  const prefixedName = `${opts.serverName}__${opts.toolName}`;
  const description =
    opts.description.length > 0
      ? opts.description
      : `MCP tool '${opts.toolName}' from server '${opts.serverName}'.`;
  return {
    name: prefixedName,
    label: `MCP: ${opts.serverName}/${opts.toolName}`,
    description,
    parameters: Type.Unsafe<Record<string, unknown>>(opts.inputSchema),
    async execute(_toolCallId, params, signal) {
      const client = opts.getClient();
      if (client === undefined) {
        return {
          content: [{ type: "text" as const, text: `MCP server '${opts.serverName}' is not connected.` }],
          details: undefined,
        };
      }
      try {
        const res = await callMcpTool(client, opts.toolName, params, signal);
        return mcpResultToAgentResult(res);
      } catch (err) {
        if (
          !isAbortError(err) &&
          isStaleMcpSessionError(err) &&
          opts.recoverStaleSession !== undefined
        ) {
          const recovered = await opts.recoverStaleSession().catch(() => false);
          const retryClient = opts.getClient();
          if (recovered && retryClient !== undefined) {
            try {
              const retryRes = await callMcpTool(retryClient, opts.toolName, params, signal);
              return mcpResultToAgentResult(retryRes);
            } catch (retryErr) {
              return errorResult(`MCP tool '${prefixedName}' threw after reconnect: ${errorMessage(retryErr)}`);
            }
          }
        }
        return errorResult(`MCP tool '${prefixedName}' threw: ${errorMessage(err)}`);
      }
    },
  } satisfies ToolDefinition;
}

async function callMcpTool(
  client: Client,
  toolName: string,
  params: unknown,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  return await client.callTool(
    {
      name: toolName,
      arguments: (params as Record<string, unknown>) ?? {},
    },
    undefined,
    signal !== undefined ? { signal } : undefined,
  );
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    details: undefined,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"));
}

function isStaleMcpSessionError(err: unknown): boolean {
  const maybe = err as {
    code?: unknown;
    message?: unknown;
    error?: { code?: unknown; message?: unknown };
  };
  const code = maybe.code ?? maybe.error?.code;
  const message = String(maybe.message ?? maybe.error?.message ?? err).toLowerCase();
  const hasStaleMessage =
    message.includes("session not found") || message.includes("sesstion not found");
  return hasStaleMessage && (code === undefined || code === -32600 || message.includes("-32600"));
}

interface McpContentBlock {
  type?: unknown;
  text?: unknown;
  data?: unknown;
  mimeType?: unknown;
  resource?: unknown;
}

interface McpCallResult {
  content?: unknown;
  isError?: unknown;
  structuredContent?: unknown;
}

export function mcpResultToAgentResult(res: unknown) {
  const r = (res ?? {}) as McpCallResult;
  const isError = r.isError === true;
  const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
  const blocks = Array.isArray(r.content) ? (r.content as McpContentBlock[]) : [];
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      content.push({ type: "text", text: block.text });
    } else if (
      block.type === "image" &&
      typeof block.data === "string" &&
      typeof block.mimeType === "string"
    ) {
      content.push({ type: "image", data: block.data, mimeType: block.mimeType });
    } else {
      content.push({
        type: "text",
        text: `[${String(block.type ?? "unknown")}] ${JSON.stringify(block)}`,
      });
    }
  }
  if (content.length === 0) {
    content.push({ type: "text", text: isError ? "[error] (no detail)" : "(empty result)" });
  }
  if (isError && content[0]?.type === "text") {
    content[0] = { type: "text", text: `[error] ${content[0].text}` };
  }
  return { content, details: r.structuredContent ?? null };
}

export const MCP_TEXT_CAP_CHARS = 30_000;

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export function capTextContent(blocks: ContentBlock[]): ContentBlock[] {
  let totalText = 0;
  for (const b of blocks) {
    if (b.type === "text") totalText += b.text.length;
  }
  if (totalText <= MCP_TEXT_CAP_CHARS) return blocks;
  const flat = blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
  const headLen = Math.floor(MCP_TEXT_CAP_CHARS * 0.6);
  const tailLen = MCP_TEXT_CAP_CHARS - headLen;
  const head = flat.slice(0, headLen);
  const tail = flat.slice(flat.length - tailLen);
  const omitted = flat.length - headLen - tailLen;
  const warning =
    `MCP_RESULT_TRUNCATED: ${omitted.toLocaleString()} characters ` +
    `(~${Math.round(omitted / 4).toLocaleString()} tokens) were omitted from the middle of this tool result. ` +
    `Do not assume the missing content was irrelevant. Next step: call the MCP tool again with a smaller scope, ` +
    `narrower filter, or pagination to inspect the omitted content.\n\n`;
  const marker =
    `\n\n[--- MCP_RESULT_TRUNCATED: omitted middle content. Use a smaller scope, narrower filter, ` +
    `or pagination to inspect it. ---]\n\n`;
  const truncatedText = warning + head + marker + tail;
  const out: ContentBlock[] = [];
  let textInjected = false;
  for (const b of blocks) {
    if (b.type === "text") {
      if (!textInjected) {
        out.push({ type: "text", text: truncatedText });
        textInjected = true;
      }
      continue;
    }
    out.push(b);
  }
  return out;
}
