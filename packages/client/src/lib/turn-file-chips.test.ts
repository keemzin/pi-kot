import { describe, expect, it } from "vitest";
import { extractTurnFilePaths, fileBasename } from "./turn-file-chips";

function call(id: string, name: string, path: string) {
  return { type: "toolCall", id, name, arguments: { path } };
}

const getResult =
  (map: Map<string, { isError?: boolean }>) =>
  (id: string | undefined) =>
    id === undefined ? undefined : map.get(id);

describe("extractTurnFilePaths", () => {
  it("collects paths from successful write/edit tool calls, in order, deduped", () => {
    const results = new Map([
      ["a", { isError: false }],
      ["b", { isError: false }],
      ["c", { isError: false }],
    ]);
    const assistants = [
      { role: "assistant", content: [call("a", "write", "src/theme.ts")] },
      {
        role: "assistant",
        content: [call("b", "edit", "src/theme.ts"), call("c", "edit", "src/App.tsx")],
      },
    ];
    expect(extractTurnFilePaths(assistants, getResult(results))).toEqual([
      "src/theme.ts",
      "src/App.tsx",
    ]);
  });

  it("skips tools that are not write/edit", () => {
    const results = new Map([["a", { isError: false }]]);
    const assistants = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "a", name: "bash", arguments: { command: "ls" } }],
      },
    ];
    expect(extractTurnFilePaths(assistants, getResult(results))).toEqual([]);
  });

  it("skips calls whose result errored or never arrived (streaming)", () => {
    const results = new Map([
      ["a", { isError: true }], // failed
      ["b", { isError: false }], // ok
    ]);
    const assistants = [
      {
        role: "assistant",
        content: [
          call("a", "edit", "src/broken.ts"),
          call("b", "write", "src/fine.ts"),
          call("c", "write", "src/pending.ts"), // c: no result yet
        ],
      },
    ];
    expect(extractTurnFilePaths(assistants, getResult(results))).toEqual(["src/fine.ts"]);
  });

  it("ignores paths mentioned in prose text", () => {
    const assistants = [{ role: "assistant", content: [{ type: "text", text: "edited src/poem.ts" }] }];
    expect(extractTurnFilePaths(assistants, getResult(new Map()))).toEqual([]);
  });

  it("skips non-string or missing paths even when the call succeeded", () => {
    const results = new Map([["a", { isError: false }]]);
    const assistants = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "a", name: "write", arguments: {} }],
      },
    ];
    expect(extractTurnFilePaths(assistants, getResult(results))).toEqual([]);
  });
});

describe("fileBasename", () => {
  it("handles posix, windows and bare names", () => {
    expect(fileBasename("src/theme.ts")).toBe("theme.ts");
    expect(fileBasename("C:\\proj\\App.tsx")).toBe("App.tsx");
    expect(fileBasename("index.ts")).toBe("index.ts");
  });
});