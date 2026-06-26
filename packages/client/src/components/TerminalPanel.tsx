/**
 * TerminalPanel — xterm.js terminal connected to the server PTY via WebSocket.
 *
 * Fixed bottom overlay that opens in the active project's directory.
 * On mobile, the panel is taller (60vh) for more room.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getStoredToken } from "../lib/api-client";

interface TerminalPanelProps {
  open: boolean;
  onClose: () => void;
  /** If set, the terminal PTY starts in this directory. */
  cwd?: string;
}

/** Read a CSS variable from the document root, returning a fallback if unset. */
function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

const MOBILE_BP = 600;

function isMobileWidth(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= MOBILE_BP;
}

export function TerminalPanel({ open, onClose, cwd }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);
  const [mobile, setMobile] = useState(isMobileWidth);

  // Track mobile width
  useEffect(() => {
    const check = () => setMobile(isMobileWidth());
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Don't mount the terminal content at all when closed
  if (!open) return null;

  return (
    <TerminalInner
      cwd={cwd}
      mobile={mobile}
      onClose={onClose}
      containerRef={containerRef}
      wsRef={wsRef}
      termRef={termRef}
      fitRef={fitRef}
      connected={connected}
      setConnected={setConnected}
    />
  );
}

/**
 * Inner component so the connect/disconnect/terminal logic
 * only runs when the panel is actually open.
 */
function TerminalInner({
  cwd,
  mobile,
  onClose,
  containerRef,
  wsRef,
  termRef,
  fitRef,
  connected,
  setConnected,
}: {
  cwd?: string;
  mobile: boolean;
  onClose: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  wsRef: React.MutableRefObject<WebSocket | null>;
  termRef: React.MutableRefObject<Terminal | null>;
  fitRef: React.MutableRefObject<FitAddon | null>;
  connected: boolean;
  setConnected: (v: boolean) => void;
}) {
  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;

    const params = new URLSearchParams();
    const token = getStoredToken();
    if (token) params.set("token", token);
    if (cwd) params.set("cwd", cwd);
    const qs = params.toString();

    const ws = new WebSocket(`${protocol}//${host}/api/v1/terminal${qs ? `?${qs}` : ""}`);

    ws.onopen = () => {
      wsRef.current = ws;
      setConnected(true);
      requestAnimationFrame(() => fitRef.current?.fit());
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "output":
            termRef.current?.write(msg.data);
            break;
          case "exit":
            termRef.current?.writeln(`\r\n\x1b[31mProcess exited with code ${msg.code}\x1b[0m`);
            setConnected(false);
            break;
          case "error":
            termRef.current?.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m`);
            break;
          case "open":
            termRef.current?.writeln(`\r\n\x1b[32mTerminal opened at ${msg.cwd}\x1b[0m`);
            break;
        }
      } catch {
        // binary data
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      setConnected(false);
    };

    ws.onerror = () => {
      termRef.current?.writeln("\r\n\x1b[31mWebSocket error\x1b[0m");
    };
  }, [cwd, setConnected, wsRef, fitRef, termRef]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [wsRef]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const bg = cssVar("--bg", "#1e1e2e");
    const fg = cssVar("--text", "#cdd6f4");
    const accent = cssVar("--accent", "#89b4fa");
    const accentText = cssVar("--accent-text", "#89b4fa");

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
      theme: {
        background: bg,
        foreground: fg,
        cursor: accentText,
        selectionBackground: accent,
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
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(element);

    const fitTimer = setTimeout(() => {
      fitAddon.fit();
    }, 50);

    termRef.current = term;
    fitRef.current = fitAddon;

    connect();

    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "input", data }));
      }
    });

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        try {
          fitAddon.fit();
          const dims = fitAddon.proposeDimensions();
          if (dims && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }),
            );
          }
        } catch {
          // hidden container might throw
        }
      }, 100);
    });

    resizeObserver.observe(element);

    return () => {
      clearTimeout(fitTimer);
      clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // Only run on mount — cleanup on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const borderColor = cssVar("--border-color", "#313244");
  const textDim = cssVar("--text-dim", "#6c7086");
  const bg = cssVar("--bg", "#1e1e2e");
  const text = cssVar("--text", "#cdd6f4");
  const accent = cssVar("--accent", "#89b4fa");
  const panelHeight = mobile ? "60vh" : "35vh";

  return (
    <div
      className="terminal-panel"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        height: panelHeight,
        minHeight: 180,
        background: bg,
        display: "flex",
        flexDirection: "column",
        animation: "terminalSlideUp 0.2s ease",
        boxShadow: "0 -2px 12px rgba(0,0,0,0.25)",
      }}
    >
      {/* Header bar — accent line below the "Terminal" label */}
      <div
        className="terminal-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
          height: 32,
          fontSize: 12,
          color: textDim,
          userSelect: "none",
          flexShrink: 0,
          borderBottom: `1px solid ${borderColor}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, height: "100%" }}>
          <span
            style={{
              fontWeight: 600,
              color: text,
              borderBottom: `2px solid ${accent}`,
              paddingBottom: 2,
              lineHeight: "30px",
            }}
          >
            Terminal
          </span>
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: connected
                ? cssVar("--success", "#34d399")
                : cssVar("--error", "#f87171"),
              marginTop: 2,
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={() => {
              disconnect();
              setTimeout(connect, 50);
            }}
            title="Restart"
            style={{
              background: "none",
              border: `1px solid ${borderColor}`,
              color: textDim,
              borderRadius: 4,
              padding: "2px 8px",
              fontSize: 11,
              cursor: "pointer",
              lineHeight: "16px",
            }}
          >
            Restart
          </button>
          <button
            onClick={onClose}
            title="Close terminal"
            style={{
              background: "none",
              border: "none",
              color: textDim,
              fontSize: 14,
              cursor: "pointer",
              padding: "2px 6px",
              lineHeight: "16px",
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Terminal xterm container — bottom padding so text isn't flush */}
      <div
        ref={containerRef}
        className="xterm-container"
        style={{
          flex: 1,
          padding: "2px 4px 8px 4px",
          overflow: "hidden",
          minHeight: 0,
        }}
      />

      <style>{`
        @keyframes terminalSlideUp {
          from { transform: translateY(10px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
