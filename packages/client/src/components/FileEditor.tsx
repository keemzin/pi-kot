/**
 * FileEditor — shared file editing component used by FileViewerPanel and FileExplorer.
 * Handles editor toolbar, CodeMirror/RenderedView toggle, footer, and dirty state.
 */
import { memo, useState } from "react";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { RenderedView } from "./RenderedView";
import { ImageViewer } from "./ImageViewer";
import { isImagePath, isHtmlPath, isMarkdownPath, formatFileSize } from "../lib/file-types";

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
  /** Whether the file is binary (images, etc). */
  binary?: boolean;
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
  binary,
}: Props) {
  const [editorMode, setEditorMode] = useState<"raw" | "rendered">("raw");
  const [wordWrap, setWordWrap] = useState(true);

  const isImage = isImagePath(path);
  const isHtml = isHtmlPath(path);
  const isMarkdown = isMarkdownPath(path);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Toolbar */}
      {showToolbar && (
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
            title={path}
          >
            {path}
          </span>

          {/* Raw / Rendered toggle — hidden for images (no raw mode) */}
          {!isImage && (
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
          )}

          {/* Wrap toggle — only in raw mode for non-image files */}
          {!isImage && editorMode === "raw" && (
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
      )}

      {/* Editor body — conditional rendering based on file type */}
      {isImage ? (
        <ImageViewer content={content} filePath={path} binary={binary ?? false} />
      ) : isHtml && editorMode === "rendered" ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <iframe
            srcDoc={content}
            sandbox="allow-scripts"
            style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
            title={`Preview ${fileName}`}
          />
        </div>
      ) : editorMode === "raw" ? (
        <CodeMirrorEditor
          key={`editor-${path}`}
          value={content}
          onChange={onChange}
          onSave={onSave}
          fileName={fileName}
          wordWrap={wordWrap}
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
