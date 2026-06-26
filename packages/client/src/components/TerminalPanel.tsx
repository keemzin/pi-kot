/**
 * TerminalPanel — xterm.js terminal connected to the server PTY via WebSocket.
 *
 * Props:
 *   open: boolean
 *   onClose: () => void
 *   projectId?: string — used to derive the cwd sent to the PTY
 */

import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getStoredToken } from "../lib/api-client";

interface TerminalPanelProps {
  open: boolean;
  onClose: () => void;
  projectId?: string;
}

export function TerminalPanel({ open, onClose, projectId }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const connect = useCallback(() => {
    if (!open) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;

    // Build query params: cwd + auth token
    const params = new URLSearchParams();
    if (projectId) params.set("cwd", `/workspace/${encodeURIComponent(projectId)}`);
    const token = getStoredToken();
    if (token) params.set("token", token);
    const qs = params.toString();

    const ws = new WebSocket(`${protocol}//${host}/api/v1/terminal${qs ? `?${qs}` : ""}`);

    ws.onopen = () => {
      wsRef.current = ws;
      // Trigger fit once connected so the terminal fills the container
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
            break;
          case "error":
            termRef.current?.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m`);
            break;
          case "open":
            termRef.current?.writeln(`\r\n\x1b[32mTerminal [${msg.id}] opened at ${msg.cwd}\x1b[0m`);
            break;
        }
      } catch {
        // binary data — ignore
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    ws.onerror = () => {
      termRef.current?.writeln("\r\n\x1b[31mWebSocket error\x1b[0m");
    };
  }, [open, projectId]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) {
      disconnect();
      return;
    }

    const element = containerRef.current;
    if (!element) return;

    // Create terminal
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
      theme: {
        background: "var(--bg, #1e1e2e)",
        foreground: "var(--text, #cdd6f4)",
        cursor: "var(--accent-text, #89b4fa)",
        selectionBackground: "var(--accent, #89b4fa)",
        black: "#45475a",
        red: "#f38ba8",
        green: "#a6e3a1",
        yellow: "#f9e2af",
        blue: "#89b4fa",
        magenta: "#f5c2e7",
        cyan: "#94e2d5",
        white: "#bac2de",
        brightBlack: "#585b70",
        brightRed: "#f38ba8",
        brightGreen: "#a6e3a1",
        brightYellow: "#f9e2af",
        brightBlue: "#89b4fa",
        brightMagenta: "#f5c2e7",
        brightCyan: "#94e2d5",
        brightWhite: "#a6adc8",
      },
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(element);
    term.focus();

    // Wait for DOM to settle then fit
    const fitTimer = setTimeout(() => {
      fitAddon.fit();
    }, 50);

    termRef.current = term;
    fitRef.current = fitAddon;

    // Connect WebSocket
    connect();

    // Handle input from terminal → WS
    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "input", data }));
      }
    });

    // Handle resize (debounced)
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
          // element hidden
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
  }, [open, connect, disconnect]);

  if (!open) return null;

  return (
    <div
      className="terminal-overlay"
      onClick={(e) => {
        // Close when clicking outside the panel
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        background: "rgba(0,0,0,0.3)",
      }}
    >
      <div
        className="terminal-panel"
        style={{
          width: "100%",
          height: "50vh",
          minHeight: 200,
          background: "var(--bg, #1e1e2e)",
          borderTop: "1px solid var(--border-color, #313244)",
          display: "flex",
          flexDirection: "column",
          animation: "slideUp 0.2s ease",
        }}
      >
        {/* Header bar */}
        <div
          className="terminal-header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 12px",
            borderBottom: "1px solid var(--border-color, #313244)",
            fontSize: 12,
            color: "var(--text-dim, #6c7086)",
            userSelect: "none",
          }}
        >
          <span>Terminal</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => {
                disconnect();
                // Reconnect after a tick
                setTimeout(connect, 50);
              }}
              title="Restart terminal"
              style={{
                background: "none",
                border: "1px solid var(--border-color, #313244)",
                color: "var(--text-dim, #6c7086)",
                borderRadius: 4,
                padding: "2px 8px",
                fontSize: 11,
                cursor: "pointer",
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
                color: "var(--text-dim, #6c7086)",
                fontSize: 14,
                cursor: "pointer",
                padding: "2px 6px",
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Terminal container */}
        <div
          ref={containerRef}
          className="xterm-container"
          style={{
            flex: 1,
            padding: 4,
            overflow: "hidden",
          }}
        />
      </div>

      {/* Keyframe for slide-up animation */}
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
