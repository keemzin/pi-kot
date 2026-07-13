import { useEffect, useState } from "react";
import { Columns2, FileDiff, RefreshCw, Rows2 } from "lucide-react";
import { getTurnDiff, ApiError, type TurnDiffEntry } from "../lib/api-client";
import { useSessionStore } from "../stores/session-store";
import { DiffBlock } from "./DiffBlock";

type ViewType = "unified" | "split";
const VIEW_TYPE_KEY = "pi-kot.turnDiff.viewType";

function readPersistedViewType(): ViewType {
  try {
    const v = localStorage.getItem(VIEW_TYPE_KEY);
    return v === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

/**
 * Shows the aggregated set of file changes from the current session's
 * latest turn. Lives in the right pane (file browser column) as a
 * sibling to the file tree.
 *
 * Refresh strategy: fetch on mount + on every message array change
 * (proxies agent_end). The "Refresh" button forces a fetch.
 */
export function TurnDiffPanel() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const messages = useSessionStore((s) => s.messages);
  const isStreaming = useSessionStore((s) => s.isStreaming);
  const partsMessages = useSessionStore((s) => s.partsMessages);

  // Use partsMessages length as a proxy for agent_end — when a turn
  // finishes, the SDK normalizes and flushes streamingMessage into
  // partsMessages. This changes less frequently than raw messages but
  // more reliably than a dedicated counter we'd need to add.
  const messageCount = partsMessages.length;

  const [entries, setEntries] = useState<TurnDiffEntry[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [viewType, setViewType] = useState<ViewType>(readPersistedViewType);

  const setAndPersistViewType = (next: ViewType): void => {
    setViewType(next);
    try {
      localStorage.setItem(VIEW_TYPE_KEY, next);
    } catch {
      // Private-mode storage failure — choice still applies for this session.
    }
  };

  const refresh = async (): Promise<void> => {
    if (activeSessionId === undefined) return;
    setLoading(true);
    setError(undefined);
    try {
      const r = await getTurnDiff(activeSessionId);
      setEntries(r.entries);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setEntries([]);
      } else {
        setEntries([]);
        setError(err instanceof ApiError ? String(err.status) : (err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Fetch on session change + when normalized parts messages length
  // changes (happens at agent_end when streamingMessage flushes).
  // Reset entries on session switch so the new session doesn't
  // briefly show the previous one's diff.
  useEffect(() => {
    setEntries([]);
    setError(undefined);
  }, [activeSessionId]);
  useEffect(() => {
    if (activeSessionId === undefined || isStreaming) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, messageCount, isStreaming]);

  if (activeSessionId === undefined) {
    return (
      <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", padding: "0 16px", textAlign: "center", fontSize: "12px", fontStyle: "italic", color: "var(--text-dim)" }}>
        Pick a session to see its file changes.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontSize: "12px", color: "var(--text-secondary)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", padding: "8px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 500, color: "var(--text-primary)", fontSize: "13px" }}>
          <FileDiff size={13} />
          Last turn
          {entries.length > 0 && (
            <span style={{ borderRadius: "var(--radius-sm)", background: "var(--bg-glass)", padding: "2px 6px", fontSize: "10px", color: "var(--text-dim)" }}>
              {entries.length}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button
            onClick={() => setAndPersistViewType(viewType === "split" ? "unified" : "split")}
            style={{ background: "none", border: "none", borderRadius: "var(--radius-sm)", padding: "4px", color: "var(--text-dim)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            title={viewType === "split" ? "Switch to unified view" : "Switch to side-by-side view"}
            type="button"
          >
            {viewType === "split" ? <Rows2 size={13} /> : <Columns2 size={13} />}
          </button>
          <button
            onClick={() => void refresh()}
            style={{ background: "none", border: "none", borderRadius: "var(--radius-sm)", padding: "4px", color: "var(--text-dim)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            title="Refresh diff"
            type="button"
          >
            <RefreshCw size={13} style={loading ? { animation: "spin 1s linear infinite" } : undefined} />
          </button>
        </div>
      </div>
      {error !== undefined && (
        <div style={{ borderBottom: "1px solid var(--error)", background: "rgba(248,113,113,0.08)", padding: "6px 12px", fontSize: "11px", color: "var(--error)" }}>
          {error}
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {entries.length === 0 && (
          <p style={{ padding: "12px", fontStyle: "italic", color: "var(--text-dim)" }}>
            {loading
              ? "Loading…"
              : error !== undefined
                ? "Couldn't load the latest turn diff (see banner)."
                : "No file changes from the most recent turn."}
          </p>
        )}
        {entries.map((entry) => {
          const open = expanded[entry.file] ?? false;
          const name = entry.file.split("/").pop() ?? entry.file;
          return (
            <div key={entry.file} style={{ borderBottom: "1px solid var(--border)" }}>
              <button
                onClick={() => setExpanded((e) => ({ ...e, [entry.file]: !open }))}
                style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "8px 12px", textAlign: "left", cursor: "pointer", background: "none", border: "none", color: "var(--text-secondary)" }}
                title={entry.file}
                type="button"
              >
                <span style={{ display: "flex", minWidth: 0, alignItems: "baseline", gap: "8px" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace", color: "var(--text-primary)", fontSize: "12px" }}>{name}</span>
                  {entry.isPureAddition && (
                    <span style={{ borderRadius: "var(--radius-sm)", background: "rgba(52,211,153,0.12)", padding: "2px 6px", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--success)" }}>
                      new
                    </span>
                  )}
                </span>
                <span style={{ display: "flex", flexShrink: 0, alignItems: "baseline", gap: "8px", fontSize: "11px" }}>
                  <span style={{ color: "var(--success)" }}>
                    +{entry.additions}
                  </span>
                  <span style={{ color: "var(--error)" }}>−{entry.deletions}</span>
                </span>
              </button>
              {open && <DiffBlock diff={entry.diff} viewType={viewType} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}