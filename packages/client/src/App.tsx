import { useEffect, useState } from "react";
import { useSessionStore } from "./stores/session-store";
import { ChatView } from "./components/ChatView";
import { ChatInput } from "./components/ChatInput";
import { fetchAuthStatus, login, type SessionSummary } from "./lib/api-client";

export function App() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const createAndActivate = useSessionStore((s) => s.createAndActivate);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const refreshSessions = useSessionStore((s) => s.refreshSessions);
  const [authRequired, setAuthRequired] = useState(false);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);

  // Bootstrap: check auth, load sessions
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

  // Auto-create first session if none exist
  useEffect(() => {
    if (!loading && !authRequired && sessions.length === 0) {
      createAndActivate();
    }
  }, [loading, authRequired, sessions.length]);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          fontFamily: "system-ui, sans-serif",
          color: "#666",
        }}
      >
        Loading...
      </div>
    );
  }

  if (authRequired) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleLogin();
          }}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            padding: "32px",
            borderRadius: "12px",
            boxShadow: "0 2px 12px rgba(0,0,0,0.1)",
            background: "#fff",
            width: "320px",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "20px" }}>pi-kot Login</h2>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            autoFocus
            style={{
              padding: "10px 12px",
              borderRadius: "8px",
              border: "1px solid #d0d0d0",
              fontSize: "14px",
            }}
          />
          <button
            type="submit"
            style={{
              padding: "10px",
              borderRadius: "8px",
              border: "none",
              background: "#4a90d9",
              color: "#fff",
              fontWeight: 600,
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            Login
          </button>
        </form>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        fontFamily: "system-ui, -apple-system, sans-serif",
        margin: 0,
        padding: 0,
        overflow: "hidden",
      }}
    >
      {/* Sidebar */}
      <div
        style={{
          width: "260px",
          borderRight: "1px solid #e0e0e0",
          display: "flex",
          flexDirection: "column",
          background: "#fafafa",
        }}
      >
        <div
          style={{
            padding: "16px",
            borderBottom: "1px solid #e0e0e0",
            fontWeight: 700,
            fontSize: "16px",
            color: "#333",
          }}
        >
          pi-kot
        </div>

        <div style={{ padding: "8px" }}>
          <button
            onClick={createAndActivate}
            style={{
              width: "100%",
              padding: "10px",
              borderRadius: "8px",
              border: "1px dashed #4a90d9",
              background: "transparent",
              color: "#4a90d9",
              fontWeight: 600,
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            + New Session
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px" }}>
          {sessions.map((s: SessionSummary) => (
            <div
              key={s.sessionId}
              onClick={() => setActiveSession(s.sessionId)}
              style={{
                padding: "10px 12px",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "13px",
                color: activeSessionId === s.sessionId ? "#4a90d9" : "#555",
                background:
                  activeSessionId === s.sessionId ? "#e3f2fd" : "transparent",
                fontWeight: activeSessionId === s.sessionId ? 600 : 400,
                marginBottom: "2px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              Session {s.sessionId.slice(0, 8)}
            </div>
          ))}
        </div>
      </div>

      {/* Main chat area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {activeSessionId !== undefined ? (
          <>
            <ChatView sessionId={activeSessionId} />
            <ChatInput sessionId={activeSessionId} />
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#999",
              fontSize: "16px",
            }}
          >
            Select or create a session to start chatting
          </div>
        )}
      </div>
    </div>
  );
}
