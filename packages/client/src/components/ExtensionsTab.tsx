/**
 * Extensions Tab — runtime extension discovery and curated recommendations.
 *
 * Architecture: detect → activate — inspired by pi-forge's approach.
 * Shows what pi.dev extensions are installed, and recommends optimised ones.
 */

import { useEffect, useState, useCallback } from "react";
import {
  fetchExtensions,
  fetchSessionExtensions,
  installExtension as installExtApi,
  installManualExtension as installManualApi,
  uninstallExtension as uninstallExtApi,
  checkExtensionUpdates,
  updateExtension as updateExtApi,
  reloadAgent,
  getVisionConfig,
  setVisionConfig,
  fetchProviders,
  type ExtensionsResponse,
  type RecommendedExtension,
  type DiscoveredExtension,
  type AgentDef,
  type ExtensionUpdateInfo,
  type VisionConfigResponse,
  type ProviderGroup,
  type ModelInfo,
  type SessionExtensionInfo,
} from "../lib/api-client";
import { useSessionStore } from "../stores/session-store";

// ── Styles (inline for self-contained component) ──────────────────────

const s = {
  section: {
    marginBottom: 24,
  } as React.CSSProperties,
  heading: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: 8,
  } as React.CSSProperties,
  subheading: {
    fontSize: 11,
    color: "var(--text-dim)",
    marginBottom: 8,
  } as React.CSSProperties,
  card: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    background: "var(--bg-glass)",
    border: "1px solid var(--border-color)",
    marginBottom: 8,
  } as React.CSSProperties,
  cardIcon: {
    fontSize: 20,
    lineHeight: 1,
    marginTop: 2,
  } as React.CSSProperties,
  cardBody: {
    flex: 1,
    minWidth: 0,
  } as React.CSSProperties,
  cardTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: 2,
  } as React.CSSProperties,
  cardDesc: {
    fontSize: 11,
    color: "var(--text-secondary)",
    lineHeight: 1.4,
  } as React.CSSProperties,
  cardMeta: {
    fontSize: 10,
    color: "var(--text-dim)",
    marginTop: 4,
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  } as React.CSSProperties,
  tag: {
    display: "inline-block",
    padding: "1px 6px",
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
  } as React.CSSProperties,
  badge: {
    display: "inline-block",
    padding: "1px 6px",
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
  } as React.CSSProperties,
  installBtn: {
    padding: "4px 12px",
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 6,
    cursor: "pointer",
    border: "1px solid var(--border-color)",
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  categoryGroup: {
    marginBottom: 12,
  } as React.CSSProperties,
  agentConfigRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    fontSize: 11,
    borderBottom: "1px solid var(--border-color)",
  } as React.CSSProperties,
  reloadBtn: {
    float: "right" as const,
    padding: "2px 8px",
    fontSize: 10,
    borderRadius: 4,
    cursor: "pointer",
    border: "1px solid var(--border-color)",
    background: "none",
    color: "var(--text-dim)",
  } as React.CSSProperties,
  empty: {
    fontSize: 11,
    color: "var(--text-dim)",
    fontStyle: "italic",
    padding: "12px 0",
    textAlign: "center" as const,
  } as React.CSSProperties,
};

// ── Category labels ────────────────────────────────────────────────────

const categoryLabels: Record<string, string> = {
  orchestration: "🎯 Orchestration",
  tools: "🛠️ Tools & Integrations",
  productivity: "⚡ Productivity",
  integration: "🔗 Integrations",
  ui: "🎨 UI Enhancements",
};

// ── Main Component ─────────────────────────────────────────────────────

export function ExtensionsTab({ onError }: { onError: (msg: string) => void }) {
  const [data, setData] = useState<ExtensionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSessionExts, setActiveSessionExts] = useState<SessionExtensionInfo | null>(null);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const [installing, setInstalling] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [reloadSuccess, setReloadSuccess] = useState(false);
  const [refreshing, setRefreshing] = useState(0);
  const [updates, setUpdates] = useState<ExtensionUpdateInfo[] | undefined>(undefined);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [manualInstalling, setManualInstalling] = useState(false);

  // ── Vision tool config (secret: only shown when pi-vision-tool is installed) ──
  const [visionConfig, setVisionConfigState] = useState<VisionConfigResponse | null>(null);
  const [visionProviders, setVisionProviders] = useState<ProviderGroup[]>([]);
  const [visionCfgSaving, setVisionCfgSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const result = await fetchExtensions();
      setData(result);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load, refreshing]);

  // Fetch active session extension info when session changes
  useEffect(() => {
    if (!activeSessionId) {
      setActiveSessionExts(null);
      return;
    }
    let cancelled = false;
    fetchSessionExtensions(activeSessionId)
      .then((info) => {
        if (!cancelled) setActiveSessionExts(info);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, refreshing]);

  const handleUninstall = async (ext: DiscoveredExtension) => {
    const pkgId = ext.package ?? ext.name;
    if (!confirm(`Uninstall "${ext.name}"? It will be removed from the packages list and can be reinstalled from recommendations.`)) return;
    setUninstalling(ext.name);
    try {
      const result = await uninstallExtApi(pkgId);
      if (!result.success) {
        onError(result.error ?? "Uninstall failed");
      }
      setRefreshing((n) => n + 1);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setUninstalling(null);
    }
  };

  const handleInstall = async (ext: RecommendedExtension) => {
    setInstalling(ext.id);
    try {
      const result = await installExtApi(ext.package);
      if (!result.success) {
        onError(result.error ?? "Install failed");
      }
      // Refresh the list
      setRefreshing((n) => n + 1);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(null);
    }
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const result = await checkExtensionUpdates();
      setUpdates(result);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleUpdate = async (pkg: string) => {
    setUpdating(pkg);
    try {
      const result = await updateExtApi(pkg);
      if (!result.success) {
        onError(result.error ?? "Update failed");
      }
      // Re-check updates after update
      setUpdates(undefined);
      setRefreshing((n) => n + 1);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(null);
    }
  };

  const handleReload = async () => {
    setReloading(true);
    setReloadSuccess(false);
    try {
      await reloadAgent();
      // Server re-reads configs — just refresh our lists (no slow full page reload)
      setUpdates(undefined);
      setRefreshing((n) => n + 1);
      setReloadSuccess(true);
      setTimeout(() => setReloadSuccess(false), 2000);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setReloading(false);
    }
  };

  const handleManualInstall = async () => {
    const spec = manualInput.trim();
    if (spec.length === 0) return;
    setManualInstalling(true);
    try {
      const result = await installManualApi(spec);
      if (!result.success) {
        onError(result.error ?? "Install failed");
      }
      setManualInput("");
      setRefreshing((n) => n + 1);
      setUpdates(undefined);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setManualInstalling(false);
    }
  };

  const hasSubagents = data?.detected.some(
    (d) =>
      d.agentTypes?.includes("scout") ||
      d.agentTypes?.includes("planner") ||
      d.agentTypes?.includes("worker"),
  ) ?? false;

  // Also check recommended list for installed subagent providers
  const subagentInstalled = data?.recommended.some(
    (r) =>
      r.installed &&
      r.providesAgentTypes?.includes("scout") &&
      r.providesAgentTypes?.includes("worker"),
  ) ?? false;

  const showAgentSettings = hasSubagents || subagentInstalled;

  // ── Vision tool detection & providers fetch (MUST be before early return) ──
  const hasVisionTool =
    data?.detected.some(
      (d) => d.name === "pi-vision-tool" || d.package === "npm:pi-vision-tool",
    ) ?? false;

  useEffect(() => {
    if (!hasVisionTool) {
      setVisionConfigState(null);
      return;
    }
    getVisionConfig().then(setVisionConfigState).catch(() => {});
    fetchProviders().then((r) => setVisionProviders(r.providers)).catch(() => {});
  }, [hasVisionTool, refreshing]);

  if (loading && !data) {
    return <div style={{ padding: 16, fontSize: 12, color: "var(--text-dim)" }}>Loading extensions…</div>;
  }

  const handleSaveVisionConfig = async (provider: string, model: string) => {
    setVisionCfgSaving(true);
    try {
      await setVisionConfig({ provider, model });
      setVisionConfigState((prev) => prev ? { ...prev, provider, model } : null);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setVisionCfgSaving(false);
    }
  };

  // ── Agent Type Settings (shown when subagent extension is detected) ──
  const agentTypes = [
    ...(data?.agents ?? []),
    // Mix in builtin defaults if not overridden by files
    ...(data ? [] : []),
  ];

  return (
    <div style={{ fontSize: 12 }}>
      {/* ── Info banner ── */}
      <div
        style={{
          background: "rgba(52, 211, 153, 0.1)",
          border: "1px solid rgba(52, 211, 153, 0.25)",
          borderRadius: 8,
          padding: "8px 12px",
          marginBottom: 16,
          fontSize: 11,
          color: "#34d399",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 16 }}>🔌</span>
        <span>
          Extensions are installed via <code style={{ fontSize: 10 }}>npm install</code> and
          auto-activated in all running sessions. Look for the{" "}
          <strong>Active</strong> badge.
        </span>
      </div>

      {/* ── Agent type settings (conditional) ── */}
      {showAgentSettings && (
        <div style={s.section}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={s.heading}>🧩 Agent Type Settings</div>
              <div style={s.subheading}>
                Default models for each subagent type. Edit the agent markdown files in{" "}
                <code style={{ fontSize: 10 }}>~/.pi/agent/agents/</code> to change.
              </div>
            </div>
            <span style={s.badge}>pi-subagents detected</span>
          </div>

          <div
            style={{
              borderRadius: 8,
              border: "1px solid var(--border-color)",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                ...s.agentConfigRow,
                fontWeight: 600,
                fontSize: 10,
                color: "var(--text-dim)",
                textTransform: "uppercase" as const,
                borderBottom: "2px solid var(--border-color)",
              }}
            >
              <span style={{ width: 70 }}>Agent</span>
              <span style={{ flex: 1 }}>Default Model</span>
              <span style={{ width: 120 }}>Tools</span>
              <span style={{ width: 60, textAlign: "right" as const }}>Source</span>
            </div>

            {renderAgentRow({ name: "scout", description: "Fast codebase recon", model: "claude-haiku-4-5", tools: ["read", "grep", "find", "ls", "bash"], source: "builtin" }, data?.agents)}
            {renderAgentRow({ name: "planner", description: "Implementation plans", model: "claude-sonnet-4-5", tools: ["read", "grep", "find", "ls"], source: "builtin" }, data?.agents)}
            {renderAgentRow({ name: "reviewer", description: "Code review & QA", model: "claude-sonnet-4-5", tools: ["read", "grep", "find", "ls", "bash"], source: "builtin" }, data?.agents)}
            {renderAgentRow({ name: "worker", description: "General-purpose execution", model: "claude-sonnet-4-5", tools: [], source: "builtin" }, data?.agents)}
          </div>

          <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 6 }}>
            💡 Install the <strong>pi-subagents</strong> extension below to activate these agent types.
            Models are set in <code>~/.pi/agent/agents/&lt;name&gt;.md</code> frontmatter.
          </div>
        </div>
      )}

      {/* ── Vision Tool Config (secret: only when pi-vision-tool is installed) ── */}
      {hasVisionTool && visionConfig?.installed && (
        <div style={s.section}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={s.heading}>👁️ Vision Tool Settings</div>
              <div style={s.subheading}>
                Select which provider/model to delegate image analysis to.{" "}
                <code style={{ fontSize: 10 }}>describe_image</code> will route to this model.
              </div>
            </div>
            <span style={s.badge}>pi-vision-tool detected</span>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "end", marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>Provider</div>
              <select
                value={visionConfig.provider ?? ""}
                onChange={(e) => {
                  const p = e.target.value;
                  // Reset model when provider changes
                  const firstModel = visionProviders.find((g) => g.provider === p)?.models?.[0];
                  void handleSaveVisionConfig(p, firstModel?.id ?? "");
                }}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  fontSize: 11,
                  borderRadius: 6,
                  border: "1px solid var(--border-color)",
                  background: "var(--bg-glass)",
                  color: "var(--text-primary)",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="" disabled>Select provider…</option>
                {visionProviders.map((g) => (
                  <option key={g.provider} value={g.provider}>{g.provider}</option>
                ))}
              </select>
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>Model</div>
              <select
                value={visionConfig.model ?? ""}
                onChange={(e) => {
                  void handleSaveVisionConfig(visionConfig.provider ?? "", e.target.value);
                }}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  fontSize: 11,
                  borderRadius: 6,
                  border: "1px solid var(--border-color)",
                  background: "var(--bg-glass)",
                  color: "var(--text-primary)",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="" disabled>Select model…</option>
                {visionProviders
                  .find((g) => g.provider === visionConfig.provider)
                  ?.models?.filter((m) => m.input?.includes("image"))
                  .map((m) => (
                    <option key={m.id} value={m.id}>{m.name ?? m.id}</option>
                  ))}
              </select>
            </div>

            <div>
              <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>&nbsp;</div>
              {visionCfgSaving && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>Saving…</span>}
              {!visionCfgSaving && visionConfig.provider && visionConfig.model && (
                <span style={{ fontSize: 10, color: "#22c55e" }}>✓ Saved</span>
              )}
            </div>
          </div>

          <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 6 }}>
            Config saved to <code style={{ fontSize: 10 }}>~/.pi/agent/vision-tool.json</code>.
            Changes apply on next session start.
          </div>
        </div>
      )}

      {/* ── Detected / Installed ── */}
      <div style={s.section}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={s.heading}>📦 Installed Extensions</div>
          <button
            onClick={() => setRefreshing((n) => n + 1)}
            style={s.reloadBtn}
            title="Refresh"
          >
            ↻
          </button>
        </div>

        {!data || data.detected.length === 0 ? (
          <div style={s.empty}>
            No extensions detected. Install some from the recommendations below.
          </div>
        ) : (
          data.detected.map((ext, i) => {
            const extUpdate = updates?.find(
              (u) => u.package === (ext.package?.replace("npm:", "") ?? ext.name),
            );
            // Check if this extension is active in the current session
            const extName = ext.name;
            const isActiveInSession = activeSessionExts?.activeExtensions.some(
              (ae) =>
                ae.displayPath === extName ||
                ae.displayPath.includes(extName) ||
                extName.includes(ae.displayPath),
            ) ?? false;
            return (
              <div key={`det-${i}`}>
                <InstalledCard
                  ext={ext}
                  update={extUpdate}
                  active={isActiveInSession}
                  sessionCommands={activeSessionExts?.commands ?? null}
                  updating={updating === (ext.package ?? ext.name)}
                  uninstalling={uninstalling === ext.name}
                  onUninstall={handleUninstall}
                  onUpdate={handleUpdate}
                />
              </div>
            );
          })
        )}
      </div>

      {/* ── Recommended ── */}
      <div style={s.section}>
        <div style={s.heading}>💎 Recommended for pi-kot</div>
        <div style={s.subheading}>
          Curated pi.dev extensions optimised for the web UI. Click to install.
        </div>

        {groupByCategory(data?.recommended ?? []).map(([cat, exts]) => (
          <div key={cat} style={s.categoryGroup}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: 6,
              }}
            >
              {categoryLabels[cat] ?? cat}
            </div>

            {exts.map((ext) => (
              <RecommendedCard
                key={ext.id}
                ext={ext}
                installing={installing === ext.id}
                onInstall={() => handleInstall(ext)}
              />
            ))}
          </div>
        ))}
      </div>

      {/* ── Manual install ── */}
      <div style={s.section}>
        <div style={s.heading}>🔧 Manual Install</div>
        <div style={s.subheading}>
          Install any pi extension by its install spec. Delegates to{" "}
          <code style={{ fontSize: 10 }}>pi install &lt;spec&gt;</code> CLI.
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="text"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder={"e.g. npm:pi-free  or  git:github.com/apmantza/pi-free"}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleManualInstall();
            }}
            style={{
              flex: 1,
              padding: "6px 10px",
              fontSize: 11,
              fontFamily: "monospace",
              borderRadius: 6,
              border: "1px solid var(--border-color)",
              background: "var(--bg-glass)",
              color: "var(--text-primary)",
              outline: "none",
            }}
          />
          <button
            onClick={handleManualInstall}
            disabled={manualInstalling || manualInput.trim().length === 0}
            style={{
              padding: "6px 14px",
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 6,
              cursor: "pointer",
              border: "1px solid var(--border-color)",
              background: manualInstalling ? "var(--bg-glass)" : "var(--accent-bg, #3b82f6)",
              color: manualInstalling ? "var(--text-dim)" : "white",
              whiteSpace: "nowrap" as const,
            }}
          >
            {manualInstalling ? "Installing…" : "pi install"}
          </button>
        </div>
      </div>

      {/* ── Reload agent ── */}
      <div style={s.section}>
        <div style={s.heading}>🔄 Agent Reload</div>
        <div style={s.subheading}>
          Reload the pi agent configuration (MCP + extension cache) after installing
          or updating extensions. Fast — no full page reload.
        </div>
        <button
          onClick={handleReload}
          disabled={reloading}
          style={{
            padding: "6px 14px",
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 6,
            cursor: reloading ? "default" : "pointer",
            border: "1px solid var(--border-color)",
            background: reloading ? "var(--bg-glass)" : "var(--accent-bg, #3b82f6)",
            color: reloading ? "var(--text-dim)" : "white",
          }}
        >
          {reloading ? "Reloading…" : reloadSuccess ? "Reloaded ✓" : "/reload"}
        </button>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function renderAgentRow(
  builtin: AgentDef,
  userAgents: AgentDef[] | undefined,
) {
  const override = userAgents?.find((a) => a.name === builtin.name);
  const agent = override ?? builtin;

  return (
    <div key={agent.name} style={s.agentConfigRow}>
      <span style={{ width: 70, fontWeight: 600 }}>{agent.name}</span>
      <span style={{ flex: 1, color: "var(--text-secondary)", fontFamily: "monospace", fontSize: 10 }}>
        {agent.model ?? "—"}
      </span>
      <span style={{ width: 120, color: "var(--text-dim)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {agent.tools && agent.tools.length > 0 ? agent.tools.join(", ") : "(all)"}
      </span>
      <span
        style={{
          width: 60,
          textAlign: "right",
          fontSize: 10,
          color: agent.source === "file" ? "var(--accent-text)" : "var(--text-dim)",
        }}
      >
        {agent.source === "file" ? "custom" : "builtin"}
      </span>
    </div>
  );
}

function InstalledCard({
  ext,
  update,
  active,
  sessionCommands,
  updating,
  uninstalling,
  onUninstall,
  onUpdate,
}: {
  ext: DiscoveredExtension;
  update?: ExtensionUpdateInfo;
  active?: boolean;
  sessionCommands?: Array<{ name: string; invocationName: string; description: string }> | null;
  updating?: boolean;
  uninstalling: boolean;
  onUninstall: (ext: DiscoveredExtension) => void;
  onUpdate: (pkg: string) => void;
}) {
  // Find commands contributed by this extension (fuzzy match by name prefix)
  const extCmds = sessionCommands?.filter(
    (c) =>
      ext.name.includes(c.name) ||
      c.name.includes(ext.name.replace(/^npm:/, "")) ||
      ext.package?.includes(c.name) ||
      c.name.includes(ext.name),
  ) ?? [];

  return (
    <div style={s.card}>
      <span style={s.cardIcon}>
        {ext.source === "extensions_dir" ? "📄" : ext.source === "agents_dir" ? "🤖" : "📦"}
      </span>
      <div style={s.cardBody}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={s.cardTitle}>{ext.name}</div>
          {active && (
            <span
              style={{
                display: "inline-block",
                padding: "1px 7px",
                borderRadius: 10,
                fontSize: 10,
                fontWeight: 600,
                background: "rgba(52, 211, 153, 0.15)",
                color: "#34d399",
                border: "1px solid rgba(52, 211, 153, 0.3)",
                lineHeight: "18px",
              }}
            >
              Active
            </span>
          )}
          {update?.updateAvailable && (
            <span
              style={{
                display: "inline-block",
                padding: "1px 7px",
                borderRadius: 10,
                fontSize: 10,
                fontWeight: 600,
                background: "rgba(34, 197, 94, 0.15)",
                color: "#22c55e",
                border: "1px solid rgba(34, 197, 94, 0.3)",
                lineHeight: "18px",
              }}
            >
              {update.installed} → {update.latest}
            </span>
          )}
        </div>
        <div style={s.cardDesc}>{ext.description}</div>
        {update && !update.updateAvailable && update.installed && (
          <div style={{ ...s.cardMeta, color: "var(--text-dim)" }}>
            v{update.installed}
          </div>
        )}
        <div style={s.cardMeta}>
          <span
            style={{
              ...s.tag,
              background: ext.source === "package" ? "var(--accent-subtle)" : "var(--bg-glass-hover)",
              color: ext.source === "package" ? "var(--accent-text)" : "var(--text-dim)",
            }}
          >
            {ext.source === "package" ? "npm package" : ext.source === "extensions_dir" ? "extension" : ext.source === "agents_dir" ? "agent" : "builtin"}
          </span>
          {ext.agentTypes && ext.agentTypes.length > 0 && (
            <span style={{ color: "var(--text-dim)" }}>
              agents: {ext.agentTypes.join(", ")}
            </span>
          )}
          {ext.enablesFeatures && ext.enablesFeatures.length > 0 && (
            <span style={{ color: "var(--text-dim)" }}>
              ✨ {ext.enablesFeatures[0]}
              {ext.enablesFeatures.length > 1 ? ` +${ext.enablesFeatures.length - 1}` : ""}
            </span>
          )}
          {extCmds.length > 0 && (
            <span style={{ color: "var(--accent-text, #818cf8)" }}>
              /{extCmds.map((c) => c.invocationName).join(", /")}
            </span>
          )}
        </div>
      </div>
      {ext.source === "package" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {update?.updateAvailable && (
            <button
              onClick={() => onUpdate(ext.package ?? ext.name)}
              disabled={updating}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 6,
                cursor: "pointer",
                border: "1px solid rgba(34, 197, 94, 0.4)",
                background: updating ? "var(--bg-glass)" : "rgba(34, 197, 94, 0.1)",
                color: "#22c55e",
                whiteSpace: "nowrap" as const,
              }}
            >
              {updating ? "…" : "Update"}
            </button>
          )}
          <button
            onClick={() => onUninstall(ext)}
            disabled={uninstalling}
            style={{
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 6,
              cursor: "pointer",
              border: "1px solid rgba(224, 108, 117, 0.4)",
              background: uninstalling ? "var(--bg-glass)" : "rgba(224, 108, 117, 0.1)",
              color: "var(--accent-red, #e06c75)",
              whiteSpace: "nowrap" as const,
            }}
          >
            {uninstalling ? "…" : "Uninstall"}
          </button>
        </div>
      )}
    </div>
  );
}

function RecommendedCard({
  ext,
  installing,
  onInstall,
}: {
  ext: RecommendedExtension;
  installing: boolean;
  onInstall: () => void;
}) {
  const [installed, setInstalled] = useState(ext.installed);
  const [justInstalled, setJustInstalled] = useState(false);

  const handleClick = async () => {
    if (installed) return;
    setInstalled(true);
    setJustInstalled(true);
    onInstall();
  };

  return (
    <div
      style={{
        ...s.card,
        opacity: installed ? 0.7 : 1,
      }}
    >
      <span style={s.cardIcon}>{ext.icon}</span>
      <div style={s.cardBody}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={s.cardTitle}>{ext.name}</div>
          {ext.verified && (
            <span
              style={{
                display: "inline-block",
                padding: "1px 7px",
                borderRadius: 10,
                fontSize: 10,
                fontWeight: 600,
                background: "rgba(34, 197, 94, 0.15)",
                color: "#22c55e",
                border: "1px solid rgba(34, 197, 94, 0.3)",
                lineHeight: "18px",
              }}
            >
              ✓ Verified
            </span>
          )}
        </div>
        <div style={s.cardDesc}>{ext.description}</div>
        <div style={s.cardMeta}>
          {ext.providesAgentTypes && ext.providesAgentTypes.length > 0 && (
            <span style={{ color: "var(--text-dim)" }}>
              agents: {ext.providesAgentTypes.join(", ")}
            </span>
          )}
          {ext.enablesFeatures && ext.enablesFeatures.length > 0 && (
            <span style={{ color: "var(--text-dim)" }}>
              ✨ {ext.enablesFeatures.join(" · ")}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={handleClick}
        disabled={installed || installing}
        style={{
          ...s.installBtn,
          background: installed
            ? "var(--accent-subtle)"
            : "var(--accent-bg, #3b82f6)",
          color: installed ? "var(--accent-text)" : "white",
          borderColor: installed ? "var(--accent-border)" : "transparent",
          cursor: installed ? "default" : "pointer",
        }}
      >
        {installing ? "…" : installed ? "✓ Installed" : "Install"}
      </button>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function groupByCategory(
  items: RecommendedExtension[],
): [string, RecommendedExtension[]][] {
  const map = new Map<string, RecommendedExtension[]>();
  for (const item of items) {
    const arr = map.get(item.category) ?? [];
    arr.push(item);
    map.set(item.category, arr);
  }
  return Array.from(map.entries());
}
