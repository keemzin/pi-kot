import { useEffect, useState, useCallback, useRef } from "react";
import { useSessionStore } from "./stores/session-store";
import { ChatView } from "./components/ChatView";
import { ChatInput } from "./components/ChatInput";
import { AskUserQuestionPanel } from "./components/AskUserQuestionPanel";
import { OrchestrationPanel } from "./components/OrchestrationPanel";

import { ContextInspectModal, useContextData, ContextPill } from "./components/ContextBar";
import { MCPPanel } from "./components/MCPPanel";
import { SessionTreePanel } from "./components/SessionTreePanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { FileExplorer } from "./components/FileExplorer";
import { FileViewerPanel } from "./components/FileViewerPanel";
import { TerminalPanel } from "./components/TerminalPanel";
import { ExtensionUIInteractionModal } from "./components/ExtensionUIInteractionModal";
import { NotificationToast } from "./components/NotificationToast";
import { SessionList } from "./components/SessionList";
import { AddProjectDialog } from "./components/AddProjectDialog";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoadingSkeleton } from "./components/LoadingSkeleton";
import { useTouchSwipe } from "./hooks/useTouchSwipe";
import { useLayoutStore } from "./stores/layout-store";

import type { SessionContextResponse } from "./lib/api-client/types";
import {
  fetchAuthStatus,
  login,
  onUnauthorized,
  clearStoredToken,
  type SessionSummary,
  type Project,
  fetchProviders,
  type ProviderGroup,
  getSessionModel,
} from "./lib/api-client";

// Module-level guard against React StrictMode double-invocation
// Tracks which project IDs have had an auto-created session.
const _autoCreatedProjects = new Set<string>();

// Tracks whether the initial app boot is done. Once true, subsequent
// project switches (user clicking a folder) stop auto-selecting the
// first session — the welcome screen stays visible instead.
let _initialBootDone = false;

const PROJECT_COLORS = [
  "var(--accent)",
  "#d19a66",
  "#56b6c2",
  "#c678dd",
  "#e5c07b",
  "#98c379",
  "#e06c75",
  "#61afef",
];

function projectColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
}

export function App() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const sessions = useSessionStore((s) => s.sessions);
  const projects = useSessionStore((s) => s.projects);
  const projectSessions = useSessionStore((s) => s.projectSessions);
  const loadProjects = useSessionStore((s) => s.loadProjects);
  const setActiveProject = useSessionStore((s) => s.setActiveProject);
  const createAndActivate = useSessionStore((s) => s.createAndActivate);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const refreshSessions = useSessionStore((s) => s.refreshSessions);
  const isStreaming = useSessionStore((s) => s.streamState.isStreaming);
  const connectionState = useSessionStore((s) => s.connectionState);

  const [authRequired, setAuthRequired] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [providers, setProviders] = useState<ProviderGroup[]>([]);
  const [modelError, setModelError] = useState<string | undefined>();
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [renamingSessionId, setRenamingSessionId] = useState<string | undefined>();
  const [renameValue, setRenameValue] = useState("");
  const [showArchived, setShowArchived] = useState<string | undefined>();
  const [projectToDelete, setProjectToDelete] = useState<string | undefined>();
  const [inspectData, setInspectData] = useState<SessionContextResponse | undefined>(undefined);
  const [expandedWorkerGroups, setExpandedWorkerGroups] = useState<Set<string>>(new Set());
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const contextData = useContextData(activeSessionId);

  const {
    sidebarCollapsed, showTreePanel, showSettings, showOrch, showMCP, showTerminal,
    showAddProjectDialog, explorerTab, isMobile,
    toggleSidebar, setSidebarCollapsed, closeSidebarOnMobile,
    setShowTreePanel, setShowSettings, setShowOrch, setShowMCP, setShowTerminal,
    setShowAddProjectDialog, setExplorerTab, toggleExplorerTab,
    setIsMobile,
  } = useLayoutStore();

  // Keep isMobile in sync with viewport
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 600);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useTouchSwipe({
    onSwipeLeft: () => setSidebarCollapsed(true),
    onSwipeRight: () => setSidebarCollapsed(false),
    threshold: 60,
  });

  // Bootstrap: check auth, load projects, fetch models
  useEffect(() => {
    (async () => {
      try {
        const { authEnabled } = await fetchAuthStatus();
        if (authEnabled) {
          const token =
            typeof localStorage !== "undefined"
              ? localStorage.getItem("pi-kot/auth-token")
              : null;
          if (token === null) {
            setAuthRequired(true);
            setLoading(false);
            return;
          }
        }
        await loadProjects();
      } catch {
        // server not reachable yet
      }

      // Fetch available models
      try {
        const res = await fetchProviders();
        setProviders(res.providers);
        const allModels = res.providers.flatMap((p) => p.models);

        // Try to restore previously selected model from localStorage
        let restored = false;
        try {
          const stored = localStorage.getItem("pi-kot-model");
          if (stored) {
            const parsed = JSON.parse(stored) as { modelId: string; provider: string };
            const match = allModels.find(
              (m) => m.id === parsed.modelId && m.hasAuth,
            );
            if (match) {
              setSelectedModel(match.id);
              setSelectedProvider(parsed.provider);
              restored = true;
            }
          }
        } catch {
          // localStorage read or parse failed
        }

        if (!restored) {
          const firstWithAuth = allModels.find((m) => m.hasAuth);
          if (firstWithAuth) {
            setSelectedModel(firstWithAuth.id);
            setSelectedProvider(
              res.providers.find((p) =>
                p.models.some((m) => m.id === firstWithAuth.id)
              )?.provider ?? "",
            );
          } else if (allModels.length > 0) {
            setSelectedModel(allModels[0].id);
            setSelectedProvider(res.providers[0]?.provider ?? "");
          }
        }
      } catch {
        // providers not available
      }

      setLoading(false);
    })();
  }, []);

  // Auto-expand active project
  useEffect(() => {
    if (activeProjectId !== undefined) {
      setExpandedProjects((prev) => new Set(prev).add(activeProjectId));
    }
  }, [activeProjectId]);

  // Restore stored session on refresh, or auto-select/auto-create as fallback
  useEffect(() => {
    if (loading || authRequired || projects.length === 0) return;
    if (activeProjectId === undefined) return;

    const projectSessionsList = projectSessions[activeProjectId];
    // Wait for sessions to finish loading (undefined = still loading)
    if (projectSessionsList === undefined) return;

    // Initial boot (first time we reach here after loading completes).
    // Restore a stored session, auto-select the first, or auto-create.
    // Subsequent project switches (user clicking a folder) leave the
    // welcome screen visible — no auto-select, no lag from loading a
    // session the user didn't ask for.
    if (!_initialBootDone) {
      _initialBootDone = true;

      // We have a stored session ID (from localStorage or URL hash)
      if (activeSessionId !== undefined) {
        const exists = projectSessionsList.some(
          (s) => s.sessionId === activeSessionId,
        );
        if (!exists) {
          // Stored session was deleted on the server — clear ID and fall through
          try {
            localStorage.removeItem("pi-kot/active-session-id");
          } catch { /* private mode */ }
          useSessionStore.setState({ activeSessionId: undefined });
          return; // Let next render auto-select/create
        }
        // Session still exists — check if it needs activation (page refresh case)
        const st = useSessionStore.getState();
        if (st.sseClient === undefined) {
          setActiveSession(activeSessionId);
        }
        return;
      }

      // No stored session — auto-select first or create
      if (projectSessionsList.length > 0) {
        setActiveSession(projectSessionsList[0].sessionId);
      } else if (!_autoCreatedProjects.has(activeProjectId)) {
        _autoCreatedProjects.add(activeProjectId);
        createAndActivate(activeProjectId);
      }
    }
  }, [loading, authRequired, activeProjectId, projectSessions, activeSessionId]);

  // Restore per-session model override when switching sessions
  useEffect(() => {
    if (!activeSessionId) return;
    (async () => {
      try {
        const res = await getSessionModel(activeSessionId);
        if (res.provider && res.modelId) {
          setSelectedModel(res.modelId);
          setSelectedProvider(res.provider);
          try {
            localStorage.setItem(
              "pi-kot-model",
              JSON.stringify({ modelId: res.modelId, provider: res.provider }),
            );
          } catch {
            // private mode
          }
        }
      } catch {
        // Session not live or not available — keep current selection
      }
    })();
  }, [activeSessionId]);

  // ── URL hash sync (deep-linkable sessions) ──
  // Write the active project/session into the URL hash so a refresh
  // or bookmark restores the same view.
  useEffect(() => {
    const pid = activeProjectId;
    const sid = activeSessionId;
    let newHash: string;
    if (pid && sid) {
      newHash = `#/project/${pid}/session/${sid}`;
    } else if (pid) {
      newHash = `#/project/${pid}`;
    } else {
      newHash = "#";
    }
    if (window.location.hash !== newHash) {
      history.replaceState(null, "", newHash);
    }
  }, [activeProjectId, activeSessionId]);

  // Respond to back/forward hash navigation
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      const m = hash.match(/^#\/project\/([^/]+)(?:\/session\/([^/]+))?$/);
      if (!m) return;
      const hashProjectId = m[1];
      const hashSessionId = m[2] ?? undefined;
      const state = useSessionStore.getState();
      if (hashSessionId && hashSessionId !== state.activeSessionId) {
        const exists = Object.values(state.projectSessions).some((list) =>
          list.some((s) => s.sessionId === hashSessionId),
        );
        if (exists) {
          // Ensure we're on the right project first
          if (hashProjectId !== state.activeProjectId) {
            state.setActiveProject(hashProjectId).then(() => {
              state.setActiveSession(hashSessionId);
            });
          } else {
            state.setActiveSession(hashSessionId);
          }
        }
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Listen for 401 unauthorized events from the API client.
  // When the server rejects a stale token (e.g. password changed,
  // server restarted) this clears auth and shows the login form.
  useEffect(() => {
    const unsub = onUnauthorized(() => {
      setPassword("");
      setLoginError(undefined);
      setAuthRequired(true);
    });
    return unsub;
  }, []);

  const handleClearToken = useCallback(() => {
    clearStoredToken();
    setPassword("");
    setLoginError(undefined);
    setAuthRequired(true);
  }, []);

  // Auto-expand worker groups when any worker in any project is live
  useEffect(() => {
    const allSessions = Object.values(projectSessions).flat();
    const toExpand = new Set(expandedWorkerGroups);
    allSessions.filter((s) => s.supervisorId && s.isLive).forEach((s) => toExpand.add(s.supervisorId!));
    setExpandedWorkerGroups(toExpand);
  }, [projectSessions]);

  const handleLogin = async () => {
    try {
      await login(password);
      setLoginError(undefined);
      setAuthRequired(false);
      await loadProjects();
    } catch {
      setLoginError("Invalid password");
    }
  };

  const handleModelSelect = useCallback(
    (modelId: string, provider: string) => {
      setSelectedModel(modelId);
      setSelectedProvider(provider);
      setModelError(undefined);
      try {
        localStorage.setItem("pi-kot-model", JSON.stringify({ modelId, provider }));
      } catch {
        // private mode
      }
    },
    [],
  );

  const handleModelError = useCallback((error: string) => {
    setModelError(error);
  }, []);

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="centered">
        <div style={{ width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 24 }}>
          <LoadingSkeleton variant="card" count={2} />
          <LoadingSkeleton variant="list" count={4} />
        </div>
      </div>
    );
  }

  if (authRequired) {
    return (
      <div className="centered">
        <form
          onSubmit={(e) => { e.preventDefault(); handleLogin(); }}
          className="login-form"
        >
          <h2 className="login-title">pi-kot</h2>
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setLoginError(undefined); }}
            placeholder="Enter password"
            autoFocus
            autoComplete="new-password"
            className={`login-input${loginError ? " login-input-error" : ""}`}
          />
          {loginError && <div className="login-error">{loginError}</div>}
          <button type="submit" className="login-btn">Login</button>
          <button
            type="button"
            onClick={handleClearToken}
            className="login-btn"
            style={{
              background: "none",
              border: "1px solid var(--border-color, #444)",
              color: "var(--text-dim, #888)",
              fontSize: "11px",
              marginTop: "4px",
            }}
          >
            Clear stored token
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-layout">
      {/* Mobile backdrop — tapping outside sidebar closes it */}
      {!sidebarCollapsed && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarCollapsed(true)}
          aria-hidden="true"
        />
      )}
      {/* Sidebar — collapsible */}
      <div className={`sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
        <div className="sidebar-header">
          <span
            style={{
              fontSize: "14px",
              fontWeight: 700,
              color: "var(--accent-text)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span
              title={
                connectionState === "connected"
                  ? "Connected"
                  : connectionState === "connecting"
                    ? "Connecting…"
                    : connectionState === "error"
                      ? "Connection error"
                      : "Disconnected"
              }
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background:
                  connectionState === "connected"
                    ? "#4caf50"
                    : connectionState === "connecting"
                      ? "#f0c040"
                      : connectionState === "error"
                        ? "#e06c75"
                        : "#666",
                transition: "all 0.3s",
                animation: connectionState === "connecting"
                  ? "connection-pulse 1.2s ease-in-out infinite"
                  : "none",
              }}
            />
            pi-kot
          </span>
          <button
            onClick={() => setShowAddProjectDialog(true)}
            title="Add a new project"
            className="sidebar-add-project"
          >
            Add Project
          </button>
        </div>

        {/* Project list */}
        <div className="project-list">
          {projects.map((project: Project) => {
            const isActive = project.id === activeProjectId;
            const isExpanded = expandedProjects.has(project.id);
            const pSessions = projectSessions[project.id] ?? [];

            return (
              <div key={project.id} className={`project-group${isActive ? " active" : ""}`}>
                {/* Project header */}
                <div
                  className={`project-row${isActive ? " active" : ""}`}
                  onClick={() => {
                    if (isActive) {
                      toggleProject(project.id);
                    } else {
                      setActiveProject(project.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  {/* Folder icon (default) / arrow (on hover) */}
                  <span className="project-icon">
                    <svg
                      className="project-icon-folder"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ color: projectColor(project.id) }}
                    >
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <svg
                      className="project-icon-arrow"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </span>

                  {/* Project name — lowercase, truncate */}
                  <span className="project-name">{project.name.toLowerCase()}</span>

                  {/* Hover-reveal project menu (left group) */}
                  <div className="project-actions-left">
                    {project.name !== "Default" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setProjectToDelete(project.id);
                        }}
                        className="project-action-btn"
                        title="Remove from sidebar"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="5 14 12 5 19 14" />
                          <line x1="4" y1="19" x2="20" y2="19" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Far-right new session button */}
                  <div className="project-actions-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        createAndActivate(project.id);
                      }}
                      className="project-action-btn"
                      title="New draft session"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Session list inside project */}
                {isExpanded && (
                  <SessionList
                    projectId={project.id}
                    sessions={pSessions}
                    activeSessionId={activeSessionId}
                    isStreaming={isStreaming}
                    renamingSessionId={renamingSessionId}
                    renameValue={renameValue}
                    renameInputRef={renameInputRef}
                    expandedWorkerGroups={expandedWorkerGroups}
                    onSelect={(sessionId) => {
                      setActiveSession(sessionId);
                      closeSidebarOnMobile();
                    }}
                    onRenameStart={(sessionId, currentName) => {
                      setRenamingSessionId(sessionId);
                      setRenameValue(currentName);
                      setTimeout(() => renameInputRef.current?.focus(), 50);
                    }}
                    onRenameChange={setRenameValue}
                    onRenameCommit={(sessionId, oldName) => {
                      const trimmed = renameValue.trim();
                      if (trimmed.length > 0 && trimmed !== oldName) {
                        useSessionStore.getState().renameSession(sessionId, trimmed);
                      }
                      setRenamingSessionId(undefined);
                    }}
                    onRenameCancel={() => setRenamingSessionId(undefined)}
                    onToggleWorkerGroup={(sessionId) => {
                      setExpandedWorkerGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(sessionId)) next.delete(sessionId);
                        else next.add(sessionId);
                        return next;
                      });
                    }}
                    onNewSession={() => {
                      createAndActivate(project.id);
                      closeSidebarOnMobile();
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Archived sessions section */}
        {activeProjectId !== undefined && (
          <>
            <div
              className="archived-toggle"
              onClick={() => {
                const next = showArchived === activeProjectId ? undefined : activeProjectId;
                if (next !== undefined) {
                  useSessionStore.getState().loadArchivedSessions(activeProjectId);
                }
                setShowArchived(next);
              }}
            >
              <span className="project-chevron">{showArchived === activeProjectId ? "▾" : "▸"}</span>
              <span className="project-name" style={{ fontSize: "12px" }}>
                Archived
              </span>
            </div>
            {showArchived === activeProjectId && (() => {
              const archived = useSessionStore.getState().archivedSessions[activeProjectId];
              if (archived === undefined) return <div className="archived-status"><LoadingSkeleton variant="list" count={2} /></div>;
              if (archived.length === 0) return <div className="archived-status">No archived sessions — they appear here once archived</div>;
              return (
                <div className="session-list project-sublist archived-list">
                  {archived.map((s: SessionSummary) => (
                    <div key={s.sessionId} className="session-item archived">
                      <span className="session-name">
                        {s.name ?? `Session ${s.sessionId.slice(0, 8)}`}
                      </span>
                      <button
                        className="session-restore-btn"
                        title="Restore session"
                        onClick={(e) => {
                          e.stopPropagation();
                          useSessionStore.getState().unarchiveSession(s.sessionId, activeProjectId);
                        }}
                      >
                        ↻
                      </button>
                    </div>
                  ))}
                </div>
              );
            })()}
          </>
        )}

        {/* Sidebar Footer (Mobile Actions) */}
        <div className="sidebar-footer">
          <div className="mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <button
              type="button"
              onClick={() => { setShowMCP(true); setSidebarCollapsed(true); }}
              className="add-project-toggle"
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
              MCP Settings
            </button>
            <button
              type="button"
              onClick={() => { setShowSettings(true); setSidebarCollapsed(true); }}
              className="add-project-toggle"
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              ⚙ Settings
            </button>
            <button
              type="button"
              onClick={() => { handleClearToken(); setSidebarCollapsed(true); }}
              className="add-project-toggle"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* Main chat area */}
      <div className="main-area">
        {/* Sticky header bar */}
        <div className="header">
          <div className="header-left">
            <button
              type="button"
              onClick={toggleSidebar}
              className="sidebar-toggle"
              title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            >
              {sidebarCollapsed ? "☰" : "✕"}
            </button>
            {activeSessionId !== undefined && (
              <>
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "var(--text-secondary)",
                    marginLeft: "8px",
                  }}
                >
                  Session {activeSessionId.slice(0, 8)}
                </span>
                <button
                  type="button"
                  onClick={() => setShowTreePanel(true)}
                  title="Session tree (branching history)"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-dim)",
                    fontSize: "12px",
                    cursor: "pointer",
                    padding: "3px 6px",
                    borderRadius: "var(--radius-sm)",
                    lineHeight: 1,
                  }}
                >
                  🌿
                </button>
              </>
            )}
          </div>
          <div className="header-right">
            <ContextPill
              data={contextData}
              onInspect={(d) => setInspectData(d)}
            />
            <button
              type="button"
              onClick={() => toggleExplorerTab("files")}
              title="File explorer"
              style={{
                background: "none",
                border: "none",
                color: explorerTab === "files" ? "var(--accent-text)" : "var(--text-dim)",
                fontSize: "12px",
                cursor: "pointer",
                padding: "3px 6px",
                borderRadius: "var(--radius-sm)",
                lineHeight: 1,
              }}
            >
              📂
            </button>

            <button
              type="button"
              onClick={() => { setShowTerminal(true); setSidebarCollapsed(true); }}
              title="Terminal"
              style={{
                background: "none",
                border: "none",
                color: showTerminal ? "var(--accent-text)" : "var(--text-dim)",
                fontSize: "12px",
                cursor: "pointer",
                padding: "3px 6px",
                borderRadius: "var(--radius-sm)",
                lineHeight: 1,
              }}
            >
              &gt;_
            </button>
            <div className="header-overflow desktop-only">
              <button
                type="button"
                onClick={() => setShowMCP(true)}
                title="MCP Settings"
                style={{
                  background: "none",
                  border: "none",
                  color: showMCP ? "var(--accent-text)" : "var(--text-dim)",
                  fontSize: "12px",
                  cursor: "pointer",
                  padding: "3px 6px",
                  borderRadius: "var(--radius-sm)",
                  lineHeight: 1,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                title="Settings"
                style={{
                  background: "none",
                  border: "none",
                  color: showSettings ? "var(--accent-text)" : "var(--text-dim)",
                  fontSize: "14px",
                  cursor: "pointer",
                  padding: "3px 6px",
                  borderRadius: "var(--radius-sm)",
                  lineHeight: 1,
                }}
              >
                ⚙
              </button>
              <button
                type="button"
                onClick={handleClearToken}
                title="Sign out (clear stored token)"
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-dim)",
                  fontSize: "12px",
                  cursor: "pointer",
                  padding: "3px 6px",
                  borderRadius: "var(--radius-sm)",
                  lineHeight: 1,
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>

        {/* Model error banner */}
        {modelError !== undefined && (
          <div
            onClick={() => setModelError(undefined)}
            className="error-banner"
            style={{
              position: "absolute",
              top: "52px",
              left: "16px",
              right: "16px",
              zIndex: 9,
              cursor: "pointer",
            }}
          >
            {modelError} — click to dismiss
          </div>
        )}

        {/* ── Flex row: chat | file viewer | file tree ── */}
        <div
          className="main-content-row"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "row",
            minHeight: 0,
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            className="chat-column"
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              overflow: "hidden",
            }}
          >
            {activeSessionId !== undefined ? (
              <>
                <ErrorBoundary label="ChatView" compact>
                  <ChatView sessionId={activeSessionId} modelName={selectedModel || undefined} providerName={selectedProvider || undefined} />
                </ErrorBoundary>
                <ErrorBoundary label="OrchestrationPanel" compact>
                  <OrchestrationPanel
                    sessionId={activeSessionId}
                    open={showOrch}
                    onClose={() => setShowOrch(false)}
                  />
                </ErrorBoundary>
                <AskUserQuestionPanel sessionId={activeSessionId} />
                <ChatInput
      sessionId={activeSessionId}
      showOrch={showOrch}
      setShowOrch={setShowOrch}
      selectedModel={selectedModel}
      onModelSelect={handleModelSelect}
      onModelError={handleModelError}
    />
              </>
            ) : (
              <div className="centered" style={{ height: "100%" }}>
                <div className="welcome">
                  <div className="welcome-icon">⌨️</div>
                  <div className="welcome-text">Select or create a session</div>
                  <div className="welcome-hint">to start chatting with the coding agent</div>
                </div>
              </div>
            )}
          </div>

          {/* File viewer — slides in when a file is opened */}
          {activeProjectId !== undefined && (
            <FileViewerPanel projectId={activeProjectId} />
          )}

          {/* File tree / git panel — slides in */}
          {activeProjectId !== undefined && !isMobile && (
            <ErrorBoundary label="FileExplorer" compact>
              <FileExplorer
                projectId={activeProjectId}
                open={explorerTab !== undefined}
                onClose={() => setExplorerTab(undefined)}
                initialTab={explorerTab}
                flexLayout
              />
            </ErrorBoundary>
          )}
        </div>
      </div>

      {/* Mobile explorer: use overlay (fixed position) instead of flex layout */}
      {activeProjectId !== undefined && isMobile && (
        <ErrorBoundary label="FileExplorer" compact>
          <FileExplorer
            projectId={activeProjectId}
            open={explorerTab !== undefined}
            onClose={() => setExplorerTab(undefined)}
            initialTab={explorerTab}
            flexLayout={false}
          />
        </ErrorBoundary>
      )}

      {/* Session Tree Panel overlay */}
      {activeSessionId !== undefined && activeProjectId !== undefined && (
        <ErrorBoundary label="SessionTreePanel" compact>
          <SessionTreePanel
            sessionId={activeSessionId}
            projectId={activeProjectId}
            open={showTreePanel}
            onClose={() => setShowTreePanel(false)}
          />
        </ErrorBoundary>
      )}

      {/* Settings Panel overlay */}
      {/* Confirm project delete — matches settings/rewind modal animation */}
      {projectToDelete !== undefined && (
        <div className="settings-overlay" onClick={() => setProjectToDelete(undefined)}>
          <div
            className="settings-panel rewind-panel"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 420, maxWidth: "90vw", height: "auto", minHeight: 0 }}
          >
            <header className="settings-header">
              <span style={{ fontSize: 14, fontWeight: 600 }}>Remove project?</span>
              <button
                onClick={() => setProjectToDelete(undefined)}
                className="settings-close"
                title="Close"
              >
                ✕
              </button>
            </header>
            <div className="settings-body" style={{ padding: "16px" }}>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.5 }}>
                This removes <strong>{projects.find(p => p.id === projectToDelete)?.name ?? projectToDelete}</strong> from the sidebar — all sessions stay safely on disk. You can add it back anytime.
              </p>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => setProjectToDelete(undefined)}
                  className="settings-tab"
                  style={{ padding: "6px 14px", fontSize: 12 }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    useSessionStore.getState().deleteProject(projectToDelete);
                    setProjectToDelete(undefined);
                  }}
                  className="settings-tab settings-tab-active"
                  style={{ padding: "6px 14px", fontSize: 12, background: "var(--accent-red, #e06c75)", color: "#fff", border: "none" }}
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <ErrorBoundary label="SettingsPanel" compact>
          <SettingsPanel onClose={() => setShowSettings(false)} />
        </ErrorBoundary>
      )}

      {inspectData !== undefined && (
        <ContextInspectModal data={inspectData} onClose={() => setInspectData(undefined)} sessionId={activeSessionId} />
      )}

      <ErrorBoundary label="TerminalPanel" compact>
        <TerminalPanel
          open={showTerminal}
          onClose={() => setShowTerminal(false)}
        />
      </ErrorBoundary>

      {showMCP && (
        <ErrorBoundary label="MCPPanel" compact>
          <MCPPanel onClose={() => setShowMCP(false)} />
        </ErrorBoundary>
      )}

      {/* Extension UI bridge interactions (select/confirm/input from extension commands) */}
      {activeSessionId !== undefined && (
        <ExtensionUIInteractionModal sessionId={activeSessionId} />
      )}

      {/* Extension command notifications (toast from ctx.ui.notify) */}
      <NotificationToast />

      {showAddProjectDialog && (
        <AddProjectDialog
          open={showAddProjectDialog}
          onClose={() => setShowAddProjectDialog(false)}
        />
      )}
    </div>
  );
}
