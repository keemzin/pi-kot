import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandFileReferences, parseFileReferences } from "./path-refs.js";

function makeWorkspace(): { dir: string; write: (rel: string, content: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), "pi-kot-pathref-"));
  const write = (rel: string, content: string) => {
    const abs = join(dir, rel);
    mkdirSync(join(dir, rel.split("/").slice(0, -1).join("/")), { recursive: true });
    writeFileSync(abs, content, "utf8");
    return abs;
  };
  return { dir, write };
}

const N_LINES = 20;
const fileBody = Array.from({ length: N_LINES }, (_, i) => `line number ${i + 1};`).join("\n") + "\n";

describe("path-refs range references (`@path#L..-..`)", () => {
  it("inlines exactly the bare range with original line numbers", async () => {
    const { dir, write } = makeWorkspace();
    write("src/foo.ts", fileBody);
    const out = await expandFileReferences("@src/foo.ts#L3-L5 fix this", dir);
    expect(out).toContain("file: src/foo.ts (lines 3-5)");
    expect(out).toContain("3 | line number 3;");
    expect(out).toContain("4 | line number 4;");
    expect(out).toContain("5 | line number 5;");
    expect(out).not.toContain("line number 1;");
    expect(out).not.toContain("line number 6;");
    expect(out).toContain(" fix this");
  });

  it("inlines a single line reference", async () => {
    const { dir, write } = makeWorkspace();
    write("src/foo.ts", fileBody);
    const out = await expandFileReferences("look at @src/foo.ts#L1", dir);
    expect(out).toContain("lines 1-1");
    expect(out).toContain("1 | line number 1;");
    expect(out).not.toContain("line number 2;");
  });

  it("supports the quoted path form with a range", async () => {
    const { dir, write } = makeWorkspace();
    write("my dir.ts", "a\nb\nc\nd\ne\n");
    const out = await expandFileReferences("use @\"my dir.ts\"#L2-L4 now", dir);
    expect(out).toContain("lines 2-4");
    expect(out).toContain("2 | b");
    expect(out).toContain("3 | c");
    expect(out).toContain("4 | d");
    expect(out).not.toContain("5 | e");
  });

  it("reports gracefully when the range is entirely past end-of-file", async () => {
    const { dir, write } = makeWorkspace();
    write("src/foo.ts", fileBody);
    const out = await expandFileReferences("@src/foo.ts#L90-99 oops", dir);
    expect(out).toContain("not included");
    expect(out).toContain("selection outside file lines");
  });

  it("still whole-file-inlines a non-range reference", async () => {
    const { dir, write } = makeWorkspace();
    write("src/bar.ts", "a\nb\n");
    const out = await expandFileReferences("see @src/bar.ts", dir);
    expect(out).toContain("file: src/bar.ts");
    expect(out).toContain("a");
    expect(out).toContain("b");
  });
});

describe("parseFileReferences", () => {
  it("returns paths with the range suffix stripped", () => {
    const paths = parseFileReferences("@src/foo.ts#L3-7 and @a/b.ts#L2");
    expect(paths).toEqual(["src/foo.ts", "a/b.ts"]);
  });

  it("does not parse @( or PowerShell arrays/hashtables as file references", () => {
    const text = `
      $model = @("27B", "8B")
      $candidates = @(
        "bin\\llama.exe"
      )
      $ht = @{ key = "val" }
      $arr = @[1, 2]
      $quoted1 = @"foo, bar"
      $quoted2 = @"baz",
    `;
    const paths = parseFileReferences(text);
    expect(paths).toEqual([]);
  });

  it("does not mangle PowerShell code with not included errors", async () => {
    const { dir } = makeWorkspace();
    const script = `if ($m -notin @("27B", "8B")) { exit 1 }`;
    const out = await expandFileReferences(script, dir);
    expect(out).toBe(script);
    expect(out).not.toContain("not included");
  });

  it("accurately inlines Send selection to chat format (@settings.json#L2-2)", async () => {
    const { dir, write } = makeWorkspace();
    write(".pi/settings.json", '{\n  "packages": []\n}\n');
    const out = await expandFileReferences("@.pi/settings.json#L2-2 check this", dir);
    expect(out).toContain("file: .pi/settings.json (lines 2-2)");
    expect(out).toContain('2 |   "packages": []');
    expect(out).toContain("check this");
  });

  it("does not parse bare identifiers like @ServerArgs or @args as file references", async () => {
    const { dir } = makeWorkspace();
    const text = "& $Bin @ServerArgs @args";
    const paths = parseFileReferences(text);
    expect(paths).toEqual([]);

    const out = await expandFileReferences(text, dir);
    expect(out).toBe(text);
  });
});