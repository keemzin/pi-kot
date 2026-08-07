import { describe, expect, it } from "vitest";
import { parseRefChips } from "./ref-chips";

describe("parseRefChips", () => {
  it("parses a bare path with a line range", () => {
    const chips = parseRefChips("check @src/foo.ts#L3-L5 thanks");
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({
      path: "src/foo.ts",
      startLine: 3,
      endLine: 5,
      raw: "@src/foo.ts#L3-L5",
    });
  });

  it("parses a bare single-line range", () => {
    const chips = parseRefChips("@src/foo.ts#L1");
    expect(chips[0]).toMatchObject({ path: "src/foo.ts", startLine: 1, endLine: 1 });
  });

  it("parses a bare path without a range", () => {
    const chips = parseRefChips("@src/foo.ts");
    expect(chips[0]).toMatchObject({ path: "src/foo.ts", startLine: undefined });
  });

  it("parses quoted paths with spaces and a range", () => {
    const chips = parseRefChips(`see @"my dir/file.ts"#L2-L4 now`);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ path: "my dir/file.ts", startLine: 2, endLine: 4 });
  });

  it("parses quoted paths without a range", () => {
    const chips = parseRefChips(`@"a b.txt"`);
    expect(chips[0]).toMatchObject({ path: "a b.txt", startLine: undefined });
  });

  it("skips unterminated quoted markers", () => {
    expect(parseRefChips(`@"oops`)).toHaveLength(0);
  });

  it("does not treat email addresses as markers", () => {
    expect(parseRefChips("mail me at user@example.com")).toHaveLength(0);
  });

  it("returns markers in document order with positions", () => {
    const chips = parseRefChips("@a.ts then @b.ts#L2-3");
    expect(chips.map((c) => c.path)).toEqual(["a.ts", "b.ts"]);
    expect(chips[0].start).toBe(0);
    expect(chips[1].start).toBeGreaterThan(chips[0].end);
  });

  it("supports the L-prefixed end line form (#L3-L5)", () => {
    const chips = parseRefChips("@src/foo.ts#L3-L5");
    expect(chips[0]).toMatchObject({ startLine: 3, endLine: 5 });
  });
});
