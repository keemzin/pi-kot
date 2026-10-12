import { tokenize, markEdits, type HunkData } from "react-diff-view";
import { Prism } from "prism-react-renderer";

/**
 * Map a filename to a Prism language ID for syntax highlighting.
 * Falls back to "plaintext" if no match.
 */
export function languageForFile(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    html: "markup",
    htm: "markup",
    css: "css",
    scss: "css",
    sass: "css",
    less: "css",
    py: "python",
    pyw: "python",
    rs: "rust",
    go: "go",
    rb: "clike",
    php: "clike",
    java: "clike",
    kt: "kotlin",
    swift: "swift",
    cs: "clike",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    c: "c",
    h: "cpp",
    hpp: "cpp",
    sh: "clike",
    bash: "clike",
    zsh: "clike",
    sql: "sql",
    md: "markdown",
    mdc: "markdown",
    mdx: "markdown",
    yaml: "yaml",
    yml: "yaml",
    graphql: "graphql",
    gql: "graphql",
    xml: "markup",
    svg: "markup",
    txt: "plaintext",
    text: "plaintext",
    log: "plaintext",
  };
  return ext && map[ext] ? map[ext] : "plaintext";
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: string[] };
  children?: HastNode[];
}

function prismTokensToHast(tokens: (string | Prism.Token)[]): HastNode[] {
  return tokens.map((token) => {
    if (typeof token === "string") {
      return { type: "text", value: token };
    }
    const classNames = [
      "token",
      token.type,
      ...(Array.isArray(token.alias)
        ? token.alias
        : token.alias
        ? [token.alias]
        : []),
    ];
    return {
      type: "element",
      tagName: "span",
      properties: { className: classNames },
      children:
        typeof token.content === "string"
          ? [{ type: "text", value: token.content }]
          : Array.isArray(token.content)
          ? prismTokensToHast(token.content as (string | Prism.Token)[])
          : [{ type: "text", value: String(token.content) }],
    };
  });
}

const prismRefractor = {
  highlight: (code: string, lang: string): HastNode[] => {
    const grammar =
      Prism.languages[lang] ||
      (lang === "markup" ? Prism.languages.html : undefined) ||
      Prism.languages.javascript ||
      Prism.languages.clike;
    if (!grammar) return [{ type: "text", value: code }];
    try {
      const tokens = Prism.tokenize(code, grammar);
      return prismTokensToHast(tokens);
    } catch {
      return [{ type: "text", value: code }];
    }
  },
};

/**
 * Tokenize diff hunks into syntax-highlighted tokens with
 * intraline word-level diff enhancements via `markEdits`.
 */
export function tokenizeHunksWithSyntax(
  hunks: HunkData[],
  filename?: string,
): any {
  if (!hunks || hunks.length === 0) return undefined;
  const rawLang = filename ? languageForFile(filename) : "plaintext";
  const lang = rawLang === "html" ? "markup" : rawLang;
  const isSupported = Boolean(Prism.languages[lang] || Prism.languages[rawLang]);

  try {
    return tokenize(hunks, {
      highlight: isSupported && lang !== "plaintext",
      refractor: prismRefractor,
      language: isSupported ? lang : "javascript",
      enhancers: [markEdits(hunks)],
    });
  } catch {
    try {
      return tokenize(hunks, {
        enhancers: [markEdits(hunks)],
      });
    } catch {
      return undefined;
    }
  }
}

/**
 * Backwards-compatibility wrapper for highlightHunks.
 */
export async function highlightHunks(
  hunks: HunkData[],
  language: string,
): Promise<any> {
  return tokenizeHunksWithSyntax(hunks, `file.${language}`);
}