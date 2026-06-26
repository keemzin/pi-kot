import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getStoredToken } from "../lib/api-client";

interface TerminalPanelProps {
  open: boolean;
  onClose: () => void;
  cwd?: string;
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

const MOBILE_BP = 600;
function isMobileWidth(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= MOBILE_BP;
}

function SingleTerminal({
  cwd,
  isActive,
  onStatusChange
}: {
  cwd?: string;
  isActive: boolean;
  onStatusChange: (status: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

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
      onStatusChange(true);
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
            onStatusChange(false);
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
      onStatusChange(false);
    };

    ws.onerror = () => {
      termRef.current?.writeln("\r\n\x1b[31mWebSocket error\x1b[0m");
    };
  }, [cwd, onStatusChange]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const bg = cssVar("--bg-solid", "#000000");
    const fg = cssVar("--text-primary", "#ffffff");
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
    
    // Fit needs a tick to calculate dimensions correctly
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
  }, [connect, disconnect]); // Run exactly once on mount

  // Refit when tab becomes active
  useEffect(() => {
    if (isActive && fitRef.current) {
      setTimeout(() => {
        try {
          fitRef.current?.fit();
        } catch {}
      }, 50);
      termRef.current?.focus();
    }
  }, [isActive]);

  return (
    <div
      ref={containerRef}
      className="xterm-container"
      style={{
        flex: 1,
        padding: "2px 4px 8px 4px",
        overflow: "hidden",
        minHeight: 0,
        display: isActive ? "block" : "none",
      }}
    />
  );
}

export function TerminalPanel({ open, onClose, cwd }: TerminalPanelProps) {
  const [tabs, setTabs] = useState<{ id: string; name: string }[]>([{ id: "1", name: "Terminal" }]);
  const [activeTabId, setActiveTabId] = useState("1");
  const [nextId, setNextId] = useState(2);
  const [statuses, setStatuses] = useState<Record<string, boolean>>({});

  const [mobile, setMobile] = useState(isMobileWidth);

  useEffect(() => {
    const check = () => setMobile(isMobileWidth());
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const addTab = () => {
    const id = String(nextId);
    setTabs([...tabs, { id, name: `Terminal ${id}` }]);
    setActiveTabId(id);
    setNextId(nextId + 1);
  };

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newTabs = tabs.filter((t) => t.id !== id);
    setTabs(newTabs);
    // Cleanup statuses
    setStatuses((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });

    if (activeTabId === id && newTabs.length > 0) {
      setActiveTabId(newTabs[newTabs.length - 1].id);
    } else if (newTabs.length === 0) {
      // All tabs closed, create a fresh one and hide panel
      const freshId = String(nextId + 1);
      setTabs([{ id: freshId, name: "Terminal" }]);
      setActiveTabId(freshId);
      setNextId(nextId + 2);
      onClose();
    }
  };

  const textDim = "var(--text-dim, #6c7086)";
  const textPrimary = "var(--text-primary, #ffffff)";
  const accentColor = "var(--accent, #89b4fa)";
  const errorColor = "var(--error, #f87171)";
  const panelHeight = mobile ? "60dvh" : "35vh";

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
        background: "var(--bg-solid, #000000)",
        display: open ? "flex" : "none",
        flexDirection: "column",
        animation: open ? "terminalSlideUp 0.2s ease" : "none",
        borderTop: `1px solid ${accentColor}`,
      }}
    >
      <div
        className="terminal-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 36,
          fontSize: 13,
          color: textDim,
          userSelect: "none",
          flexShrink: 0,
          borderBottom: "1px solid var(--border, #313244)",
        }}
      >
        <div 
          className="terminal-tabs-container"
          style={{ 
            display: "flex", 
            alignItems: "center", 
            height: "100%", 
            overflowX: "auto",
            scrollbarWidth: "none",
          }}
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const connected = statuses[tab.id] ?? false;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: "100%",
                  fontWeight: 500,
                  color: isActive ? textPrimary : textDim,
                  borderBottom: `2px solid ${isActive ? (connected ? accentColor : errorColor) : "transparent"}`,
                  padding: "0 10px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  backgroundColor: isActive ? "rgba(255, 255, 255, 0.03)" : "transparent",
                }}
              >
                <span style={{ color: connected ? accentColor : errorColor, fontFamily: "monospace", fontSize: 14 }}>
                  &gt;_
                </span>
                {tab.name}
                <button
                  onClick={(e) => closeTab(tab.id, e)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "inherit",
                    padding: "0 4px",
                    marginLeft: "4px",
                    fontSize: 12,
                    cursor: "pointer",
                    opacity: isActive ? 1 : 0.5,
                  }}
                  title="Close terminal"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <div 
          style={{ 
            display: "flex", 
            gap: 12, 
            alignItems: "center", 
            padding: "0 16px",
            background: "var(--bg-solid, #000000)",
            boxShadow: "-8px 0 8px var(--bg-solid, #000000)"
          }}
        >
          <button
            onClick={addTab}
            title="New Terminal"
            style={{
              background: "none",
              border: "none",
              color: textDim,
              fontSize: 18,
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            +
          </button>
          <button
            onClick={onClose}
            title="Hide terminal"
            style={{
              background: "none",
              border: "none",
              color: textDim,
              fontSize: 14,
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {tabs.map((tab) => (
        <SingleTerminal
          key={tab.id}
          cwd={cwd}
          isActive={tab.id === activeTabId}
          onStatusChange={(status) => setStatuses((s) => ({ ...s, [tab.id]: status }))}
        />
      ))}

      <style>{`
        @keyframes terminalSlideUp {
          from { transform: translateY(10px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .terminal-tabs-container::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}
