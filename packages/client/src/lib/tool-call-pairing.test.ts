import { describe, it, expect } from "vitest";
import {
  buildToolCallPairing,
  isToolCallBlock,
  getToolCallId,
  isPairedToolResult,
  splitAssistantToolSegments,
  toolPreviewFromArgs,
  countDiffLines,
  type PairableMessage,
} from "./tool-call-pairing.js";

/* ── buildToolCallPairing ── */

describe("buildToolCallPairing", () => {
  it("pairs tool results with assistant tool calls by toolCallId", () => {
    const messages: PairableMessage[] = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call-1", name: "bash" }],
      },
      { role: "toolResult", toolCallId: "call-1", content: "done" },
    ];

    const result = buildToolCallPairing(messages);
    expect(result.pairedIds.has("call-1")).toBe(true);
    expect(result.toolResultsById.get("call-1")?.content).toBe("done");
    expect(result.pairedResultMessages.size).toBe(1);
  });

  it("ignores tool results with no matching assistant call", () => {
    const messages: PairableMessage[] = [
      { role: "toolResult", toolCallId: "orphan", content: "no match" },
    ];

    const result = buildToolCallPairing(messages);
    expect(result.pairedIds.size).toBe(0);
    expect(result.toolResultsById.size).toBe(0);
  });

  it("returns empty pairing for no messages", () => {
    const result = buildToolCallPairing([]);
    expect(result.pairedIds.size).toBe(0);
    expect(result.toolResultsById.size).toBe(0);
  });

  it("pairs multiple tool calls correctly", () => {
    const messages: PairableMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call-a", name: "read" },
          { type: "toolCall", id: "call-b", name: "grep" },
        ],
      },
      { role: "toolResult", toolCallId: "call-a", content: "file content" },
      { role: "toolResult", toolCallId: "call-b", content: "grep results" },
    ];

    const result = buildToolCallPairing(messages);
    expect(result.pairedIds).toEqual(new Set(["call-a", "call-b"]));
    expect(result.toolResultsById.get("call-a")?.content).toBe("file content");
    expect(result.toolResultsById.get("call-b")?.content).toBe("grep results");
  });

  it("ignores assistant messages with no content array", () => {
    const messages: PairableMessage[] = [
      { role: "assistant", content: "just text" },
      { role: "toolResult", toolCallId: "call-1", content: "x" },
    ];

    const result = buildToolCallPairing(messages);
    expect(result.pairedIds.size).toBe(0);
  });
});

/* ── isToolCallBlock ── */

describe("isToolCallBlock", () => {
  it("returns true for toolCall blocks", () => {
    expect(isToolCallBlock({ type: "toolCall", id: "x" })).toBe(true);
  });

  it("returns false for non-toolCall blocks", () => {
    expect(isToolCallBlock({ type: "text", text: "hello" })).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isToolCallBlock(undefined)).toBe(false);
  });
});

/* ── getToolCallId ── */

describe("getToolCallId", () => {
  it("returns the id when present and non-empty", () => {
    expect(getToolCallId({ id: "call-123", type: "toolCall" })).toBe("call-123");
  });

  it("returns undefined when id is empty string", () => {
    expect(getToolCallId({ id: "", type: "toolCall" })).toBeUndefined();
  });

  it("returns undefined when id is not a string", () => {
    expect(getToolCallId({ id: 42, type: "toolCall" })).toBeUndefined();
  });
});

/* ── isPairedToolResult ── */

describe("isPairedToolResult", () => {
  it("returns true for messages in pairedResultMessages", () => {
    const msg: PairableMessage = { role: "toolResult", toolCallId: "c1" };
    const pairing = buildToolCallPairing([
      { role: "assistant", content: [{ type: "toolCall", id: "c1" }] },
      msg,
    ]);
    expect(isPairedToolResult(pairing, msg)).toBe(true);
  });

  it("returns false for unpaired messages", () => {
    const msg: PairableMessage = { role: "toolResult", toolCallId: "nope" };
    const pairing = buildToolCallPairing([]);
    expect(isPairedToolResult(pairing, msg)).toBe(false);
  });
});

/* ── splitAssistantToolSegments ── */

describe("splitAssistantToolSegments", () => {
  it("returns undefined when there are no tool calls", () => {
    const result = splitAssistantToolSegments(
      [{ type: "text", text: "hello" }],
      new Map(),
    );
    expect(result).toBeUndefined();
  });

  it("splits a single tool call into a tools segment", () => {
    const content = [{ type: "toolCall", id: "c1", name: "bash" }];
    const results = new Map([["c1", { role: "toolResult", content: "ok" }]]);

    const segments = splitAssistantToolSegments(content, results);
    expect(segments).toHaveLength(1);
    expect(segments?.[0]?.kind).toBe("tools");
    expect(segments?.[0]?.entries).toHaveLength(1);
    const entry = segments?.[0]?.entries?.[0];
    expect(entry?.kind).toBe("tool");
    if (entry?.kind === "tool") {
      expect(entry?.result?.content).toBe("ok");
    }
  });

  it("groups consecutive batchable tool calls", () => {
    const content = [
      { type: "toolCall", id: "c1", name: "bash" },
      { type: "toolCall", id: "c2", name: "grep" },
    ];

    const segments = splitAssistantToolSegments(content, new Map());
    expect(segments).toHaveLength(1);
    expect(segments?.[0]?.batchable).toBe(true);
    expect(segments?.[0]?.entries).toHaveLength(2);
  });

  it("keeps edit/write tools non-batchable (individual entries)", () => {
    const content = [
      { type: "toolCall", id: "c1", name: "edit" },
      { type: "toolCall", id: "c2", name: "write" },
    ];

    const segments = splitAssistantToolSegments(content, new Map());
    expect(segments).toHaveLength(2);
    expect(segments?.[0]?.batchable).toBe(false);
    expect(segments?.[1]?.batchable).toBe(false);
  });

  it("groups thinking blocks with subsequent tool calls", () => {
    const content = [
      { type: "thinking", content: "let me check..." },
      { type: "toolCall", id: "c1", name: "bash" },
    ];

    const segments = splitAssistantToolSegments(content, new Map());
    expect(segments).toHaveLength(1);
    expect(segments?.[0]?.entries).toHaveLength(2);
    expect(segments?.[0]?.entries?.[0]?.kind).toBe("thinking");
    expect(segments?.[0]?.entries?.[1]?.kind).toBe("tool");
  });

  it("preserves prose before and after tool calls", () => {
    const content = [
      { type: "text", text: "Let me check" },
      { type: "toolCall", id: "c1", name: "bash" },
      { type: "text", text: "Here is the result" },
    ];

    const segments = splitAssistantToolSegments(content, new Map());
    expect(segments).toHaveLength(3);
    expect(segments?.[0]?.kind).toBe("assistant");
    expect(segments?.[0]?.content?.[0]?.text).toBe("Let me check");
    expect(segments?.[1]?.kind).toBe("tools");
    expect(segments?.[2]?.kind).toBe("assistant");
    expect(segments?.[2]?.content?.[0]?.text).toBe("Here is the result");
  });
});

/* ── toolPreviewFromArgs ── */

describe("toolPreviewFromArgs", () => {
  it("extracts bash command", () => {
    expect(toolPreviewFromArgs("bash", { command: "ls -la" })).toBe("ls -la");
  });

  it("extracts file path for read/write/edit", () => {
    expect(toolPreviewFromArgs("read", { path: "src/main.ts" })).toBe("src/main.ts");
    expect(toolPreviewFromArgs("write", { path: "README.md" })).toBe("README.md");
    expect(toolPreviewFromArgs("edit", { path: "index.html" })).toBe("index.html");
  });

  it("extracts pattern for grep/glob", () => {
    expect(toolPreviewFromArgs("grep", { pattern: "TODO" })).toBe("TODO");
    expect(toolPreviewFromArgs("glob", { pattern: "*.ts" })).toBe("*.ts");
  });

  it("extracts query for web_search", () => {
    expect(toolPreviewFromArgs("web_search", { query: "test" })).toBe("test");
  });

  it("extracts url for web_fetch", () => {
    expect(toolPreviewFromArgs("web_fetch", { url: "https://example.com" })).toBe("https://example.com");
  });

  it("returns undefined for unknown tool", () => {
    expect(toolPreviewFromArgs("unknown", { data: "x" })).toBeUndefined();
  });

  it("returns undefined when args is null", () => {
    expect(toolPreviewFromArgs("bash", null)).toBeUndefined();
  });
});

/* ── countDiffLines ── */

describe("countDiffLines", () => {
  it("counts adds and dels in a diff", () => {
    const result = countDiffLines("+added\n+also\n-removed\n context\n+added2");
    expect(result.adds).toBe(3);
    expect(result.dels).toBe(1);
  });

  it("returns zero for no diff", () => {
    expect(countDiffLines("")).toEqual({ adds: 0, dels: 0 });
  });

  it("returns zero for context-only lines", () => {
    expect(countDiffLines(" context\n more context")).toEqual({ adds: 0, dels: 0 });
  });
});
