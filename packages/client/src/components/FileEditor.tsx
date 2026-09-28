/**
 * FileEditor — text-only file editing component with CodeMirror.
 * Handles editor toolbar, Raw/Rendered toggle, footer, and dirty state.
 * Binary files (images, audio, PDF) are handled by FileViewer instead.
 */
import { memo, useEffect, useMemo, useState } from "react";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { RenderedView } from "./RenderedView";
import { isHtmlPath, isMarkdownPath, isSvgPath, isRenderablePath, formatFileSize } from "../lib/file-types";

interface Props {
  path: string;
  fileName: string;
  content: string;
  language?: string;
  saving: boolean;
  dirty: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  savedAt?: Date;
  error?: string;
  showToolbar?: boolean;
  /** File size in bytes from the server response. */
  size?: number;
  /** Fired when the user sends the currently selected lines to the chat, with the 1-based inclusive range. */
  onSendSelection?: (range: { startLine: number; endLine: number }) => void;
}

export const FileEditor = memo(function FileEditor({
  path,
  fileName,
  content,
  language,
  saving,
  dirty,
  onChange,
  onSave,
  savedAt,
  error,
  showToolbar = true,
  size,
  onSendSelection,
}: Props) {
  const [editorMode, setEditorMode] = useState<"raw" | "rendered">("raw");
  const [wordWrap, setWordWrap] = useState(true);
  const [selection, setSelection] = useState<{ startLine: number; endLine: number } | null>(null);

  const isHtml = isHtmlPath(path);
  const isMarkdown = isMarkdownPath(path);
  const isSvg = isSvgPath(path);
  const isRenderable = isRenderablePath(path);

  // If the current file cannot be rendered, always fallback to raw code editor
  useEffect(() => {
    if (!isRenderable && editorMode === "rendered") {
      setEditorMode("raw");
    }
  }, [path, isRenderable, editorMode]);

  const { pathDir, pathBase } = useMemo(() => {
    const clean = path.replace(/\\/g, "/");
    const lastSlash = clean.lastIndexOf("/");
    if (lastSlash === -1) {
      return { pathDir: "", pathBase: clean };
    }
    return {
      pathDir: clean.slice(0, lastSlash),
      pathBase: clean.slice(lastSlash + 1),
    };
  }, [path]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Toolbar */}
      {showToolbar && (
        <div
          className="file-editor-toolbar"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            padding: "4px 10px",
            fontSize: "11px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-glass, rgba(0,0,0,0.02))",
            flexShrink: 0,
            minHeight: "34px",
          }}
        >
          {/* Left section: Path & seamless Raw/Rendered segmented toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1 }}>
            {/* Directory Breadcrumb (only when file is in a subfolder, since the tab already displays the filename) */}
            {pathDir ? (
              <>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    minWidth: 0,
                    color: "var(--text-dim)",
                    fontSize: "11px",
                  }}
                  title={path}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: 0.7 }}>
                    {pathDir} /
                  </span>
                </div>
                {isRenderable && (
                  <span style={{ width: "1px", height: "14px", background: "var(--border)", flexShrink: 0, margin: "0 2px" }} />
                )}
              </>
            ) : null}

            {/* Redesigned Raw / Rendered Toggle on the left (only for markdown/html/svg) */}
            {isRenderable && (
              <div
                className="file-editor-mode-toggle"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  background: "var(--bg-glass-hover, rgba(255, 255, 255, 0.06))",
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  padding: "2px",
                  gap: "2px",
                  flexShrink: 0,
                }}
              >
                <button
                  onClick={() => setEditorMode("raw")}
                  type="button"
                  className={`file-mode-btn${editorMode === "raw" ? " active" : ""}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    background: editorMode === "raw" ? "var(--bg-solid, #232730)" : "transparent",
                    color: editorMode === "raw" ? "var(--text-primary)" : "var(--text-dim)",
                    border: "none",
                    borderRadius: "4px",
                    padding: "2px 8px",
                    fontSize: "11px",
                    fontWeight: editorMode === "raw" ? 600 : 500,
                    cursor: "pointer",
                    boxShadow: editorMode === "raw" ? "0 1px 3px rgba(0,0,0,0.2)" : "none",
                    transition: "all 0.15s ease",
                  }}
                  title="View / edit raw code"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                  <span>Raw</span>
                </button>
                <button
                  onClick={() => setEditorMode("rendered")}
                  type="button"
                  className={`file-mode-btn${editorMode === "rendered" ? " active" : ""}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    background: editorMode === "rendered" ? "var(--bg-solid, #232730)" : "transparent",
                    color: editorMode === "rendered" ? "var(--text-primary)" : "var(--text-dim)",
                    border: "none",
                    borderRadius: "4px",
                    padding: "2px 8px",
                    fontSize: "11px",
                    fontWeight: editorMode === "rendered" ? 600 : 500,
                    cursor: "pointer",
                    boxShadow: editorMode === "rendered" ? "0 1px 3px rgba(0,0,0,0.2)" : "none",
                    transition: "all 0.15s ease",
                  }}
                  title="View rendered preview"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span>Rendered</span>
                </button>
              </div>
            )}
          </div>

          {/* Right section: Word wrap & Send selection to chat */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
            {/* Word wrap toggle — only in raw mode */}
            {editorMode === "raw" && (
              <button
                onClick={() => setWordWrap((w) => !w)}
                type="button"
                className={`file-editor-btn${wordWrap ? " active" : ""}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "2px 8px",
                  fontSize: "11px",
                  fontWeight: 500,
                  borderRadius: "5px",
                  border: "1px solid",
                  background: wordWrap ? "var(--accent-subtle, rgba(99,102,241,0.12))" : "transparent",
                  color: wordWrap ? "var(--accent-text, #818cf8)" : "var(--text-dim)",
                  borderColor: wordWrap ? "var(--accent-subtle-border, rgba(99,102,241,0.25))" : "var(--border)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
                title={wordWrap ? "Word wrap enabled (click to disable)" : "Word wrap disabled (click to enable)"}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 10 4 15 9 20" />
                  <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                </svg>
                <span>Wrap</span>
              </button>
            )}

            {/* Send selected lines to chat — enabled when a range is selected */}
            {editorMode === "raw" && onSendSelection !== undefined && (
              <button
                onClick={() => {
                  if (selection !== null) onSendSelection(selection);
                }}
                disabled={selection === null || saving}
                type="button"
                className={`file-editor-btn send-selection${selection !== null ? " active" : ""}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "2px 10px",
                  fontSize: "11px",
                  fontWeight: 500,
                  borderRadius: "5px",
                  border: selection !== null ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: selection !== null ? "var(--accent-bg, rgba(99,102,241,0.15))" : "transparent",
                  color: selection !== null ? "var(--accent-text, #a5b4fc)" : "var(--text-dim)",
                  cursor: selection === null ? "default" : "pointer",
                  opacity: selection === null ? 0.6 : 1,
                  transition: "all 0.15s ease",
                }}
                title={
                  selection === null
                    ? "Select lines in editor to send to chat"
                    : `Send lines ${selection.startLine}–${selection.endLine} to chat`
                }
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  <polyline points="10 9 14 12 10 15" />
                </svg>
                <span>
                  {selection !== null
                    ? `Send L${selection.startLine}–${selection.endLine} ⇢ chat`
                    : "Send selection ⇢ chat"}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Editor body — text editing only (binary files handled by FileViewer) */}
      {(isHtml || isSvg) && editorMode === "rendered" ? (
        <div style={{ flex: 1, minHeight: 0, background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto" }}>
          {isSvg ? (
            <div
              style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
              dangerouslySetInnerHTML={{ __html: content }}
            />
          ) : (
            <iframe
              srcDoc={content}
              sandbox="allow-scripts"
              style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
              title={`Preview ${fileName}`}
            />
          )}
        </div>
      ) : editorMode === "raw" ? (
        <CodeMirrorEditor
          key={`editor-${path}`}
          value={content}
          onChange={onChange}
          onSave={onSave}
          fileName={fileName}
          wordWrap={wordWrap}
          onSelectionChange={setSelection}
        />
      ) : (
        <RenderedView content={content} fileName={fileName} />
      )}

      {/* Status footer */}
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
        {/* Left: language label + file size */}
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
          {typeof size === "number" && size > 0 && (
            <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>
              {formatFileSize(size)}
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
            if (dirty) {
              return <span style={{ color: "var(--accent-text, #d19a66)" }}>Unsaved changes</span>;
            }
            if (savedAt) {
              return <span style={{ color: "#98c379" }}>Saved {savedAt.toLocaleTimeString()}</span>;
            }
            return <span>Up to date</span>;
          })()}

          <button
            onClick={onSave}
            disabled={!dirty || saving}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "3px",
              padding: "2px 8px",
              fontSize: "10px",
              fontWeight: 600,
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              background: dirty ? "var(--accent-bg)" : "transparent",
              color: dirty ? "var(--accent-text)" : "var(--text-dim)",
              cursor: dirty && !saving ? "pointer" : "default",
              opacity: dirty ? 1 : 0.5,
            }}
            type="button"
          >
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        </div>
      </div>
    </div>
  );
});
