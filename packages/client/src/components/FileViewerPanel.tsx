import { useCallback, useEffect, useRef, useState } from "react";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { RenderedView } from "./RenderedView";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { filesRead, filesWrite } from "../lib/api-client";
import { useLayoutStore, VIEWER_MIN_WIDTH } from "../stores/layout-store";
import { ConfirmDialog } from "./Modal";

export function FileViewerPanel({ projectId }: { projectId: string }) {
  const viewerTabs = useLayoutStore((s) => s.viewerTabs);
  const viewerActivePath = useLayoutStore((s) => s.viewerActivePath);
  const viewerWidth = useLayoutStore((s) => s.viewerWidth);
  const setViewerActivePath = useLayoutStore((s) => s.setViewerActivePath);
  const closeFileViewerTab = useLayoutStore((s) => s.closeFileViewerTab);
  const closeAllViewerTabs = useLayoutStore((s) => s.closeAllViewerTabs);
  const setViewerWidth = useLayoutStore((s) => s.setViewerWidth);

  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [language, setLanguage] = useState<string | undefined>();
  const [savedAt, setSavedAt] = useState<Date | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);
  const [editorMode, setEditorMode] = useState<"raw" | "rendered">("raw");
  const [pendingConfirm, setPendingConfirm] = useState<
    { kind: "close-tab"; path: string; name: string } | { kind: "close-all" } | undefined
  >(undefined);
  const resizeRef = useRef<{ startX: number; startW: number } | undefined>(undefined);

  const activeFile = viewerTabs.find((t) => t.path === viewerActivePath);
  const isDirty = content !== savedContent;

  // Load file content when active file changes
  useEffect(() => {
    if (!activeFile) {
      setContent("");
      setSavedContent("");
      setError(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    filesRead(projectId, activeFile.path)
      .then((data) => {
        if (cancelled) return;
        const c = data.binary ? "(binary file)" : data.content ?? "";
        // CM6 always terminates documents with \n — normalize so
        // the onChange callback doesn't fire after the sync sync
        // effect, which would make content !== savedContent and
        // mark a freshly opened file as dirty.
        const normalized = c === "" || c.endsWith("\n") ? c : c + "\n";
        setContent(normalized);
        setSavedContent(normalized);
        setLanguage(data.language);
        setFileName(activeFile.name);
        setSavedAt(undefined);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "read failed");
        setContent("");
        setSavedContent("");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeFile?.path, projectId]);

  const handleSave = useCallback(async () => {
    if (!activeFile || !isDirty || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await filesWrite(projectId, activeFile.path, content);
      setSavedContent(content);
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }, [activeFile, content, isDirty, saving, projectId]);

  const handleContentChange = useCallback((value: string) => {
    setContent(value);
  }, []);

  // ── Resize ──
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startW: viewerWidth };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = ev.clientX - resizeRef.current.startX;
      setViewerWidth(resizeRef.current.startW - dx);
    };
    const onUp = () => {
      resizeRef.current = undefined;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [viewerWidth, setViewerWidth]);

  // ── Keyboard: Ctrl+S / Cmd+S ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handleSave]);

  const hasViewer = viewerTabs.length > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: hasViewer ? viewerWidth : 0,
        minWidth: hasViewer ? VIEWER_MIN_WIDTH : 0,
        overflow: "hidden",
        flexShrink: 0,
        borderLeft: hasViewer ? "1px solid var(--border)" : "none",
        background: "var(--bg-solid)",
        transition: "width 0.2s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        willChange: "width",
        paddingTop: "50px",
      }}
    >
      {hasViewer && (
        <>
          {/* ── Resize handle ── */}
          <div
            onMouseDown={onResizeStart}
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
            className="viewer-resize-handle"
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
            {viewerTabs.length > 1 && (
              <button
                onClick={() => {
                  if (isDirty) { setPendingConfirm({ kind: "close-all" }); return; }
                  closeAllViewerTabs();
                }}
                title="Close all tabs"
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
            {viewerTabs.map((tab) => {
              const isActive = tab.path === viewerActivePath;
              return (
                <div
                  key={tab.path}
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
                  {/* Dirty dot indicator — only for the active tab */}
                  {isActive && isDirty && (
                    <span
                      style={{
                        display: "inline-block",
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: "var(--accent-text, #e8a838)",
                        flexShrink: 0,
                      }}
                      aria-label="Unsaved changes"
                      title="Unsaved changes"
                    />
                  )}
                  <button
                    onClick={() => setViewerActivePath(tab.path)}
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
                    title={tab.path}
                  >
                    {tab.name}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isActive && isDirty) {
                        setPendingConfirm({ kind: "close-tab", path: tab.path, name: tab.name });
                        return;
                      }
                      closeFileViewerTab(tab.path);
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
                    className="viewer-tab-close"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          {/* ── Error ── */}
          {error && (
            <div
              style={{
                padding: "4px 12px",
                fontSize: "10px",
                color: "var(--error)",
                background: "rgba(248,113,113,0.08)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {error}
            </div>
          )}

          {/* ── Editor area ── */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {loading ? (
              <div style={{ padding: "12px" }}>
                <LoadingSkeleton variant="card" count={3} />
              </div>
            ) : activeFile ? (
              <>
                {/* Toolbar — just path + raw/rendered toggle */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "6px",
                    padding: "3px 10px",
                    fontSize: "10px",
                    color: "var(--text-dim)",
                    borderBottom: "1px solid var(--border)",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                    }}
                    title={activeFile.path}
                  >
                    {activeFile.path}
                  </span>

                  {/* Raw / Rendered toggle */}
                  <div
                    style={{
                      display: "flex",
                      gap: "1px",
                      background: "var(--bg-glass)",
                      borderRadius: "var(--radius-sm)",
                      padding: "1px",
                      flexShrink: 0,
                    }}
                  >
                    <button
                      onClick={() => setEditorMode("raw")}
                      style={{
                        background: editorMode === "raw" ? "var(--bg-solid)" : "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: editorMode === "raw" ? "var(--text-primary)" : "var(--text-dim)",
                        fontSize: "10px",
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: "var(--radius-sm)",
                      }}
                      type="button"
                    >
                      Raw
                    </button>
                    <button
                      onClick={() => setEditorMode("rendered")}
                      style={{
                        background: editorMode === "rendered" ? "var(--bg-solid)" : "transparent",
                        border: "none",
                        cursor: "pointer",
                        color: editorMode === "rendered" ? "var(--text-primary)" : "var(--text-dim)",
                        fontSize: "10px",
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: "var(--radius-sm)",
                      }}
                      type="button"
                    >
                      Rendered
                    </button>
                  </div>

                  {/* Wrap toggle — only in raw mode */}
                  {editorMode === "raw" && (
                    <button
                      onClick={() => setWordWrap((w) => !w)}
                      title="Toggle word wrap"
                      style={{
                        padding: "2px 6px",
                        fontSize: "9px",
                        fontWeight: 600,
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        background: wordWrap ? "var(--accent-bg)" : "transparent",
                        color: wordWrap ? "var(--accent-text)" : "var(--text-dim)",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                      type="button"
                    >
                      {wordWrap ? "wrap" : "no wrap"}
                    </button>
                  )}
                </div>

                {/* Editor body */}
                {editorMode === "raw" ? (
                  <CodeMirrorEditor
                    key={`viewer-${activeFile.path}`}
                    value={content}
                    onChange={handleContentChange}
                    onSave={handleSave}
                    fileName={activeFile.name}
                    wordWrap={wordWrap}
                  />
                ) : (
                  <RenderedView
                    content={content}
                    fileName={activeFile.name}
                  />
                )}

                {/* Status bar — language, wrap toggle, save status, save button */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                    padding: "2px 10px",
                    fontSize: "10px",
                    color: "var(--text-dim)",
                    borderTop: "1px solid var(--border)",
                    background: "var(--bg-glass)",
                    flexShrink: 0,
                  }}
                >
                  {/* Left: language label */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {language && (
                      <span
                        style={{
                          fontFamily: "var(--font-mono, monospace)",
                          fontSize: "10px",
                          color: "var(--text-dim)",
                        }}
                      >
                        {language}
                      </span>
                    )}
                  </div>

                  {/* Right: status label + save button */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {/* Status label */}
                    {(() => {
                      if (saving) {
                        return <span style={{ color: "var(--text-dim)", fontStyle: "italic" }}>Saving…</span>;
                      }
                      if (error) {
                        return <span style={{ color: "var(--error, #e06c75)" }}>Save failed</span>;
                      }
                      if (isDirty) {
                        return <span style={{ color: "var(--accent-text, #d19a66)" }}>Unsaved changes</span>;
                      }
                      if (savedAt) {
                        return <span style={{ color: "#98c379" }}>Saved {savedAt.toLocaleTimeString()}</span>;
                      }
                      return <span>Up to date</span>;
                    })()}

                    <button
                      onClick={handleSave}
                      disabled={!isDirty || saving}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "3px",
                        padding: "2px 8px",
                        fontSize: "10px",
                        fontWeight: 600,
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        background: isDirty ? "var(--accent-bg)" : "transparent",
                        color: isDirty ? "var(--accent-text)" : "var(--text-dim)",
                        cursor: isDirty && !saving ? "pointer" : "default",
                        opacity: isDirty ? 1 : 0.5,
                      }}
                      type="button"
                    >
                      {saving ? "Saving…" : isDirty ? "Save" : "Saved"}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </>
      )}

      {/* Theme confirmation dialog — replaces browser confirm() */}
      <ConfirmDialog
        open={pendingConfirm !== undefined}
        onClose={() => setPendingConfirm(undefined)}
        onConfirm={() => {
          if (pendingConfirm?.kind === "close-tab") {
            closeFileViewerTab(pendingConfirm.path);
          } else if (pendingConfirm?.kind === "close-all") {
            closeAllViewerTabs();
          }
          setPendingConfirm(undefined);
        }}
        title="Unsaved changes"
        message={
          pendingConfirm?.kind === "close-tab"
            ? `Close “${pendingConfirm.name}”? Unsaved changes will be lost.`
            : `Close all ${viewerTabs.length} tabs? Unsaved changes in the active tab will be lost.`
        }
        primaryLabel="Discard & close"
        tone="danger"
      />
    </div>
  );
}
