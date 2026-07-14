import type { HunkData } from "react-diff-view";

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
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    sass: "sass",
    less: "less",
    py: "python",
    pyw: "python",
    rs: "rust",
    go: "go",
    rb: "ruby",
    php: "php",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    cs: "csharp",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    c: "c",
    h: "cpp",
    hpp: "cpp",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    fish: "bash",
    ps1: "powershell",
    sql: "sql",
    md: "markdown",
    mdc: "markdown",
    mdx: "markdown",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    ini: "ini",
    cfg: "ini",
    conf: "ini",
    dockerfile: "docker",
    tf: "hcl",
    hcl: "hcl",
    proto: "protobuf",
    graphql: "graphql",
    gql: "graphql",
    vue: "vue",
    svelte: "svelte",
    astro: "astro",
    xml: "xml",
    svg: "xml",
    plist: "xml",
    txt: "plaintext",
    text: "plaintext",
    log: "plaintext",
    csv: "csv",
    tsv: "csv",
    lock: "plaintext",
  };
  return ext && map[ext] ? map[ext] : "plaintext";
}

/**
 * Placeholder for future syntax highlighting. Currently returns
 * undefined to disable highlighting (renders plain text diffs).
 * When enabled, this would use prism-react-renderer to tokenize
 * diff hunks and return HunkTokens compatible with react-diff-view.
 */
export async function highlightHunks(
  _hunks: HunkData[],
  _language: string,
): Promise<undefined> {
  return undefined;
}