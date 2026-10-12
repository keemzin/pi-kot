import { useEffect, useState, useCallback, useRef } from "react";
import {
  Zap,
  X,
  Play,
  Unlink,
  Trash2,
  AlertCircle,
  Inbox,
  CheckCircle2,
} from "lucide-react";
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
  const [error, setError] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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

  // Click outside and Escape key dismissal
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.(".orch-popover-anchor")) return;
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const timeout = setTimeout(() => {
      window.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleClickOutside);
      clearTimeout(timeout);
    };
  }, [open, onClose]);

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

  const pendingCount = inboxItems.filter((i) => !i.delivered).length;

  return (
    <div
      ref={panelRef}
      className="orchestration-popover-card"
      role="dialog"
      aria-label="Subagent Orchestration"
    >
      {/* Popover Header */}
      <div className="orch-popover-header">
        <div className="orch-popover-title-row">
          <Zap size={14} className="orch-title-icon" />
          <span className="orch-popover-title">Subagents</span>
          <span className={`orch-role-pill ${role}`}>
            {role === "supervisor" && "Supervisor"}
            {role === "worker" && "Worker"}
            {role === "standalone" && "Standalone"}
            {role === "loading" && "Loading..."}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="orch-popover-close-btn"
          title="Close (Esc)"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      {config?.available === false && (
        <div className="orch-unavailable-notice">
          <AlertCircle size={14} className="orch-notice-icon" />
          <span>Orchestration unavailable: {config.disabledReason ?? "disabled"}</span>
        </div>
      )}

      {role === "loading" && <LoadingSkeleton variant="list" count={2} />}

      {role === "standalone" && config?.available !== false && (
        <div className="orch-standalone-body">
          <div className="orch-standalone-desc">
            <span className="orch-desc-title">Session is Standalone</span>
            <span className="orch-desc-sub">
              Enable supervisor mode to spawn, coordinate, and delegate tasks to background worker subagents.
            </span>
          </div>
          <button
            type="button"
            className="orch-enable-btn"
            onClick={handleEnable}
            disabled={enabling}
          >
            <Zap size={13} fill="currentColor" />
            <span>{enabling ? "Enabling Supervisor..." : "Enable Supervisor Mode"}</span>
          </button>
        </div>
      )}

      {role === "supervisor" && (
        <div className="orch-supervisor-body">
          {/* Status and Action summary */}
          <div className="orch-supervisor-summary">
            <div className="orch-stat-col">
              <div className="orch-supervisor-badge">
                <CheckCircle2 size={12} style={{ color: "#98c379" }} />
                <span>Active</span>
              </div>
              <span className="orch-stat-label">
                {workers.length} {workers.length === 1 ? "worker" : "workers"}
              </span>
            </div>
            {pendingCount > 0 && (
              <div className="orch-stat-col">
                <span className="orch-stat-num orch-stat-amber">{pendingCount}</span>
                <span className="orch-stat-label">Pending Inbox</span>
              </div>
            )}
            <button
              type="button"
              className="orch-disable-btn"
              onClick={handleDisable}
              title="Disable supervisor mode for this session"
            >
              Disable
            </button>
          </div>

          {/* Workers list */}
          {workers.length > 0 ? (
            <div className="orch-worker-list">
              <div className="orch-section-label">WORKER SUBAGENTS</div>
              {workers.map((w) => {
                const isRunning = w.isLive && (w.state === "running" || w.state === "streaming");
                const isWaiting = w.state === "awaiting_question";
                const isErrored = w.state === "errored";
                const dotColor = !w.isLive
                  ? "#5c6370"
                  : isRunning
                    ? "#98c379"
                    : isWaiting
                      ? "#e5c07b"
                      : isErrored
                        ? "#e06c75"
                        : "#56b6c2";

                return (
                  <div key={w.workerId} className="orch-worker-card">
                    <div className="orch-worker-info">
                      <span
                        className={`orch-worker-status-dot${isRunning ? " running" : ""}`}
                        style={{ background: dotColor }}
                      />
                      <span className="orch-worker-name" title={w.workerId}>
                        {w.name ?? w.workerId.slice(0, 8)}
                      </span>
                      <span className="orch-worker-state-tag">{w.state}</span>
                    </div>
                    <div className="orch-worker-btn-group">
                      {!w.isLive && (
                        <button
                          type="button"
                          onClick={() => handleResume(w.workerId)}
                          className="orch-worker-action-btn"
                          title="Resume worker"
                        >
                          <Play size={10} style={{ marginRight: 2 }} />
                          Resume
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDetach(w.workerId)}
                        className="orch-worker-action-btn"
                        title="Detach worker"
                      >
                        <Unlink size={10} style={{ marginRight: 2 }} />
                        Detach
                      </button>
                      <button
                        type="button"
                        onClick={() => handleKill(w.workerId)}
                        className="orch-worker-action-btn danger"
                        title="Terminate worker"
                      >
                        <Trash2 size={10} style={{ marginRight: 2 }} />
                        Kill
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="orch-empty-workers">
              No subagent workers running. Workers will appear here when spawned by the supervisor.
            </div>
          )}

          {/* Inbox items */}
          {pendingCount > 0 && (
            <div className="orch-inbox-alert">
              <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <Inbox size={12} style={{ color: "#e5c07b" }} />
                <span>{pendingCount} undelivered inbox item(s)</span>
              </div>
              <button
                type="button"
                className="orch-inbox-clear-btn"
                onClick={async () => {
                  await clearInboxUI(sessionId);
                  await loadData();
                }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {role === "worker" && (
        <div className="orch-worker-desc">
          <span className="orch-desc-title">Worker Subagent</span>
          <span className="orch-desc-sub">
            This session is operating as a worker. Orchestration is managed upstream by the supervisor.
          </span>
        </div>
      )}

      {error !== null && (
        <div className="orch-error-alert">
          <AlertCircle size={12} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
