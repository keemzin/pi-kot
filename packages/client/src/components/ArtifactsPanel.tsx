/**
 * ArtifactsPanel — shows two sections:
 * 1. Stream artifacts (from chat code blocks, filtered by active session)
 * 2. Saved artifacts (from .pi/artifacts/ files, filtered by current project)
 *
 * Upgrades:
 * - Direct in-app preview for saved artifacts (no forced pop-out)
 * - Quick search filter across stream and saved artifacts
 * - Loading indicator when reading saved files
 * - Mobile-friendly touch targets
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useLayoutStore } from "../stores/layout-store";
import { useSessionStore } from "../stores/session-store";
import { listArtifacts, type ArtifactFileInfo } from "../lib/api-client";
import { useI18n } from "../hooks/useI18n";
import { getFileTypeIcon } from "./FileIcon";
import { Search, X, RotateCw, ExternalLink, RefreshCw } from "lucide-react";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(iso: string, t: (key: string) => string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t("artifacts.justNow");
  if (diffMin < 60) return `${diffMin}${t("artifacts.mAgo")}`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}${t("artifacts.hAgo")}`;
  return `${Math.floor(diffHr / 24)}${t("artifacts.dAgo")}`;
}

export function ArtifactsPanel() {
  const { t } = useI18n();

  // ── Stream artifacts (from chat) ──
  const artifactItems = useLayoutStore((s) => s.artifactItems);
  const artifactActiveId = useLayoutStore((s) => s.artifactActiveId);
  const setArtifactActiveId = useLayoutStore((s) => s.setArtifactActiveId);
  const openArtifactViewer = useLayoutStore((s) => s.openArtifactViewer);
  const setExplorerTab = useLayoutStore((s) => s.setExplorerTab);
  const isMobile = useLayoutStore((s) => s.isMobile);
  const pushArtifact = useLayoutStore((s) => s.pushArtifact);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  // ── Saved artifacts (from .pi/artifacts/, filtered by project) ──
  const [savedFiles, setSavedFiles] = useState<ArtifactFileInfo[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [openingSavedName, setOpeningSavedName] = useState<string | null>(null);

  // ── Search filter ──
  const [searchQuery, setSearchQuery] = useState("");

  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const projects = useSessionStore((s) => s.projects);
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const projectPath = activeProject?.path;

  // Filter stream artifacts to current session only
  const sessionStreamArtifacts = useMemo(() => {
    return artifactItems.filter((a) => a.sessionId === activeSessionId);
  }, [artifactItems, activeSessionId]);

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

  useEffect(() => {
    fetchSaved();
  }, [fetchSaved]);

  const openFullView = (filename: string) => {
    const qs = projectPath ? `?cwd=${encodeURIComponent(projectPath)}` : "";
    const encoded = filename
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    window.open(`/api/v1/artifacts/${encoded}${qs}`, "_blank");
  };

  // Open saved artifact in-app inside ArtifactViewer
  const openSavedArtifact = async (file: ArtifactFileInfo) => {
    setOpeningSavedName(file.name);
    try {
      const qs = projectPath ? `?cwd=${encodeURIComponent(projectPath)}` : "";
      const encoded = file.name
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");
      const url = `/api/v1/artifacts/${encoded}${qs}`;

      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      let type: "html" | "svg" | "json" | "markdown" | "image" | "text" = "text";
      if (ext === "html" || ext === "htm") type = "html";
      else if (ext === "svg") type = "svg";
      else if (ext === "json") type = "json";
      else if (ext === "md" || ext === "markdown") type = "markdown";
      else if (["png", "jpg", "jpeg", "gif", "webp", "ico"].includes(ext)) type = "image";

      let content = "";
      if (type === "image") {
        content = url;
      } else {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        content = await res.text();
      }

      const id = `saved-${file.name}`;
      const baseName = file.name.split("/").pop() || file.name;

      pushArtifact({
        id,
        title: baseName,
        type,
        content,
        sessionId: activeSessionId || "saved",
      });

      setArtifactActiveId(id);
      openArtifactViewer(id, baseName, type);
      if (isMobile) setExplorerTab(undefined);
    } catch {
      // Fallback: open in new tab if fetch failed
      openFullView(file.name);
    } finally {
      setOpeningSavedName(null);
    }
  };

  // Filter lists by search query
  const q = searchQuery.toLowerCase().trim();
  const filteredStream = useMemo(() => {
    if (!q) return sessionStreamArtifacts;
    return sessionStreamArtifacts.filter(
      (a) => a.title.toLowerCase().includes(q) || a.type.toLowerCase().includes(q),
    );
  }, [sessionStreamArtifacts, q]);

  const filteredSaved = useMemo(() => {
    if (!q) return savedFiles;
    return savedFiles.filter(
      (f) => f.name.toLowerCase().includes(q) || f.type.toLowerCase().includes(q),
    );
  }, [savedFiles, q]);

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
      {/* ── Search Bar ── */}
      <div
        style={{
          padding: "8px 10px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-glass-strong, rgba(255,255,255,0.02))",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "var(--bg-subtle, rgba(255,255,255,0.05))",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm, 6px)",
            padding: "4px 8px",
          }}
        >
          <Search size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter artifacts..."
            style={{
              flex: 1,
              minWidth: 0,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: 12,
              color: "var(--text-primary)",
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-tertiary)",
                cursor: "pointer",
                padding: 0,
                display: "inline-flex",
                alignItems: "center",
              }}
              title="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* ── Stream Section Header ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 10px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-glass-strong)",
          flexShrink: 0,
          height: "34px",
          minHeight: "34px",
          boxSizing: "border-box",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>
          📡 {t("artifacts.stream")}
        </span>
        <span
          style={{
            fontSize: 10.5,
            color: "var(--text-tertiary)",
            background: "var(--bg-glass)",
            padding: "1px 6px",
            borderRadius: 10,
          }}
        >
          {filteredStream.length}
        </span>
      </div>

      {/* ── Stream List ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
        {filteredStream.length === 0 ? (
          <div
            style={{
              padding: "16px 12px",
              textAlign: "center",
              color: "var(--text-tertiary)",
              fontSize: 12,
            }}
          >
            {searchQuery ? "No matching stream artifacts" : t("artifacts.noStream")}
          </div>
        ) : (
          filteredStream.map((item) => {
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
                  transition: "background 0.12s ease",
                }}
                title={item.title}
              >
                <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center" }}>
                  {getFileTypeIcon(item.title || item.type, 14)}
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
                    fontSize: 9.5,
                    color: "var(--text-tertiary)",
                    flexShrink: 0,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    background: "var(--bg-glass)",
                    padding: "1px 5px",
                    borderRadius: 4,
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
          padding: "0 10px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-glass-strong)",
          flexShrink: 0,
          height: "34px",
          minHeight: "34px",
          boxSizing: "border-box",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>
          💾 {t("artifacts.saved")}
        </span>
        <button
          onClick={fetchSaved}
          disabled={savedLoading}
          style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
            background: "var(--bg-glass)",
            border: "none",
            padding: "2px 6px",
            borderRadius: 8,
            cursor: savedLoading ? "wait" : "pointer",
            opacity: savedLoading ? 0.5 : 1,
            display: "inline-flex",
            alignItems: "center",
          }}
          title={t("artifacts.refreshSaved")}
        >
          <RefreshCw size={11} className={savedLoading ? "spin" : ""} />
        </button>
        <span
          style={{
            fontSize: 10.5,
            color: "var(--text-tertiary)",
            background: "var(--bg-glass)",
            padding: "1px 6px",
            borderRadius: 10,
          }}
        >
          {filteredSaved.length}
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
        ) : filteredSaved.length === 0 ? (
          <div
            style={{
              padding: "16px 12px",
              textAlign: "center",
              color: "var(--text-tertiary)",
              fontSize: 12,
            }}
          >
            {searchQuery ? (
              "No matching saved artifacts"
            ) : (
              <>
                {t("artifacts.noSaved")}
                <br />
                <span style={{ fontSize: 11 }}>
                  {projectPath ? t("artifacts.agentCreated") : t("artifacts.selectProject")}
                </span>
              </>
            )}
          </div>
        ) : (
          filteredSaved.map((file) => {
            const lastSlash = file.name.lastIndexOf("/");
            const dirPart = lastSlash !== -1 ? file.name.slice(0, lastSlash + 1) : "";
            const basePart = lastSlash !== -1 ? file.name.slice(lastSlash + 1) : file.name;
            const isOpening = openingSavedName === file.name;
            const isTabActive = artifactActiveId === `saved-${file.name}`;

            return (
              <div
                key={file.name}
                onClick={() => openSavedArtifact(file)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "6px 12px",
                  borderBottom: "1px solid var(--border-subtle, transparent)",
                  cursor: isOpening ? "wait" : "pointer",
                  transition: "background 0.15s ease",
                  background: isTabActive ? "var(--accent-subtle)" : "transparent",
                  borderLeft: isTabActive ? "3px solid var(--accent-text)" : "3px solid transparent",
                }}
                onMouseEnter={(e) => {
                  if (!isTabActive) e.currentTarget.style.background = "var(--bg-glass-strong, rgba(255,255,255,0.05))";
                }}
                onMouseLeave={(e) => {
                  if (!isTabActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center" }}>
                  {isOpening ? <RotateCw size={14} className="spin" /> : getFileTypeIcon(file.name ?? file.type, 14)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: isTabActive ? "var(--accent-text)" : "var(--text-primary)",
                      fontWeight: isTabActive ? 600 : 400,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={file.name}
                  >
                    {dirPart && (
                      <span style={{ color: "var(--text-tertiary)", opacity: 0.8 }}>
                        {dirPart}
                      </span>
                    )}
                    <span>{basePart}</span>
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
                    <span>{formatTime(file.modified, t)}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openFullView(file.name);
                    }}
                    style={{
                      fontSize: 11,
                      color: "var(--text-tertiary)",
                      background: "transparent",
                      border: "none",
                      padding: "4px",
                      borderRadius: 4,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                    }}
                    title={t("artifacts.openNewTab")}
                  >
                    <ExternalLink size={12} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
