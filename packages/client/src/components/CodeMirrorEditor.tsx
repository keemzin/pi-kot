import { useRef, useEffect, useMemo } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "@codemirror/basic-setup";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
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

interface Props {
  value: string;
  onChange: (val: string) => void;
  onSave?: () => void;
  fileName: string;
  wordWrap?: boolean;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  json: "json", css: "css", html: "html", md: "markdown",
  py: "python", rs: "rust", go: "go", sh: "bash", bash: "bash",
  yaml: "yaml", yml: "yaml", toml: "toml", sql: "sql",
  cpp: "cpp", c: "cpp", h: "cpp", hpp: "cpp",
  java: "java", xml: "html", svg: "html",
  mjs: "javascript", mts: "typescript", cjs: "javascript",
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
    default: return javascript();
  }
}

// Theme-adaptive syntax highlighting using CSS variables.
// Works in both light and dark themes — same approach as OpenKot.
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
    const chromeTheme = EditorView.theme({
      "&": { fontSize: "13px", height: "100%" },
      ".cm-scroller": { overflow: "auto" },
      ".cm-content": {
        fontFamily: "var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace)",
        padding: "8px 0",
      },
      ".cm-gutters": {
        borderRight: "1px solid var(--border)",
        background: "var(--bg-glass)",
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
        language,
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
      style={{ flex: 1, overflow: "hidden", background: "var(--bg-solid)" }}
    />
  );
}
