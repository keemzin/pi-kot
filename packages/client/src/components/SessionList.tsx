import { useState, useMemo } from "react";
import type { SessionSummary } from "../lib/api-client";
import { useSessionStore } from "../stores/session-store";
import { useFavoriteStore } from "../stores/favorite-store";

const PAGE_SIZE = 8; // sessions shown before "Show more"
const SEARCH_THRESHOLD = 0; // show search input once a project has this many sessions

interface Props {
  projectId: string;
  sessions: SessionSummary[];
  activeSessionId: string | undefined;
  isStreaming: boolean;
  renamingSessionId: string | undefined;
  renameValue: string;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  expandedWorkerGroups: Set<string>;
  pendingRevert?: string;
  onSelect: (sessionId: string) => void;
  onRenameStart: (sessionId: string, currentName: string) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: (sessionId: string, oldName: string) => void;
  onRenameCancel: () => void;
  onToggleWorkerGroup: (sessionId: string) => void;
  onNewSession: () => void;
}

export function SessionList({
  projectId,
  sessions,
  activeSessionId,
  isStreaming,
  renamingSessionId,
  renameValue,
  renameInputRef,
  expandedWorkerGroups,
  onSelect,
  onRenameStart,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onToggleWorkerGroup,
  onNewSession,
}: Props) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const supervisors = useMemo(() => sessions.filter((s) => !s.supervisorId), [sessions]);
  const workers = useMemo(() => sessions.filter((s) => s.supervisorId), [sessions]);
  const unattachedWorkers = useMemo(
    () => workers.filter((w) => !supervisors.some((s) => s.sessionId === w.supervisorId)),
    [workers, supervisors],
  );

  const q = query.trim().toLowerCase();

  // Filter supervisors by query
  const filteredSupervisors = useMemo(() => {
    if (!q) return supervisors;
    return supervisors.filter((s) =>
      (s.name ?? `Session ${s.sessionId.slice(0, 8)}`).toLowerCase().includes(q),
    );
  }, [supervisors, q]);

  // Paginate — always keep active session visible regardless of page
  const truncated = !showAll && !q && filteredSupervisors.length > PAGE_SIZE;
  const visibleSupervisors = truncated
    ? filteredSupervisors.slice(0, PAGE_SIZE).includes(
        filteredSupervisors.find((s) => s.sessionId === activeSessionId) ?? filteredSupervisors[0],
      )
      // active is within first page — just slice
      ? filteredSupervisors.slice(0, PAGE_SIZE)
      // active is beyond first page — show first PAGE_SIZE-1 + the active one
      : [
          ...filteredSupervisors.slice(0, PAGE_SIZE - 1),
          filteredSupervisors.find((s) => s.sessionId === activeSessionId) ?? filteredSupervisors[PAGE_SIZE - 1],
        ].filter(Boolean) as SessionSummary[]
    : filteredSupervisors;

  const hiddenCount = filteredSupervisors.length - visibleSupervisors.length;

  const { favorites: favIds, toggle: toggleFav } = useFavoriteStore();
  const { favSessions, normalSessions } = useMemo(() => {
    const fav: SessionSummary[] = [];
    const normal: SessionSummary[] = [];
    for (const s of visibleSupervisors) {
      if (favIds.includes(s.sessionId)) {
        fav.push(s);
      } else {
        normal.push(s);
      }
    }
    return { favSessions: fav, normalSessions: normal };
  }, [visibleSupervisors, favIds]);

  const showSearch = sessions.length >= SEARCH_THRESHOLD;

  const renderRow = (supervisor: SessionSummary) => {
    const childWorkers = workers.filter((w) => w.supervisorId === supervisor.sessionId);
    const isExpandedGroup = expandedWorkerGroups.has(supervisor.sessionId);
    const isActive = activeSessionId === supervisor.sessionId;
    const displayName = supervisor.name ?? `Session ${supervisor.sessionId.slice(0, 8)}`;
    const isFav = favIds.includes(supervisor.sessionId);

    return (
      <div key={supervisor.sessionId}>
        <div
          onClick={(e) => {
            if (renamingSessionId === supervisor.sessionId) return;
            e.stopPropagation();
            onSelect(supervisor.sessionId);
          }}
          className={`session-item${isActive ? " active" : ""}`}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onRenameStart(supervisor.sessionId, displayName);
          }}
        >
          {childWorkers.length > 0 && (
            <span
              className="project-chevron"
              onClick={(e) => { e.stopPropagation(); onToggleWorkerGroup(supervisor.sessionId); }}
              style={{ cursor: "pointer", marginRight: "4px" }}
            >
              {isExpandedGroup ? "▾" : "▶"}
            </span>
          )}
          {renamingSessionId === supervisor.sessionId ? (
            <input
              ref={renameInputRef}
              className="session-rename-input"
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onBlur={() => onRenameCommit(supervisor.sessionId, displayName)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") onRenameCancel();
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
            <button
              className={`session-fav-btn${isFav ? " favorited" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleFav(supervisor.sessionId);
              }}
              title={isFav ? "Remove from favorites" : "Add to favorites"}
            >
              {isFav ? "★" : "☆"}
            </button>
            <span className="session-name">{displayName}</span>
            <button
              className="session-archive-btn"
              title="Archive session"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Archive "${displayName}"?`)) {
                  useSessionStore.getState().archiveSession(supervisor.sessionId);
                }
              }}
            >
              ✕
            </button>
            </>
          )}
        </div>

        {childWorkers.length > 0 && isExpandedGroup && (
          <div className="session-children">
            {childWorkers.map((worker) => (
              <WorkerItem
                key={worker.sessionId}
                worker={worker}
                isActive={activeSessionId === worker.sessionId}
                isStreaming={isStreaming && activeSessionId === worker.sessionId}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="session-list project-sublist">
      {/* ── Search ── */}
      {showSearch && (
        <div style={{ padding: "2px 8px 3px" }}>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setShowAll(false); }}
            placeholder="Search sessions…"
            className="session-search-input"
            type="search"
          />
        </div>
      )}

      {/* ── Empty states ── */}
      {supervisors.length === 0 && workers.length === 0 && (
        <div style={{ padding: "6px 12px 2px", fontSize: "11px", color: "var(--text-dim)", fontStyle: "italic" }}>
          No sessions yet — click + to start one
        </div>
      )}
      {q && filteredSupervisors.length === 0 && (
        <div style={{ padding: "6px 12px 2px", fontSize: "11px", color: "var(--text-dim)", fontStyle: "italic" }}>
          No matches for "{query}"
        </div>
      )}

      {/* ── Favorites section ── */}
      {favSessions.length > 0 && !q && (
        <>
          <div className="favorites-section-header">★ Favorites</div>
          {favSessions.map(renderRow)}
          {normalSessions.length > 0 && <div className="favorites-section-divider" />}
        </>
      )}
      {/* ── All sessions ── */}
      {q ? visibleSupervisors.map(renderRow) : normalSessions.map(renderRow)}

      {/* ── Show more / less ── */}
      {truncated && hiddenCount > 0 && (
        <button
          className="session-show-more-btn"
          onClick={() => setShowAll(true)}
          type="button"
        >
          ↓ {hiddenCount} more session{hiddenCount !== 1 ? "s" : ""}
        </button>
      )}
      {showAll && filteredSupervisors.length > PAGE_SIZE && (
        <button
          className="session-show-more-btn"
          onClick={() => setShowAll(false)}
          type="button"
        >
          ↑ Show less
        </button>
      )}

      {/* ── Unattached workers ── */}
      {unattachedWorkers.map((worker) => (
        <WorkerItem
          key={worker.sessionId}
          worker={worker}
          isActive={activeSessionId === worker.sessionId}
          isStreaming={isStreaming && activeSessionId === worker.sessionId}
          onSelect={onSelect}
        />
      ))}

      {/* ── New session ── */}
      <button
        className="new-session-row"
        onClick={(e) => { e.stopPropagation(); onNewSession(); }}
        type="button"
      >
        <span style={{ fontSize: "14px", lineHeight: 1 }}>＋</span>
        New session
      </button>
    </div>
  );
}

/* ── Worker item (shared) ── */
function WorkerItem({
  worker,
  isActive,
  isStreaming,
  onSelect,
}: {
  worker: SessionSummary;
  isActive: boolean;
  isStreaming: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onSelect(worker.sessionId); }}
      className={`session-item session-worker-item${isActive ? " active" : ""}`}
    >
      <span
        className={`session-worker-dot${isStreaming ? " active" : ""}`}
        style={{
          background: worker.isLive && !isStreaming
            ? "#98c379"
            : !worker.isLive
              ? "#56b6c2"
              : undefined,
        }}
      />
      <span className="session-worker-name">
        {worker.name ?? `Session ${worker.sessionId.slice(0, 8)}`}
      </span>
    </div>
  );
}
