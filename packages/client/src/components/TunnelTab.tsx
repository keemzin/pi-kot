/**
 * Tunnel Tab — ngrok tunnel management for the Settings panel.
 */
import { useEffect, useState, useCallback } from "react";
import {
  checkTunnel,
  doctorTunnel,
  getTunnelStatus,
  startTunnel,
  stopTunnel,
  type TunnelCheckResponse,
  type TunnelDoctorResponse,
  type TunnelStatusResponse,
} from "../lib/api-client";

type TunnelState = "idle" | "starting" | "stopping" | "error";

const STATUS_COLORS: Record<string, string> = {
  pass: "var(--accent-green, #98c379)",
  fail: "var(--accent-red, #e06c75)",
  warn: "var(--accent-yellow, #e5c07b)",
};

function StatusDot({ status }: { status: string }) {
  return (
    <span style={{
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: STATUS_COLORS[status] ?? "var(--text-dim)",
      flexShrink: 0,
      display: "inline-block",
    }} />
  );
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const color = STATUS_COLORS[status] ?? "var(--text-dim)";
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "3px 10px",
      borderRadius: 4,
      fontSize: 12,
      fontWeight: 500,
      color,
      background: `color-mix(in srgb, ${color} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
    }}>
      <StatusDot status={status} />
      {label}
    </span>
  );
}

function copyToClipboard(text: string): Promise<void> {
  // Preferred: async clipboard API (requires secure context)
  if (typeof navigator?.clipboard?.writeText === "function") {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
}

function fallbackCopy(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      resolve();
    } catch {
      reject(new Error("clipboard fallback failed"));
    }
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <button
      onClick={async () => {
        setFailed(false);
        try {
          await copyToClipboard(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setFailed(true);
          setTimeout(() => setFailed(false), 2000);
        }
      }}
      style={{
        background: "var(--bg-glass)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: 11,
        cursor: "pointer",
        color: failed ? "var(--accent-red, #e06c75)" : copied ? "var(--accent-green, #98c379)" : "var(--text-dim)",
        whiteSpace: "nowrap",
      }}
      title="Copy URL"
    >
      {failed ? "Failed" : copied ? "Copied!" : "Copy"}
    </button>
  );
}

export function TunnelTab() {
  const [check, setCheck] = useState<TunnelCheckResponse | null>(null);
  const [doctor, setDoctor] = useState<TunnelDoctorResponse | null>(null);
  const [status, setStatus] = useState<TunnelStatusResponse | null>(null);
  const [tunnelState, setTunnelState] = useState<TunnelState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [c, d, s] = await Promise.all([
        checkTunnel(),
        doctorTunnel(),
        getTunnelStatus(),
      ]);
      setCheck(c);
      setDoctor(d);
      setStatus(s);
      setRunning(s.active);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tunnel info");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleStart = async () => {
    setTunnelState("starting");
    setError(null);
    try {
      const result = await startTunnel();
      setRunning(true);
      setStatus({
        active: true,
        url: result.url,
        mode: result.mode,
        provider: result.provider,
        providerMetadata: result.providerMetadata,
        localPort: result.localPort,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start tunnel");
    } finally {
      setTunnelState("idle");
    }
  };

  const handleStop = async () => {
    setTunnelState("stopping");
    setError(null);
    try {
      await stopTunnel();
      setRunning(false);
      setStatus((prev) => prev ? { ...prev, active: false, url: null } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop tunnel");
    } finally {
      setTunnelState("idle");
    }
  };

  const ngrokInstalled = check?.available ?? false;

  return (
    <div className="settings-section" style={{ padding: "20px 24px" }}>
      <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>
        Ngrok Tunnel
      </h3>

      {/* Installation status */}
      <div style={{
        background: "var(--bg-frosted)",
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Status</span>
          <StatusBadge
            status={ngrokInstalled ? "pass" : "fail"}
            label={ngrokInstalled ? "ngrok installed" : "ngrok not installed"}
          />
        </div>
        {check && (
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>
            {check.version && <div>Version: {check.version}</div>}
            {!ngrokInstalled && check.installCommand && (
              <div style={{ marginTop: 8 }}>
                <span>Install: </span>
                <code style={{
                  background: "var(--bg-glass)",
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontSize: 12,
                }}>
                  {check.installCommand}
                </code>
                {check.installUrl && (
                  <span style={{ marginLeft: 8 }}>
                    <a
                      href={check.installUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--accent)" }}
                    >
                      Download
                    </a>
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Diagnostics */}
      {doctor && (
        <div style={{
          background: "var(--bg-frosted)",
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>
            Diagnostics
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {doctor.providerChecks.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, flexWrap: "wrap" }}>
                <StatusBadge status={c.status} label={c.label} />
                <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
                  {c.detail}
                </span>
              </div>
            ))}
          </div>
          {doctor.modes.map((mode) => (
            <div key={mode.mode} style={{ marginTop: 10 }}>
              <div style={{
                fontSize: 12,
                fontWeight: 500,
                marginBottom: 6,
                textTransform: "capitalize",
              }}>
                {mode.mode} mode
              </div>
              {mode.blockers.length > 0 && (
                <div style={{ fontSize: 11, color: "var(--accent-red, #e06c75)" }}>
                  Blockers: {mode.blockers.join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Active tunnel */}
      {running && status?.url && (
        <div style={{
          background: "var(--bg-frosted)",
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
          border: "1px solid var(--accent-green, #98c379)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "var(--accent-green, #98c379)",
            }} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>Tunnel Active</span>
          </div>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            fontFamily: "var(--font-mono, monospace)",
            color: "var(--text-primary)",
          }}>
            <span>{status.url}</span>
            <CopyButton text={status.url} />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
            Provider: {status.provider} · Mode: {status.mode}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: "var(--bg-frosted)",
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
          border: "1px solid var(--accent-red, #e06c75)",
          fontSize: 12,
          color: "var(--accent-red, #e06c75)",
        }}>
          {error}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleStart}
          disabled={!ngrokInstalled || running || tunnelState === "starting" || tunnelState === "stopping"}
          className="settings-tab settings-tab-active"
          style={{
            padding: "8px 20px",
            fontSize: 13,
            fontWeight: 500,
            border: running ? "1px solid var(--accent-green, #98c379)" : "none",
            borderRadius: 6,
            cursor: !ngrokInstalled || running || tunnelState !== "idle" ? "not-allowed" : "pointer",
            opacity: !ngrokInstalled || running || tunnelState !== "idle" ? 0.5 : 1,
            background: running
              ? "var(--bg-glass)"
              : "var(--accent)",
            color: running
              ? "var(--accent-green, #98c379)"
              : "#fff",
          }}
        >
          {tunnelState === "starting"
            ? "Starting..."
            : running
              ? "Tunnel Active"
              : "Start Tunnel"}
        </button>
        <button
          onClick={handleStop}
          disabled={!running || tunnelState !== "idle"}
          className="settings-tab"
          style={{
            padding: "8px 20px",
            fontSize: 13,
            fontWeight: 500,
            border: "1px solid var(--accent-red, #e06c75)",
            borderRadius: 6,
            cursor: !running || tunnelState !== "idle" ? "not-allowed" : "pointer",
            opacity: !running || tunnelState !== "idle" ? 0.5 : 1,
            background: "var(--bg-glass)",
            color: "var(--accent-red, #e06c75)",
          }}
        >
          {tunnelState === "stopping" ? "Stopping..." : "Stop Tunnel"}
        </button>
        <button
          onClick={refresh}
          className="settings-tab"
          style={{
            padding: "8px 12px",
            fontSize: 12,
            border: "1px solid var(--border)",
            borderRadius: 6,
            cursor: "pointer",
            background: "var(--bg-glass)",
            color: "var(--text-dim)",
          }}
          title="Refresh"
        >
          ↻
        </button>
      </div>
    </div>
  );
}
