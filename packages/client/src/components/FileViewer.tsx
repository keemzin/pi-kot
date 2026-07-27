/**
 * FileViewer — unified read-only file viewer, ported from pi-web's FileViewer.
 * Handles images, audio, PDF/DOCX, text (syntax highlighted), HTML preview,
 * markdown preview, and diff view. All sub-viewers are inline.
 *
 * Binary files stream directly from /files/read (no blob URLs).
 * Text files are fetched as JSON and rendered with react-syntax-highlighter.
 * SSE watch provides live reload when files change on disk.
 */
"use client";

import { useEffect, useState, useRef, useCallback, useMemo, type MouseEvent } from "react";
import { Highlight, themes as prismThemes } from "prism-react-renderer";
import { getStoredToken } from "../lib/api-client";
import {
  DOCX_PREVIEW_MAX_BYTES,
  documentPreviewKind,
  formatFileSize,
  getFileExt,
  isAudioPath,
  isDocumentPath,
  isImagePath,
} from "../lib/file-types";

interface Props {
  /** Project ID for API calls */
  projectId: string;
  /** Absolute file path */
  filePath: string;
  /** Watch URL for SSE live reload */
  watchUrl?: string;
  /** Previous content for diff view (set when file has unsaved changes) */
  previousContent?: string;
  /** Whether the file is dirty (for diff toggle) */
  isDirty?: boolean;
  /** Optional callback when a markdown link is clicked */
  onOpenFile?: (filePath: string) => void;
  /** Whether to force dark theme */
  isDark?: boolean;
}

// ── Helpers ──

function getFileName(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
}

function getRelativePath(filePath: string, projectId?: string): string {
  // Just show the filename for now — could be enhanced with cwd
  return getFileName(filePath);
}

function getReadUrl(projectId: string, filePath: string, bust?: number): string {
  const qs = new URLSearchParams({ projectId, path: filePath });
  if (bust !== undefined && bust > 0) qs.set("v", String(bust));
  return `/api/v1/files/read?${qs.toString()}`;
}

function getDownloadUrl(projectId: string, filePath: string): string {
  const qs = new URLSearchParams({ projectId, path: filePath });
  return `/api/v1/files/download?${qs.toString()}`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const totalSeconds = Math.round(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

// ── Download Link ──

function DownloadLink({ projectId, filePath }: { projectId: string; filePath: string }) {
  return (
    <a
      href={getDownloadUrl(projectId, filePath)}
      download={getFileName(filePath)}
      title="Download file"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 20,
        padding: "0 5px",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        color: "var(--text-muted)",
        cursor: "pointer",
        flexShrink: 0,
        textDecoration: "none",
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </a>
  );
}

// ── Live Watch Indicator ──

function WatchIndicator({ watching }: { watching: boolean }) {
  return (
    <span
      title={watching ? "Live sync active" : "Not watching"}
      style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)" }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: watching ? "#4ade80" : "var(--border)",
          display: "inline-block",
          boxShadow: watching ? "0 0 4px #4ade80" : "none",
        }}
      />
      {watching ? "live" : "static"}
    </span>
  );
}

// ── Status Bar (shared across all viewer types) ──

function StatusBar({
  filePath,
  projectId,
  children,
  watching,
}: {
  filePath: string;
  projectId: string;
  children?: React.ReactNode;
  watching: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "4px 16px",
        borderBottom: "1px solid var(--border)",
        fontSize: 11,
        color: "var(--text-dim)",
        background: "var(--bg)",
        flexShrink: 0,
      }}
    >
      <span
        style={{ fontFamily: "var(--font-mono, monospace)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        title={filePath}
      >
        {getRelativePath(filePath, projectId)}
      </span>
      <span style={{ marginLeft: "auto" }}>{children}</span>
      <WatchIndicator watching={watching} />
      <DownloadLink projectId={projectId} filePath={filePath} />
    </div>
  );
}

// ── ImageViewer ──

function ImageViewer({ projectId, filePath }: { projectId: string; filePath: string }) {
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const ext = getFileExt(filePath) || "image";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setNaturalSize(null);
    setError(null);
    setWatching(false);
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
  }, [filePath]);

  // SSE watch
  useEffect(() => {
    const watchUrl = `/api/v1/files/watch?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(filePath)}`;
    const es = new EventSource(watchUrl);
    esRef.current = es;
    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setBust((b) => b + 1);
    });
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);
    return () => { es.close(); esRef.current = null; };
  }, [projectId, filePath]);

  const src = getReadUrl(projectId, filePath, bust);
  const formatSizeStr = size != null ? formatFileSize(size) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <StatusBar filePath={filePath} projectId={projectId} watching={watching}>
        <span>{ext || "image"}</span>
        {naturalSize && <span>{naturalSize.w} × {naturalSize.h}</span>}
        {formatSizeStr && <span>{formatSizeStr}</span>}
      </StatusBar>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          background: "var(--bg-panel)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          backgroundImage:
            "linear-gradient(45deg, var(--bg) 25%, transparent 25%), linear-gradient(-45deg, var(--bg) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--bg) 75%), linear-gradient(-45deg, transparent 75%, var(--bg) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
        }}
      >
        {error ? (
          <div style={{ color: "#f87171", fontSize: 13 }}>{error}</div>
        ) : (
          <img
            src={src}
            alt={filePath}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => setError("Failed to load image")}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── AudioViewer ──

function AudioViewer({ projectId, filePath }: { projectId: string; filePath: string }) {
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const ext = getFileExt(filePath) || "audio";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setDuration(null);
    setError(null);
    setWatching(false);
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
  }, [filePath]);

  // SSE watch
  useEffect(() => {
    const watchUrl = `/api/v1/files/watch?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(filePath)}`;
    const es = new EventSource(watchUrl);
    esRef.current = es;
    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setDuration(null);
      setError(null);
      setBust((b) => b + 1);
    });
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);
    return () => { es.close(); esRef.current = null; };
  }, [projectId, filePath]);

  const src = getReadUrl(projectId, filePath, bust);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <StatusBar filePath={filePath} projectId={projectId} watching={watching}>
        <span>{ext || "audio"}</span>
        {duration != null && <span>{formatDuration(duration)}</span>}
        {size != null && <span>{formatFileSize(size)}</span>}
      </StatusBar>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "var(--bg-panel)",
        }}
      >
        <div style={{ width: "min(680px, 100%)" }}>
          {error && (
            <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12, textAlign: "center" }}>
              {error}
            </div>
          )}
          <audio
            key={src}
            controls
            preload="metadata"
            src={src}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onError={() => setError("Failed to load audio")}
            style={{ width: "100%" }}
          />
        </div>
      </div>
    </div>
  );
}

// ── DocumentViewer (PDF / DOCX) ──

function DocumentViewer({ projectId, filePath }: { projectId: string; filePath: string }) {
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const ext = getFileExt(filePath);
  const isPdf = ext === "pdf";
  const previewUrl = getReadUrl(projectId, filePath, bust);

  useEffect(() => {
    setBust(0);
    setSize(null);
    setError(null);
    setWatching(false);
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
  }, [filePath]);

  // Fetch metadata + SSE watch
  useEffect(() => {
    // Fetch size
    fetch(getReadUrl(projectId, filePath), { method: "HEAD" })
      .then((r) => {
        const contentLength = r.headers.get("content-length");
        if (contentLength) {
          const s = Number(contentLength);
          setSize(s);
          if (!isPdf && s > DOCX_PREVIEW_MAX_BYTES) {
            setError("DOCX too large for preview (>10MB)");
          }
        }
      })
      .catch(() => {});

    const watchUrl = `/api/v1/files/watch?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(filePath)}`;
    const es = new EventSource(watchUrl);
    esRef.current = es;
    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") {
          setSize(d.size);
          if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
            setError("DOCX too large for preview (>10MB)");
            return;
          }
        }
      } catch { /* ignore */ }
      setError(null);
      setBust((b) => b + 1);
    });
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);
    return () => { es.close(); esRef.current = null; };
  }, [projectId, filePath, isPdf]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <StatusBar filePath={filePath} projectId={projectId} watching={watching}>
        <span>{ext === "docx" ? "docx preview" : "pdf"}</span>
        {size != null && <span>{formatFileSize(size)}</span>}
      </StatusBar>
      <div style={{ flex: 1, minHeight: 0, background: "var(--bg-panel)" }}>
        {error ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, color: "#f87171", fontSize: 13, textAlign: "center" }}>
            {error}
          </div>
        ) : (
          <iframe
            key={previewUrl}
            src={previewUrl}
            sandbox={isPdf ? undefined : ""}
            title={`Preview ${getFileName(filePath)}`}
            style={{ width: "100%", height: "100%", border: "none", background: isPdf ? "var(--bg)" : "#eef1f5" }}
          />
        )}
      </div>
    </div>
  );
}

// ── DiffView (inline, ported from pi-web) ──

type DiffLine =
  | { type: "unchanged"; text: string; lineNo: number }
  | { type: "removed"; text: string; lineNo: number }
  | { type: "added"; text: string; lineNo: number };

function diffLines(oldLines: string[], newLines: string[]): DiffLine[] {
  const m = oldLines.length;
  const n = newLines.length;
  const max = m + n;
  const v: number[] = new Array(2 * max + 1).fill(0);
  const trace: number[][] = [];

  for (let d = 0; d <= max; d++) {
    trace.push([...v]);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max])) {
        x = v[k + 1 + max];
      } else {
        x = v[k - 1 + max] + 1;
      }
      let y = x - k;
      while (x < m && y < n && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }
      v[k + max] = x;
      if (x >= m && y >= n) {
        // Backtrack
        const result: DiffLine[] = [];
        let cx = m, cy = n;
        for (let dd = d; dd > 0; dd--) {
          const pv = trace[dd - 1];
          const pk = cx - cy;
          const prevK = pk === -dd || (pk !== dd && pv[pk - 1 + max] < pv[pk + 1 + max]) ? pk + 1 : pk - 1;
          const prevX = pv[prevK + max];
          const prevY = prevX - prevK;
          while (cx > prevX && cy > prevY) {
            cx--;
            cy--;
            result.unshift({ type: "unchanged", text: oldLines[cx], lineNo: cx + 1 });
          }
          if (dd > 0) {
            if (cx > prevX) {
              cx--;
              result.unshift({ type: "removed", text: oldLines[cx], lineNo: cx + 1 });
            } else {
              cy--;
              result.unshift({ type: "added", text: newLines[cy], lineNo: cy + 1 });
            }
          }
        }
        while (cx > 0 && cy > 0) {
          cx--;
          cy--;
          result.unshift({ type: "unchanged", text: oldLines[cx], lineNo: cx + 1 });
        }
        return result;
      }
    }
  }
  // Fallback
  return [
    ...oldLines.map((t, i) => ({ type: "removed" as const, text: t, lineNo: i + 1 })),
    ...newLines.map((t, i) => ({ type: "added" as const, text: t, lineNo: i + 1 })),
  ];
}

function DiffView({ oldContent, newContent }: { oldContent: string; newContent: string }) {
  const diff = useMemo(() => diffLines(oldContent.split("\n"), newContent.split("\n")), [oldContent, newContent]);
  const hasChanges = diff.some((l) => l.type !== "unchanged");
  if (!hasChanges) {
    return (
      <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--font-mono, monospace)" }}>
        No changes
      </div>
    );
  }

  const CONTEXT = 3;
  const changed = new Set(diff.flatMap((l, i) => (l.type !== "unchanged" ? [i] : [])));
  const visible = new Set<number>();
  for (const ci of changed) {
    for (let j = Math.max(0, ci - CONTEXT); j <= Math.min(diff.length - 1, ci + CONTEXT); j++) {
      visible.add(j);
    }
  }

  const segments: Array<{ hidden: true; count: number } | { hidden: false; lines: DiffLine[] }> = [];
  let i = 0;
  while (i < diff.length) {
    if (visible.has(i)) {
      const block: DiffLine[] = [];
      while (i < diff.length && visible.has(i)) {
        block.push(diff[i]);
        i++;
      }
      segments.push({ hidden: false, lines: block });
    } else {
      let count = 0;
      while (i < diff.length && !visible.has(i)) { count++; i++; }
      segments.push({ hidden: true, count });
    }
  }

  // Track running line number for added/unchanged lines
  const newLineNos: number[] = [];
  let nlo = 1;
  for (const line of diff) {
    if (line.type === "removed") newLineNos.push(0);
    else newLineNos.push(nlo++);
  }

  let diffIdx = 0;

  return (
    <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13, lineHeight: 1.6 }}>
      {segments.map((seg, si) => {
        if (seg.hidden) {
          const result = (
            <div
              key={si}
              style={{
                padding: "2px 16px",
                color: "var(--text-dim)",
                background: "var(--bg-panel)",
                fontSize: 11,
                borderTop: "1px solid var(--border)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              ... {seg.count} unchanged lines ...
            </div>
          );
          diffIdx += seg.count;
          return result;
        }
        const lines = seg.lines.map((line, li) => {
          const idx = diffIdx + li;
          const newLno = newLineNos[idx];
          const bg = line.type === "added" ? "rgba(0,200,80,0.12)" : line.type === "removed" ? "rgba(240,60,60,0.14)" : "transparent";
          const prefix = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
          const prefixColor = line.type === "added" ? "#4ade80" : line.type === "removed" ? "#f87171" : "var(--text-dim)";

          return (
            <div
              key={li}
              style={{
                display: "flex",
                background: bg,
                borderLeft: line.type === "added" ? "3px solid #4ade80" : line.type === "removed" ? "3px solid #f87171" : "3px solid transparent",
              }}
            >
              <span
                style={{
                  minWidth: 44,
                  padding: "0 8px 0 16px",
                  textAlign: "right",
                  color: "var(--text-dim)",
                  userSelect: "none",
                  fontSize: 11,
                  lineHeight: 1.6,
                  borderRight: "1px solid var(--border)",
                  background: "var(--bg-panel)",
                  flexShrink: 0,
                }}
              >
                {line.type === "removed" ? line.lineNo : newLno || ""}
              </span>
              <span style={{ minWidth: 16, padding: "0 6px", color: prefixColor, userSelect: "none", flexShrink: 0, fontWeight: 600 }}>
                {prefix}
              </span>
              <span style={{ flex: 1, padding: "0 8px 0 0", whiteSpace: "pre", color: "var(--text)", overflowX: "auto" }}>
                {line.text || "\u00a0"}
              </span>
            </div>
          );
        });
        diffIdx += seg.lines.length;
        return <div key={si}>{lines}</div>;
      })}
    </div>
  );
}

// ── TextFileViewer ──

interface TextFileData {
  content: string;
  language: string;
  size: number;
}

function TextFileViewer({
  projectId,
  filePath,
  isDark,
  previousContent,
}: {
  projectId: string;
  filePath: string;
  isDark?: boolean;
  previousContent?: string;
}) {
  const [data, setData] = useState<TextFileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [viewMode, setViewMode] = useState<"source" | "diff">("source");
  const [wrapLines, setWrapLines] = useState(false);
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  const isHtml = data?.language === "html";
  const isMarkdown = data?.language === "markdown";
  const hasDiff = previousContent !== undefined && previousContent !== (data?.content ?? "");
  const lines = data?.content.split("\n") ?? [];

  const fetchContent = useCallback((isRefresh = false) => {
    const qs = new URLSearchParams({ projectId, path: filePath });
    fetch(`/api/v1/files/read?${qs.toString()}`)
      .then((r) => r.json())
      .then((d: TextFileData & { error?: string }) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        setData(d);
        if (isRefresh) setBust((b) => b + 1);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [projectId, filePath]);

  // Initial load + SSE watch
  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    setPreviewMode(false);
    setViewMode("source");
    setWrapLines(false);
    setBust(0);
    setWatching(false);
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    fetchContent();

    const watchUrl = `/api/v1/files/watch?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(filePath)}`;
    const es = new EventSource(watchUrl);
    esRef.current = es;
    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", () => fetchContent(true));
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);
    return () => { es.close(); esRef.current = null; };
  }, [projectId, filePath, fetchContent]);

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171", fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Status bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono, monospace)" }} title={filePath}>
          {getRelativePath(filePath, projectId)}
        </span>
        <span style={{ marginLeft: "auto" }}>{data.language}</span>
        {viewMode === "source" && <span>{lines.length} lines</span>}
        <span>{formatFileSize(data.size)}</span>
        <WatchIndicator watching={watching} />

        {/* Diff / Source toggle */}
        {hasDiff && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setViewMode("source")}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: viewMode === "source" ? "var(--bg-selected)" : "var(--bg-hover)",
                color: viewMode === "source" ? "var(--text)" : "var(--text-muted)",
                fontWeight: viewMode === "source" ? 600 : 400,
              }}
            >
              Source
            </button>
            <button
              onClick={() => setViewMode("diff")}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: viewMode === "diff" ? "var(--bg-selected)" : "var(--bg-hover)",
                color: viewMode === "diff" ? "var(--text)" : "var(--text-muted)",
                fontWeight: viewMode === "diff" ? 600 : 400,
              }}
            >
              Diff
            </button>
          </div>
        )}

        {/* Word wrap toggle */}
        {viewMode === "source" && !previewMode && (
          <button
            onClick={() => setWrapLines((v) => !v)}
            title={wrapLines ? "Disable word wrap" : "Enable word wrap"}
            style={{
              padding: "2px 8px", fontSize: 11, cursor: "pointer",
              background: wrapLines ? "var(--bg-selected)" : "var(--bg-hover)",
              color: wrapLines ? "var(--text)" : "var(--text-muted)",
              border: "1px solid var(--border)", borderRadius: 5,
              fontWeight: wrapLines ? 600 : 400,
            }}
          >
            wrap
          </button>
        )}

        {/* HTML source/preview toggle */}
        {isHtml && viewMode === "source" && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setPreviewMode(false)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: !previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: !previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: !previewMode ? 600 : 400,
              }}
            >
              Code
            </button>
            <button
              onClick={() => setPreviewMode(true)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: previewMode ? 600 : 400,
              }}
            >
              Preview
            </button>
          </div>
        )}

        {/* Markdown preview/raw toggle */}
        {isMarkdown && viewMode === "source" && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setPreviewMode(true)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: previewMode ? 600 : 400,
              }}
            >
              Preview
            </button>
            <button
              onClick={() => setPreviewMode(false)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: !previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: !previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: !previewMode ? 600 : 400,
              }}
            >
              Raw
            </button>
          </div>
        )}
        <DownloadLink projectId={projectId} filePath={filePath} />
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflow: "auto", background: "var(--bg)" }}>
        {viewMode === "diff" && hasDiff && previousContent !== undefined ? (
          <DiffView oldContent={previousContent} newContent={data.content} />
        ) : isHtml && previewMode ? (
          <iframe
            srcDoc={data.content}
            sandbox="allow-scripts"
            style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
            title="HTML preview"
          />
        ) : isMarkdown && previewMode ? (
          <div style={{ padding: "24px 32px", color: "var(--text)" }}>
            {/* Simple markdown rendering — just show raw for now, could use react-markdown */}
            <pre style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {data.content}
            </pre>
          </div>
        ) : (
          <div style={{ margin: 0, padding: "12px 0", background: "var(--bg)", fontSize: 13, lineHeight: 1.6, fontFamily: "var(--font-mono, monospace)", minHeight: "100%" }}>
            <Highlight
              theme={isDark ? prismThemes.vsDark : prismThemes.vsLight}
              code={data.content}
              language={(data.language === "text" ? "plaintext" : data.language) as any}
            >
              {({ tokens, getLineProps, getTokenProps, style }) => (
                <pre style={{ margin: 0, padding: 0, ...style, background: "transparent" }}>
                  {tokens.map((line, i) => {
                    const { key: _lk, ...lineRest } = getLineProps({ line, key: i });
                    return (
                      <div key={i} {...lineRest} style={{ display: "flex" }}>
                        <span style={{ minWidth: "3em", padding: "0 1em 0 0", textAlign: "right", color: "var(--text-dim)", userSelect: "none", borderRight: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0 }}>
                          {i + 1}
                        </span>
                        <span style={{ flex: 1, paddingLeft: 8 }}>
                          {line.map((token, key) => {
                            const { key: _tk, ...tokenRest } = getTokenProps({ token, key });
                            return <span key={key} {...tokenRest} />;
                          })}
                        </span>
                      </div>
                    );
                  })}
                </pre>
              )}
            </Highlight>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main FileViewer (dispatcher) ──

export function FileViewer({
  projectId,
  filePath,
  watchUrl,
  previousContent,
  isDark,
  onOpenFile,
}: Props) {
  if (isImagePath(filePath)) {
    return <ImageViewer projectId={projectId} filePath={filePath} />;
  }
  if (isAudioPath(filePath)) {
    return <AudioViewer projectId={projectId} filePath={filePath} />;
  }
  if (isDocumentPath(filePath)) {
    return <DocumentViewer projectId={projectId} filePath={filePath} />;
  }
  return (
    <TextFileViewer
      projectId={projectId}
      filePath={filePath}
      previousContent={previousContent}
      isDark={isDark}
    />
  );
}
