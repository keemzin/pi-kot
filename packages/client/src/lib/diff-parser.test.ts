import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "./diff-parser.js";

describe("parseUnifiedDiff", () => {
  it("returns empty array for empty input", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  it("handles added lines", () => {
    const result = parseUnifiedDiff(`@@ -0,0 +1,3 @@
+def
+ghi
+jkl`);
    expect(result).toEqual([
      { line: 1, kind: "added" },
      { line: 2, kind: "added" },
      { line: 3, kind: "added" },
    ]);
  });

  it("handles modified lines", () => {
    const result = parseUnifiedDiff(`@@ -1,2 +1,2 @@
-old
+new`);
    expect(result).toEqual([{ line: 1, kind: "modified" }]);
  });

  it("handles deleted lines", () => {
    const result = parseUnifiedDiff(`@@ -1,3 +1,1 @@
-one
-two
-three
+four`);
    // 3 deletions, 1 addition → 1 modified, remaining 2 become deletedAbove
    expect(result).toEqual([
      { line: 1, kind: "modified" },
      { line: 2, kind: "deletedAbove" },
    ]);
  });

  it("handles pure deletions at EOF", () => {
    const result = parseUnifiedDiff(`@@ -1,3 +0,0 @@
-one
-two
-three`);
    expect(result).toEqual([{ line: 1, kind: "deletedAbove" }]);
  });

  it("handles real-world git diff with context", () => {
    const result = parseUnifiedDiff(`@@ -10,7 +10,7 @@
   existing line
-removed line
+replacement line
   another context
-stale code
+updated code
   final context`);
    expect(result).toEqual([
      { line: 11, kind: "modified" },
      { line: 13, kind: "modified" },
    ]);
  });

  it("handles multiple hunks", () => {
    const result = parseUnifiedDiff(`@@ -1,2 +1,2 @@
-old
+new
@@ -10,2 +10,2 @@
-other
+other2`);
    expect(result).toEqual([
      { line: 1, kind: "modified" },
      { line: 10, kind: "modified" },
    ]);
  });
});
