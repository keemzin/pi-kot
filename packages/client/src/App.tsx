import { useEffect, useState, useCallback } from "react";
import { useSessionStore } from "./stores/session-store";
import { ChatView } from "./components/ChatView";
import { ChatInput } from "./components/ChatInput";
import { ThemePicker } from "./components/ThemePicker";
import { ModelDropdown } from "./components/ModelDropdown";
import {
  fetchAuthStatus,
  login,
  type SessionSummary,
  type Project,
  fetchProviders,
  type ProviderGroup,
  createProjectAPI,
  cloneRepo,
} from "./lib/api-client";
import { applyTheme } from "./lib/theme";

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
  const [currentTheme, setCurrentTheme] = useState(() => {
    try {
      return localStorage.getItem("pi-kot-theme") ?? "night";
    } catch {
      return "night";
    }
  });
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [providers, setProviders] = useState<ProviderGroup[]>([]);
  const [modelError, setModelError] = useState<string | undefined>();
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [showAddProject, setShowAddProject] = useState(false);
  const [cloneMode, setCloneMode] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPath, setNewProjectPath] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneFolder, setCloneFolder] = useState("");
  const [cloneBranch, setCloneBranch] = useState("");
  const [cloneToken, setCloneToken] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<string[]>([]);

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

  // Auto-select first session if none active, or create one if none exist
  useEffect(() => {
    if (loading || authRequired || projects.length === 0) return;
    if (activeSessionId === undefined && activeProjectId !== undefined) {
      const projectSessionsList = projectSessions[activeProjectId];
      // Wait for sessions to finish loading (undefined = still loading)
      if (projectSessionsList === undefined) return;

      if (projectSessionsList.length > 0) {
        setActiveSession(projectSessionsList[0].sessionId);
      } else if (!_autoCreatedProjects.has(activeProjectId)) {
        _autoCreatedProjects.add(activeProjectId);
        createAndActivate(activeProjectId);
      }
    }
  }, [loading, authRequired, activeProjectId, projectSessions, activeSessionId]);

  const handleLogin = async () => {
    try {
      await login(password);
      setAuthRequired(false);
      await loadProjects();
    } catch {
      setPassword("");
    }
  };

  const handleThemeChange = (themeId: string) => {
    applyTheme(themeId);
    setCurrentTheme(themeId);
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
                </div>

                {/* Session list inside project */}
                {isExpanded && (
                  <div className="session-list project-sublist">
                    {pSessions.map((s: SessionSummary) => (
                      <div
                        key={s.sessionId}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveSession(s.sessionId);
                        }}
                        className={`session-item ${activeSessionId === s.sessionId ? "active" : ""}`}
                      >
                        <span className="session-name">
                          {s.name ?? `Session ${s.sessionId.slice(0, 8)}`}
                        </span>
                      </div>
                    ))}

                    {/* New session button inside project */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        createAndActivate(project.id);
                      }}
                      className="new-session-mini"
                      title="New session in this project"
                    >
                      + New Session
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

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
                  <input
                    type="text"
                    value={newProjectPath}
                    onChange={(e) => setNewProjectPath(e.target.value)}
                    placeholder="Path to existing folder (e.g. ~/my-project)"
                    className="add-project-input"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddProject();
                      if (e.key === "Escape") setShowAddProject(false);
                    }}
                  />
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
            <ThemePicker currentTheme={currentTheme} onChange={handleThemeChange} />
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
            <ChatView sessionId={activeSessionId} modelName={selectedModel} providerName={selectedProvider} />
            <ChatInput sessionId={activeSessionId} />
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
    </div>
  );
}
