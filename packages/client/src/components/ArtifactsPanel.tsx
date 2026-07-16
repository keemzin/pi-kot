/**
 * ArtifactsPanel — shows two sections:
 * 1. Stream artifacts (from chat code blocks, filtered by active session)
 * 2. Saved artifacts (from .pi/artifacts/ files, filtered by current project)
 */
import { useState, useEffect, useCallback } from "react";
import { useLayoutStore } from "../stores/layout-store";
import { useSessionStore } from "../stores/session-store";
import { listArtifacts, type ArtifactFileInfo } from "../lib/api-client";

const ARTIFACT_ICONS: Record<string, string> = {
  html: "◈", svg: "◇", markdown: "📝", json: "{}", text: "¶", image: "🖼",
  css: "#", js: "⚡", ts: "TS", unknown: "📄",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function ArtifactsPanel() {
  // ── Stream artifacts (from chat) ──
  const artifactItems       = useLayoutStore((s) => s.artifactItems);
  const artifactActiveId    = useLayoutStore((s) => s.artifactActiveId);
  const setArtifactActiveId = useLayoutStore((s) => s.setArtifactActiveId);
  const openArtifactViewer  = useLayoutStore((s) => s.openArtifactViewer);
  const setExplorerTab      = useLayoutStore((s) => s.setExplorerTab);
  const isMobile            = useLayoutStore((s) => s.isMobile);
  const activeSessionId     = useSessionStore((s) => s.activeSessionId);

  // Filter stream artifacts to current session only
  const sessionStreamArtifacts = artifactItems.filter(
    (a) => a.sessionId === activeSessionId,
  );

  // ── Saved artifacts (from .pi/artifacts/, filtered by project) ──
  const [savedFiles, setSavedFiles] = useState<ArtifactFileInfo[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);

  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const projects        = useSessionStore((s) => s.projects);
  const activeProject   = projects.find((p) => p.id === activeProjectId);
  const projectPath     = activeProject?.path;

  const fetchSaved = useCallback(async () => {
    setSavedLoading(true);
    setSavedError(null);
    try {
      const res = await listArtifacts(projectPath);
      setSavedFiles(res.files);
    } catch (err) {
      setSavedError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setSavedLoading(false);
    }
  }, [projectPath]);

  useEffect(() => { fetchSaved(); }, [fetchSaved]);

  const openFullView = (filename: string) => {
    const qs = projectPath ? `?cwd=${encodeURIComponent(projectPath)}` : "";
    window.open(`/api/v1/artifacts/${encodeURIComponent(filename)}${qs}`, "_blank");
  };

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
      {/* ── Stream Section Header ── */}
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
          📡 Stream
        </span>
        <span
          style={{ fontSize: 11, color: "var(--text-tertiary)", background: "var(--bg-glass)", padding: "1px 6px", borderRadius: 10 }}
        >
          {sessionStreamArtifacts.length}
        </span>
      </div>

      {/* ── Stream List ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
        {sessionStreamArtifacts.length === 0 ? (
          <div
            style={{
              padding: "16px 12px",
              textAlign: "center",
              color: "var(--text-tertiary)",
              fontSize: 12,
            }}
          >
            No stream artifacts for this session.
          </div>
        ) : (
          sessionStreamArtifacts.map((item) => {
            const isActive = item.id === artifactActiveId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setArtifactActiveId(item.id);
                  openArtifactViewer(item.id, item.title, item.type);
                  if (isMobile) setExplorerTab(undefined);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  width: "100%",
                  padding: "6px 12px",
                  border: "none",
                  background: isActive ? "var(--accent-subtle)" : "transparent",
                  color: isActive ? "var(--accent-text)" : "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: 12,
                  textAlign: "left",
                  borderRadius: 0,
                  borderLeft: isActive ? "3px solid var(--accent-text)" : "3px solid transparent",
                }}
                title={item.title}
              >
                <span style={{ flexShrink: 0, fontSize: 14, lineHeight: 1 }}>
                  {ARTIFACT_ICONS[item.type] ?? "◈"}
                </span>
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.title}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--text-tertiary)",
                    flexShrink: 0,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  {item.type}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* ── Saved Section Header ── */}
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
          💾 Saved
        </span>
        <button
          onClick={fetchSaved}
          disabled={savedLoading}
          style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
            background: "var(--bg-glass)",
            border: "none",
            padding: "2px 8px",
            borderRadius: 10,
            cursor: savedLoading ? "wait" : "pointer",
            opacity: savedLoading ? 0.5 : 1,
          }}
          title="Refresh saved artifacts"
        >
          {savedLoading ? "⏳" : "🔄"}
        </button>
        <span
          style={{ fontSize: 11, color: "var(--text-tertiary)", background: "var(--bg-glass)", padding: "1px 6px", borderRadius: 10 }}
        >
          {savedFiles.length}
        </span>
      </div>

      {/* ── Saved List ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {savedError ? (
          <div
            style={{
              padding: "16px 12px",
              textAlign: "center",
              color: "var(--error-text, #ff4444)",
              fontSize: 12,
            }}
          >
            {savedError}
          </div>
        ) : savedFiles.length === 0 ? (
          <div
            style={{
              padding: "16px 12px",
              textAlign: "center",
              color: "var(--text-tertiary)",
              fontSize: 12,
            }}
          >
            No saved artifacts.
            <br />
            <span style={{ fontSize: 11 }}>
              {projectPath
                ? `Agent-created files in .pi/artifacts/`
                : "Select a project to see saved artifacts"}
            </span>
          </div>
        ) : (
          savedFiles.map((file) => (
            <div
              key={file.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 12px",
                borderBottom: "1px solid var(--border-subtle, transparent)",
              }}
            >
              <span style={{ flexShrink: 0, fontSize: 14, lineHeight: 1 }}>
                {ARTIFACT_ICONS[file.type] ?? "📄"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={file.name}
                >
                  {file.name}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text-tertiary)",
                    display: "flex",
                    gap: 8,
                  }}
                >
                  <span>{formatSize(file.size)}</span>
                  <span>{formatTime(file.modified)}</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                <button
                  onClick={() => openFullView(file.name)}
                  style={{
                    fontSize: 11,
                    color: "var(--accent-text)",
                    background: "var(--accent-subtle)",
                    border: "none",
                    padding: "2px 6px",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                  title="Open in new tab (full browser experience)"
                >
                  ↗
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
