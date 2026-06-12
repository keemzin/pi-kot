import { useEffect, useState, useCallback } from "react";
import { useSessionStore } from "./stores/session-store";
import { ChatView } from "./components/ChatView";
import { ChatInput } from "./components/ChatInput";
import { ThemePicker } from "./components/ThemePicker";
import { ModelDropdown } from "./components/ModelDropdown";
import { fetchAuthStatus, login, type SessionSummary, fetchProviders, type ProviderGroup } from "./lib/api-client";
import { applyTheme } from "./lib/theme";

export function App() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
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

  // Bootstrap: check auth, load sessions, fetch models
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
        await refreshSessions();
      } catch {
        // server not reachable yet
      }

      // Fetch available models
      try {
        const res = await fetchProviders();
        setProviders(res.providers);
        // Auto-select first model with auth, or first model overall
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

  const handleLogin = async () => {
    try {
      await login(password);
      setAuthRequired(false);
      await refreshSessions();
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

  // Auto-create first session if none exist, or auto-select the first existing one
  useEffect(() => {
    if (loading || authRequired) return;
    if (sessions.length === 0) {
      createAndActivate();
    } else if (activeSessionId === undefined) {
      setActiveSession(sessions[0].sessionId);
    }
  }, [loading, authRequired, sessions, activeSessionId]);

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
          <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--accent-text)" }}>
            pi-kot
          </span>
        </div>

        <div className="sidebar-actions">
          <button onClick={createAndActivate} className="new-session-btn">
            + New Session
          </button>
        </div>

        <div className="session-list">
          {sessions.map((s: SessionSummary) => (
            <div
              key={s.sessionId}
              onClick={() => setActiveSession(s.sessionId)}
              className={`session-item ${activeSessionId === s.sessionId ? "active" : ""}`}
            >
              Session {s.sessionId.slice(0, 8)}
            </div>
          ))}
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
              <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-secondary)" }}>
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
            <ChatView sessionId={activeSessionId} />
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
