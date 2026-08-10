import { useState } from "react";
import { FileDiff, FileText, RefreshCw } from "lucide-react";
import { getTurnDiff, type TurnDiffEntry } from "../lib/api-client";
import { fileBasename } from "../lib/turn-file-chips";
import { DiffBlock } from "./DiffBlock";

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

  const canDiff = sessionId !== undefined && startIndex !== undefined;

  const loadDiff = async (): Promise<void> => {
    if (sessionId === undefined || startIndex === undefined) return;
    setLoading(true);
    setError(undefined);
    try {
      const r = await getTurnDiff(sessionId, startIndex, endIndex);
      setEntries(r.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const toggleDiff = (): void => {
    const next = !diffOpen;
    setDiffOpen(next);
    if (next && entries.length === 0 && error === undefined) void loadDiff();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", margin: "8px 0 4px" }}>
      <div
        aria-label="Files this turn wrote"
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}
      >
        <span style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim)", fontWeight: 500 }}>
          wrote
        </span>
        {files.map((path) => (
          <button
            key={path}
            type="button"
            title={path}
            aria-label={`Open ${path}`}
            onClick={() => onOpen(path)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "3px 8px",
              fontSize: "12px",
              fontFamily: "var(--font-mono, monospace)",
              color: "var(--text-primary)",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            <FileText size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
            <span style={{ maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {fileBasename(path)}
            </span>
          </button>
        ))}
        {canDiff && (
          <button
            type="button"
            onClick={toggleDiff}
            title={diffOpen ? "Hide turn diff" : "Show this turn's diff"}
            aria-label={diffOpen ? "Hide turn diff" : "Show this turn's diff"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "3px 8px",
              fontSize: "11px",
              color: "var(--text-secondary)",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            <FileDiff size={12} />
            {diffOpen ? "hide diff" : "diff"}
            {entries.length > 0 && (
              <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>{entries.length}</span>
            )}
          </button>
        )}
      </div>

      {diffOpen && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden", background: "var(--bg-glass)" }}>
          {error !== undefined && (
            <div style={{ padding: "6px 10px", fontSize: "11px", color: "var(--error)", borderBottom: "1px solid var(--border)" }}>
              Couldn't load turn diff: {error}
            </div>
          )}
          {loading && entries.length === 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px", fontSize: "11px", color: "var(--text-dim)" }}>
              <RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} />
              Loading diff…
            </div>
          )}
          {!loading && entries.length === 0 && error === undefined && (
            <div style={{ padding: "8px 12px", fontSize: "11px", fontStyle: "italic", color: "var(--text-dim)" }}>
              No file changes captured for this turn.
            </div>
          )}
          {entries.map((entry) => {
            const open = expanded[entry.file] ?? false;
            const name = fileBasename(entry.file);
            return (
              <div key={entry.file} style={{ borderBottom: "1px solid var(--border)", overflow: "hidden" }}>
                <button
                  type="button"
                  onClick={() => setExpanded((e) => ({ ...e, [entry.file]: !open }))}
                  style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "6px 10px", textAlign: "left", cursor: "pointer", background: "none", border: "none", color: "var(--text-secondary)" }}
                  title={entry.file}
                >
                  <span style={{ display: "flex", minWidth: 0, alignItems: "center", gap: "8px" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace", color: "var(--text-primary)", fontSize: "11px" }}>{name}</span>
                    {entry.isPureAddition && (
                      <span style={{ borderRadius: "var(--radius-sm)", background: "rgba(52,211,153,0.12)", padding: "2px 6px", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--success)" }}>
                        new
                      </span>
                    )}
                  </span>
                  <span style={{ display: "flex", flexShrink: 0, alignItems: "baseline", gap: "8px", fontSize: "11px" }}>
                    <span style={{ color: "var(--success)" }}>+{entry.additions}</span>
                    <span style={{ color: "var(--error)" }}>−{entry.deletions}</span>
                  </span>
                </button>
                {open && <DiffBlock diff={entry.diff} viewType="unified" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}