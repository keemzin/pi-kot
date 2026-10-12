import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Columns2,
  Copy,
  ExternalLink,
  FileCode2,
  FileDiff,
  RefreshCw,
  Rows,
} from "lucide-react";
import { getTurnDiff, type TurnDiffEntry } from "../lib/api-client";
import { fileBasename } from "../lib/turn-file-chips";
import { DiffBlock } from "./DiffBlock";

function fileExtensionColor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return "#38bdf8"; // Sky / TS
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "#facc15"; // Yellow / JS
    case "json":
      return "#fbbf24"; // Amber
    case "css":
    case "scss":
    case "less":
      return "#34d399"; // Emerald
    case "py":
      return "#60a5fa"; // Blue / Python
    case "rs":
    case "go":
    case "c":
    case "cpp":
    case "h":
      return "#f87171"; // Rose
    case "html":
    case "svg":
      return "#fb923c"; // Orange
    case "md":
    case "mdx":
      return "#c084fc"; // Purple
    default:
      return "var(--accent, #6366f1)";
  }
}

function splitFilePath(filePath: string) {
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

function CopyPathButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(path).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      title={copied ? "Copied path!" : "Copy path"}
      aria-label="Copy path"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "none",
        border: "none",
        color: copied ? "var(--success, #22c55e)" : "var(--text-dim)",
        cursor: "pointer",
        padding: "3px",
        borderRadius: "4px",
        transition: "color 0.15s ease",
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

/**
 * Chips of files a turn wrote (`write`/`edit` calls that succeeded),
 * rendered under the reply that wrote them. Click a chip to open the
 * file in the viewer. The trailing "diff" toggle fetches the turn's
 * changeset (scoped to this turn on the server) and renders it inline.
 */
export function TurnFileChips({
  files,
  sessionId,
  startIndex,
  endIndex,
  onOpen,
}: {
  files: string[];
  sessionId?: string;
  /** Raw message-array index of the turn's first user message. */
  startIndex?: number;
  /** Raw message-array index one past the turn's last message. */
  endIndex?: number;
  onOpen: (path: string) => void;
}) {
  const [diffOpen, setDiffOpen] = useState(false);
  const [entries, setEntries] = useState<TurnDiffEntry[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [viewType, setViewType] = useState<"unified" | "split">("unified");

  const canDiff = sessionId !== undefined && startIndex !== undefined;

  const loadDiff = async (): Promise<void> => {
    if (sessionId === undefined || startIndex === undefined) return;
    setLoading(true);
    setError(undefined);
    try {
      const r = await getTurnDiff(sessionId, startIndex, endIndex);
      setEntries(r.entries);
      // Auto-expand all entries when diff is opened
      const initExpanded: Record<string, boolean> = {};
      for (const entry of r.entries) {
        initExpanded[entry.file] = true;
      }
      setExpanded(initExpanded);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const toggleDiff = (): void => {
    const next = !diffOpen;
    setDiffOpen(next);
    if (next && entries.length === 0 && error === undefined) {
      void loadDiff();
    }
  };

  const toggleAll = (): void => {
    const allAreOpen = entries.every((e) => expanded[e.file] ?? false);
    const next: Record<string, boolean> = {};
    for (const e of entries) {
      next[e.file] = !allAreOpen;
    }
    setExpanded(next);
  };

  const allExpanded = entries.length > 0 && entries.every((e) => expanded[e.file] ?? false);
  const totalAdds = entries.reduce((acc, e) => acc + e.additions, 0);
  const totalDels = entries.reduce((acc, e) => acc + e.deletions, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "8px 0 4px" }}>
      {/* File chips row */}
      <div
        aria-label="Files this turn wrote"
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}
      >
        <span
          style={{
            fontSize: "10px",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--text-dim)",
            fontWeight: 600,
          }}
        >
          wrote
        </span>
        {files.map((path) => {
          const color = fileExtensionColor(path);
          return (
            <button
              key={path}
              type="button"
              title={path}
              aria-label={`Open ${path}`}
              onClick={() => onOpen(path)}
              className="turn-file-chip"
            >
              <FileCode2 size={12.5} style={{ color, flexShrink: 0 }} />
              <span
                style={{
                  maxWidth: "280px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {fileBasename(path)}
              </span>
            </button>
          );
        })}
        {canDiff && (
          <button
            type="button"
            onClick={toggleDiff}
            title={diffOpen ? "Hide turn diff" : "Show this turn's diff"}
            aria-label={diffOpen ? "Hide turn diff" : "Show this turn's diff"}
            className={`turn-diff-toggle-chip ${diffOpen ? "active" : ""}`}
          >
            <FileDiff size={12.5} />
            <span>{diffOpen ? "hide diff" : "diff"}</span>
            <span
              style={{
                fontSize: "10px",
                padding: "0.5px 5px",
                borderRadius: "10px",
                background: diffOpen ? "rgba(99, 102, 241, 0.2)" : "rgba(255, 255, 255, 0.08)",
                color: diffOpen ? "var(--accent)" : "var(--text-dim)",
                fontWeight: 600,
              }}
            >
              {entries.length > 0 ? entries.length : files.length}
            </span>
          </button>
        )}
      </div>

      {/* Expanded turn diff panel */}
      {diffOpen && (
        <div className="turn-diff-container">
          {/* Panel toolbar header */}
          <div className="turn-diff-toolbar">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <FileDiff size={13} style={{ color: "var(--accent)" }} />
              <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>Turn Changes</span>
              {entries.length > 0 && (
                <span style={{ color: "var(--text-dim)", fontSize: "10.5px" }}>
                  ({entries.length} {entries.length === 1 ? "file" : "files"})
                </span>
              )}
              {entries.length > 0 && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "10.5px",
                    marginLeft: "4px",
                  }}
                >
                  <span style={{ color: "var(--success, #22c55e)", fontWeight: 600 }}>
                    +{totalAdds}
                  </span>
                  <span style={{ color: "var(--error, #ef4444)", fontWeight: 600 }}>
                    −{totalDels}
                  </span>
                </div>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {entries.length > 1 && (
                <button
                  type="button"
                  onClick={toggleAll}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-secondary)",
                    fontSize: "11px",
                    cursor: "pointer",
                    padding: "2px 6px",
                    borderRadius: "4px",
                  }}
                >
                  {allExpanded ? "Collapse all" : "Expand all"}
                </button>
              )}

              {/* View type switcher: Unified / Split */}
              <div
                className="turn-diff-view-segmented"
                role="group"
                aria-label="Diff view layout"
              >
                <button
                  type="button"
                  className={`turn-diff-view-btn ${viewType === "unified" ? "active" : ""}`}
                  onClick={() => setViewType("unified")}
                  title="Unified line-by-line view"
                >
                  <Rows size={11} />
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

          {/* Loading, error, or empty status */}
          {error !== undefined && (
            <div
              style={{
                padding: "8px 12px",
                fontSize: "11px",
                color: "var(--error)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              Couldn't load turn diff: {error}
            </div>
          )}
          {loading && entries.length === 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "12px 14px",
                fontSize: "11px",
                color: "var(--text-dim)",
              }}
            >
              <RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} />
              Loading diff…
            </div>
          )}
          {!loading && entries.length === 0 && error === undefined && (
            <div
              style={{
                padding: "12px 14px",
                fontSize: "11px",
                fontStyle: "italic",
                color: "var(--text-dim)",
              }}
            >
              No file changes captured for this turn.
            </div>
          )}

          {/* File diff entries list */}
          {entries.map((entry) => {
            const open = expanded[entry.file] ?? false;
            const { dir, name } = splitFilePath(entry.file);
            const color = fileExtensionColor(entry.file);

            return (
              <div key={entry.file} className="turn-diff-entry">
                <button
                  type="button"
                  onClick={() => setExpanded((e) => ({ ...e, [entry.file]: !open }))}
                  className={`turn-diff-file-header ${open ? "open" : ""}`}
                  title={entry.file}
                >
                  {/* Left: chevron, file icon, path, status badge */}
                  <span
                    style={{
                      display: "flex",
                      minWidth: 0,
                      alignItems: "center",
                      gap: "7px",
                    }}
                  >
                    <span style={{ color: "var(--text-dim)", display: "flex" }}>
                      {open ? <ChevronDown size={13.5} /> : <ChevronRight size={13.5} />}
                    </span>
                    <FileCode2 size={13.5} style={{ color, flexShrink: 0 }} />
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: "11px",
                      }}
                    >
                      {dir && (
                        <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>{dir}</span>
                      )}
                      <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{name}</span>
                    </span>

                    {entry.isPureAddition ? (
                      <span
                        style={{
                          borderRadius: "4px",
                          background: "rgba(34, 197, 94, 0.14)",
                          border: "1px solid rgba(34, 197, 94, 0.25)",
                          padding: "1px 5px",
                          fontSize: "9px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          color: "var(--success, #22c55e)",
                        }}
                      >
                        new
                      </span>
                    ) : (
                      <span
                        style={{
                          borderRadius: "4px",
                          background: "rgba(56, 189, 248, 0.12)",
                          border: "1px solid rgba(56, 189, 248, 0.25)",
                          padding: "1px 5px",
                          fontSize: "9px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          color: "#38bdf8",
                        }}
                      >
                        modified
                      </span>
                    )}
                  </span>

                  {/* Right: stats pills + quick actions */}
                  <span
                    style={{
                      display: "flex",
                      flexShrink: 0,
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "11px",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        fontFamily: "var(--font-mono, monospace)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {entry.additions > 0 && (
                        <span
                          style={{
                            color: "var(--success, #22c55e)",
                            background: "rgba(34, 197, 94, 0.12)",
                            padding: "1px 5px",
                            borderRadius: "4px",
                            fontWeight: 500,
                          }}
                        >
                          +{entry.additions}
                        </span>
                      )}
                      {entry.deletions > 0 && (
                        <span
                          style={{
                            color: "var(--error, #ef4444)",
                            background: "rgba(239, 68, 68, 0.12)",
                            padding: "1px 5px",
                            borderRadius: "4px",
                            fontWeight: 500,
                          }}
                        >
                          −{entry.deletions}
                        </span>
                      )}
                    </span>

                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "2px",
                        marginLeft: "4px",
                      }}
                    >
                      <CopyPathButton path={entry.file} />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(entry.file);
                        }}
                        title={`Open ${entry.file} in editor`}
                        aria-label="Open in editor"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "none",
                          border: "none",
                          color: "var(--text-dim)",
                          cursor: "pointer",
                          padding: "3px",
                          borderRadius: "4px",
                          transition: "color 0.15s ease",
                        }}
                      >
                        <ExternalLink size={12} />
                      </button>
                    </span>
                  </span>
                </button>

                {open && <DiffBlock diff={entry.diff} viewType={viewType} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}