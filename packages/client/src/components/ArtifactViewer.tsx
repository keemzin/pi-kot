/**
 * ArtifactViewer — slides beside the chat when an artifact is clicked in the list.
 * Mirrors FileViewerPanel: tab strip, resizable, width persisted to localStorage + server.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLayoutStore, type ArtifactItem, VIEWER_MIN_WIDTH } from "../stores/layout-store";
import { displayInSandbox } from "../lib/sandbox";
import { ChatMarkdown } from "./ChatMarkdown";
import { Highlight, themes as prismThemes } from "prism-react-renderer";
import { getUiSettings, updateUiSettings } from "../lib/api-client";

/* ── Preview renderers (moved from ArtifactsPanel) ── */

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

function JsonPreview({ content }: { content: string }) {
  let formatted: string;
  try { formatted = JSON.stringify(JSON.parse(content), null, 2); }
  catch { formatted = content; }
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

/* ── Viewer panel ── */

const ARTIFACT_ICONS: Record<string, string> = {
  html: "◈", svg: "◇", markdown: "📝", json: "{}", text: "¶", image: "🖼",
};

export function ArtifactViewer() {
  const isMobile                = useLayoutStore((s) => s.isMobile);
  const artifactItems          = useLayoutStore((s) => s.artifactItems);
  const artifactViewerTabs     = useLayoutStore((s) => s.artifactViewerTabs);
  const artifactViewerActiveId = useLayoutStore((s) => s.artifactViewerActiveId);
  const artifactViewerWidth    = useLayoutStore((s) => s.artifactViewerWidth);
  const setArtifactViewerActiveId = useLayoutStore((s) => s.setArtifactViewerActiveId);
  const closeArtifactViewerTab    = useLayoutStore((s) => s.closeArtifactViewerTab);
  const closeAllArtifactViewerTabs = useLayoutStore((s) => s.closeAllArtifactViewerTabs);
  const setArtifactViewerWidth     = useLayoutStore((s) => s.setArtifactViewerWidth);

  const resizeRef = useRef<{ startX: number; startW: number } | undefined>(undefined);
  const [isResizing, setIsResizing] = useState(false);

  const activeTab = artifactViewerTabs.find((t) => t.id === artifactViewerActiveId)
    ?? artifactViewerTabs[artifactViewerTabs.length - 1];
  const activeItem = activeTab
    ? artifactItems.find((a) => a.id === activeTab.id)
    : undefined;
  const hasViewer = artifactViewerTabs.length > 0;

  // ── Load persisted width from server on mount ──
  useEffect(() => {
    let cancelled = false;
    getUiSettings()
      .then((s) => {
        if (cancelled) return;
        const w = (s as Record<string, unknown>).artifactViewerWidth;
        if (typeof w === "number" && w > 0) {
          setArtifactViewerWidth(w);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [setArtifactViewerWidth]);

  // ── Resize ──
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeRef.current = { startX: e.clientX, startW: artifactViewerWidth };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = ev.clientX - resizeRef.current.startX;
      setArtifactViewerWidth(resizeRef.current.startW - dx);
    };
    const onUp = () => {
      setIsResizing(false);
      resizeRef.current = undefined;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const finalW = useLayoutStore.getState().artifactViewerWidth;
      updateUiSettings({ artifactViewerWidth: finalW }).catch(() => {});
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [artifactViewerWidth, setArtifactViewerWidth]);

  const outStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed" as const,
        top: 50,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 130, // above mobile explorer (120)
        background: "var(--bg-solid)",
        display: "flex",
        flexDirection: "column",
        transform: hasViewer ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.18s ease",
        willChange: "transform",
        overflow: "hidden",
      }
    : {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: hasViewer ? artifactViewerWidth : 0,
        minWidth: hasViewer ? VIEWER_MIN_WIDTH : 0,
        overflow: "hidden",
        flexShrink: 0,
        position: "relative" as const,
        borderLeft: hasViewer ? "1px solid var(--border)" : "none",
        background: "var(--bg-solid)",
        transition: isResizing ? "none" : "width 0.2s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        willChange: "width",
        paddingTop: "50px",
      };

  return (
    <div style={outStyle}>
      {hasViewer && (
        <>
          {/* ── Resize handle ── */}
          <div
            onMouseDown={onResizeStart}
            className="artifact-viewer-resize-handle"
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: "4px",
              cursor: "col-resize",
              zIndex: 10,
              background: "transparent",
              transition: "background 0.15s ease",
            }}
          />

          {/* ── Tab strip ── */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "2px",
              padding: "4px 8px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-glass)",
              flexShrink: 0,
              overflowX: "auto",
              minHeight: "38px",
            }}
          >
            {artifactViewerTabs.length > 1 && (
              <button
                onClick={() => closeAllArtifactViewerTabs()}
                title="Close all artifact tabs"
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  padding: "2px 6px",
                  fontSize: "11px",
                  borderRadius: "var(--radius-xs)",
                  flexShrink: 0,
                }}
                type="button"
              >
                ✕✕
              </button>
            )}
            {artifactViewerTabs.map((tab) => {
              const isActive = tab.id === artifactViewerActiveId;
              return (
                <div
                  key={tab.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "3px 8px",
                    fontSize: "12px",
                    fontWeight: isActive ? 600 : 400,
                    whiteSpace: "nowrap",
                    borderRadius: "var(--radius-xs)",
                    background: isActive ? "var(--accent-subtle)" : "transparent",
                    color: isActive ? "var(--accent-text)" : "var(--text-secondary)",
                    cursor: "default",
                    minWidth: 0,
                    flexShrink: 0,
                    borderBottom: isActive ? "2px solid var(--accent-text)" : "2px solid transparent",
                    transition: "all 0.12s ease",
                  }}
                >
                  <button
                    onClick={() => setArtifactViewerActiveId(tab.id)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "inherit",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: "12px",
                      fontWeight: "inherit",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    type="button"
                    title={tab.title}
                  >
                    {ARTIFACT_ICONS[tab.type] ?? "◈"} {tab.title}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeArtifactViewerTab(tab.id);
                    }}
                    title="Close"
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--text-dim)",
                      cursor: "pointer",
                      padding: "1px 3px",
                      fontSize: "10px",
                      lineHeight: 1,
                      opacity: 0.5,
                      borderRadius: "2px",
                    }}
                    type="button"
                    className="artifact-viewer-tab-close"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          {/* ── Preview area ── */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {activeItem ? (
              <ArtifactPreview key={activeItem.id} item={activeItem} />
            ) : (
              <div
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--text-tertiary)", fontSize: 13,
                }}
              >
                Artifact not found
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
