import { useState, useEffect } from "react";
import { getVersions, checkSdkUpdate } from "../../lib/api-client";
import { errorMsg } from "./shared";

export function GeneralTab() {
  const [versions, setVersions] = useState<{ serverVersion: string; sdkVersion: string } | undefined>(undefined);
  const [checkResult, setCheckResult] = useState<{
    latestSdkVersion: string;
    updateAvailable: boolean;
    error?: string;
  } | undefined>(undefined);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    getVersions()
      .then(setVersions)
      .catch(() => {});
  }, []);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setCheckResult(undefined);
    try {
      const res = await checkSdkUpdate();
      setCheckResult({
        latestSdkVersion: res.latestSdkVersion,
        updateAvailable: res.updateAvailable,
      });
    } catch (err) {
      setCheckResult({ latestSdkVersion: "?", updateAvailable: false, error: errorMsg(err) });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="settings-fields">
      <div className="settings-field">
        <label className="settings-label">About</label>
        <p className="settings-hint">
          pi-kot — a web UI for the pi coding agent.
        </p>
      </div>

      <hr className="settings-divider" />

      <div className="settings-field">
        <label className="settings-label">Versions</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
          <div style={{ display: "flex", gap: 16, fontSize: 13, alignItems: "center" }}>
            <span style={{ color: "var(--text-secondary)", minWidth: 100 }}>pi-kot server</span>
            <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>
              {versions?.serverVersion ?? "…"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 13, alignItems: "center" }}>
            <span style={{ color: "var(--text-secondary)", minWidth: 100 }}>pi SDK</span>
            <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>
              {versions?.sdkVersion ?? "…"}
            </span>
          </div>
          {checkResult !== undefined && (
            <div style={{ display: "flex", gap: 16, fontSize: 13, alignItems: "center" }}>
              <span style={{ color: "var(--text-secondary)", minWidth: 100 }}>Latest SDK</span>
              <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>
                {checkResult.error !== undefined ? (
                  <span style={{ color: "var(--danger, #e74c3c)" }}>Check failed</span>
                ) : (
                  checkResult.latestSdkVersion
                )}
              </span>
              {checkResult.error === undefined && checkResult.updateAvailable && (
                <span style={{
                  fontSize: 11,
                  color: "#fff",
                  background: "var(--accent-text, #3b82f6)",
                  padding: "1px 8px",
                  borderRadius: 4,
                  fontWeight: 600,
                }}>
                  Update available
                </span>
              )}
              {checkResult.error === undefined && !checkResult.updateAvailable && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Up to date</span>
              )}
            </div>
          )}
          {checkResult?.error !== undefined && (
            <p style={{ fontSize: 12, color: "var(--danger, #e74c3c)", margin: 0 }}>
              {checkResult.error}
            </p>
          )}
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <button
            onClick={() => void handleCheckUpdate()}
            disabled={checking}
            className="settings-btn"
          >
            {checking ? "Checking…" : checkResult !== undefined ? "Check again" : "Check for updates"}
          </button>
        </div>
      </div>

      <hr className="settings-divider" />

      <div className="settings-field">
        <button
          onClick={() => window.location.reload()}
          className="settings-btn"
        >
          Reload page
        </button>
      </div>
    </div>
  );
}
