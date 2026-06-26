/**
 * TerminalPanel — multi-tab xterm.js terminal with persistent PTY sessions.
 *
 * Architecture ported from pi-forge:
 *
 * - **Persistent across panel toggle:** The panel stays mounted even
 *   when visually hidden (CSS display:none). Each tab's WebSocket
 *   and xterm instance live in a module-level Map, outlasting React
 *   renders. When the panel is hidden, the WS stays connected and
 *   the PTY keeps running on the server.
 *
 * - **Multi-tab:** Each tab gets its own WS + PTY on the server,
 *   tracked by a stable `tabId`. Tab metadata is in a Zustand store
 *   persisted to sessionStorage.
 *
 * - **Reattach:** On page reload, the store restores tabs from
 *   sessionStorage and reconnects each with the same `tabId`, so the
 *   server reattaches to the existing PTY and replays recent output.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useTerminalStore, type TerminalTab } from "../stores/terminal-store";
import { getStoredToken } from "../lib/api-client";
import { useSessionStore } from "../stores/session-store";

interface TerminalPanelProps {
  open: boolean;
  onClose: () => void;
}

interface Live {
  term: Terminal;
  fit: FitAddon;
  ws: WebSocket;
  observer: ResizeObserver;
  lastSize: { cols: number; rows: number };
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  disposed: boolean;
}

const live = new Map<string, Live>();

function disableBrowserTextAssist(host: HTMLElement): void {
  const input = host.querySelector("textarea");
  if (input === null) return;
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("autocapitalize", "none");
  input.setAttribute("spellcheck", "false");
}

function syncPtySize(entry: Live, force = false): void {
  const cols = entry.term.cols;
  const rows = entry.term.rows;
  if (!force && cols === entry.lastSize.cols && rows === entry.lastSize.rows) return;
  entry.lastSize = { cols, rows };
  if (entry.ws.readyState === WebSocket.OPEN) {
    entry.ws.send(JSON.stringify({ type: "resize", cols, rows }));
  }
}

function fitAndSyncPty(entry: Live, force = false): void {
  entry.fit.fit();
  syncPtySize(entry, force);
}

function reconnectDelayMs(attempt: number): number {
  const seconds = [1, 2, 4, 8, 16, 30];
  return (seconds[Math.min(attempt, seconds.length - 1)] ?? 30) * 1000;
}

function isTerminalCloseCode(code: number): boolean {
  return code === 1000 || code === 4401 || code === 4404;
}

export function TerminalPanel({ open, onClose }: TerminalPanelProps) {
  const projectId = useSessionStore((s) => s.activeProjectId);
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const openTab = useTerminalStore((s) => s.openTab);
  const closeTab = useTerminalStore((s) => s.closeTab);
  const setActiveTab = useTerminalStore((s) => s.setActiveTab);

  // Track virtual keyboard offset on mobile so the panel sits above it
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const layoutHeight = window.innerHeight;
      const offset = Math.max(0, layoutHeight - vv.height);
      setKeyboardOffset(offset);
      setIsMobile(offset > 0);
    };
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, []);

  // Listen for focus events on the terminal host — when xterm's textarea
  // gets focus on mobile the keyboard opens, so we nudge the panel up.
  // Fallback for browsers where visualViewport fires late or not at all.
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
        setTimeout(() => {
          const vv = window.visualViewport;
          if (!vv) return;
          const offset = Math.max(0, window.innerHeight - vv.height);
          if (offset > 0) setKeyboardOffset(offset);
        }, 300);
      }
    };
    const onFocusOut = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const offset = Math.max(0, window.innerHeight - vv.height);
      setKeyboardOffset(offset);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [open]);

  const projectTabs = tabs.filter((t) => t.projectId === projectId);
  const activeTab = projectTabs.find((t) => t.id === activeTabId) ?? projectTabs[0];

  const onNewTab = (): void => {
    if (projectId === undefined) return;
    openTab(projectId);
  };

  const onCloseTab = (id: string): void => {
    teardown(id);
    closeTab(id);
  };

  const panelHeight = isMobile ? "45vh" : "35vh";

  return (
    <div
      className="terminal-panel-root"
      style={{
        display: open ? "flex" : "none",
        position: "fixed",
        bottom: keyboardOffset,
        left: 0,
        right: 0,
        zIndex: 100,
        height: panelHeight,
        minHeight: 180,
        background: "var(--bg, #1e1e2e)",
        flexDirection: "column",
        borderTop: "1px solid var(--border-color, #313244)",
        transition: "bottom 0.15s ease",
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 8px",
          height: 32,
          fontSize: 12,
          color: "var(--text-dim, #6c7086)",
          userSelect: "none",
          flexShrink: 0,
          borderBottom: "1px solid var(--border-color, #313244)",
          background: "var(--bg-glass, rgba(255,255,255,0.04))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 2, overflow: "hidden" }}>
          {projectTabs.length === 0 && (
            <span style={{ padding: "0 8px", fontSize: 11, fontStyle: "italic", color: "var(--text-dim)" }}>
              No terminals open.
            </span>
          )}
          {projectTabs.map((t) => {
            const isActive = t.id === activeTab?.id;
            return (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  borderRadius: 4,
                  padding: "2px 8px",
                  fontSize: 11,
                  cursor: "default",
                  background: isActive ? "var(--bg-glass-active, rgba(255,255,255,0.08))" : "transparent",
                  color: isActive ? "var(--text-primary, #fff)" : "var(--text-dim, #6c7086)",
                }}
              >
                <span
                  onClick={() => setActiveTab(t.id)}
                  style={{
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ fontSize: 10 }}>{`>`}_</span>
                  {t.label}
                </span>
                <button
                  onClick={() => onCloseTab(t.id)}
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    padding: "1px 3px",
                    borderRadius: 3,
                    fontSize: 10,
                    lineHeight: 1,
                    color: "var(--text-dim, #6c7086)",
                    opacity: 0.6,
                  }}
                  title="Close terminal (kills the PTY)"
                >
                  ✕
                </button>
              </div>
            );
          })}
          <button
            onClick={onNewTab}
            style={{
              all: "unset",
              cursor: "pointer",
              padding: "2px 6px",
              borderRadius: 4,
              fontSize: 11,
              color: "var(--text-dim, #6c7086)",
              marginLeft: 4,
              whiteSpace: "nowrap",
            }}
            title="New terminal"
          >
            + New
          </button>
        </div>
        <button
          onClick={onClose}
          style={{
            all: "unset",
            cursor: "pointer",
            padding: "2px 6px",
            borderRadius: 4,
            fontSize: 13,
            color: "var(--text-dim, #6c7086)",
            lineHeight: 1,
          }}
          title="Close terminal panel"
        >
          ✕
        </button>
      </div>

      {/* Terminal hosts */}
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        {projectTabs.length === 0 && (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontStyle: "italic",
              color: "var(--text-dim, #6c7086)",
            }}
          >
            Click "New" to open a terminal.
          </div>
        )}
        {tabs.map((t) => (
          <TerminalHost
            key={t.id}
            tab={t}
            visible={t.projectId === projectId && t.id === activeTab?.id}
          />
        ))}
      </div>
    </div>
  );
}

function TerminalHost({ tab, visible }: { tab: TerminalTab; visible: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hostRef.current === null) return undefined;
    const host = hostRef.current;

    // Re-mount path: existing live entry — re-attach xterm to fresh host div
    const existing = live.get(tab.id);
    if (existing !== undefined) {
      try {
        const root = existing.term.element;
        if (root !== undefined && root.parentNode !== host) {
          host.appendChild(root);
        } else {
          existing.term.open(host);
        }
        disableBrowserTextAssist(host);
        fitAndSyncPty(existing, true);
      } catch {
        // transient
      }
      const observer = new ResizeObserver(() => {
        try {
          fitAndSyncPty(existing);
        } catch {
          // host detached momentarily
        }
      });
      observer.observe(host);
      try {
        existing.observer.disconnect();
      } catch {
        // ignore
      }
      existing.observer = observer;
      requestAnimationFrame(() => {
        try {
          fitAndSyncPty(existing);
          existing.term.focus();
        } catch {
          // ignore
        }
      });
      return () => {
        try {
          observer.disconnect();
        } catch {
          // ignore
        }
      };
    }

    // First mount: create xterm + WS
    const term = new Terminal({
      theme: {
        background: cssVar("--bg", "#1e1e2e"),
        foreground: cssVar("--text-primary", "#cdd6f4"),
        cursor: cssVar("--accent-text", "#89b4fa"),
        selectionBackground: cssVar("--accent", "#89b4fa"),
        black: cssVar("--ansi-black", "#45475a"),
        red: cssVar("--ansi-red", "#f38ba8"),
        green: cssVar("--ansi-green", "#a6e3a1"),
        yellow: cssVar("--ansi-yellow", "#f9e2af"),
        blue: cssVar("--ansi-blue", "#89b4fa"),
        magenta: cssVar("--ansi-magenta", "#f5c2e7"),
        cyan: cssVar("--ansi-cyan", "#94e2d5"),
        white: cssVar("--ansi-white", "#bac2de"),
        brightBlack: cssVar("--ansi-bright-black", "#585b70"),
        brightRed: cssVar("--ansi-bright-red", "#f38ba8"),
        brightGreen: cssVar("--ansi-bright-green", "#a6e3a1"),
        brightYellow: cssVar("--ansi-bright-yellow", "#f9e2af"),
        brightBlue: cssVar("--ansi-bright-blue", "#89b4fa"),
        brightMagenta: cssVar("--ansi-bright-magenta", "#f5c2e7"),
        brightCyan: cssVar("--ansi-bright-cyan", "#94e2d5"),
        brightWhite: cssVar("--ansi-bright-white", "#a6adc8"),
      },
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      allowTransparency: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    disableBrowserTextAssist(host);
    fit.fit();

    const initialSize = { cols: term.cols, rows: term.rows };
    const ws = attachWebSocket(tab.id, tab.projectId, term, initialSize, false);

    const dataDisposable = term.onData((data) => {
      const sock = live.get(tab.id)?.ws;
      if (sock?.readyState === WebSocket.OPEN) {
        sock.send(JSON.stringify({ type: "input", data }));
      }
    });

    const observer = new ResizeObserver(() => {
      try {
        const entry = live.get(tab.id);
        if (entry === undefined) return;
        fitAndSyncPty(entry);
      } catch {
        // host detached momentarily
      }
    });
    observer.observe(host);

    live.set(tab.id, {
      term,
      fit,
      ws,
      observer,
      lastSize: initialSize,
      reconnectAttempt: 0,
      reconnectTimer: undefined,
      disposed: false,
    });

    void dataDisposable;

    return () => {
      // Panel hidden: disconnect only the observer. WS + term survive.
      try {
        observer.disconnect();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  // Visible → fit + focus
  useEffect(() => {
    if (!visible) return;
    const entry = live.get(tab.id);
    if (entry === undefined) return;
    requestAnimationFrame(() => {
      try {
        fitAndSyncPty(entry);
        entry.term.focus();
      } catch {
        // ignore
      }
    });
  }, [visible, tab.id]);

  const onHostClick = (): void => {
    live.get(tab.id)?.term.focus();
  };

  return (
    <div
      ref={hostRef}
      onClick={onHostClick}
      className="terminal-host"
      style={{
        position: "absolute",
        inset: 0,
        visibility: visible ? "visible" : "hidden",
        pointerEvents: visible ? "auto" : "none",
        zIndex: visible ? 1 : 0,
        padding: "2px 4px 8px 4px",
      }}
    />
  );
}

function attachWebSocket(
  tabId: string,
  projectId: string,
  term: Terminal,
  size: { cols: number; rows: number },
  isReconnect: boolean,
): WebSocket {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const stored = getStoredToken();
  const tokenQs = stored !== undefined ? `&token=${encodeURIComponent(stored)}` : "";
  const url = `${proto}://${window.location.host}/api/v1/terminal?projectId=${encodeURIComponent(
    projectId,
  )}&tabId=${encodeURIComponent(tabId)}${tokenQs}`;

  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    const entry = live.get(tabId);
    const currentSize =
      entry !== undefined ? { cols: entry.term.cols, rows: entry.term.rows } : size;
    ws.send(JSON.stringify({ type: "resize", cols: currentSize.cols, rows: currentSize.rows }));
    if (entry !== undefined) {
      entry.lastSize = currentSize;
      entry.reconnectAttempt = 0;
    }
    void isReconnect;
  };

  ws.onmessage = (e) => {
    if (typeof e.data === "string") {
      // JSON control messages (open, exit, error)
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "open") {
          term.writeln(`\r\n\x1b[32mTerminal opened at ${msg.cwd}\x1b[0m`);
          return;
        }
        if (msg.type === "exit") {
          term.writeln(`\r\n\x1b[31mProcess exited with code ${msg.code}\x1b[0m`);
          return;
        }
        if (msg.type === "error") {
          term.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m`);
          return;
        }
      } catch {
        // not JSON — write as text
        term.write(e.data);
      }
    } else if (e.data instanceof ArrayBuffer) {
      term.write(new Uint8Array(e.data));
    }
  };

  ws.onclose = (e) => {
    const entry = live.get(tabId);
    if (entry === undefined || entry.disposed) return;
    if (isTerminalCloseCode(e.code)) {
      let msg = `[connection closed: ${String(e.code)}]`;
      if (e.code === 4401) {
        msg = "[connection closed (4401): session expired — refresh the page after logging back in]";
      } else if (e.code === 4404) {
        msg = "[connection closed (4404): project no longer exists]";
      }
      term.write(`\r\n${msg}\r\n`);
      return;
    }
    const attempt = entry.reconnectAttempt + 1;
    entry.reconnectAttempt = attempt;
    const delay = reconnectDelayMs(attempt);
    term.write(
      `\r\n[connection lost (${String(e.code)}) — reconnecting in ${String(delay / 1000)}s, attempt ${String(attempt)}]\r\n`,
    );
    entry.reconnectTimer = setTimeout(() => {
      const cur = live.get(tabId);
      if (cur === undefined || cur.disposed) return;
      cur.reconnectTimer = undefined;
      cur.ws = attachWebSocket(tabId, projectId, term, cur.lastSize, true);
    }, delay);
  };

  return ws;
}

function teardown(id: string): void {
  const entry = live.get(id);
  if (entry === undefined) return;
  entry.disposed = true;
  if (entry.reconnectTimer !== undefined) clearTimeout(entry.reconnectTimer);
  live.delete(id);
  try {
    entry.observer.disconnect();
  } catch {
    // ignore
  }
  try {
    if (entry.ws.readyState === WebSocket.OPEN || entry.ws.readyState === WebSocket.CONNECTING) {
      entry.ws.close(1000, "tab_closed");
    }
  } catch {
    // ignore
  }
  try {
    entry.term.dispose();
  } catch {
    // ignore
  }
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}
