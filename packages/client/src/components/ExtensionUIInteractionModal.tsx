/**
 * ExtensionUIInteractionModal — renders extension UI bridge interactions
 * (select, confirm, input) as modal dialogs in the web GUI.
 *
 * When an extension command calls `ctx.ui.select()` / `ctx.ui.confirm()`
 * / `ctx.ui.input()`, the server sends an SSE event with type
 * `extension_ui_select` etc. The extension-ui-store captures it and this
 * component renders the appropriate dialog, collects user input, and
 * responds via `POST /extension-ui/respond`.
 */

import { useCallback, useEffect, useState } from "react";
import { useExtensionUIStore, type ExtensionUIEvent } from "../stores/extension-ui-store";
import { respondExtensionUI } from "../lib/api-client";

interface Props {
  sessionId: string;
}

export function ExtensionUIInteractionModal({ sessionId }: Props) {
  const activeInteraction = useExtensionUIStore((s) => s.activeInteraction);
  const clearInteraction = useExtensionUIStore((s) => s.clearInteraction);
  const cancelCommand = useExtensionUIStore((s) => s.cancelCommand);
  const commandRunning = useExtensionUIStore((s) => s.commandRunning);
  const [inputValue, setInputValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Cancel: tell the server the user dismissed, then clear client state.
  // Without the server cancel, the pending promise stays alive for 2 minutes
  // before timing out — leaving "Extension command running…" visible.
  const handleCancel = useCallback(() => {
    const inter = useExtensionUIStore.getState().activeInteraction;
    if (inter && 'requestId' in inter) {
      const reqId = (inter as { requestId: string }).requestId;
      respondExtensionUI(sessionId, reqId, "").catch(() => {});
    }
    cancelCommand();
  }, [sessionId, cancelCommand]);

  // Reset local state when interaction changes
  useEffect(() => {
    setInputValue("");
    setSelectedIndex(0);
  }, [activeInteraction?.type]);

  if (activeInteraction === undefined && !commandRunning) return null;

  // ── Not running + no interaction = stale state, don't show ──
  if (!commandRunning && activeInteraction === undefined) return null;

  // ── Handle select — server sends prefixed type "extension_ui_select"
  //    (store stores original prefixed type; TS type has short name — cast at runtime)
  const evType = (activeInteraction as { type: string } | undefined)?.type ?? "";
  if (evType === "extension_ui_select") { 
    const ev = activeInteraction as ExtensionUIEvent & { type: string; requestId: string; title: string; options: string[] };
    return (
      <div className="settings-overlay" onClick={handleCancel}>
        <div
          className="settings-panel rewind-panel"
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 520,
            maxWidth: "92vw",
            height: "auto",
            maxHeight: "80vh",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <header className="settings-header">
            <span style={{ fontSize: 14, fontWeight: 600 }}>{ev.title}</span>
            <button onClick={handleCancel} className="settings-close" title="Cancel">
              ✕
            </button>
          </header>
          <div className="settings-body" style={{ padding: "12px 16px", overflowY: "auto", flex: 1 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {ev.options.map((option, i) => {
                // Parse multi-line checkpoint items: first line is the label, rest is detail
                const lines = option.split("\n").filter(Boolean);
                const label = lines[0] ?? option;
                // Strip ANSI escape codes — browsers don't interpret them
                const detail = lines.slice(1).join(" ").trim().replace(/\u001b\[[0-9;]*m/g, '');
                return (
                  <button
                    key={i}
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        // Send the FULL option string — pi-rewind uses
                        // items.indexOf(selected) to find the checkpoint.
                        await respondExtensionUI(sessionId, ev.requestId, option);
                      } catch (err) {
                        console.error("Extension UI respond failed:", err);
                      }
                      // Don't clearInteraction here — the next interaction's
                      // SSE event would be cleared by the finally block.
                      // The overlay's onClick handles stale-state cleanup.
                    }}
                    onMouseEnter={() => setSelectedIndex(i)}
                    style={{
                      display: "flex",
                      width: "100%",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: i === selectedIndex ? "1px solid var(--accent-border)" : "1px solid transparent",
                      background: i === selectedIndex ? "var(--accent-subtle)" : "none",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 11,
                      fontFamily: "inherit",
                      color: "var(--text-primary)",
                      transition: "background 0.15s",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: "var(--bg-glass-hover)",
                        color: "var(--text-dim)",
                        fontSize: 10,
                        fontWeight: 700,
                        flexShrink: 0,
                        marginTop: 1,
                      }}
                    >
                      {i + 1}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {label}
                      </div>
                      {detail && (
                        <div
                          style={{
                            fontSize: 10,
                            color: "var(--text-dim)",
                            marginTop: 2,
                            fontFamily: "monospace",
                          }}
                        >
                          {detail}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ padding: "8px 16px", borderTop: "1px solid var(--border-color)", fontSize: 10, color: "var(--text-dim)", textAlign: "center" }}>
            Select an option above
          </div>
        </div>
      </div>
    );
  }

  // ── Handle confirm ──
  // ── Handle confirm
  if (evType === "extension_ui_confirm") {
    const ev = activeInteraction as ExtensionUIEvent & { type: string; requestId: string; title: string; message: string };
    return (
      <div className="settings-overlay" onClick={handleCancel}>
        <div
          className="settings-panel rewind-panel"
          onClick={(e) => e.stopPropagation()}
          style={{ width: 420, maxWidth: "92vw", height: "auto", minHeight: 0 }}
        >
          <header className="settings-header">
            <span style={{ fontSize: 14, fontWeight: 600 }}>{ev.title}</span>
            <button onClick={handleCancel} className="settings-close" title="Cancel">
              ✕
            </button>
          </header>
          <div className="settings-body" style={{ padding: "16px" }}>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.5 }}>
              {ev.message}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  try { await respondExtensionUI(sessionId, ev.requestId, false); } catch (err) { console.error(err); }
                }}
                className="settings-tab"
                style={{ padding: "6px 14px", fontSize: 12 }}
              >
                No
              </button>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  try { await respondExtensionUI(sessionId, ev.requestId, true); } catch (err) { console.error(err); }
                }}
                className="settings-tab settings-tab-active"
                style={{ padding: "6px 14px", fontSize: 12 }}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Handle input ──
  // ── Handle input
  if (evType === "extension_ui_input") {
    const ev = activeInteraction as ExtensionUIEvent & { type: string; requestId: string; title: string; placeholder: string };
    return (
      <div className="settings-overlay" onClick={handleCancel}>
        <div
          className="settings-panel rewind-panel"
          onClick={(e) => e.stopPropagation()}
          style={{ width: 420, maxWidth: "92vw", height: "auto", minHeight: 0 }}
        >
          <header className="settings-header">
            <span style={{ fontSize: 14, fontWeight: 600 }}>{ev.title}</span>
            <button onClick={handleCancel} className="settings-close" title="Cancel">
              ✕
            </button>
          </header>
          <div className="settings-body" style={{ padding: "16px" }}>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={ev.placeholder}
              autoFocus
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: 12,
                borderRadius: 6,
                border: "1px solid var(--border-color)",
                background: "var(--bg-glass)",
                color: "var(--text-primary)",
                outline: "none",
                fontFamily: "inherit",
                boxSizing: "border-box",
                marginBottom: 12,
              }}
              onKeyDown={async (e) => {
                if (e.key === "Enter") {
                  e.stopPropagation();
                  try { await respondExtensionUI(sessionId, ev.requestId, inputValue); } catch (err) { console.error(err); }
                }
                if (e.key === "Escape") {
                  handleCancel();
                }
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={handleCancel}
                className="settings-tab"
                style={{ padding: "6px 14px", fontSize: 12 }}
              >
                Cancel
              </button>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  try { await respondExtensionUI(sessionId, ev.requestId, inputValue); } catch (err) { console.error(err); }
                }}
                className="settings-tab settings-tab-active"
                style={{ padding: "6px 14px", fontSize: 12 }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Unknown interaction type, or command running without interaction ──
  if (commandRunning && activeInteraction === undefined) {
    return (
      <div className="settings-overlay">
        <div
          className="settings-panel rewind-panel"
          onClick={(e) => e.stopPropagation()}
          style={{ width: 300, maxWidth: "92vw", height: "auto", minHeight: 0, textAlign: "center" }}
        >
          <div className="settings-body" style={{ padding: "20px" }}>
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
              Extension command running…
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
