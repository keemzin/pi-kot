import { useEffect, useState, useCallback, useRef } from "react";
import { useSessionStore } from "./stores/session-store";
import { ChatView } from "./components/ChatView";
import { ChatInput } from "./components/ChatInput";
import { AskUserQuestionPanel } from "./components/AskUserQuestionPanel";
import { OrchestrationPanel } from "./components/OrchestrationPanel";

import { ModelDropdown } from "./components/ModelDropdown";
import { ContextInspectModal } from "./components/ContextBar";
import { SessionTreePanel } from "./components/SessionTreePanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { FileExplorer } from "./components/FileExplorer";
import { ExtensionUIInteractionModal } from "./components/ExtensionUIInteractionModal";

import type { SessionContextResponse } from "./lib/api-client/types";
import {
  fetchAuthStatus,
  login,
  type SessionSummary,
  type Project,
  fetchProviders,
  type ProviderGroup,
  createProjectAPI,
  browseDirectories,
  cloneRepo,
} from "./lib/api-client";

// Module-level guard against React StrictMode double-invocation
// Tracks which project IDs have had an auto-created session.
const _autoCreatedProjects = new Set<string>();

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

  const [authRequired, setAuthRequired] = useState(false);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [selectedModel, setSelectedModel] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [providers, setProviders] = useState<ProviderGroup[]>([]);
  const [modelError, setModelError] = useState<string | undefined>();
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [showAddProject, setShowAddProject] = useState(false);
  const [showTreePanel, setShowTreePanel] = useState(false);
  const [cloneMode, setCloneMode] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPath, setNewProjectPath] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneFolder, setCloneFolder] = useState("");
  const [cloneBranch, setCloneBranch] = useState("");
  const [cloneToken, setCloneToken] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<string[]>([]);
  const [renamingSessionId, setRenamingSessionId] = useState<string | undefined>();
  const [renameValue, setRenameValue] = useState("");
  const [showArchived, setShowArchived] = useState<string | undefined>();
  const [projectToDelete, setProjectToDelete] = useState<string | undefined>();
  const [showSettings, setShowSettings] = useState(false);
  const [inspectData, setInspectData] = useState<SessionContextResponse | undefined>(undefined);
  const [showExplorer, setShowExplorer] = useState(false);
  const [showOrch, setShowOrch] = useState(false);
  const [expandedWorkerGroups, setExpandedWorkerGroups] = useState<Set<string>>(new Set());
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [pathSuggestions, setPathSuggestions] = useState<string[]>([]);
  const [showPathSuggestions, setShowPathSuggestions] = useState(false);
  const [pathSuggestionIdx, setPathSuggestionIdx] = useState(-1);
  const pathDebounceRef = useRef<number | undefined>(undefined);

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
        return; // Let next render auto-create
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
  }, [loading, authRequired, activeProjectId, projectSessions, activeSessionId]);

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
      setAuthRequired(false);
      await loadProjects();
    } catch {
      setPassword("");
    }
  };

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => !c);
  }, []);

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

  const handleAddProject = async () => {
    const name = newProjectName.trim();
    const path = newProjectPath.trim() || "";
    if (!name) return;
    try {
      await createProjectAPI(name, path);
      await loadProjects();
      setNewProjectName("");
      setNewProjectPath("");
      setShowAddProject(false);
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "Failed to create project");
    }
  };

  const fetchPathSuggestions = useCallback(async (query: string, immediate?: boolean) => {
    if (pathDebounceRef.current) clearTimeout(pathDebounceRef.current);
    const doFetch = async () => {
      try {
        const { suggestions } = await browseDirectories(query);
        setPathSuggestions(suggestions);
        setShowPathSuggestions(suggestions.length > 0);
        setPathSuggestionIdx(-1);
      } catch {
        setShowPathSuggestions(false);
      }
    };
    if (immediate) {
      await doFetch();
    } else {
      pathDebounceRef.current = setTimeout(doFetch, 150);
    }
  }, []);

  const handlePathInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setNewProjectPath(val);
    if (val.trim().length > 0) {
      fetchPathSuggestions(val.trim());
    } else {
      setPathSuggestions([]);
      setShowPathSuggestions(false);
    }
  };

  const handlePathFocus = () => {
    const q = newProjectPath.trim();
    fetchPathSuggestions(q || "/", true);
  };

  const handlePathBlur = () => {
    // Delay hiding so click on suggestion registers
    setTimeout(() => setShowPathSuggestions(false), 200);
  };

  const selectPathSuggestion = (path: string) => {
    setNewProjectPath(path);
    setShowPathSuggestions(false);
    setPathSuggestions([]);
  };

  const handlePathKeyDown = (e: React.KeyboardEvent) => {
    if (showPathSuggestions && pathSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPathSuggestionIdx((prev) =>
          prev < pathSuggestions.length - 1 ? prev + 1 : 0,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPathSuggestionIdx((prev) =>
          prev > 0 ? prev - 1 : pathSuggestions.length - 1,
        );
        return;
      }
      if (e.key === "Enter" && pathSuggestionIdx >= 0) {
        e.preventDefault();
        selectPathSuggestion(pathSuggestions[pathSuggestionIdx]);
        return;
      }
      if (e.key === "Escape") {
        setShowPathSuggestions(false);
        return;
      }
    }
    if (e.key === "Enter") {
      handleAddProject();
    }
    if (e.key === "Escape") {
      setShowAddProject(false);
    }
  };

  const handleCloneRepo = () => {
    const name = (cloneFolder || newProjectName).trim();
    if (!cloneUrl.trim() || !name) return;
    setCloning(true);
    setCloneProgress([]);

    const abort = cloneRepo(
      {
        url: cloneUrl.trim(),
        folderName: name,
        projectName: newProjectName.trim() || name,
        branch: cloneBranch.trim() || undefined,
        token: cloneToken.trim() || undefined,
      },
      (event) => {
        switch (event.type) {
          case "started":
            setCloneProgress((p) => [...p, `Cloning ${event.cloneUrlForDisplay}...`]);
            break;
          case "progress":
            if (event.percent !== null) {
              setCloneProgress((p) => [...p, `${event.phase}: ${event.percent}%`]);
            } else {
              setCloneProgress((p) => [...p, `${event.phase}...`]);
            }
            break;
          case "stderr":
            setCloneProgress((p) => [...p, event.line]);
            break;
          case "done":
            loadProjects().then(() => {
              // Auto-select the newly created project
              const state = useSessionStore.getState();
              const lastProj = state.projects[state.projects.length - 1];
              if (lastProj) {
                setActiveProject(lastProj.id);
              }
            });
            setCloneProgress((p) => [...p, "✓ Clone complete, project created"]);
            setTimeout(() => {
              setShowAddProject(false);
              setCloneMode(false);
              setCloning(false);
              setCloneProgress([]);
              setCloneUrl("");
              setCloneFolder("");
              setCloneBranch("");
              setCloneToken("");
              setNewProjectName("");
            }, 1500);
            break;
          case "error":
            setCloneProgress((p) => [...p, `✗ Error: ${event.message}`]);
            setCloning(false);
            break;
        }
      },
      (err) => {
        setCloneProgress((p) => [...p, `✗ ${err.message}`]);
        setCloning(false);
      },
    );

    // Store abort function for cancellation
    (window as any).__cloneAbort = abort;
  };

  if (loading) {
    return <div className="centered">Loading...</div>;
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
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            autoFocus
            className="login-input"
          />
          <button type="submit" className="login-btn">Login</button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-layout">
      {/* Sidebar — collapsible */}
      <div className={`sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
        <div className="sidebar-header">
          <span
            style={{
              fontSize: "14px",
              fontWeight: 700,
              color: "var(--accent-text)",
            }}
          >
            pi-kot
          </span>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            title="Settings"
            style={{
              background: "none",
              border: "none",
              color: "var(--text-dim)",
              fontSize: "14px",
              cursor: "pointer",
              padding: "4px 4px",
              borderRadius: "var(--radius-sm)",
              lineHeight: 1,
            }}
          >
            ⚙
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
                  className={`project-header${isActive ? " active" : ""}`}
                  onClick={() => {
                    if (isActive) {
                      toggleProject(project.id);
                    } else {
                      setActiveProject(project.id);
                    }
                  }}
                >
                  <span className="project-chevron">{isExpanded ? "▾" : "▸"}</span>
                  <span className="project-name">{project.name}</span>
                  <span className="project-count">{pSessions.length}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      createAndActivate(project.id);
                    }}
                    className="new-session-inline"
                    title="New session"
                  >
                    +
                  </button>
                  {project.name !== "Default" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setProjectToDelete(project.id);
                      }}
                      className="project-remove-btn"
                      title="Remove project from list"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Session list inside project */}
                {isExpanded && (() => {
                  const supervisors = pSessions.filter((s) => !s.supervisorId);
                  const workers = pSessions.filter((s) => s.supervisorId);
                  return (
                    <div className="session-list project-sublist">
                      {supervisors.map((supervisor: SessionSummary) => {
                        const childWorkers = workers.filter((w) => w.supervisorId === supervisor.sessionId);
                        const isExpandedGroup = expandedWorkerGroups.has(supervisor.sessionId);
                        return (
                          <div key={supervisor.sessionId}>
                            {/* Supervisor session item */}
                            <div
                              onClick={(e) => {
                                if (renamingSessionId === supervisor.sessionId) return;
                                e.stopPropagation();
                                setActiveSession(supervisor.sessionId);
                              }}
                              className={`session-item ${activeSessionId === supervisor.sessionId ? "active" : ""}`}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                setRenamingSessionId(supervisor.sessionId);
                                setRenameValue(supervisor.name ?? `Session ${supervisor.sessionId.slice(0, 8)}`);
                                setTimeout(() => renameInputRef.current?.focus(), 50);
                              }}
                            >
                              {/* Toggle chevron for workers */}
                              {childWorkers.length > 0 && (
                                <span
                                  className="project-chevron"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedWorkerGroups((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(supervisor.sessionId)) next.delete(supervisor.sessionId);
                                      else next.add(supervisor.sessionId);
                                      return next;
                                    });
                                  }}
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
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onBlur={() => {
                                    const trimmed = renameValue.trim();
                                    if (trimmed.length > 0 && trimmed !== (supervisor.name ?? `Session ${supervisor.sessionId.slice(0, 8)}`)) {
                                      useSessionStore.getState().renameSession(supervisor.sessionId, trimmed);
                                    }
                                    setRenamingSessionId(undefined);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.currentTarget.blur();
                                    } else if (e.key === "Escape") {
                                      setRenamingSessionId(undefined);
                                    }
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <>
                                  <span className="session-name">
                                    {supervisor.name ?? `Session ${supervisor.sessionId.slice(0, 8)}`}
                                  </span>
                                  <button
                                    className="session-archive-btn"
                                    title="Archive session"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (confirm(`Archive session "${supervisor.name ?? supervisor.sessionId.slice(0, 8)}"?`)) {
                                        useSessionStore.getState().archiveSession(supervisor.sessionId);
                                      }
                                    }}
                                  >
                                    🗑
                                  </button>
                                </>
                              )}
                            </div>
                            {/* Worker children */}
                            {childWorkers.length > 0 && isExpandedGroup && (
                              <div className="session-children">
                                {childWorkers.map((worker: SessionSummary) => (
                                  <div
                                    key={worker.sessionId}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveSession(worker.sessionId);
                                    }}
                                    className={`session-item session-worker-item ${activeSessionId === worker.sessionId ? "active" : ""}`}
                                  >
                                    <span
                                      className={`session-worker-dot ${worker.sessionId === activeSessionId && isStreaming ? "active" : ""}`}
                                      style={{
                                        background: worker.isLive && !(worker.sessionId === activeSessionId && isStreaming)
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
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {/* Unattached workers (no matching supervisor found) */}
                      {workers.filter((w) => !supervisors.some((s) => s.sessionId === w.supervisorId)).map((worker: SessionSummary) => (
                        <div
                          key={worker.sessionId}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveSession(worker.sessionId);
                          }}
                          className={`session-item session-worker-item ${activeSessionId === worker.sessionId ? "active" : ""}`}
                        >
                          <span
                            className={`session-worker-dot ${worker.sessionId === activeSessionId && isStreaming ? "active" : ""}`}
                            style={{
                              background: worker.isLive && !(worker.sessionId === activeSessionId && isStreaming)
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
                      ))}
                    </div>
                  );
                })()}
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
              if (archived === undefined) return <div className="archived-status">Loading...</div>;
              if (archived.length === 0) return <div className="archived-status">No archived sessions</div>;
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

        {/* Add project button / form */}
        <div className="sidebar-footer">
          {showAddProject ? (
            <div className="add-project-form">
              {/* Mode toggle */}
              <div className="clone-mode-toggle">
                <button
                  className={`clone-mode-btn${!cloneMode ? " active" : ""}`}
                  onClick={() => setCloneMode(false)}
                >
                  Existing Folder
                </button>
                <button
                  className={`clone-mode-btn${cloneMode ? " active" : ""}`}
                  onClick={() => setCloneMode(true)}
                >
                  Clone Repo
                </button>
              </div>

              {cloneMode ? (
                <>
                  <input
                    type="text"
                    value={cloneUrl}
                    onChange={(e) => setCloneUrl(e.target.value)}
                    placeholder="Git URL (https://...)"
                    className="add-project-input"
                    autoFocus
                    disabled={cloning}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCloneRepo();
                      if (e.key === "Escape") setShowAddProject(false);
                    }}
                  />
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="Project name"
                    className="add-project-input"
                    disabled={cloning}
                  />
                  <input
                    type="text"
                    value={cloneFolder}
                    onChange={(e) => setCloneFolder(e.target.value)}
                    placeholder="Folder name (under workspace)"
                    className="add-project-input"
                    disabled={cloning}
                  />
                  <input
                    type="text"
                    value={cloneBranch}
                    onChange={(e) => setCloneBranch(e.target.value)}
                    placeholder="Branch (optional)"
                    className="add-project-input"
                    disabled={cloning}
                  />
                  <input
                    type="password"
                    value={cloneToken}
                    onChange={(e) => setCloneToken(e.target.value)}
                    placeholder="Access token (optional)"
                    className="add-project-input"
                    disabled={cloning}
                  />
                  {cloneProgress.length > 0 && (
                    <div className="clone-progress">
                      {cloneProgress.map((line, i) => (
                        <div key={i} className="clone-progress-line">
                          {line}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="add-project-actions">
                    {cloning ? (
                      <button
                        onClick={() => {
                          ((window as any).__cloneAbort as (() => void) | undefined)?.();
                          setCloning(false);
                        }}
                        className="add-project-cancel"
                        style={{ flex: 1, textAlign: "center" }}
                      >
                        Cancel
                      </button>
                    ) : (
                      <>
                        <button onClick={handleCloneRepo} className="add-project-btn">
                          Clone
                        </button>
                        <button
                          onClick={() => setShowAddProject(false)}
                          className="add-project-cancel"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="Project name"
                    className="add-project-input"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddProject();
                      if (e.key === "Escape") setShowAddProject(false);
                    }}
                  />
                  <div style={{ position: "relative" }}>
                    <input
                      type="text"
                      value={newProjectPath}
                      onChange={handlePathInputChange}
                      onFocus={handlePathFocus}
                      onBlur={handlePathBlur}
                      onKeyDown={handlePathKeyDown}
                      placeholder="/home or ~/ or folder name → auto-suggest"
                      className="add-project-input"
                      style={{ width: "100%" }}
                    />
                    {showPathSuggestions && pathSuggestions.length > 0 && (
                      <div className="path-suggestions">
                        {pathSuggestions.slice(0, 20).map((s, i) => {
                          return (
                            <div
                              key={s}
                              className={"path-suggestion-item" + (i === pathSuggestionIdx ? " highlighted" : "")}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                selectPathSuggestion(s);
                              }}
                              onMouseEnter={() => setPathSuggestionIdx(i)}
                            >
                              📁 {s}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="add-project-actions">
                    <button onClick={handleAddProject} className="add-project-btn">
                      Add
                    </button>
                    <button
                      onClick={() => setShowAddProject(false)}
                      className="add-project-cancel"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowAddProject(true)}
              className="add-project-toggle"
              title="Add a new project"
            >
              + Add Project
            </button>
          )}
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
            {providers.length > 0 && (
              <ModelDropdown
                sessionId={activeSessionId}
                selected={selectedModel}
                onSelect={handleModelSelect}
                onError={handleModelError}
              />
            )}
            <span
              className={`status-dot ${activeSessionId !== undefined ? (isStreaming ? "streaming" : "live") : ""}`}
            />

            <button
              type="button"
              onClick={() => setShowExplorer((v) => !v)}
              title="File explorer"
              style={{
                background: "none",
                border: "none",
                color: showExplorer ? "var(--accent-text)" : "var(--text-dim)",
                fontSize: "12px",
                cursor: "pointer",
                padding: "3px 6px",
                borderRadius: "var(--radius-sm)",
                lineHeight: 1,
              }}
            >
              📂
            </button>
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

        {activeSessionId !== undefined ? (
          <>
            <ChatView sessionId={activeSessionId} />
            <OrchestrationPanel
              sessionId={activeSessionId}
              open={showOrch}
              onClose={() => setShowOrch(false)}
            />
            <AskUserQuestionPanel sessionId={activeSessionId} />
            <ChatInput
      sessionId={activeSessionId}
      showOrch={showOrch}
      setShowOrch={setShowOrch}
      onInspectContext={setInspectData}
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

      {/* Session Tree Panel overlay */}
      {activeSessionId !== undefined && activeProjectId !== undefined && (
        <SessionTreePanel
          sessionId={activeSessionId}
          projectId={activeProjectId}
          open={showTreePanel}
          onClose={() => setShowTreePanel(false)}
        />
      )}

      {/* File Explorer panel */}
      {activeProjectId !== undefined && (
        <FileExplorer
          projectId={activeProjectId}
          open={showExplorer}
          onClose={() => setShowExplorer(false)}
        />
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
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}

      {inspectData !== undefined && (
        <ContextInspectModal data={inspectData} onClose={() => setInspectData(undefined)} />
      )}

      {/* Extension UI bridge interactions (select/confirm/input from extension commands) */}
      {activeSessionId !== undefined && (
        <ExtensionUIInteractionModal sessionId={activeSessionId} />
      )}
    </div>
  );
}
