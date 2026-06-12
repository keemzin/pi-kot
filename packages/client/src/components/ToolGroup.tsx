import { useState } from "react";

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
}

/** SVG icon for a tool based on its name */
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
  if (n === "read" || n === "file_read" || n === "grep" || n === "glob") return "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8";
  if (n === "edit" || n === "write" || n === "create") return "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z";
  if (n === "bash" || n === "shell" || n === "cmd" || n === "terminal") return "M4 17l6-6-6-6 M12 19h8";
  if (n === "search" || n === "web_search") return "M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z";
  if (n === "fetch" || n === "web_fetch" || n === "webfetch") return "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3";
  if (n === "task" || n === "subagent") return "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5";
  if (n === "question" || n === "ask") return "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M12 16v-4 M12 8h.01";
  if (n === "thinking" || n === "reason") return "M12 2a10 10 0 1 0 10 10h-10V2z M2 12a10 10 0 0 0 10 10V2z";
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
    <div className="tool-card" style={{ display: "flex", flexDirection: "column" }}>
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

export function ToolGroup({ tools, isStreaming }: Props) {
  const hasTools = tools.some((t) => t.type === "tool_call");
  const hasResults = tools.some((t) => t.type === "tool_result");
  const [view, setView] = useState<"full" | "hidden">(
    isStreaming ? "full" : (hasTools || hasResults ? "full" : "hidden"),
  );

  // Auto-show on streaming start, auto-collapse when done
  if (!isStreaming && view === "full" && !hasTools && !hasResults) {
    // No tools to show
  }

  const toggle = () => setView((v) => (v === "full" ? "hidden" : "full"));

  const runningTool = tools.find((t) => t.status === "running");

  return (
    <div style={{ marginBottom: 4 }}>
      <button
        type="button"
        onClick={toggle}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "transparent", border: "none", cursor: "pointer",
          fontFamily: "inherit", padding: "2px 0",
          marginBottom: view === "full" ? 4 : 0,
        }}
      >
        <span style={{ color: "var(--text-dim)", display: "inline-flex", alignItems: "center" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" strokeWidth="1.5" opacity="0.25" />
            {runningTool ? (
              <line x1="12" y1="3" x2="12" y2="12" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <>
                <line x1="12" y1="3" x2="12" y2="12" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
                <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
              </>
            )}
          </svg>
        </span>
        <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-secondary)" }}>
          Trail
        </span>
        {runningTool && (
          <span style={{
            fontSize: "0.75rem", color: "var(--accent)",
            fontWeight: 500, display: "flex", alignItems: "center", gap: 3,
          }}>
            <span style={{
              display: "inline-block", width: 6, height: 6, borderRadius: "50%",
              background: "var(--accent)", animation: "pulse 1s ease-in-out infinite",
            }} />
            {getToolDisplayName(runningTool.name)}
          </span>
        )}
        {!runningTool && tools.length > 0 && (
          <span style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>
            {tools.length} tool{tools.length > 1 ? "s" : ""}
          </span>
        )}
        <span style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginLeft: "auto" }}>
          {view === "full" ? "▾" : "▸"}
        </span>
      </button>

      {view === "full" && (
        <div style={{
          paddingLeft: 8, borderLeft: "2px solid var(--border)",
          display: "flex", flexDirection: "column", gap: 1,
        }}>
          {tools.map((tool, i) => (
            <ToolRow key={i} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}
