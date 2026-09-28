import { useEffect, useState, useMemo } from "react";
import {
  Play,
  Square,
  Trash2,
  Terminal,
  Clock,
  Send,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import {
  useProcessesStore,
  selectProcesses,
  EMPTY_PROCESSES,
  LIVE_STATUSES,
  type ProcessInfo,
} from "../stores/processes-store";
import {
  listProcesses,
  killProcess,
  clearProcesses,
  getProcessOutput,
  sendProcessStdin,
} from "../lib/api-client";

interface Props {
  sessionId?: string;
}

function formatDuration(start: number, end: number | null): string {
  const endTime = end ?? Date.now();
  const diffSec = Math.max(0, Math.floor((endTime - start) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${mins}m ${secs}s`;
}

export function ProcessesPanel({ sessionId }: Props) {
  const processes = useProcessesStore((s) => (sessionId ? selectProcesses(s, sessionId) : EMPTY_PROCESSES));
  const setProcesses = useProcessesStore((s) => s.setProcesses);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [outputMap, setOutputMap] = useState<Record<string, { stdout: string[]; stderr: string[] }>>({});
  const [stdinInputs, setStdinInputs] = useState<Record<string, string>>({});
  const [loadingKill, setLoadingKill] = useState<Record<string, boolean>>({});
  const [loadingClear, setLoadingClear] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Update live uptime counter every second for running processes
  useEffect(() => {
    const hasRunning = processes.some((p) => LIVE_STATUSES.has(p.status));
    if (!hasRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [processes]);

  // Initial load
  useEffect(() => {
    if (!sessionId) return;
    void listProcesses(sessionId)
      .then((res) => {
        setProcesses(sessionId, res.processes);
      })
      .catch(() => {
        // best-effort
      });
  }, [sessionId, setProcesses]);

  // Polling output for expanded process
  useEffect(() => {
    if (!sessionId || !expandedId) return;
    const fetchOut = () => {
      void getProcessOutput(sessionId, expandedId)
        .then((res) => {
          setOutputMap((prev) => ({
            ...prev,
            [expandedId]: { stdout: res.stdout, stderr: res.stderr },
          }));
        })
        .catch(() => {});
    };

    fetchOut();
    const isLive = processes.find((p) => p.id === expandedId && LIVE_STATUSES.has(p.status));
    if (isLive) {
      const interval = setInterval(fetchOut, 2000);
      return () => clearInterval(interval);
    }
  }, [sessionId, expandedId, processes]);

  const { runningList, finishedList } = useMemo(() => {
    const running: ProcessInfo[] = [];
    const finished: ProcessInfo[] = [];
    for (const p of processes) {
      if (LIVE_STATUSES.has(p.status)) {
        running.push(p);
      } else {
        finished.push(p);
      }
    }
    return { runningList: running, finishedList: finished };
  }, [processes]);

  const handleKill = async (processId: string) => {
    if (!sessionId) return;
    setLoadingKill((prev) => ({ ...prev, [processId]: true }));
    try {
      await killProcess(sessionId, processId);
      const res = await listProcesses(sessionId);
      setProcesses(sessionId, res.processes);
    } catch {
      // handled
    } finally {
      setLoadingKill((prev) => ({ ...prev, [processId]: false }));
    }
  };

  const handleClearFinished = async () => {
    if (!sessionId) return;
    setLoadingClear(true);
    try {
      await clearProcesses(sessionId);
      const res = await listProcesses(sessionId);
      setProcesses(sessionId, res.processes);
    } catch {
      // handled
    } finally {
      setLoadingClear(false);
    }
  };

  const handleSendStdin = async (processId: string) => {
    if (!sessionId) return;
    const input = stdinInputs[processId];
    if (!input || input.trim() === "") return;

    try {
      await sendProcessStdin(sessionId, processId, input.endsWith("\n") ? input : input + "\n");
      setStdinInputs((prev) => ({ ...prev, [processId]: "" }));
      // refresh output
      const out = await getProcessOutput(sessionId, processId);
      setOutputMap((prev) => ({
        ...prev,
        [processId]: { stdout: out.stdout, stderr: out.stderr },
      }));
    } catch {
      // handled
    }
  };

  if (!sessionId) {
    return (
      <div style={{ padding: "16px", color: "var(--text-secondary)", textAlign: "center" }}>
        No active session.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "var(--bg-panel, var(--bg))",
      }}
    >
      {/* Header toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-glass)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
            Processes
          </span>
          {runningList.length > 0 && (
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                padding: "2px 7px",
                borderRadius: "10px",
                background: "rgba(16, 185, 129, 0.15)",
                color: "#10b981",
                border: "1px solid rgba(16, 185, 129, 0.3)",
              }}
            >
              {runningList.length} running
            </span>
          )}
        </div>

        {finishedList.length > 0 && (
          <button
            onClick={handleClearFinished}
            disabled={loadingClear}
            type="button"
            title="Clear finished processes"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 8px",
              fontSize: "11px",
              borderRadius: "6px",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            <Trash2 size={12} />
            <span>Clear finished</span>
          </button>
        )}
      </div>

      {/* Process list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
        {processes.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "40px 16px",
              color: "var(--text-muted, var(--text-secondary))",
              textAlign: "center",
              gap: "8px",
            }}
          >
            <Terminal size={32} strokeWidth={1.5} style={{ opacity: 0.5 }} />
            <div style={{ fontSize: "13px", fontWeight: 500 }}>No background processes</div>
            <div style={{ fontSize: "12px", opacity: 0.8, maxWidth: "260px" }}>
              Ask the agent to start long-running commands, dev servers, or watchers in the background.
            </div>
          </div>
        ) : (
          <>
            {/* Running processes */}
            {runningList.map((proc) => {
              const isExpanded = expandedId === proc.id;
              const out = outputMap[proc.id];
              const isKilling = loadingKill[proc.id];

              return (
                <div
                  key={proc.id}
                  style={{
                    borderRadius: "8px",
                    border: "1px solid rgba(16, 185, 129, 0.3)",
                    background: "var(--bg-card, rgba(255,255,255,0.03))",
                    overflow: "hidden",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                  }}
                >
                  {/* Process card header */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      cursor: "pointer",
                      gap: "8px",
                    }}
                    onClick={() => setExpandedId(isExpanded ? null : proc.id)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: "#10b981",
                          boxShadow: "0 0 6px #10b981",
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
                            {proc.name}
                          </span>
                          <span
                            style={{
                              fontSize: "10px",
                              padding: "1px 5px",
                              borderRadius: "4px",
                              background: "rgba(255,255,255,0.06)",
                              color: "var(--text-secondary)",
                            }}
                          >
                            PID {proc.pid}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: "11px",
                            fontFamily: "monospace",
                            color: "var(--text-secondary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {proc.command}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                      <span
                        style={{
                          fontSize: "11px",
                          color: "var(--text-secondary)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "3px",
                        }}
                      >
                        <Clock size={11} />
                        {formatDuration(proc.startTime, null)}
                      </span>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleKill(proc.id);
                        }}
                        disabled={isKilling}
                        type="button"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          padding: "3px 8px",
                          fontSize: "11px",
                          fontWeight: 500,
                          borderRadius: "4px",
                          border: "1px solid rgba(239, 68, 68, 0.4)",
                          background: "rgba(239, 68, 68, 0.1)",
                          color: "#ef4444",
                          cursor: isKilling ? "default" : "pointer",
                        }}
                      >
                        <Square size={10} fill="#ef4444" />
                        <span>{isKilling ? "Stopping..." : "Kill"}</span>
                      </button>

                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </div>
                  </div>

                  {/* Expanded output tail */}
                  {isExpanded && (
                    <div
                      style={{
                        borderTop: "1px solid var(--border)",
                        padding: "10px",
                        background: "rgba(0,0,0,0.25)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "6px",
                        }}
                      >
                        <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 500 }}>
                          Live Log Output:
                        </span>
                        <button
                          onClick={() => {
                            void getProcessOutput(sessionId, proc.id).then((res) => {
                              setOutputMap((prev) => ({
                                ...prev,
                                [proc.id]: { stdout: res.stdout, stderr: res.stderr },
                              }));
                            });
                          }}
                          type="button"
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--text-secondary)",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            fontSize: "11px",
                          }}
                        >
                          <RefreshCw size={11} /> Refresh
                        </button>
                      </div>

                      <div
                        style={{
                          fontFamily: "monospace",
                          fontSize: "11px",
                          lineHeight: "1.4",
                          maxHeight: "180px",
                          overflowY: "auto",
                          padding: "8px",
                          borderRadius: "4px",
                          background: "#0d0d0d",
                          color: "#e5e5e5",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                        }}
                      >
                        {(!out || (out.stdout.length === 0 && out.stderr.length === 0)) ? (
                          <span style={{ color: "#666" }}>(waiting for output...)</span>
                        ) : (
                          <>
                            {out.stdout.map((l, i) => (
                              <div key={"out-" + i}>{l}</div>
                            ))}
                            {out.stderr.map((l, i) => (
                              <div key={"err-" + i} style={{ color: "#f87171" }}>
                                {l}
                              </div>
                            ))}
                          </>
                        )}
                      </div>

                      {/* Stdin input bar */}
                      <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                        <input
                          type="text"
                          placeholder="Send input to stdin..."
                          value={stdinInputs[proc.id] ?? ""}
                          onChange={(e) =>
                            setStdinInputs((prev) => ({ ...prev, [proc.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              void handleSendStdin(proc.id);
                            }
                          }}
                          style={{
                            flex: 1,
                            fontSize: "11px",
                            fontFamily: "monospace",
                            padding: "4px 8px",
                            borderRadius: "4px",
                            border: "1px solid var(--border)",
                            background: "rgba(255,255,255,0.05)",
                            color: "var(--text-primary)",
                            outline: "none",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => void handleSendStdin(proc.id)}
                          style={{
                            padding: "4px 8px",
                            fontSize: "11px",
                            borderRadius: "4px",
                            border: "1px solid var(--border)",
                            background: "var(--accent)",
                            color: "#fff",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <Send size={11} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Finished processes */}
            {finishedList.map((proc) => {
              const isExpanded = expandedId === proc.id;
              const out = outputMap[proc.id];

              return (
                <div
                  key={proc.id}
                  style={{
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "var(--bg-card, rgba(255,255,255,0.02))",
                    overflow: "hidden",
                    opacity: 0.85,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      cursor: "pointer",
                      gap: "8px",
                    }}
                    onClick={() => setExpandedId(isExpanded ? null : proc.id)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                      {proc.success ? (
                        <CheckCircle size={14} color="#10b981" />
                      ) : (
                        <AlertCircle size={14} color={proc.status === "killed" ? "#9ca3af" : "#ef4444"} />
                      )}
                      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>
                            {proc.name}
                          </span>
                          <span
                            style={{
                              fontSize: "10px",
                              padding: "1px 5px",
                              borderRadius: "4px",
                              background: "rgba(255,255,255,0.06)",
                              color: "var(--text-secondary)",
                            }}
                          >
                            {proc.status} (exit {proc.exitCode ?? "?"})
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: "11px",
                            fontFamily: "monospace",
                            color: "var(--text-secondary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {proc.command}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                      <span
                        style={{
                          fontSize: "11px",
                          color: "var(--text-secondary)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "3px",
                        }}
                      >
                        <Clock size={11} />
                        {formatDuration(proc.startTime, proc.endTime)}
                      </span>

                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div
                      style={{
                        borderTop: "1px solid var(--border)",
                        padding: "10px",
                        background: "rgba(0,0,0,0.25)",
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "monospace",
                          fontSize: "11px",
                          lineHeight: "1.4",
                          maxHeight: "160px",
                          overflowY: "auto",
                          padding: "8px",
                          borderRadius: "4px",
                          background: "#0d0d0d",
                          color: "#e5e5e5",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                        }}
                      >
                        {(!out || (out.stdout.length === 0 && out.stderr.length === 0)) ? (
                          <span style={{ color: "#666" }}>(no log lines captured)</span>
                        ) : (
                          <>
                            {out.stdout.map((l, i) => (
                              <div key={"out-" + i}>{l}</div>
                            ))}
                            {out.stderr.map((l, i) => (
                              <div key={"err-" + i} style={{ color: "#f87171" }}>
                                {l}
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
