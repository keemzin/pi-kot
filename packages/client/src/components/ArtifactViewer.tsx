/**
 * ArtifactViewer — slides beside the chat when an artifact is clicked in the list.
 * Features:
 * 1. Segmented Preview ↔ Code toggle
 * 2. Action toolbar: Copy, Download, Pop Out / Fullscreen, Refresh
 * 3. Canvas background toggle for HTML/SVG (Light, Dark, Checkerboard)
 * 4. Responsive mobile-friendly layout with back/close button
 * 5. Tab strip with auto-persistence of width and state
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLayoutStore, type ArtifactItem, VIEWER_MIN_WIDTH } from "../stores/layout-store";
import { displayInSandbox } from "../lib/sandbox";
import { ChatMarkdown } from "./ChatMarkdown";
import { Highlight, themes as prismThemes } from "prism-react-renderer";
import { getUiSettings, updateUiSettings } from "../lib/api-client";
import {
  Eye,
  Code2,
  Copy,
  Check,
  Download,
  ExternalLink,
  RotateCw,
  X,
  ChevronLeft,
  Sun,
  Moon,
  Grid,
} from "lucide-react";

type CanvasTheme = "light" | "dark" | "checker";

/* ── Preview Renderers ── */

function SandboxPreview({
  item,
  renderKey,
  canvasTheme,
}: {
  item: ArtifactItem;
  renderKey: number;
  canvasTheme: CanvasTheme;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const bgStyle =
      canvasTheme === "light"
        ? "background:#ffffff;color:#111111;"
        : canvasTheme === "dark"
        ? "background:#1e1e2e;color:#cdd6f4;"
        : "background:transparent;";

    const html =
      item.type === "svg"
        ? `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${item.title}</title>
           <style>
             html, body { margin:0; padding:16px; display:flex; align-items:center; justify-content:center; min-height:100vh; box-sizing:border-box; ${bgStyle} }
             svg { max-width:100%; max-height:100%; height:auto; }
           </style>
           </head><body>${item.content}</body></html>`
        : item.content;

    const cleanup = displayInSandbox(el, html, "allow-scripts allow-modals", "transparent");
    return cleanup;
  }, [item, renderKey, canvasTheme]);

  const checkerBg =
    canvasTheme === "checker"
      ? {
          backgroundImage:
            "linear-gradient(45deg, rgba(128,128,128,0.12) 25%, transparent 25%), linear-gradient(-45deg, rgba(128,128,128,0.12) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.12) 75%), linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.12) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
          backgroundColor: "var(--bg-solid, #181825)",
        }
      : canvasTheme === "light"
      ? { backgroundColor: "#ffffff" }
      : { backgroundColor: "var(--bg-solid, #181825)" };

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        ...checkerBg,
      }}
    />
  );
}

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
        <pre
          style={{
            margin: 0,
            padding: "16px",
            fontSize: 12.5,
            lineHeight: 1.6,
            overflow: "auto",
            flex: 1,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          }}
        >
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
        margin: 0,
        padding: "16px",
        fontSize: 12.5,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        overflow: "auto",
        flex: 1,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        color: "var(--text-primary)",
        lineHeight: 1.6,
      }}
    >
      {content}
    </pre>
  );
}

function ImagePreview({ content }: { content: string }) {
  const isDataUri = /^data:image\//.test(content) || content.startsWith("http") || content.startsWith("/api/");
  const src = isDataUri ? content : `data:image/png;base64,${content}`;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        overflow: "auto",
        background: "var(--bg-solid, #181825)",
      }}
    >
      <img
        src={src}
        alt="artifact"
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          borderRadius: 8,
          boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
          objectFit: "contain",
        }}
      />
    </div>
  );
}

function CodeView({ item }: { item: ArtifactItem }) {
  const isLight = document.documentElement.getAttribute("data-theme")?.includes("light");
  const prismTheme = isLight ? prismThemes.vsLight : prismThemes.nightOwl;

  let language = "markup";
  if (item.type === "json") language = "json";
  else if (item.type === "markdown") language = "markdown";
  else if (item.type === "html" || item.type === "svg") language = "markup";
  else language = "text";

  let formattedCode = item.content;
  if (item.type === "json") {
    try {
      formattedCode = JSON.stringify(JSON.parse(item.content), null, 2);
    } catch {
      formattedCode = item.content;
    }
  }

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: "auto",
        background: isLight ? "#f8fafc" : "var(--bg-solid, #121218)",
      }}
    >
      <Highlight theme={prismTheme} code={formattedCode} language={language}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <pre
            style={{
              margin: 0,
              padding: "16px 12px",
              fontSize: 12.5,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              lineHeight: 1.6,
              tabSize: 2,
            }}
          >
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })} style={{ display: "flex" }}>
                <span
                  style={{
                    width: "36px",
                    textAlign: "right",
                    paddingRight: "14px",
                    userSelect: "none",
                    opacity: 0.35,
                    flexShrink: 0,
                    fontSize: 11,
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ flex: 1, minWidth: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {line.map((token, j) => (
                    <span key={j} {...getTokenProps({ token })} />
                  ))}
                </span>
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}

function ArtifactContentRenderer({
  item,
  mode,
  renderKey,
  canvasTheme,
}: {
  item: ArtifactItem;
  mode: "preview" | "code";
  renderKey: number;
  canvasTheme: CanvasTheme;
}) {
  if (mode === "code" && item.type !== "image") {
    return <CodeView item={item} />;
  }

  switch (item.type) {
    case "html":
    case "svg":
      return <SandboxPreview item={item} renderKey={renderKey} canvasTheme={canvasTheme} />;
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

/* ── Main Viewer ── */

const ARTIFACT_ICONS: Record<string, string> = {
  html: "◈",
  svg: "◇",
  markdown: "📝",
  json: "{}",
  text: "¶",
  image: "🖼",
};

export function ArtifactViewer() {
  const isMobile = useLayoutStore((s) => s.isMobile);
  const artifactItems = useLayoutStore((s) => s.artifactItems);
  const artifactViewerTabs = useLayoutStore((s) => s.artifactViewerTabs);
  const artifactViewerActiveId = useLayoutStore((s) => s.artifactViewerActiveId);
  const artifactViewerWidth = useLayoutStore((s) => s.artifactViewerWidth);
  const setArtifactViewerActiveId = useLayoutStore((s) => s.setArtifactViewerActiveId);
  const closeArtifactViewerTab = useLayoutStore((s) => s.closeArtifactViewerTab);
  const closeAllArtifactViewerTabs = useLayoutStore((s) => s.closeAllArtifactViewerTabs);
  const setArtifactViewerWidth = useLayoutStore((s) => s.setArtifactViewerWidth);

  const [mode, setMode] = useState<"preview" | "code">("preview");
  const [canvasTheme, setCanvasTheme] = useState<CanvasTheme>("checker");
  const [renderKey, setRenderKey] = useState<number>(0);
  const [copied, setCopied] = useState<boolean>(false);

  const resizeRef = useRef<{ startX: number; startW: number } | undefined>(undefined);
  const [isResizing, setIsResizing] = useState(false);

  const activeTab =
    artifactViewerTabs.find((t) => t.id === artifactViewerActiveId) ??
    artifactViewerTabs[artifactViewerTabs.length - 1];

  const activeItem = activeTab
    ? artifactItems.find((a) => a.id === activeTab.id)
    : undefined;

  const hasViewer = artifactViewerTabs.length > 0;

  // Load width on mount
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
    return () => {
      cancelled = true;
    };
  }, [setArtifactViewerWidth]);

  // Resize handler
  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
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
    },
    [artifactViewerWidth, setArtifactViewerWidth],
  );

  // Actions
  const handleCopy = () => {
    if (!activeItem) return;
    navigator.clipboard
      .writeText(activeItem.content)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        const ta = document.createElement("textarea");
        ta.value = activeItem.content;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
  };

  const handleDownload = () => {
    if (!activeItem) return;
    let ext = "txt";
    let mime = "text/plain";
    if (activeItem.type === "html") {
      ext = "html";
      mime = "text/html";
    } else if (activeItem.type === "svg") {
      ext = "svg";
      mime = "image/svg+xml";
    } else if (activeItem.type === "json") {
      ext = "json";
      mime = "application/json";
    } else if (activeItem.type === "markdown") {
      ext = "md";
      mime = "text/markdown";
    } else if (activeItem.type === "image") {
      ext = "png";
      mime = "image/png";
    }

    const safeName = (activeItem.title || "artifact")
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const filename = safeName.endsWith(`.${ext}`) ? safeName : `${safeName}.${ext}`;

    if (activeItem.type === "image" && (activeItem.content.startsWith("http") || activeItem.content.startsWith("/api/"))) {
      const a = document.createElement("a");
      a.href = activeItem.content;
      a.download = filename;
      a.click();
      return;
    }

    const blob = new Blob([activeItem.content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handlePopOut = () => {
    if (!activeItem) return;
    if (activeItem.content.startsWith("http") || activeItem.content.startsWith("/api/")) {
      window.open(activeItem.content, "_blank");
      return;
    }
    let html = activeItem.content;
    if (activeItem.type === "svg") {
      html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${activeItem.title}</title>
        <style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1e1e2e;}</style>
        </head><body>${activeItem.content}</body></html>`;
    } else if (activeItem.type === "markdown" || activeItem.type === "text" || activeItem.type === "json") {
      const blob = new Blob([activeItem.content], { type: "text/plain;charset=utf-8" });
      window.open(URL.createObjectURL(blob), "_blank");
      return;
    }
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const outStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed" as const,
        top: 50,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 130,
        background: "var(--bg-solid)",
        display: "flex",
        flexDirection: "column",
        transform: hasViewer ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
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
          {/* Resize handle (desktop only) */}
          {!isMobile && (
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
          )}

          {/* ── Top Header Bar ── */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-glass-strong, rgba(20,20,28,0.7))",
              backdropFilter: "blur(12px)",
              flexShrink: 0,
            }}
          >
            {/* Top row: Back/title (mobile) + Actions */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: isMobile ? "8px 10px" : "6px 10px",
                gap: 8,
                minHeight: 40,
                boxSizing: "border-box",
              }}
            >
              {/* Left side */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
                {isMobile && (
                  <button
                    type="button"
                    onClick={() => closeAllArtifactViewerTabs()}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      background: "var(--bg-glass)",
                      border: "1px solid var(--border)",
                      color: "var(--text-primary)",
                      padding: "5px 10px",
                      borderRadius: "var(--radius-sm, 6px)",
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    <ChevronLeft size={14} />
                    <span>Back</span>
                  </button>
                )}

                {/* Title badge */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={activeItem?.title}
                >
                  <span style={{ color: "var(--accent-text)", flexShrink: 0 }}>
                    {ARTIFACT_ICONS[activeItem?.type ?? ""] ?? "◈"}
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {activeItem?.title || "Artifact"}
                  </span>
                </div>
              </div>

              {/* Right side: Action toolbar */}
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                {/* Mode Segmented Toggle: [ Preview | Code ] */}
                {activeItem?.type !== "image" && (
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      background: "var(--bg-glass, rgba(255,255,255,0.06))",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm, 6px)",
                      padding: "2px",
                      marginRight: 4,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setMode("preview")}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: isMobile ? "4px 8px" : "3px 8px",
                        fontSize: 11,
                        fontWeight: mode === "preview" ? 600 : 400,
                        border: "none",
                        borderRadius: 4,
                        background: mode === "preview" ? "var(--accent)" : "transparent",
                        color: mode === "preview" ? "#ffffff" : "var(--text-secondary)",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                      title="Rendered visual preview"
                    >
                      <Eye size={12} />
                      <span>Preview</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("code")}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: isMobile ? "4px 8px" : "3px 8px",
                        fontSize: 11,
                        fontWeight: mode === "code" ? 600 : 400,
                        border: "none",
                        borderRadius: 4,
                        background: mode === "code" ? "var(--accent)" : "transparent",
                        color: mode === "code" ? "#ffffff" : "var(--text-secondary)",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                      title="Inspect source code"
                    >
                      <Code2 size={12} />
                      <span>Code</span>
                    </button>
                  </div>
                )}

                {/* Canvas background toggle (HTML/SVG in Preview mode) */}
                {mode === "preview" && (activeItem?.type === "html" || activeItem?.type === "svg") && (
                  <button
                    type="button"
                    onClick={() => {
                      setCanvasTheme((cur) => (cur === "checker" ? "light" : cur === "light" ? "dark" : "checker"));
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 28,
                      height: 28,
                      background: "transparent",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                    }}
                    title={`Canvas Background: ${canvasTheme} (Click to switch)`}
                  >
                    {canvasTheme === "checker" ? (
                      <Grid size={13} />
                    ) : canvasTheme === "light" ? (
                      <Sun size={13} />
                    ) : (
                      <Moon size={13} />
                    )}
                  </button>
                )}

                {/* Reload (HTML/SVG in Preview mode) */}
                {mode === "preview" && (activeItem?.type === "html" || activeItem?.type === "svg") && (
                  <button
                    type="button"
                    onClick={() => setRenderKey((k) => k + 1)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 28,
                      height: 28,
                      background: "transparent",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                    }}
                    title="Reload preview"
                  >
                    <RotateCw size={13} />
                  </button>
                )}

                {/* Copy button */}
                <button
                  type="button"
                  onClick={handleCopy}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    background: copied ? "var(--success-subtle, rgba(46, 213, 115, 0.15))" : "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    color: copied ? "var(--success, #2ed573)" : "var(--text-secondary)",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                  title={copied ? "Copied!" : "Copy content"}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>

                {/* Download button */}
                <button
                  type="button"
                  onClick={handleDownload}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                  }}
                  title="Download artifact file"
                >
                  <Download size={13} />
                </button>

                {/* Pop out to new window */}
                <button
                  type="button"
                  onClick={handlePopOut}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                  }}
                  title="Open in new window / full page"
                >
                  <ExternalLink size={13} />
                </button>

                {/* Close Viewer */}
                {!isMobile && (
                  <button
                    type="button"
                    onClick={() => closeAllArtifactViewerTabs()}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 28,
                      height: 28,
                      background: "transparent",
                      border: "none",
                      color: "var(--text-dim)",
                      cursor: "pointer",
                      marginLeft: 2,
                    }}
                    title="Close artifact viewer"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            </div>

            {/* Bottom row: Tabs strip (if > 1 tab or desktop) */}
            {artifactViewerTabs.length > 1 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "2px",
                  padding: "0 8px 4px 8px",
                  overflowX: "auto",
                  minHeight: "30px",
                  boxSizing: "border-box",
                }}
              >
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
                        fontSize: "11.5px",
                        fontWeight: isActive ? 600 : 400,
                        whiteSpace: "nowrap",
                        borderRadius: "var(--radius-xs, 4px)",
                        background: isActive ? "var(--accent-subtle)" : "transparent",
                        color: isActive ? "var(--accent-text)" : "var(--text-secondary)",
                        cursor: "pointer",
                        flexShrink: 0,
                        borderBottom: isActive ? "2px solid var(--accent-text)" : "2px solid transparent",
                        transition: "all 0.12s ease",
                      }}
                      onClick={() => setArtifactViewerActiveId(tab.id)}
                    >
                      <span>{ARTIFACT_ICONS[tab.type] ?? "◈"}</span>
                      <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {tab.title}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          closeArtifactViewerTab(tab.id);
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--text-dim)",
                          cursor: "pointer",
                          padding: "1px 2px",
                          display: "inline-flex",
                          alignItems: "center",
                          opacity: 0.6,
                        }}
                        title="Close tab"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Content Viewport ── */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {activeItem ? (
              <ArtifactContentRenderer
                key={`${activeItem.id}-${renderKey}`}
                item={activeItem}
                mode={mode}
                renderKey={renderKey}
                canvasTheme={canvasTheme}
              />
            ) : (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-tertiary)",
                  fontSize: 13,
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
