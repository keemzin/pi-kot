import { useEffect, useRef, useState } from "react";
import { useMcpStore } from "../stores/mcp-store";
import { listTools, setToolEnabled } from "../lib/api-client";
import type { McpServerConfig, McpServerStatus } from "../lib/api-client/types";

export function MCPPanel({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const settings = useMcpStore((s) => s.settings);
  const globalServers = useMcpStore((s) => s.globalServers);
  const globalStatus = useMcpStore((s) => s.globalStatus);
  const loading = useMcpStore((s) => s.loading);
  const error = useMcpStore((s) => s.error);
  const startPolling = useMcpStore((s) => s.startPolling);
  const stopPolling = useMcpStore((s) => s.stopPolling);
  const setMcpEnabled = useMcpStore((s) => s.setMcpEnabled);
  const deleteServer = useMcpStore((s) => s.deleteServer);
  const probeServer = useMcpStore((s) => s.probeServer);
  const upsertServer = useMcpStore((s) => s.upsertServer);

  const [showAddForm, setShowAddForm] = useState(false);
  const [probeLoading, setProbeLoading] = useState<string | null>(null);

  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleProbe = async (name: string) => {
    setProbeLoading(name);
    try {
      await probeServer(name);
    } finally {
      setProbeLoading(null);
    }
  };

  const serverEntries = Object.entries(globalServers);

  return (
    <div className="settings-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        ref={dialogRef}
        className="settings-panel"
        style={{ maxWidth: "520px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-header">
          <span className="settings-section-title" style={{ margin: 0, textTransform: "none", letterSpacing: 0, fontSize: "13px" }}>
            MCP Settings
          </span>
          <button type="button" className="settings-close" onClick={onClose}>✕</button>
        </header>

        <div className="settings-body" style={{ padding: "12px 16px 16px" }}>
          {error !== null && (
            <div className="mcp-error">{error}</div>
          )}

          {loading && settings === undefined ? (
            <div style={{ padding: "20px 0", textAlign: "center", color: "var(--text-dim)", fontSize: "12px" }}>
              Loading MCP configuration...
            </div>
          ) : (
            <>
              <div className="settings-card" style={{ marginBottom: "10px" }}>
                <div className="settings-card-header">
                  <span className="settings-section-title" style={{ margin: 0 }}>Status</span>
                  <label className="mcp-toggle" style={{ cursor: "pointer" }}>
                    <span
                      className="mcp-toggle-track"
                      data-enabled={settings?.enabled ?? false}
                      onClick={() => setMcpEnabled(!(settings?.enabled ?? false))}
                    >
                      <span className="mcp-toggle-thumb" />
                    </span>
                    <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      {settings?.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </label>
                </div>
                {settings !== undefined && (
                  <div style={{ padding: "0 12px 8px", fontSize: "12px", color: "var(--text-dim)" }}>
                    {settings.connected} / {settings.total} servers connected
                  </div>
                )}
              </div>

              <div className="settings-card" style={{ marginBottom: "10px" }}>
                <div className="settings-card-header">
                  <span className="settings-section-title" style={{ margin: 0 }}>Servers</span>
                  <button
                    type="button"
                    className="mcp-add-btn"
                    onClick={() => setShowAddForm(!showAddForm)}
                    title="Add server"
                  >
                    +
                  </button>
                </div>

                {showAddForm && (
                  <McpServerForm
                    onSave={async (name, config) => {
                      await upsertServer(name, config);
                      setShowAddForm(false);
                    }}
                    onCancel={() => setShowAddForm(false)}
                  />
                )}

                {serverEntries.length === 0 && !showAddForm ? (
                  <div style={{ padding: "12px", textAlign: "center", fontSize: "12px", color: "var(--text-dim)" }}>
                    No MCP servers configured
                  </div>
                ) : (
                  <div className="mcp-server-list">
                    {serverEntries.map(([name]) => {
                      const st = globalStatus.find((s) => s.name === name);
                      return (
                        <McpServerRow
                          key={name}
                          name={name}
                          status={st}
                          probeLoading={probeLoading === name}
                          onProbe={() => handleProbe(name)}
                          onDelete={() => deleteServer(name)}
                        />
                      );
                    })}
                    {globalStatus
                      .filter((s) => !globalServers[s.name])
                      .map((st) => (
                        <McpServerRow
                          key={st.name}
                          name={st.name}
                          status={st}
                          probeLoading={probeLoading === st.name}
                          onProbe={() => handleProbe(st.name)}
                          onDelete={() => deleteServer(st.name)}
                        />
                      ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function McpServerRow({
  name,
  status,
  probeLoading,
  onProbe,
  onDelete,
}: {
  name: string;
  status: McpServerStatus | undefined;
  probeLoading: boolean;
  onProbe: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tools, setTools] = useState<Array<{ name: string; shortName: string; description: string; enabled: boolean }> | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [togglingTools, setTogglingTools] = useState<Set<string>>(new Set());

  const stateColor =
    status?.state === "connected" ? "var(--success)" :
    status?.state === "connecting" ? "var(--warning)" :
    status?.state === "error" ? "var(--error)" :
    status?.state === "trust_required" ? "var(--warning)" :
    "var(--text-dim)";

  const stateLabel =
    status?.state === "connected" ? "Connected" :
    status?.state === "connecting" ? "Connecting..." :
    status?.state === "error" ? `Error${status.lastError ? `: ${status.lastError}` : ""}` :
    status?.state === "disabled" ? "Disabled" :
    status?.state === "trust_required" ? "Trust Required" :
    status?.state === "idle" ? "Idle" :
    status !== undefined ? status.state : "—";

  const kindLabel = status?.kind ?? "—";

  const loadTools = async () => {
    setToolsLoading(true);
    try {
      const listing = await listTools();
      const srv = listing.mcp.find((s) => s.server === name);
      setTools(srv?.tools.map((t) => ({ name: t.name, shortName: t.shortName, description: t.description, enabled: t.enabled })) ?? []);
    } catch {
      setTools([]);
    } finally {
      setToolsLoading(false);
    }
  };

  const toggleTool = async (bridgedName: string, nextEnabled: boolean) => {
    setTogglingTools((prev) => new Set(prev).add(bridgedName));
    try {
      await setToolEnabled("mcp", bridgedName, nextEnabled);
      setTools((prev) => prev?.map((t) => t.name === bridgedName ? { ...t, enabled: nextEnabled } : t) ?? null);
    } finally {
      setTogglingTools((prev) => { const next = new Set(prev); next.delete(bridgedName); return next; });
    }
  };

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && tools === null) loadTools();
  };

  return (
    <div className="mcp-server-item" onClick={handleExpand}>
      <div className="mcp-server-header">
        <span className="mcp-server-chevron">{expanded ? "▾" : "▸"}</span>
        <span className="mcp-server-state-dot" style={{ background: stateColor }} />
        <span className="mcp-server-name">{name}</span>
        <span className="mcp-server-badge" data-kind={kindLabel}>{kindLabel}</span>
        {status !== undefined && (
          <span className="mcp-server-tools">{status.toolCount} tools</span>
        )}
      </div>

      {expanded && (
        <div className="mcp-server-details" onClick={(e) => e.stopPropagation()}>
          <div className="mcp-server-meta" style={{ fontSize: "11px", color: "var(--text-dim)", paddingBottom: "6px" }}>
            <span style={{ color: stateColor, fontWeight: 600 }}>{stateLabel}</span>
            {status?.url !== undefined && <span style={{ marginLeft: "8px" }}>{status.url}</span>}
            {status?.command !== undefined && <span style={{ marginLeft: "8px" }}>{status.command} {(status.args ?? []).slice(0, 2).join(" ")}</span>}
          </div>

          {toolsLoading ? (
            <div style={{ fontSize: "11px", color: "var(--text-dim)", padding: "4px 0" }}>Loading tools...</div>
          ) : tools !== null && tools.length > 0 ? (
            <div className="mcp-tools-list">
              <div className="mcp-tools-header">Tools</div>
              {tools.map((t) => (
                <div key={t.name} className="mcp-tool-row">
                  <div className="mcp-tool-info">
                    <span className="mcp-tool-name">{t.shortName}</span>
                    <span className="mcp-tool-fqn">{t.name}</span>
                    {t.description && <span className="mcp-tool-desc">{t.description}</span>}
                  </div>
                  <label className="mcp-toggle" style={{ cursor: "pointer", flexShrink: 0 }}>
                    <span
                      className="mcp-toggle-track"
                      data-enabled={t.enabled}
                      onClick={() => { if (!togglingTools.has(t.name)) toggleTool(t.name, !t.enabled); }}
                    >
                      <span className="mcp-toggle-thumb" />
                    </span>
                    <span style={{ fontSize: "10px", color: "var(--text-dim)", minWidth: "32px", textAlign: "right" }}>
                      {togglingTools.has(t.name) ? "..." : t.enabled ? "on" : "off"}
                    </span>
                  </label>
                </div>
              ))}
            </div>
          ) : tools !== null ? (
            <div style={{ fontSize: "11px", color: "var(--text-dim)", padding: "4px 0" }}>No tools available</div>
          ) : null}

          <div className="mcp-server-actions" style={{ marginTop: "6px" }}>
            <button
              type="button"
              className="mcp-action-btn"
              onClick={onProbe}
              disabled={probeLoading}
            >
              {probeLoading ? "Probing..." : "Probe"}
            </button>
            <button
              type="button"
              className="mcp-action-btn mcp-action-btn-danger"
              onClick={onDelete}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function McpServerForm({
  onSave,
  onCancel,
}: {
  onSave: (name: string, config: McpServerConfig) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"remote" | "stdio">("stdio");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState("streamable-http");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [cwd, setCwd] = useState("");
  const [envEntries, setEnvEntries] = useState<{ key: string; value: string }[]>([]);
  const [headersEntries, setHeadersEntries] = useState<{ key: string; value: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSave = async () => {
    setFormError(null);
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setFormError("Server name is required");
      return;
    }

    const config: McpServerConfig = { enabled: true };

    if (kind === "remote") {
      if (url.trim().length === 0) {
        setFormError("URL is required for remote servers");
        return;
      }
      config.url = url.trim();
      config.transport = transport as "auto" | "streamable-http" | "sse";
      const hdrs: Record<string, string> = {};
      for (const e of headersEntries) {
        if (e.key.trim().length > 0) hdrs[e.key.trim()] = e.value;
      }
      if (Object.keys(hdrs).length > 0) config.headers = hdrs;
    } else {
      if (command.trim().length === 0) {
        setFormError("Command is required for stdio servers");
        return;
      }
      config.command = command.trim();
      if (args.trim().length > 0) {
        config.args = args.split(" ").filter(Boolean);
      }
      if (cwd.trim().length > 0) config.cwd = cwd.trim();
      const env: Record<string, string> = {};
      for (const e of envEntries) {
        if (e.key.trim().length > 0) env[e.key.trim()] = e.value;
      }
      if (Object.keys(env).length > 0) config.env = env;
    }

    setSaving(true);
    try {
      await onSave(trimmedName, config);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save server");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mcp-form" onClick={(e) => e.stopPropagation()}>
      <div className="mcp-form-row">
        <label className="mcp-form-label">Name</label>
        <input
          className="mcp-form-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-mcp-server"
        />
      </div>
      <div className="mcp-form-row">
        <label className="mcp-form-label">Type</label>
        <select
          className="mcp-form-select"
          value={kind}
          onChange={(e) => setKind(e.target.value as "remote" | "stdio")}
        >
          <option value="stdio">stdio</option>
          <option value="remote">Remote URL</option>
        </select>
      </div>
      {kind === "remote" ? (
        <>
          <div className="mcp-form-row">
            <label className="mcp-form-label">URL</label>
            <input
              className="mcp-form-input"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:8080/mcp"
            />
          </div>
          <div className="mcp-form-row">
            <label className="mcp-form-label">Transport</label>
            <select
              className="mcp-form-select"
              value={transport}
              onChange={(e) => setTransport(e.target.value)}
            >
              <option value="streamable-http">Streamable HTTP</option>
              <option value="sse">SSE</option>
              <option value="auto">Auto</option>
            </select>
          </div>
          <div className="mcp-form-section-label">Headers</div>
          {headersEntries.map((entry, i) => (
            <div key={i} className="mcp-form-row mcp-form-row-inline">
              <input
                className="mcp-form-input mcp-form-input-half"
                type="text"
                value={entry.key}
                onChange={(e) => {
                  const next = [...headersEntries];
                  next[i] = { ...next[i], key: e.target.value };
                  setHeadersEntries(next);
                }}
                placeholder="Authorization"
              />
              <input
                className="mcp-form-input mcp-form-input-half"
                type="text"
                value={entry.value}
                onChange={(e) => {
                  const next = [...headersEntries];
                  next[i] = { ...next[i], value: e.target.value };
                  setHeadersEntries(next);
                }}
                placeholder="Bearer ..."
              />
              <button
                type="button"
                className="mcp-action-btn"
                onClick={() => setHeadersEntries(headersEntries.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="mcp-action-btn"
            style={{ alignSelf: "flex-start" }}
            onClick={() => setHeadersEntries([...headersEntries, { key: "", value: "" }])}
          >
            + Header
          </button>
        </>
      ) : (
        <>
          <div className="mcp-form-row">
            <label className="mcp-form-label">Command</label>
            <input
              className="mcp-form-input"
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx"
            />
          </div>
          <div className="mcp-form-row">
            <label className="mcp-form-label">Args</label>
            <input
              className="mcp-form-input"
              type="text"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="-y @modelcontextprotocol/server-filesystem /path"
            />
          </div>
          <div className="mcp-form-row">
            <label className="mcp-form-label">Working Directory</label>
            <input
              className="mcp-form-input"
              type="text"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="/absolute/path (optional)"
            />
          </div>
          <div className="mcp-form-section-label">Environment Variables</div>
          {envEntries.map((entry, i) => (
            <div key={i} className="mcp-form-row mcp-form-row-inline">
              <input
                className="mcp-form-input mcp-form-input-half"
                type="text"
                value={entry.key}
                onChange={(e) => {
                  const next = [...envEntries];
                  next[i] = { ...next[i], key: e.target.value };
                  setEnvEntries(next);
                }}
                placeholder="MY_VAR"
              />
              <input
                className="mcp-form-input mcp-form-input-half"
                type="text"
                value={entry.value}
                onChange={(e) => {
                  const next = [...envEntries];
                  next[i] = { ...next[i], value: e.target.value };
                  setEnvEntries(next);
                }}
                placeholder="value"
              />
              <button
                type="button"
                className="mcp-action-btn"
                onClick={() => setEnvEntries(envEntries.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="mcp-action-btn"
            style={{ alignSelf: "flex-start" }}
            onClick={() => setEnvEntries([...envEntries, { key: "", value: "" }])}
          >
            + Env Var
          </button>
        </>
      )}
      {formError !== null && <div className="mcp-form-error">{formError}</div>}
      <div className="mcp-form-actions">
        <button type="button" className="mcp-action-btn" onClick={onCancel}>Cancel</button>
        <button type="button" className="mcp-action-btn mcp-action-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
