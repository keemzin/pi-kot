import { useState, useMemo } from "react";
import { Star, Archive, Plus, Search, ChevronRight, ChevronDown } from "lucide-react";
import type { SessionSummary } from "../lib/api-client";
import { useSessionStore } from "../stores/session-store";
import { useFavoriteStore } from "../stores/favorite-store";
import { useI18n } from "../hooks/useI18n";

const PAGE_SIZE = 8; // sessions shown before "Show more"
const SEARCH_THRESHOLD = 0; // show search input once a project has this many sessions

function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return "";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "1d";
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w`;
  return `${Math.floor(days / 30)}mo`;
}

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
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [favoritesCollapsed, setFavoritesCollapsed] = useState(false);

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

  const { favorites: favIds, toggle: toggleFav, isFavorite, unfavorite: unfavoriteFav } = useFavoriteStore();

  // Separate supervisors into favorites and non-favorites across ALL matching supervisors
  const { favSupervisors, nonFavSupervisors } = useMemo(() => {
    const fav: SessionSummary[] = [];
    const nonFav: SessionSummary[] = [];
    for (const s of filteredSupervisors) {
      if (isFavorite(s.sessionId)) {
        fav.push(s);
      } else {
        nonFav.push(s);
      }
    }
    return { favSupervisors: fav, nonFavSupervisors: nonFav };
  }, [filteredSupervisors, isFavorite, favIds]);

  // Paginate non-favorite supervisors — always keep active session visible regardless of page
  const truncated = !showAll && !q && nonFavSupervisors.length > PAGE_SIZE;
  const visibleNormalSupervisors = truncated
    ? nonFavSupervisors.slice(0, PAGE_SIZE).includes(
        nonFavSupervisors.find((s) => s.sessionId === activeSessionId) ?? nonFavSupervisors[0],
      )
      // active is within first page — just slice
      ? nonFavSupervisors.slice(0, PAGE_SIZE)
      // active is beyond first page — show first PAGE_SIZE-1 + the active one
      : [
          ...nonFavSupervisors.slice(0, PAGE_SIZE - 1),
          nonFavSupervisors.find((s) => s.sessionId === activeSessionId) ?? nonFavSupervisors[PAGE_SIZE - 1],
        ].filter(Boolean) as SessionSummary[]
    : nonFavSupervisors;

  const hiddenCount = nonFavSupervisors.length - visibleNormalSupervisors.length;

  const showSearch = sessions.length >= SEARCH_THRESHOLD;

  const renderRow = (supervisor: SessionSummary) => {
    const childWorkers = workers.filter((w) => w.supervisorId === supervisor.sessionId);
    const isExpandedGroup = expandedWorkerGroups.has(supervisor.sessionId);
    const isActive = activeSessionId === supervisor.sessionId;
    const displayName = supervisor.name ?? `Session ${supervisor.sessionId.slice(0, 8)}`;
    const isFav = isFavorite(supervisor.sessionId);
    const relativeTime = formatRelativeTime(supervisor.lastActivityAt || supervisor.createdAt);

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
              style={{ cursor: "pointer", marginRight: "4px", display: "inline-flex", alignItems: "center" }}
            >
              {isExpandedGroup ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
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
              <span className="session-name" title={displayName}>{displayName}</span>

              <div className="session-item-meta">
                {isFav && (
                  <span className="session-fav-indicator" title="Favorited">
                    <Star size={11} fill="currentColor" />
                  </span>
                )}
                {relativeTime && <span className="session-time">{relativeTime}</span>}
                <div className="session-actions">
                  <button
                    className={`session-action-btn session-fav-btn${isFav ? " favorited" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFav(supervisor.sessionId);
                    }}
                    title={isFav ? "Remove from favorites" : "Add to favorites"}
                  >
                    <Star size={12} fill={isFav ? "currentColor" : "none"} />
                  </button>
                  <button
                    className="session-action-btn session-archive-btn"
                    title="Archive session"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Archive "${displayName}"?`)) {
                        unfavoriteFav(supervisor.sessionId);
                        useSessionStore.getState().archiveSession(supervisor.sessionId);
                      }
                    }}
                  >
                    <Archive size={12} />
                  </button>
                </div>
              </div>
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
        <div className="session-search-box">
          <Search size={12} className="session-search-icon" />
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
          {t("sidebar.noSessions")}
        </div>
      )}
      {q && filteredSupervisors.length === 0 && (
        <div style={{ padding: "6px 12px 2px", fontSize: "11px", color: "var(--text-dim)", fontStyle: "italic" }}>
          {t("sidebar.noMatches", { query })}
        </div>
      )}

      {/* ── Favorites section ── */}
      {favSupervisors.length > 0 && !q && (
        <>
          <div
            className="favorites-section-header clickable"
            onClick={() => setFavoritesCollapsed((c) => !c)}
            title={favoritesCollapsed ? "Expand favorites" : "Collapse favorites"}
          >
            <span className="favorites-chevron">
              {favoritesCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
            </span>
            <span>{t("sidebar.favorites")}</span>
            <span className="favorites-count-badge">{favSupervisors.length}</span>
          </div>
          {!favoritesCollapsed && favSupervisors.map(renderRow)}
          {visibleNormalSupervisors.length > 0 && <div className="favorites-section-divider" />}
        </>
      )}
      {/* ── All sessions ── */}
      {q ? filteredSupervisors.map(renderRow) : visibleNormalSupervisors.map(renderRow)}

      {/* ── Show more / less ── */}
      {truncated && hiddenCount > 0 && (
        <button
          className="session-show-more-btn"
          onClick={() => setShowAll(true)}
          type="button"
        >
          {hiddenCount !== 1 ? t("sidebar.showMorePlural", { count: hiddenCount }) : t("sidebar.showMore", { count: hiddenCount })}
        </button>
      )}
      {showAll && nonFavSupervisors.length > PAGE_SIZE && (
        <button
          className="session-show-more-btn"
          onClick={() => setShowAll(false)}
          type="button"
        >
          {t("sidebar.showLess")}
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
        <Plus size={13} strokeWidth={2.2} />
        <span>{t("sidebar.newSession")}</span>
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
  const relativeTime = formatRelativeTime(worker.lastActivityAt || worker.createdAt);

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
      {relativeTime && <span className="session-time session-worker-time">{relativeTime}</span>}
    </div>
  );
}
