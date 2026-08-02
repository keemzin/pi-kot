import { describe, it, expect } from "vitest";
import {
  buildGroupedTurn,
  getToolDisplayName,
  getToolDescription,
  type PairableMessage,
} from "./ToolGroupCard.js";

const result = (isError = false): PairableMessage => ({
  role: "toolResult",
  isError,
  content: [{ type: "text", text: "ok" }],
});

const getResult = (id: string): PairableMessage | undefined =>
  id === "call-1" || id === "call-2" ? result() : undefined;
const noCustom = (): boolean => false;

/* ── buildGroupedTurn ── */

describe("buildGroupedTurn", () => {
  it("puts text between tool calls into the trail as justifications", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check the file." },
          { type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } },
          { type: "text", text: "Now I will edit it." },
          { type: "toolCall", id: "call-2", name: "edit", arguments: { path: "a.ts" } },
          { type: "text", text: "Edit applied." },
        ],
      },
    ];

    const turn = buildGroupedTurn(msgs, getResult, noCustom);
    expect(turn.segments).toHaveLength(1);
    const entries = turn.segments[0]!.entries;
    expect(entries.map((e) => e.kind)).toEqual([
      "justification",
      "tool",
      "justification",
      "tool",
    ]);
    expect(entries[0]).toMatchObject({ kind: "justification", text: "Let me check the file." });
    expect(entries[1]).toMatchObject({ kind: "tool", block: { name: "read", id: "call-1" } });
    // Text after the LAST tool call is the answer, not a justification
    expect(turn.finalParts).toEqual([{ type: "text", text: "Edit applied." }]);
  });

  it("keeps text after the last tool call as the final answer", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls" } },
          { type: "text", text: "Done. Here is the summary." },
        ],
      },
    ];

    const turn = buildGroupedTurn(msgs, getResult, noCustom);
    expect(turn.segments[0]!.entries.map((e) => e.kind)).toEqual(["tool"]);
    expect(turn.finalParts).toEqual([{ type: "text", text: "Done. Here is the summary." }]);
  });

  it("accumulates tool calls and interstitial text across multiple messages", () => {
    const msgs = [
      { role: "assistant", content: [{ type: "text", text: "First note." }] },
      { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "read", arguments: {} }] },
      { role: "assistant", content: [{ type: "text", text: "Second note." }] },
      { role: "assistant", content: [{ type: "toolCall", id: "call-2", name: "write", arguments: {} }] },
      { role: "assistant", content: [{ type: "text", text: "Final answer." }] },
    ];

    const turn = buildGroupedTurn(msgs, getResult, noCustom);
    expect(turn.segments[0]!.entries.map((e) => e.kind)).toEqual([
      "justification",
      "tool",
      "justification",
      "tool",
    ]);
    expect(turn.finalParts).toEqual([{ type: "text", text: "Final answer." }]);
  });

  it("renders a tool-only turn with no final text", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call-1", name: "grep", arguments: { pattern: "foo" } },
        ],
      },
    ];
    const turn = buildGroupedTurn(msgs, getResult, noCustom);
    expect(turn.segments[0]!.entries).toHaveLength(1);
    expect(turn.finalParts).toEqual([]);
  });

  it("returns a pure-text turn (no tools) entirely as final parts", () => {
    const msgs = [
      { role: "assistant", content: [{ type: "text", text: "Just talking." }] },
    ];
    const turn = buildGroupedTurn(msgs, getResult, noCustom);
    expect(turn.segments).toHaveLength(0);
    expect(turn.finalParts).toEqual([{ type: "text", text: "Just talking." }]);
  });

  it("skips noise tools (step-start, thinking) but keeps surrounding prose", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Planning…" },
          { type: "toolCall", id: "s1", name: "step-start", arguments: {} },
          { type: "text", text: "Now the real tool." },
          { type: "toolCall", id: "call-1", name: "bash", arguments: {} },
        ],
      },
    ];
    const turn = buildGroupedTurn(msgs, getResult, noCustom);
    const entries = turn.segments[0]!.entries;
    expect(entries.filter((e) => e.kind === "tool")).toHaveLength(1);
    expect(entries.filter((e) => e.kind === "justification")).toHaveLength(2);
  });

  it("breaks the trail at custom-rendered tools", () => {
    const isCustom = (name: string): boolean => name === "javascript_repl";
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call-1", name: "read", arguments: {} },
          { type: "toolCall", id: "call-2", name: "javascript_repl", arguments: { code: "1+1" } },
          { type: "toolCall", id: "call-3", name: "edit", arguments: {} },
        ],
      },
    ];
    const turn = buildGroupedTurn(msgs, getResult, isCustom);
    expect(turn.segments).toHaveLength(2);
    expect(turn.segments[0]!.entries.map((e) => (e.kind === "tool" ? e.block.name : e.kind))).toEqual(["read"]);
    expect(turn.segments[1]!.entries.map((e) => (e.kind === "tool" ? e.block.name : e.kind))).toEqual(["edit"]);
    expect(turn.customTools).toHaveLength(1);
    expect(turn.customTools[0]!.name).toBe("javascript_repl");
  });

  it("collects non-assistant role messages as specials", () => {
    const msgs = [
      { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "bash", arguments: {} }] },
      { role: "branchSummary", summary: "sum", fromId: "abc" },
    ];
    const turn = buildGroupedTurn(msgs, getResult, noCustom);
    expect(turn.specials).toHaveLength(1);
    expect(turn.specials[0]).toMatchObject({ role: "branchSummary" });
    expect(turn.segments[0]!.entries).toHaveLength(1);
  });

  it("tracks thinking blocks as trail entries", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "deep thought" },
          { type: "toolCall", id: "call-1", name: "bash", arguments: {} },
        ],
      },
    ];
    const turn = buildGroupedTurn(msgs, getResult, noCustom);
    expect(turn.segments[0]!.entries.map((e) => e.kind)).toEqual(["thinking", "tool"]);
  });
});

/* ── Tool presentation helpers ── */

describe("getToolDisplayName", () => {
  it("maps known tools to friendly verbs", () => {
    expect(getToolDisplayName("edit")).toBe("Edited");
    expect(getToolDisplayName("write")).toBe("Wrote");
    expect(getToolDisplayName("read")).toBe("Read");
    expect(getToolDisplayName("bash")).toBe("Shell Command");
    expect(getToolDisplayName("web_search")).toBe("Searched Web");
    expect(getToolDisplayName("ask_user_question")).toBe("Asked");
  });

  it("falls back to title-cased snake_case for unknown tools", () => {
    expect(getToolDisplayName("mcp_fetch_page")).toBe("Mcp Fetch Page");
    expect(getToolDisplayName("ctx_execute")).toBe("Ctx Execute");
  });
});

describe("getToolDescription", () => {
  it("derives a one-line description from args", () => {
    expect(getToolDescription("bash", { command: "ls -la\necho hi" })).toBe("ls -la");
    expect(getToolDescription("read", { path: "/home/u/src/app.ts" })).toBe("app.ts");
    expect(getToolDescription("grep", { pattern: "TODO" })).toBe('"TODO"');
    expect(getToolDescription("web_search", { query: "react hooks" })).toBe('"react hooks"');
  });

  it("returns empty string when no args match", () => {
    expect(getToolDescription("bash", {})).toBe("");
  });
});
