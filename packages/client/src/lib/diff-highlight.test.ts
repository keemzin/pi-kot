import { describe, expect, it } from "vitest";
import { parseDiff } from "react-diff-view";
import { languageForFile, tokenizeHunksWithSyntax } from "./diff-highlight";

describe("languageForFile", () => {
  it("resolves typescript for .ts and .tsx", () => {
    expect(languageForFile("main.ts")).toBe("typescript");
    expect(languageForFile("Component.tsx")).toBe("tsx");
  });

  it("resolves javascript for .js and .jsx", () => {
    expect(languageForFile("index.js")).toBe("javascript");
    expect(languageForFile("app.jsx")).toBe("jsx");
  });

  it("resolves python, rust, and json", () => {
    expect(languageForFile("script.py")).toBe("python");
    expect(languageForFile("lib.rs")).toBe("rust");
    expect(languageForFile("package.json")).toBe("json");
  });

  it("falls back to plaintext for unknown extensions", () => {
    expect(languageForFile("data.xyz")).toBe("plaintext");
    expect(languageForFile("unknown")).toBe("plaintext");
  });
});

describe("tokenizeHunksWithSyntax", () => {
  it("returns undefined for empty or missing hunks", () => {
    expect(tokenizeHunksWithSyntax([])).toBeUndefined();
  });

  it("tokenizes diff hunks into syntax tokens and edit markers", () => {
    const rawDiff = `diff --git a/test.ts b/test.ts
index 0000..1111 100644
--- a/test.ts
+++ b/test.ts
@@ -1,2 +1,3 @@
 import { test } from "vitest";
-const a = 1;
+const a = 2;
+console.log(a);
`;
    const [file] = parseDiff(rawDiff);
    expect(file).toBeDefined();
    const tokens = tokenizeHunksWithSyntax(file!.hunks, "test.ts");
    expect(tokens).toBeDefined();
    expect(tokens.old).toBeDefined();
    expect(tokens.new).toBeDefined();

    // Verify token syntax types exist (e.g. keyword, punctuation, edit)
    const newTokensFlattened = JSON.stringify(tokens.new);
    expect(newTokensFlattened).toContain("keyword");
    expect(newTokensFlattened).toContain("edit");
  });
});
