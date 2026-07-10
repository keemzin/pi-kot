import { useEffect, useRef } from "react";
import { useLayoutStore, type ArtifactItem } from "../stores/layout-store";
import { displayInSandbox } from "../lib/sandbox";
import { ChatMarkdown } from "./ChatMarkdown";
import { Highlight, themes as prismThemes } from "prism-react-renderer";

const ARTIFACT_MIN_WIDTH = 280;
const ARTIFACT_MAX_WIDTH = 900;

/** HTML/SVG: sandboxed iframe */
function SandboxPreview({ item }: { item: ArtifactItem }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const html =
      item.type === "svg"
        ? `<!DOCTYPE html><html><head><meta charset="utf-8">
           <style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff}</style>
           </head><body>${item.content}</body></html>`
        : item.content;

    const cleanup = displayInSandbox(el, html);
    return cleanup;
  }, [item]);

  return <div ref={containerRef} style={{ flex: 1, minHeight: 0, overflow: "hidden" }} />;
}

/** JSON: syntax-highlighted code block */
function JsonPreview({ content }: { content: string }) {
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    formatted = content;
  }
  return (
    <Highlight theme={prismThemes.nightOwl} code={formatted} language="json">
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre style={{ margin: 0, padding: "12px 16px", fontSize: 13, overflow: "auto", flex: 1 }}>
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })}>
              {line.map((token, j) => (
                <span key={j} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}

/** Plain text / log output */
function TextPreview({ content }: { content: string }) {
  return (
    <pre
      style={{
        margin: 0, padding: "12px 16px", fontSize: 12,
        fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace",
        overflow: "auto", flex: 1, whiteSpace: "pre-wrap", wordBreak: "break-word",
        color: "var(--text-primary)", lineHeight: 1.5,
      }}
    >
      {content}
    </pre>
  );
}

/** Image: raw render */
function ImagePreview({ content }: { content: string }) {
  const isDataUri = /^data:image\//.test(content);
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflow: "auto" }}>
      <img
        src={isDataUri ? content : `data:image/png;base64,${content}`}
        alt="artifact"
        style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8, boxShadow: "0 4px 24px rgba(0,0,0,0.15)" }}
      />
    </div>
  );
}

const ARTIFACT_ICONS: Record<string, string> = {
  html: "◈",
  svg: "◇",
  markdown: "📝",
  json: "{}",
  text: "¶",
  image: "🖼",
};

function ArtifactPreview({ item }: { item: ArtifactItem }) {
  switch (item.type) {
    case "html":
    case "svg":
      return <SandboxPreview item={item} />;
    case "markdown":
      return (
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", background: "var(--bg-primary)" }}>
          <ChatMarkdown text={item.content} />
        </div>
      );
    case "json":
      return <JsonPreview content={item.content} />;
    case "image":
      return <ImagePreview content={item.content} />;
    default:
      return <TextPreview content={item.content} />;
  }
}

export function ArtifactsPanel() {
  const artifactItems    = useLayoutStore((s) => s.artifactItems);
  const artifactActiveId = useLayoutStore((s) => s.artifactActiveId);
  const setArtifactActiveId = useLayoutStore((s) => s.setArtifactActiveId);

  const activeItem = artifactItems.find((a) => a.id === artifactActiveId) ?? artifactItems[artifactItems.length - 1];

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        background: "var(--bg-primary)",
      }}
    >
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 10px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-glass-strong)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>
            🎨 Artifacts
          </span>
          <span
            style={{ fontSize: 11, color: "var(--text-tertiary)", background: "var(--bg-glass)", padding: "1px 6px", borderRadius: 10 }}
          >
            {artifactItems.length}
          </span>
        </div>

        {/* Tab bar */}
        {artifactItems.length > 1 && (
          <div
            style={{
              display: "flex",
              overflowX: "auto",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-glass)",
              flexShrink: 0,
            }}
          >
            {artifactItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setArtifactActiveId(item.id)}
                style={{
                  flexShrink: 0,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: item.id === activeItem?.id ? 600 : 400,
                  color: item.id === activeItem?.id ? "var(--accent-text)" : "var(--text-secondary)",
                  background: item.id === activeItem?.id ? "var(--bg-glass-strong)" : "transparent",
                  border: "none",
                  borderBottom: item.id === activeItem?.id ? "2px solid var(--accent-bg)" : "2px solid transparent",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  maxWidth: 140,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={item.title}
              >
                {ARTIFACT_ICONS[item.type] ?? "◈"} {item.title}
              </button>
            ))}
          </div>
        )}

        {/* Active artifact title */}
        {artifactItems.length === 1 && activeItem && (
          <div
            style={{
              padding: "4px 10px",
              fontSize: 11,
              color: "var(--text-secondary)",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-glass)",
              flexShrink: 0,
            }}
          >
            {ARTIFACT_ICONS[activeItem.type] ?? "◈"} {activeItem.type.toUpperCase()} · {activeItem.title}
          </div>
        )}

        {/* Preview area */}
        {activeItem ? (
          <ArtifactPreview key={activeItem.id} item={activeItem} />
        ) : (
          <div
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--text-tertiary)", fontSize: 13,
            }}
          >
            No artifact selected
          </div>
        )}
      </div>
    </div>
  );
}
