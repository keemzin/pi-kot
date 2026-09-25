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

  it("correctly parses Send selection to chat format (@path#L<start>-<end>)", () => {
    const chip1 = parseRefChips("@settings.json#L2-2");
    expect(chip1).toHaveLength(1);
    expect(chip1[0]).toMatchObject({ path: "settings.json", startLine: 2, endLine: 2 });

    const chip2 = parseRefChips("@.pi/settings.json#L2-2");
    expect(chip2).toHaveLength(1);
    expect(chip2[0]).toMatchObject({ path: ".pi/settings.json", startLine: 2, endLine: 2 });

    const chip3 = parseRefChips(`@"my dir/settings.json"#L2-2`);
    expect(chip3).toHaveLength(1);
    expect(chip3[0]).toMatchObject({ path: "my dir/settings.json", startLine: 2, endLine: 2 });
  });

  it("does not parse @( or PowerShell arrays as file tags", () => {
    const text = `
      if ($BonsaiModel -notin @("27B", "8B", "4B", "1.7B")) {
        $BinCandidates = @(
          "bin\\cuda\\llama-server.exe"
        )
        $tryPatterns = @("*-PQ2_0.gguf", "*-PTQ1_0.gguf")
        @()
        @("--temp", "1.0")
      }
    `;
    const chips = parseRefChips(text);
    expect(chips).toHaveLength(0);
  });

  it("does not parse @{ or PowerShell hashtables as file tags", () => {
    const chips = parseRefChips(`$ht = @{ key = "value"; count = 10 }`);
    expect(chips).toHaveLength(0);
  });

  it("does not parse @[ array or decorator syntax as file tags", () => {
    const chips = parseRefChips(`val = @[1, 2, 3]`);
    expect(chips).toHaveLength(0);
  });

  it("does not parse quotes followed by commas or containing commas as file tags", () => {
    const chips1 = parseRefChips(`test @"foo", and other`);
    expect(chips1).toHaveLength(0);

    const chips2 = parseRefChips(`test @"foo, bar"`);
    expect(chips2).toHaveLength(0);
  });

  it("does not parse bare tokens with code operators or parentheses as file tags", () => {
    const chips = parseRefChips(`func(@arg,) and @--temp and @$variable and @a=b`);
    expect(chips).toHaveLength(0);
  });

  it("does not parse bare identifiers without extensions like @ServerArgs, @args, @Override as file tags", () => {
    const chips = parseRefChips(`& $Bin @ServerArgs @args with @Override and @param`);
    expect(chips).toHaveLength(0);
  });
});
