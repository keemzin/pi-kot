import { useEffect, useState, useCallback } from "react";
import { LoadingSkeleton } from "./LoadingSkeleton";
import type {
  OrchestrationConfig,
  WorkerListItem,
  InboxItem,
} from "../lib/api-client";
import {
  fetchOrchestrationConfig,
  getSessionOrchestrationRole,
  enableSupervisorUI,
  disableSupervisorUI,
  listWorkers,
  fetchInbox,
  clearInboxUI,
  killWorkerUI,
  detachWorkerUI,
  resumeWorkerUI,
} from "../lib/api-client";

interface Props {
  sessionId: string;
  open: boolean;
  onClose: () => void;
}

type Role = "supervisor" | "worker" | "standalone" | "loading";

export function OrchestrationPanel({ sessionId, open, onClose }: Props) {
  const [config, setConfig] = useState<OrchestrationConfig | null>(null);
  const [role, setRole] = useState<Role>("loading");
  const [workers, setWorkers] = useState<WorkerListItem[]>([]);
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const cfg = await fetchOrchestrationConfig();
      setConfig(cfg);
      if (cfg.available === false) return;

      const roleData = await getSessionOrchestrationRole(sessionId);
      setRole(roleData.role);

      if (roleData.role === "supervisor") {
        const [w, i] = await Promise.all([
          listWorkers(sessionId),
          fetchInbox(sessionId),
        ]);
        setWorkers(w.workers);
        setInboxItems(i.items);
        setInboxCount(i.count);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [sessionId]);

  useEffect(() => {
    if (!open) return;
    loadData();
    const interval = setInterval(loadData, 4000);
    return () => clearInterval(interval);
  }, [open, loadData]);

  const handleEnable = async () => {
    setEnabling(true);
    setError(null);
    try {
      await enableSupervisorUI(sessionId);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setEnabling(false);
  };

  const handleDisable = async () => {
    setError(null);
    try {
      await disableSupervisorUI(sessionId);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleKill = async (workerId: string) => {
    try {
      await killWorkerUI(sessionId, workerId);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDetach = async (workerId: string) => {
    try {
      await detachWorkerUI(sessionId, workerId);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleResume = async (workerId: string) => {
    try {
      await resumeWorkerUI(sessionId, workerId);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!open) return null;

  if (config?.available === false) {
    return (
      <div
        style={{
          padding: "12px 16px",
          fontSize: "12px",
          color: "var(--text-dim)",
          borderBottom: "1px solid var(--border-color)",
        }}
      >
        🚫 Orchestration unavailable: {config.disabledReason ?? "disabled"}
      </div>
    );
  }

  const pendingCount = inboxItems.filter((i) => !i.delivered).length;

  return (
    <div
      style={{
        padding: "10px 16px",
        fontSize: "12px",
        color: "var(--text-secondary)",
        borderBottom: "1px solid var(--border-color)",
        background: "var(--bg-secondary)",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        maxWidth: 800,
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "13px" }}>
          ⚡ Orchestration
        </span>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-dim)",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          ✕
        </button>
      </div>

      {role === "loading" && <LoadingSkeleton variant="list" count={2} />}

      {role === "standalone" && (
        <div
          style={{
            display: "flex",
            gap: "8px",
            alignItems: "center",
          }}
        >
          <span>Session is standalone.</span>
          <button
            type="button"
            onClick={handleEnable}
            disabled={enabling}
            style={{
              padding: "4px 10px",
              fontSize: "11px",
              fontWeight: 600,
              background: "var(--accent-bg)",
              color: "var(--accent-text)",
              border: "1px solid var(--accent-border)",
              borderRadius: "var(--radius-sm)",
              cursor: enabling ? "wait" : "pointer",
            }}
          >
            {enabling ? "Enabling..." : "Enable supervisor mode"}
          </button>
        </div>
      )}

      {role === "supervisor" && (
        <>
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span style={{ color: "var(--accent-text)", fontWeight: 500 }}>
              ✅ Supervisor active
            </span>
            <span style={{ color: "var(--text-dim)" }}>
              {workers.length} worker(s)
              {pendingCount > 0 && (
                <span style={{ color: "#e5c07b", marginLeft: "4px" }}>
                  · {pendingCount} pending inbox
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={handleDisable}
              style={{
                padding: "3px 8px",
                fontSize: "11px",
                background: "none",
                color: "var(--text-dim)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
              }}
            >
              Disable
            </button>
          </div>

          {workers.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {workers.map((w) => (
                <div
                  key={w.workerId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "11px",
                    padding: "4px 6px",
                    background: "var(--bg-primary)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: w.isLive
                        ? w.state === "running" || w.state === "streaming"
                          ? "#98c379"
                          : w.state === "awaiting_question"
                            ? "#e5c07b"
                            : w.state === "errored"
                              ? "#e06c75"
                              : "#56b6c2"
                        : "#5c6370",
                      display: "inline-block",
                    }}
                  />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {w.name ?? w.workerId.slice(0, 8)}
                  </span>
                  <span style={{ color: "var(--text-dim)" }}>{w.state}</span>
                  {!w.isLive && (
                    <button
                      type="button"
                      onClick={() => handleResume(w.workerId)}
                      style={{
                        padding: "1px 5px",
                        fontSize: "10px",
                        background: "none",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        cursor: "pointer",
                      }}
                    >
                      Resume
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDetach(w.workerId)}
                    title="Detach"
                    style={{
                      padding: "1px 5px",
                      fontSize: "10px",
                      background: "none",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                    }}
                  >
                    Detach
                  </button>
                  <button
                    type="button"
                    onClick={() => handleKill(w.workerId)}
                    title="Kill"
                    style={{
                      padding: "1px 5px",
                      fontSize: "10px",
                      background: "none",
                      border: "1px solid #e06c75",
                      color: "#e06c75",
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                    }}
                  >
                    Kill
                  </button>
                </div>
              ))}
            </div>
          )}

          {pendingCount > 0 && (
            <div
              style={{
                fontSize: "11px",
                padding: "4px 6px",
                background: "var(--bg-primary)",
                borderRadius: "var(--radius-sm)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>{pendingCount} undelivered inbox item(s)</span>
              <button
                type="button"
                onClick={async () => {
                  await clearInboxUI(sessionId);
                  await loadData();
                }}
                style={{
                  padding: "1px 5px",
                  fontSize: "10px",
                  background: "none",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                }}
              >
                Clear inbox
              </button>
            </div>
          )}
        </>
      )}

      {role === "worker" && (
        <span>This session is a worker. Orchestration is managed by the supervisor.</span>
      )}

      {error !== null && (
        <div style={{ color: "#e06c75", fontSize: "11px" }}>Error: {error}</div>
      )}
    </div>
  );
}
