/**
 * RewindModal — invokes the pi-rewind extension's `/rewind` command
 * via the extension command bridge.
 *
 * The extension handles everything: checkpoint listing, mode selection,
 * git restore, and conversation navigation. All UI interactions flow
 * through SSE bridge events (extension_ui_select / extension_ui_confirm
 * / extension_ui_notify / extension_ui_done), which the
 * ExtensionUIInteractionModal renders in the app overlay.
 *
 * This modal is just a trigger — it fires the command and closes.
 * The ExtensionUIInteractionModal takes over from there.
 */

import { useState } from "react";
import { invokeExtensionCommand } from "../lib/api-client";

interface Props {
  sessionId: string;
  onClose: () => void;
}

export function RewindModal({ sessionId, onClose }: Props) {
  const [invoking, setInvoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRewind = async () => {
    setInvoking(true);
    setError(null);
    try {
      const result = await invokeExtensionCommand(sessionId, "rewind");
      if (!result.accepted) {
        setError("Command was rejected by the server");
        setInvoking(false);
        return;
      }
      // Close the modal — the ExtensionUIInteractionModal will handle
      // the interactive flow via SSE bridge events.
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInvoking(false);
    }
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel rewind-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 420, maxWidth: "92vw", height: "auto", minHeight: 120, maxHeight: "80vh" }}
      >
        <header className="settings-header">
          <span style={{ fontSize: 14, fontWeight: 600 }}>↩️ Rewind</span>
          <button onClick={onClose} className="settings-close" title="Close">
            ✕
          </button>
        </header>

        <div className="settings-body" style={{ padding: "16px", textAlign: "center" }}>
          {error !== null ? (
            <>
              <div style={{ fontSize: 12, color: "var(--accent-red)", marginBottom: 12 }}>
                Error: {error}
              </div>
              <button
                onClick={() => { setError(null); setInvoking(false); }}
                className="settings-tab"
                style={{ padding: "6px 14px", fontSize: 12 }}
              >
                Retry
              </button>
            </>
          ) : invoking ? (
            <div style={{ fontSize: 12, color: "var(--text-dim)", padding: 20 }}>
              Launching pi-rewind…
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.5 }}>
                This will launch the <strong>pi-rewind</strong> extension.
                It will walk you through picking a checkpoint and choosing a restore mode.
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <button
                  onClick={onClose}
                  className="settings-tab"
                  style={{ padding: "6px 14px", fontSize: 12 }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleRewind}
                  className="settings-tab settings-tab-active"
                  style={{
                    padding: "6px 14px",
                    fontSize: 12,
                    background: "var(--accent-red, #e06c75)",
                    color: "#fff",
                    border: "none",
                  }}
                >
                  ↩️ Rewind
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
