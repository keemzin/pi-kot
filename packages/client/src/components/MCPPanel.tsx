import { useCallback, useEffect, useRef, useState } from "react";
import { useMcpStore } from "../stores/mcp-store";
import { listTools, setToolEnabled, listToolOverrides, clearToolProjectOverride, fetchProjects } from "../lib/api-client";
import type { McpServerConfig, McpServerStatus, ToolOverridesResponse } from "../lib/api-client/types";

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
  const [editingName, setEditingName] = useState<string | undefined>(undefined);
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

  const handleToggleServer = async (name: string, next: boolean) => {
    const prev = globalServers[name];
    if (prev === undefined) return;
    await upsertServer(name, { ...prev, enabled: next });
  };

  const handleEdit = (name: string) => {
    setShowAddForm(false);
    setEditingName(name);
  };

  const handleAdd = () => {
    setEditingName(undefined);
    setShowAddForm(true);
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
                    onClick={() => editingName !== undefined ? setEditingName(undefined) : handleAdd()}
                    title="Add server"
                  >
                    +
                  </button>
                </div>

                {(!showAddForm && editingName === undefined) && serverEntries.length === 0 ? (
                  <div style={{ padding: "12px", textAlign: "center", fontSize: "12px", color: "var(--text-dim)" }}>
                    No MCP servers configured
                  </div>
                ) : (
                  <div className="mcp-server-list">
                    {showAddForm && (
                      <McpServerForm
                        onSave={async (name, config) => {
                          await upsertServer(name, config);
                          setShowAddForm(false);
                        }}
                        onCancel={() => setShowAddForm(false)}
                      />
                    )}

                    {editingName !== undefined && globalServers[editingName] !== undefined && (
                      <McpServerForm
                        key={editingName}
                        initialName={editingName}
                        initialConfig={globalServers[editingName]}
                        isEditing
                        onSave={async (_name, config) => {
                          await upsertServer(editingName, config);
                          setEditingName(undefined);
                        }}
                        onCancel={() => setEditingName(undefined)}
                      />
                    )}

                    {serverEntries.map(([name]) => {
                      const st = globalStatus.find((s) => s.name === name);
                      return (
                        <McpServerRow
                          key={name}
                          name={name}
                          config={globalServers[name]}
                          status={st}
                          probeLoading={probeLoading === name}
                          onToggle={(next) => handleToggleServer(name, next)}
                          onEdit={() => handleEdit(name)}
                          onProbe={() => handleProbe(name)}
                          onDelete={() => deleteServer(name)}
                          isEditing={editingName === name}
                        />
                      );
                    })}
                    {globalStatus
                      .filter((s) => !globalServers[s.name])
                      .map((st) => (
                        <McpServerRow
                          key={st.name}
                          name={st.name}
                          config={undefined}
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
  config,
  status,
  probeLoading,
  onToggle,
  onEdit,
  onProbe,
  onDelete,
  isEditing,
}: {
  name: string;
  config: McpServerConfig | undefined;
  status: McpServerStatus | undefined;
  probeLoading: boolean;
  onToggle?: (enabled: boolean) => Promise<void>;
  onEdit?: () => void;
  onProbe: () => Promise<void>;
  onDelete: () => void;
  isEditing?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tools, setTools] = useState<Array<{ name: string; shortName: string; description: string; enabled: boolean; globalEnabled: boolean; projectOverride?: "enabled" | "disabled" }> | null>(null);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [togglingTools, setTogglingTools] = useState<Set<string>>(new Set());
  const [projectsList, setProjectsList] = useState<Array<{ id: string; name: string }>>([]);
  const [overridesData, setOverridesData] = useState<ToolOverridesResponse | null>(null);

  const serverEnabled = config?.enabled !== false;
  const effectiveState = serverEnabled ? (status?.state ?? "idle") : "disabled";

  const stateColor =
    effectiveState === "connected" ? "var(--success)" :
    effectiveState === "connecting" ? "var(--warning)" :
    effectiveState === "error" ? "var(--error)" :
    effectiveState === "trust_required" ? "var(--warning)" :
    effectiveState === "disabled" ? "var(--text-dim)" :
    "var(--text-dim)";

  const stateLabel =
    effectiveState === "connected" ? "Connected" :
    effectiveState === "connecting" ? "Connecting..." :
    effectiveState === "error" ? `Error${status?.lastError ? `: ${status.lastError}` : ""}` :
    effectiveState === "disabled" ? (serverEnabled ? "Disabled" : "Disabled") :
    effectiveState === "trust_required" ? "Trust Required" :
    effectiveState === "idle" ? "Idle" :
    status !== undefined ? status.state : "—";

  const kindLabel = status?.kind ?? "—";

  const loadTools = useCallback(async () => {
    setToolsLoading(true);
    try {
      const [listing, overrides, projRes] = await Promise.all([
        listTools(),
        listToolOverrides(),
        fetchProjects(),
      ]);
      setOverridesData(overrides);
      setProjectsList(projRes.projects.map((p) => ({ id: p.id, name: p.name })));
      const srv = listing.mcp.find((s) => s.server === name);
      setTools(srv?.tools.map((t) => ({ name: t.name, shortName: t.shortName, description: t.description, enabled: t.enabled, globalEnabled: t.globalEnabled, projectOverride: t.projectOverride })) ?? []);
    } catch (err) {
      console.warn("loadTools failed:", err);
      setTools([]);
    } finally {
      setToolsLoading(false);
    }
  }, [name]);

  const toggleToolGlobal = async (bridgedName: string, nextEnabled: boolean) => {
    setTogglingTools((prev) => new Set(prev).add(bridgedName));
    try {
      await setToolEnabled("mcp", bridgedName, nextEnabled, { scope: "global" });
      setTools((prev) => prev?.map((t) => t.name === bridgedName ? { ...t, enabled: nextEnabled, globalEnabled: nextEnabled } : t) ?? null);
    } finally {
      setTogglingTools((prev) => { const next = new Set(prev); next.delete(bridgedName); return next; });
    }
  };

  const setProjectToolOverride = async (bridgedName: string, projectId: string, state: "enabled" | "disabled" | undefined) => {
    const key = `proj:${projectId}:${bridgedName}`;
    setTogglingTools((prev) => new Set(prev).add(key));
    try {
      if (state === undefined) {
        await clearToolProjectOverride("mcp", bridgedName, projectId);
      } else {
        await setToolEnabled("mcp", bridgedName, state === "enabled", { scope: "project", projectId });
      }
      await loadTools();
    } finally {
      setTogglingTools((prev) => { const next = new Set(prev); next.delete(key); return next; });
    }
  };

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) loadTools();
  };

  const handleProbeAndReload = async () => {
    setToolsLoading(true);
    try {
      await onProbe();
      const [listing, overrides, projRes] = await Promise.all([
        listTools(),
        listToolOverrides(),
        fetchProjects(),
      ]);
      setOverridesData(overrides);
      setProjectsList(projRes.projects.map((p) => ({ id: p.id, name: p.name })));
      const srv = listing.mcp.find((s) => s.server === name);
      setTools(srv?.tools.map((t) => ({ name: t.name, shortName: t.shortName, description: t.description, enabled: t.enabled, globalEnabled: t.globalEnabled, projectOverride: t.projectOverride })) ?? []);
    } catch (err) {
      console.warn("reload after probe failed:", err);
      setTools([]);
    } finally {
      setToolsLoading(false);
    }
  };

  const expandable = status !== undefined;
  const isDisabled = effectiveState === "disabled";

  return (
    <div className="mcp-server-item" onClick={expandable ? handleExpand : undefined}>
      <div className="mcp-server-header" style={isEditing ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
        <span className="mcp-server-chevron">{expanded ? "▾" : "▸"}</span>
        <span className="mcp-server-state-dot" style={{ background: stateColor }} />
        <span className="mcp-server-name">{name}</span>
        {config !== undefined && (
          <span className="mcp-server-badge" style={{ fontSize: "10px", color: serverEnabled ? "var(--text-secondary)" : "var(--text-dim)" }}>
            {serverEnabled ? "Enabled" : "Disabled"}
          </span>
        )}
        <span className="mcp-server-badge" data-kind={kindLabel}>{kindLabel}</span>
        {status !== undefined && (
          <span className="mcp-server-tools">{status.toolCount} tools</span>
        )}
      </div>

      {expanded && !isEditing && (
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
                <ToolCascadeRow
                  key={t.name}
                  family="mcp"
                  name={t.shortName}
                  fqn={t.name}
                  description={t.description}
                  enabled={t.enabled}
                  globalEnabled={t.globalEnabled}
                  projectOverride={t.projectOverride}
                  projectsList={projectsList}
                  overridesData={overridesData}
                  busy={togglingTools.has(t.name)}
                  onToggleGlobal={(next) => toggleToolGlobal(t.name, next)}
                  onSetProjectOverride={(pid, state) => setProjectToolOverride(t.name, pid, state)}
                />
              ))}
            </div>
          ) : tools !== null ? (
            <div style={{ fontSize: "11px", color: "var(--text-dim)", padding: "4px 0" }}>No tools available</div>
          ) : null}

          <div className="mcp-server-actions" style={{ marginTop: "6px", display: "flex", gap: "4px", flexWrap: "wrap" }}>
            {onToggle !== undefined && (
              <button
                type="button"
                className={`mcp-action-btn ${serverEnabled ? "" : "mcp-action-btn-danger"}`}
                onClick={() => onToggle(!serverEnabled)}
              >
                {serverEnabled ? "Disable" : "Enable"}
              </button>
            )}
            <button
              type="button"
              className="mcp-action-btn"
              onClick={handleProbeAndReload}
              disabled={probeLoading || isDisabled}
            >
              {probeLoading ? "Probing..." : "Probe"}
            </button>
            {onEdit !== undefined && (
              <button
                type="button"
                className="mcp-action-btn"
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
              >
                Edit
              </button>
            )}
            <button
              type="button"
              className="mcp-action-btn mcp-action-btn-danger"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const SECRET_PLACEHOLDER = "***REDACTED***";

function McpServerForm({
  initialName,
  initialConfig,
  isEditing,
  onSave,
  onCancel,
}: {
  initialName?: string;
  initialConfig?: McpServerConfig;
  isEditing?: boolean;
  onSave: (name: string, config: McpServerConfig) => Promise<void>;
  onCancel: () => void;
}) {
  const isStdio = initialConfig !== undefined
    ? typeof initialConfig.command === "string" && initialConfig.command.length > 0
    : false;

  const [name, setName] = useState(initialName ?? "");
  const [kind, setKind] = useState<"remote" | "stdio">(isStdio ? "stdio" : "remote");
  const [enabled, setEnabled] = useState(initialConfig?.enabled !== false);
  const [url, setUrl] = useState(initialConfig?.url ?? "");
  const [transport, setTransport] = useState(initialConfig?.transport ?? "auto");
  const [command, setCommand] = useState(initialConfig?.command ?? "");
  const [args, setArgs] = useState((initialConfig?.args ?? []).join(" "));
  const [cwd, setCwd] = useState(initialConfig?.cwd ?? "");
  const [envEntries, setEnvEntries] = useState<{ key: string; value: string }[]>(
    Object.entries(initialConfig?.env ?? {}).map(([k, v]) => ({ key: k, value: v }))
  );
  const [headersEntries, setHeadersEntries] = useState<{ key: string; value: string }[]>(
    Object.entries(initialConfig?.headers ?? {}).map(([k, v]) => ({ key: k, value: v }))
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSave = async () => {
    setFormError(null);
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setFormError("Server name is required");
      return;
    }

    const config: McpServerConfig = { enabled };

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
          disabled={isEditing}
          style={isEditing ? { opacity: 0.6 } : undefined}
        />
      </div>
      <div className="mcp-form-row">
        <label className="mcp-form-label">Type</label>
        <select
          className="mcp-form-select"
          value={kind}
          onChange={(e) => setKind(e.target.value as "remote" | "stdio")}
          disabled={isEditing}
          style={isEditing ? { opacity: 0.6 } : undefined}
        >
          <option value="stdio">stdio</option>
          <option value="remote">Remote URL</option>
        </select>
        {isEditing && (
          <span style={{ fontSize: "10px", color: "var(--text-dim)", marginLeft: "6px" }}>
            (locked while editing)
          </span>
        )}
      </div>
      <div className="mcp-form-row">
        <label className="mcp-form-label">Enabled</label>
        <label className="mcp-form-checkbox-label" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
            Disabled servers don't connect or contribute tools
          </span>
        </label>
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
              onChange={(e) => setTransport(e.target.value as "auto" | "streamable-http" | "sse")}
            >
              <option value="auto">Auto</option>
              <option value="streamable-http">Streamable HTTP</option>
              <option value="sse">SSE</option>
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
                type={entry.value === SECRET_PLACEHOLDER ? "text" : "password"}
                value={entry.value === SECRET_PLACEHOLDER ? "" : entry.value}
                onChange={(e) => {
                  const next = [...headersEntries];
                  next[i] = { ...next[i], value: e.target.value };
                  setHeadersEntries(next);
                }}
                placeholder={entry.value === SECRET_PLACEHOLDER ? "leave blank to keep stored value" : "Bearer ..."}
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
                type={entry.value === SECRET_PLACEHOLDER ? "text" : "password"}
                value={entry.value === SECRET_PLACEHOLDER ? "" : entry.value}
                onChange={(e) => {
                  const next = [...envEntries];
                  next[i] = { ...next[i], value: e.target.value };
                  setEnvEntries(next);
                }}
                placeholder={entry.value === SECRET_PLACEHOLDER ? "leave blank to keep stored value" : "value"}
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
          {saving ? "Saving..." : isEditing ? "Save changes" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── ToolCascadeRow ──────────────────────────────────────────────────────────

interface ToolCascadeRowProps {
  family: "builtin" | "mcp" | "extension";
  name: string;
  fqn: string;
  description: string;
  enabled: boolean;
  globalEnabled: boolean;
  projectOverride?: "enabled" | "disabled";
  projectsList: Array<{ id: string; name: string }>;
  overridesData: ToolOverridesResponse | null;
  busy: boolean;
  onToggleGlobal: (next: boolean) => void;
  onSetProjectOverride: (projectId: string, state: "enabled" | "disabled" | undefined) => void;
}

function ToolCascadeRow({
  family,
  name,
  fqn,
  description,
  enabled,
  globalEnabled,
  projectOverride,
  projectsList,
  overridesData,
  busy,
  onToggleGlobal,
  onSetProjectOverride,
}: ToolCascadeRowProps) {
  const [showOverrides, setShowOverrides] = useState(false);

  const existingOverrideProjects = overridesData !== null
    ? Object.entries(overridesData.projects)
        .filter(([, ov]) => {
          const arr = ov[family];
          return arr.enable.includes(fqn) || arr.disable.includes(fqn);
        })
        .map(([pid]) => pid)
    : [];

  const availableForOverride = projectsList.filter(
    (p) => !existingOverrideProjects.includes(p.id),
  );

  return (
    <div className="mcp-tool-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", width: "100%" }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: enabled ? "var(--success, #22c55e)" : "var(--text-dim)",
            flexShrink: 0,
          }}
        />
        <div className="mcp-tool-info" style={{ flex: 1, minWidth: 0 }}>
          <span className="mcp-tool-name">{name}</span>
          <span className="mcp-tool-fqn">{fqn}</span>
          {description !== "" && <span className="mcp-tool-desc">{description}</span>}
        </div>
        <button
          type="button"
          className="mcp-action-btn"
          style={{ fontSize: "10px", padding: "2px 6px" }}
          disabled={busy}
          onClick={() => onToggleGlobal(!globalEnabled)}
        >
          {busy ? "..." : globalEnabled ? "Global: enabled" : "Global: disabled"}
        </button>
        {projectsList.length > 0 && (
          <button
            type="button"
            className="mcp-action-btn"
            style={{ fontSize: "10px", padding: "2px 6px" }}
            onClick={() => setShowOverrides(!showOverrides)}
          >
            {showOverrides ? "▴" : "▾"} Overrides ({existingOverrideProjects.length})
          </button>
        )}
      </div>

      {showOverrides && (
        <div style={{ paddingLeft: "20px", paddingTop: "6px" }}>
          {existingOverrideProjects.map((pid) => {
            const proj = projectsList.find((p) => p.id === pid);
            const ov = overridesData?.projects[pid]?.[family];
            const currentState: "enabled" | "disabled" | undefined =
              ov?.enable.includes(fqn) ? "enabled" :
              ov?.disable.includes(fqn) ? "disabled" :
              undefined;
            return (
              <div key={pid} style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                <span style={{ fontSize: "11px", color: "var(--text-secondary)", minWidth: "80px" }}>
                  {proj?.name ?? pid}
                </span>
                <TriStatePicker
                  value={currentState}
                  disabled={busy}
                  onChange={(state) => onSetProjectOverride(pid, state)}
                />
              </div>
            );
          })}
          {availableForOverride.length > 0 && (
            <AddOverrideDropdown
              projects={availableForOverride}
              busy={busy}
              onSet={(pid, state) => onSetProjectOverride(pid, state)}
            />
          )}
          {existingOverrideProjects.length === 0 && availableForOverride.length === 0 && (
            <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>No projects configured</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── TriStatePicker ──────────────────────────────────────────────────────────

interface TriStatePickerProps {
  value: "enabled" | "disabled" | undefined;
  disabled: boolean;
  onChange: (state: "enabled" | "disabled" | undefined) => void;
}

function TriStatePicker({ value, disabled, onChange }: TriStatePickerProps) {
  const states = [
    { label: "Inherit", state: undefined as "enabled" | "disabled" | undefined },
    { label: "Enabled", state: "enabled" as "enabled" | "disabled" | undefined },
    { label: "Disabled", state: "disabled" as "enabled" | "disabled" | undefined },
  ];

  return (
    <div className="mcp-tristate" style={{ display: "inline-flex", borderRadius: "4px", overflow: "hidden", border: "1px solid var(--border, #333)" }}>
      {states.map((s) => {
        const active = value === s.state;
        const bg =
          active && s.state === "enabled" ? "var(--success, #22c55e)" :
          active && s.state === "disabled" ? "var(--error, #ef4444)" :
          active ? "var(--bg-tertiary, #333)" :
          "transparent";
        return (
          <button
            key={s.label}
            type="button"
            disabled={disabled}
            style={{
              padding: "2px 8px",
              fontSize: "10px",
              border: "none",
              borderRight: "1px solid var(--border, #333)",
              cursor: disabled ? "default" : "pointer",
              background: bg,
              color: active ? "#fff" : "var(--text-secondary)",
              fontWeight: active ? 600 : 400,
            }}
            onClick={() => onChange(s.state)}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

// ── AddOverrideDropdown ─────────────────────────────────────────────────────

interface AddOverrideDropdownProps {
  projects: Array<{ id: string; name: string }>;
  busy: boolean;
  onSet: (projectId: string, state: "enabled" | "disabled") => void;
}

function AddOverrideDropdown({ projects, busy, onSet }: AddOverrideDropdownProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(projects[0]?.id ?? "");

  if (projects.length === 0) return null;

  return (
    <div style={{ marginTop: "4px" }}>
      {!open ? (
        <button
          type="button"
          className="mcp-action-btn"
          style={{ fontSize: "10px", padding: "2px 6px" }}
          onClick={() => setOpen(true)}
        >
          + Add override for&hellip;
        </button>
      ) : (
        <div className="mcp-override-form" style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
          <select
            className="mcp-form-select mcp-override-select"
            style={{ fontSize: "10px", padding: "2px 4px", maxWidth: "160px" }}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            type="button"
            className="mcp-action-btn"
            style={{ fontSize: "10px", padding: "2px 6px" }}
            disabled={busy || selected.length === 0}
            onClick={() => { onSet(selected, "enabled"); setOpen(false); }}
          >
            Enable here
          </button>
          <button
            type="button"
            className="mcp-action-btn"
            style={{ fontSize: "10px", padding: "2px 6px" }}
            disabled={busy || selected.length === 0}
            onClick={() => { onSet(selected, "disabled"); setOpen(false); }}
          >
            Disable here
          </button>
          <button
            type="button"
            className="mcp-action-btn"
            style={{ fontSize: "10px", padding: "2px 6px" }}
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
