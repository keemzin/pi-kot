import { useRef, useEffect, useMemo } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "@codemirror/basic-setup";
import { syntaxHighlighting, HighlightStyle, StreamLanguage } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { cpp } from "@codemirror/lang-cpp";
import { yaml } from "@codemirror/lang-yaml";
import { java } from "@codemirror/lang-java";
// Legacy modes — CM5-era language definitions wrapped via
// StreamLanguage.define() for CM6. Coverage is wide and bundle cost
// per language is small (~1–3 KB minified each).
import { jinja2 } from "@codemirror/legacy-modes/mode/jinja2";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { r } from "@codemirror/legacy-modes/mode/r";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { go } from "@codemirror/legacy-modes/mode/go";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { kotlin, scala, csharp } from "@codemirror/legacy-modes/mode/clike";
import { groovy } from "@codemirror/legacy-modes/mode/groovy";
import { xml } from "@codemirror/legacy-modes/mode/xml";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { clojure } from "@codemirror/legacy-modes/mode/clojure";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { oCaml } from "@codemirror/legacy-modes/mode/mllike";
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";

interface Props {
  value: string;
  onChange: (val: string) => void;
  onSave?: () => void;
  fileName: string;
  wordWrap?: boolean;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  mjs: "javascript", mts: "typescript", cjs: "javascript",
  json: "json", css: "css", scss: "css", less: "css",
  html: "html", htm: "html", xhtml: "html", svg: "html",
  xml: "xml", xsl: "xml", xslt: "xml",
  md: "markdown", mdx: "markdown",
  py: "python", pyw: "python",
  rs: "rust",
  go: "go",
  sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
  yaml: "yaml", yml: "yaml",
  toml: "toml",
  sql: "sql",
  cpp: "cpp", c: "cpp", h: "cpp", hpp: "cpp", cc: "cpp", cxx: "cpp",
  java: "java", class: "java", jar: "java",
  rb: "ruby", rake: "ruby", gemspec: "ruby",
  kt: "kotlin", kts: "kotlin", ktm: "kotlin",
  scala: "scala", sc: "scala",
  swift: "swift",
  groovy: "groovy", gvy: "groovy", gsh: "groovy",
  cs: "csharp", csx: "csharp",
  lua: "lua",
  pl: "perl", pm: "perl", t: "perl",
  r: "r", rmd: "r",
  ps1: "powershell", psm1: "powershell", psd1: "powershell",
  clj: "clojure", cljs: "clojure", cljc: "clojure", edn: "clojure",
  hs: "haskell", lhs: "haskell",
  ml: "ocaml", mli: "ocaml",
  proto: "protobuf",
  cmake: "cmake",
  nginx: "nginx", nginxconf: "nginx",
  Dockerfile: "dockerfile", dockerfile: "dockerfile",
  ini: "properties", cfg: "properties", conf: "properties",
  env: "properties",
  jinja: "jinja2", jinja2: "jinja2", j2: "jinja2",
  Makefile: "makefile", mk: "makefile", mak: "makefile",
  diff: "diff", patch: "diff"
};

function languageFromExt(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const lang = EXT_TO_LANG[ext];
  switch (lang) {
    case "typescript": return javascript({ typescript: true });
    case "tsx": return javascript({ jsx: true, typescript: true });
    case "javascript": return javascript();
    case "jsx": return javascript({ jsx: true });
    case "python": return python();
    case "rust": return rust();
    case "markdown": return markdown();
    case "json": return json();
    case "html": return html();
    case "css": return css();
    case "cpp": return cpp();
    case "yaml": return yaml();
    case "java": return java();
    // Legacy-mode-backed languages
    case "shell": return StreamLanguage.define(shell);
    case "toml": return StreamLanguage.define(toml);
    case "dockerfile": return StreamLanguage.define(dockerFile);
    case "properties": return StreamLanguage.define(properties);
    case "lua": return StreamLanguage.define(lua);
    case "perl": return StreamLanguage.define(perl);
    case "r": return StreamLanguage.define(r);
    case "powershell": return StreamLanguage.define(powerShell);
    case "ruby": return StreamLanguage.define(ruby);
    case "go": return StreamLanguage.define(go);
    case "swift": return StreamLanguage.define(swift);
    case "kotlin": return StreamLanguage.define(kotlin);
    case "scala": return StreamLanguage.define(scala);
    case "groovy": return StreamLanguage.define(groovy);
    case "csharp": return StreamLanguage.define(csharp);
    case "xml": return StreamLanguage.define(xml);
    case "jinja2": return StreamLanguage.define(jinja2);
    case "sql": return StreamLanguage.define(standardSQL);
    case "diff": return StreamLanguage.define(diff);
    case "clojure": return StreamLanguage.define(clojure);
    case "haskell": return StreamLanguage.define(haskell);
    case "ocaml": return StreamLanguage.define(oCaml);
    case "protobuf": return StreamLanguage.define(protobuf);
    case "cmake": return StreamLanguage.define(cmake);
    case "nginx": return StreamLanguage.define(nginx);
    case "makefile": return StreamLanguage.define(shell);
    default: return undefined;
  }
}

// Theme-adaptive syntax highlighting using CSS variables.
// Works in both light and dark themes.
const themeHighlight = HighlightStyle.define([
  { tag: tags.keyword,              color: "var(--cm-keyword, var(--accent-text))", fontWeight: "bold" },
  { tag: tags.operator,             color: "var(--cm-operator, var(--text-secondary))" },
  { tag: tags.string,               color: "var(--cm-string, #98c379)" },
  { tag: tags.number,               color: "var(--cm-number, #d19a66)" },
  { tag: tags.bool,                 color: "var(--cm-bool, #d19a66)" },
  { tag: tags.null,                 color: "var(--cm-null, #d19a66)" },
  { tag: tags.comment,              color: "var(--cm-comment, #5c6370)", fontStyle: "italic" },
  { tag: tags.lineComment,          color: "var(--cm-comment, #5c6370)", fontStyle: "italic" },
  { tag: tags.blockComment,         color: "var(--cm-comment, #5c6370)", fontStyle: "italic" },
  { tag: tags.function(tags.variableName), color: "var(--cm-function, #61afef)" },
  { tag: tags.function(tags.propertyName), color: "var(--cm-function, #61afef)" },
  { tag: tags.className,            color: "var(--cm-class, #e5c07b)" },
  { tag: tags.typeName,             color: "var(--cm-type, #e5c07b)" },
  { tag: tags.propertyName,         color: "var(--cm-property, var(--text-primary))" },
  { tag: tags.variableName,         color: "var(--cm-variable, var(--text-primary))" },
  { tag: tags.attributeName,        color: "var(--cm-attr-name, #98c379)" },
  { tag: tags.attributeValue,       color: "var(--cm-attr-value, #98c379)" },
  { tag: tags.tagName,              color: "var(--cm-tag, var(--accent-text))" },
  { tag: tags.punctuation,          color: "var(--cm-punctuation, var(--text-dim))" },
  { tag: tags.bracket,              color: "var(--cm-bracket, var(--text-dim))" },
  { tag: tags.regexp,               color: "var(--cm-regex, #c678dd)" },
  { tag: tags.escape,               color: "var(--cm-escape, #c678dd)" },
  { tag: tags.link,                 color: "var(--cm-link, #61afef)", textDecoration: "underline" },
  { tag: tags.heading,              color: "var(--cm-heading, var(--accent-text))", fontWeight: "bold" },
  { tag: tags.strong,               fontWeight: "bold" },
  { tag: tags.emphasis,             fontStyle: "italic" },
  { tag: tags.inserted,             color: "var(--cm-inserted, #98c379)" },
  { tag: tags.deleted,              color: "var(--cm-deleted, #e06c75)" },
  { tag: tags.changed,              color: "var(--cm-changed, #d19a66)" },
  { tag: tags.meta,                 color: "var(--cm-meta, var(--text-dim))" },
]);

export function CodeMirrorEditor({
  value,
  onChange,
  onSave,
  fileName,
  wordWrap = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const wrappingCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  const language = useMemo(() => languageFromExt(fileName), [fileName]);

  // Re-create editor when language changes (file switch)
  const langKey = useMemo(() => fileName, [fileName]);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const saveKeymap = keymap.of([
      { key: "Mod-s", run: () => { onSaveRef.current?.(); return true; } },
    ]);

    // Editor chrome that adapts to CSS variables
    // Force editor to fill its container so `.cm-scroller` is
    // the actual scroll container, not the parent div. The gutter
    // gets an explicit z-index so text content doesn't layer over
    // the line numbers during horizontal scroll.
    const chromeTheme = EditorView.theme({
      "&": { fontSize: "13px", height: "100%" },
      ".cm-scroller": { overflow: "auto" },
      ".cm-content": {
        fontFamily: "var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace)",
        padding: "8px 0",
      },
      ".cm-gutters": {
        zIndex: 1,
        borderRight: "1px solid var(--border)",
        background: "var(--bg-solid)",
        color: "var(--text-dim)",
      },
      ".cm-activeLineGutter": { background: "var(--bg-glass-hover)" },
      ".cm-activeLine": { background: "var(--bg-glass-hover)" },
      "&.cm-focused .cm-cursor": { borderLeftColor: "var(--accent-text)" },
      ".cm-selectionBackground": { background: "var(--selection-bg, rgba(255,255,255,0.1))" },
      "&.cm-focused .cm-selectionBackground": {
        background: "var(--selection-bg-focused, rgba(255,255,255,0.15))",
      },
      ".cm-matchingBracket": {
        background: "rgba(255,255,255,0.08)",
        outline: "1px solid var(--text-dim)",
      },
      ".cm-foldPlaceholder": {
        background: "var(--bg-glass)",
        border: "1px solid var(--border)",
        color: "var(--text-dim)",
      },
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        syntaxHighlighting(themeHighlight, { fallback: true }),
        ...(language !== undefined ? [language] : []),
        chromeTheme,
        updateListener,
        saveKeymap,
        wrappingCompartment.current.of(wordWrap ? EditorView.lineWrapping : []),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [langKey]);

  // Sync value from external changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  // Toggle word wrap
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wrappingCompartment.current.reconfigure(
        wordWrap ? EditorView.lineWrapping : [],
      ),
    });
  }, [wordWrap]);

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, minHeight: 0, minWidth: 0, background: "var(--bg-solid)" }}
    />
  );
}
