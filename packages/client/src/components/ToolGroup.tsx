import { useState, useEffect, useRef } from "react";

interface ToolItem {
  type: "tool_call" | "tool_result";
  name: string;
  status: "running" | "done" | "error";
  input?: unknown;
  output?: string;
  isError?: boolean;
}

interface Props {
  tools: ToolItem[];
  isStreaming?: boolean;
  modelName?: string;
  providerName?: string;
}

/* ── SVG icon for a tool ── */

function ToolIcon({ name }: { name: string }) {
  const icon = getToolIcon(name);
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d={icon} />
    </svg>
  );
}

function getToolIcon(name: string): string {
  const n = name.toLowerCase();
  if (n === "read" || n === "file_read" || n === "grep" || n === "glob")
    return "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8";
  if (n === "edit" || n === "write" || n === "create")
    return "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z";
  if (n === "bash" || n === "shell" || n === "cmd" || n === "terminal")
    return "M4 17l6-6-6-6 M12 19h8";
  if (n === "search" || n === "web_search")
    return "M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z";
  if (n === "fetch" || n === "web_fetch" || n === "webfetch")
    return "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3";
  if (n === "task" || n === "subagent")
    return "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5";
  if (n === "question" || n === "ask")
    return "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M12 16v-4 M12 8h.01";
  if (n === "thinking" || n === "reason")
    return "M12 2a10 10 0 1 0 10 10h-10V2z M2 12a10 10 0 0 0 10 10V2z";
  return "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"; // default: tool
}

function getToolDisplayName(name: string): string {
  const n = name.toLowerCase();
  const map: Record<string, string> = {
    read: "Read", file_read: "Read", grep: "Search", glob: "Explore",
    edit: "Edit", write: "Write", create: "Create",
    bash: "Run", shell: "Run", cmd: "Run",
    web_search: "Search", web_fetch: "Fetch", webfetch: "Fetch",
    task: "Task", subagent: "Subagent",
    question: "Ask", ask: "Ask",
    thinking: "Thinking", reasoning: "Reasoning",
  };
  return map[n] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

function getToolDescription(name: string, input?: unknown): string {
  if (!input || typeof input !== "object") return "";
  const inp = input as Record<string, string>;
  return inp.filePath ?? inp.file_path ?? inp.path ?? inp.url ?? inp.command ?? "";
}

/* ── Individual tool row ── */

function ToolRow({ tool }: { tool: ToolItem }) {
  const [open, setOpen] = useState(false);
  const dotColor = tool.status === "error"
    ? "var(--error)"
    : tool.status === "running"
    ? "var(--accent)"
    : "var(--text-dim)";

  const desc = getToolDescription(tool.name, tool.input);
  const label = getToolDisplayName(tool.name);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen((o) => !o); }}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "4px 0", cursor: "pointer", userSelect: "none",
        }}
      >
        <span style={{
          width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
          background: dotColor,
          transition: "background 0.2s",
        }} />
        <span style={{ color: "var(--text-dim)", display: "inline-flex", alignItems: "center" }}>
          <ToolIcon name={tool.name} />
        </span>
        <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-secondary)", flexShrink: 0 }}>
          {label}
        </span>
        {desc && (
          <span style={{
            fontSize: "0.8rem", color: "var(--text-dim)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            flex: 1, minWidth: 0,
          }} title={desc}>
            {desc}
          </span>
        )}
        <span style={{ color: "var(--text-dim)", display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d={open ? "M18 15l-6-6-6 6" : "M9 18l6-6-6-6"} />
          </svg>
        </span>
      </div>
      {open && (
        <div style={{ paddingLeft: 20, paddingBottom: 6 }}>
          {tool.type === "tool_call" && tool.input ? (
            <pre style={{ fontSize: "0.75rem", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--text-dim)" }}>
              {String(JSON.stringify(tool.input, null, 2) ?? "")}
            </pre>
          ) : null}
          {tool.type === "tool_result" && tool.output ? (
            <pre style={{
              fontSize: "0.75rem", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all",
              maxHeight: 200, overflow: "auto",
              background: "var(--bg-glass)", padding: "6px 10px", borderRadius: "var(--radius-sm)",
              color: tool.isError ? "var(--error)" : "var(--text-primary)",
            }}>
              {(tool.output.length > 4000 ? tool.output.slice(0, 4000) + "\n…(truncated)" : tool.output) ?? ""}
            </pre>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ── Main ToolGroup ── */

export function ToolGroup({ tools, isStreaming, modelName, providerName }: Props) {
  const hasTools = tools.length > 0;
  const hasRunning = tools.some((t) => t.status === "running");

  // Initial view: full when streaming or has tools, otherwise hidden
  const [view, setView] = useState<"full" | "justify" | "hidden">(
    isStreaming || hasTools ? "full" : "hidden",
  );

  // Keep refs for the auto-collapse timer
  const prevStreaming = useRef(isStreaming);
  const hasToolsRef = useRef(hasTools);
  hasToolsRef.current = hasTools;

  // Auto-collapse 3s after streaming stops
  useEffect(() => {
    if (isStreaming && !prevStreaming.current) {
      setView("full");
    }
    if (!isStreaming && prevStreaming.current) {
      const timer = setTimeout(() => {
        setView(hasToolsRef.current ? "full" : "hidden");
      }, 3000);
      prevStreaming.current = isStreaming;
      return () => clearTimeout(timer);
    }
    prevStreaming.current = isStreaming;
  }, [isStreaming]);

  // Cycle: full → hidden → full (justify not used yet, skip it)
  const cycle = () => {
    setView((v) => {
      if (v === "full") return "hidden";
      return "full";
    });
  };

  const viewLabel = view === "full" ? "Full" : view === "hidden" ? "Hidden" : "Justify";
  const toolCount = tools.length;
  const gearRotation = view === "hidden" ? 0 : view === "full" ? toolCount * 36 : 0;

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [tools.length, isStreaming]);

  return (
    <div style={{ position: "relative", marginBottom: 4 }}>
      {/* Header row — sticky during streaming */}
      <div
        style={
          isStreaming && view === "full"
            ? { position: "sticky", top: 0, zIndex: 10, background: "var(--bg)", overflowAnchor: "none" }
            : {}
        }
      >
        <button
          type="button"
          title={`Trail view: ${view}. Click to cycle: Full → Hidden`}
          onClick={cycle}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "transparent", border: "none", cursor: "pointer",
            fontFamily: "inherit", padding: "2px 0",
            marginBottom: view !== "hidden" ? 4 : 0,
            width: "100%", textAlign: "left",
          }}
        >
          {/* Spinning gear */}
          <span style={{ color: "var(--text-dim)", display: "inline-flex", alignItems: "center" }}>
            <svg
              width="16" height="16" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2"
              style={{
                transform: `rotate(${gearRotation}deg)`,
                transformOrigin: "50% 50%",
                transition: "transform 0.3s ease",
              }}
            >
              <circle cx="12" cy="12" r="9" strokeWidth="1.5" opacity="0.25" />
              <line x1="12" y1="12" x2="12" y2="3" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-secondary)" }}>
            Trail
          </span>
          <span style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginLeft: 4 }}>
            {viewLabel}
          </span>

          {/* Running tool indicator */}
          {hasRunning && (() => {
            const rt = tools.find((t) => t.status === "running");
            return rt ? (
              <span style={{
                fontSize: "0.75rem", color: "var(--accent)",
                fontWeight: 500, display: "flex", alignItems: "center", gap: 3,
              }}>
                <span style={{
                  display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                  background: "var(--accent)",
                  animation: "pulse 1s ease-in-out infinite",
                }} />
                {getToolDisplayName(rt.name)}
              </span>
            ) : null;
          })()}

          {/* Tool count */}
          {!hasRunning && toolCount > 0 && (
            <span style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>
              {toolCount} tool{toolCount > 1 ? "s" : ""}
            </span>
          )}

          {/* Model badge */}
          {modelName && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 3,
              fontSize: "0.75rem", color: "var(--accent)",
              background: hasRunning ? "var(--bg-glass)" : "rgba(237,180,73,0.12)",
              border: `1px solid ${hasRunning ? "var(--border)" : "rgba(237,180,73,0.25)"}`,
              borderRadius: 4, padding: "1px 6px",
              marginLeft: "auto",
            }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8, flexShrink: 0 }}>
                <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
              </svg>
              {providerName && <span style={{ opacity: 0.6 }}>{providerName}:</span>}
              <span style={{ fontWeight: 600 }}>{modelName}</span>
            </span>
          )}
        </button>

        {/* Gradient fade under sticky header */}
        {isStreaming && view === "full" && (
          <div aria-hidden="true" style={{
            pointerEvents: "none", position: "absolute",
            left: 0, right: 0, top: "100%", zIndex: 0,
            height: 12,
            background: "linear-gradient(to bottom, var(--bg), transparent)",
          }} />
        )}
      </div>

      {/* Full view — scrollable container with tools */}
      {view === "full" && (
        <div
          ref={scrollRef}
          style={
            isStreaming
              ? { maxHeight: 260, overflowY: "auto", resize: "vertical", minHeight: 60 }
              : {}
          }
        >
          <div style={{
            paddingLeft: 8, borderLeft: "2px solid var(--border)",
            display: "flex", flexDirection: "column", gap: 1,
          }}>
            {tools.map((tool, i) => (
              <ToolRow key={i} tool={tool} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
