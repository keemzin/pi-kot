/**
 * Extensions Tab — runtime extension discovery and curated recommendations.
 *
 * Architecture: detect → activate — inspired by pi-forge's approach.
 * Shows what pi.dev extensions are installed, and recommends optimised ones.
 */

import { useEffect, useState, useCallback } from "react";
import {
  fetchExtensions,
  installExtension as installExtApi,
  uninstallExtension as uninstallExtApi,
  type ExtensionsResponse,
  type RecommendedExtension,
  type DiscoveredExtension,
  type AgentDef,
} from "../lib/api-client";

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
  const [installing, setInstalling] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(0);

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

  if (loading && !data) {
    return <div style={{ padding: 16, fontSize: 12, color: "var(--text-dim)" }}>Loading extensions…</div>;
  }

  // ── Agent Type Settings (shown when subagent extension is detected) ──
  const agentTypes = [
    ...(data?.agents ?? []),
    // Mix in builtin defaults if not overridden by files
    ...(data ? [] : []),
  ];

  return (
    <div style={{ fontSize: 12 }}>
      {/* ── Experimental banner ── */}
      <div
        style={{
          background: "var(--accent-subtle, #fef3cd)",
          border: "1px solid var(--accent-border, #ffc107)",
          borderRadius: 8,
          padding: "8px 12px",
          marginBottom: 16,
          fontSize: 11,
          color: "var(--accent-text, #856404)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 16 }}>⚗️</span>
        <span>
          <strong>Experimental</strong> — extension install runs{" "}
          <code style={{ fontSize: 10 }}>npm install</code> directly. Extensions
          detected here may not auto-activate in sessions yet — needs more
          SDK plumbing.
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
          data.detected.map((ext, i) => (
            <div key={`det-${i}`}>
              <InstalledCard
                ext={ext}
                uninstalling={uninstalling === ext.name}
                onUninstall={handleUninstall}
              />
            </div>
          ))
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
  uninstalling,
  onUninstall,
}: {
  ext: DiscoveredExtension;
  uninstalling: boolean;
  onUninstall: (ext: DiscoveredExtension) => void;
}) {
  return (
    <div style={s.card}>
      <span style={s.cardIcon}>
        {ext.source === "extensions_dir" ? "📄" : ext.source === "agents_dir" ? "🤖" : "📦"}
      </span>
      <div style={s.cardBody}>
        <div style={s.cardTitle}>{ext.name}</div>
        <div style={s.cardDesc}>{ext.description}</div>
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
        </div>
      </div>
      {ext.source === "package" && (
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
