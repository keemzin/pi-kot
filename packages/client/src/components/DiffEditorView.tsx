import { useState } from "react";
import {
  Check,
  Columns2,
  Copy,
  ExternalLink,
  FileCode2,
  FileDiff,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Rows2,
} from "lucide-react";
import { getStoredToken } from "../lib/api-client";
import { useLayoutStore, type ViewerTab } from "../stores/layout-store";
import { DiffBlock } from "./DiffBlock";

async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = getStoredToken();
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (token !== undefined) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return fetch(input, { ...init, headers });
}

function splitPath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return { dir: "", name: normalized };
  }
  return {
    dir: normalized.slice(0, lastSlash + 1),
    name: normalized.slice(lastSlash + 1),
  };
}

function parseStatsFromDiff(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

export function DiffEditorView({
  tab,
  projectId,
  onOpenFile,
}: {
  tab: ViewerTab;
  projectId: string;
  onOpenFile: (path: string, name: string) => void;
}) {
  const [viewType, setViewType] = useState<"unified" | "split">("unified");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const bumpFileTick = useLayoutStore((s) => s.bumpFileTick);
  const openDiffViewer = useLayoutStore((s) => s.openDiffViewer);
  const closeFileViewerTab = useLayoutStore((s) => s.closeFileViewerTab);

  const rawPath = tab.originalPath ?? tab.name;
  const { dir, name } = splitPath(rawPath);
  const stats = tab.diff ? parseStatsFromDiff(tab.diff) : { additions: 0, deletions: 0 };

  const handleCopy = () => {
    navigator.clipboard?.writeText(rawPath).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const handleStageToggle = async () => {
    if (busy || tab.commitHash) return;
    setBusy(true);
    try {
      const endpoint = tab.staged ? "/api/v1/git/unstage" : "/api/v1/git/stage";
      const res = await authFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, paths: [rawPath] }),
      });
      if (res.ok) {
        bumpFileTick();
        // Close the old diff tab and switch to the toggled state if applicable
        closeFileViewerTab(tab.path);
        // Fetch toggled diff
        const nextStaged = !tab.staged;
        const qs = new URLSearchParams({ projectId, path: rawPath });
        if (nextStaged) qs.set("staged", "1");
        const diffRes = await authFetch(`/api/v1/git/diff/file?${qs}`);
        if (diffRes.ok) {
          const diffData = (await diffRes.json()) as { diff: string };
          if (diffData.diff) {
            openDiffViewer({
              path: rawPath,
              name: tab.name,
              diff: diffData.diff,
              staged: nextStaged,
              originalPath: rawPath,
              diffTitle: `${tab.name} (${nextStaged ? "Staged" : "Working Tree"})`,
            });
          }
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRevert = async () => {
    if (!confirmRevert) {
      setConfirmRevert(true);
      setTimeout(() => setConfirmRevert(false), 3000);
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/v1/git/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, paths: [rawPath] }),
      });
      if (res.ok) {
        bumpFileTick();
        closeFileViewerTab(tab.path);
      }
    } finally {
      setBusy(false);
      setConfirmRevert(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", overflow: "hidden", background: "var(--bg-solid)" }}>
      {/* ── Top Diff Toolbar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-subtle)",
          gap: "8px",
          flexShrink: 0,
        }}
      >
        {/* Left: icon, breadcrumbs, badges, stats */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, overflow: "hidden" }}>
          <FileDiff size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <div style={{ display: "flex", alignItems: "baseline", gap: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {dir && <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono, monospace)", fontSize: "11px" }}>{dir}</span>}
            <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono, monospace)", fontWeight: 600, fontSize: "12px" }}>{name}</span>
          </div>

          {/* Badges */}
          {tab.commitHash ? (
            <span
              style={{
                borderRadius: "4px",
                background: "rgba(168, 85, 247, 0.15)",
                border: "1px solid rgba(168, 85, 247, 0.3)",
                color: "#c084fc",
                padding: "1px 6px",
                fontSize: "10px",
                fontFamily: "monospace",
                flexShrink: 0,
              }}
            >
              commit {tab.commitHash.slice(0, 7)}
            </span>
          ) : tab.staged ? (
            <span
              style={{
                borderRadius: "4px",
                background: "rgba(34, 197, 94, 0.15)",
                border: "1px solid rgba(34, 197, 94, 0.3)",
                color: "var(--success, #22c55e)",
                padding: "1px 6px",
                fontSize: "10px",
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                flexShrink: 0,
              }}
            >
              staged
            </span>
          ) : (
            <span
              style={{
                borderRadius: "4px",
                background: "rgba(245, 158, 11, 0.15)",
                border: "1px solid rgba(245, 158, 11, 0.3)",
                color: "#f59e0b",
                padding: "1px 6px",
                fontSize: "10px",
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                flexShrink: 0,
              }}
            >
              working tree
            </span>
          )}

          {/* Stats pill */}
          {(stats.additions > 0 || stats.deletions > 0) && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "11px",
                fontVariantNumeric: "tabular-nums",
                flexShrink: 0,
              }}
            >
              {stats.additions > 0 && (
                <span style={{ color: "var(--success, #22c55e)", fontWeight: 600 }}>+{stats.additions}</span>
              )}
              {stats.deletions > 0 && (
                <span style={{ color: "var(--error, #ef4444)", fontWeight: 600 }}>−{stats.deletions}</span>
              )}
            </div>
          )}
        </div>

        {/* Right: Actions and Unified/Split switcher */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
          {/* Copy path */}
          <button
            type="button"
            onClick={handleCopy}
            className="diff-toolbar-btn diff-toolbar-btn-icon-only"
            title={copied ? "Copied path!" : "Copy path"}
            aria-label="Copy path"
          >
            {copied ? <Check size={12} style={{ color: "var(--success, #22c55e)" }} /> : <Copy size={12} />}
          </button>

          {/* Open working file in editor */}
          <button
            type="button"
            onClick={() => onOpenFile(rawPath, name)}
            className="diff-toolbar-btn"
            title="Open working file in editor"
            aria-label="Open working file in editor"
          >
            <FileCode2 size={12} />
            <span>Open File</span>
          </button>

          {/* Stage / Unstage button */}
          {!tab.commitHash && (
            <button
              type="button"
              onClick={handleStageToggle}
              disabled={busy}
              className={`diff-toolbar-btn ${tab.staged ? "diff-toolbar-btn-unstage" : "diff-toolbar-btn-stage"}`}
              title={tab.staged ? "Unstage this file" : "Stage this file"}
            >
              {tab.staged ? <Minus size={12} /> : <Plus size={12} />}
              <span>{tab.staged ? "Unstage" : "Stage"}</span>
            </button>
          )}

          {/* Revert / Discard changes button (working tree only) */}
          {!tab.commitHash && !tab.staged && (
            <button
              type="button"
              onClick={handleRevert}
              disabled={busy}
              className={`diff-toolbar-btn diff-toolbar-btn-discard ${confirmRevert ? "confirm" : ""}`}
              title={confirmRevert ? "Click again to confirm discarding changes" : "Discard changes"}
            >
              <RotateCcw size={11} />
              <span>{confirmRevert ? "Confirm Discard?" : "Discard"}</span>
            </button>
          )}

          {/* Segmented Unified / Split Switcher */}
          <div
            className="turn-diff-view-segmented"
            role="group"
            aria-label="Diff layout mode"
            style={{ marginLeft: "4px" }}
          >
            <button
              type="button"
              className={`turn-diff-view-btn ${viewType === "unified" ? "active" : ""}`}
              onClick={() => setViewType("unified")}
              title="Unified line-by-line view"
            >
              <Rows2 size={11} />
              <span>Unified</span>
            </button>
            <button
              type="button"
              className={`turn-diff-view-btn ${viewType === "split" ? "active" : ""}`}
              onClick={() => setViewType("split")}
              title="Side-by-side split view"
            >
              <Columns2 size={11} />
              <span>Split</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Main Diff Viewport ── */}
      <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
        {tab.diff ? (
          <DiffBlock diff={tab.diff} viewType={viewType} />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-dim)", fontSize: "12px", fontStyle: "italic" }}>
            No diff changes found for this file.
          </div>
        )}
      </div>
    </div>
  );
}
