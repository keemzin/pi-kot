/**
 * Packages Tab — SDK-powered package management (merged from ExtensionsTab).
 *
 * Features:
 * - SDK package inventory with resources (extensions, skills, prompts, themes)
 * - Install / uninstall / enable-disable / updates
 * - Verified badge from recommended catalog
 * - Vision Tool Settings (when pi-vision-tool is installed)
 * - Agent reload
 */

import { useEffect, useState, useCallback } from "react";
import {
  fetchSdkPackages,
  installSdkPackage,
  removeSdkPackage,
  toggleSdkPackage,
  fetchExtensions,
  checkExtensionUpdates as apiCheckUpdates,
  updateExtension as apiUpdateExtension,
  getVisionConfig,
  setVisionConfig as apiSetVisionConfig,
  fetchProviders,
  reloadAgent,
  type SdkPackagesResponse,
  type SdkPackageInfo,
  type SdkResourceInfo,
  type ExtensionsResponse,
  type RecommendedExtension,
  type ExtensionUpdateInfo,
  type VisionConfigResponse,
  type SetVisionConfigPayload,
  type ProviderGroup,
  REASONING_LEVELS,
  type ReasoningLevel,
} from "../lib/api-client";

// ── Styles ──────────────────────────────────────────────────────────

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
    borderRadius: 8,
    background: "var(--bg-glass)",
    border: "1px solid var(--border-color)",
    marginBottom: 8,
    overflow: "hidden",
  } as React.CSSProperties,
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    cursor: "pointer",
    userSelect: "none" as const,
  } as React.CSSProperties,
  cardTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-primary)",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  badge: {
    fontSize: 10,
    padding: "1px 6px",
    borderRadius: 4,
    fontWeight: 500,
    flexShrink: 0,
  } as React.CSSProperties,
  resourceSection: {
    padding: "0 12px 10px",
  } as React.CSSProperties,
  resourceItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    borderRadius: 4,
    fontSize: 11,
    color: "var(--text-secondary)",
  } as React.CSSProperties,
  resourceIcon: {
    fontSize: 13,
    width: 18,
    textAlign: "center" as const,
    flexShrink: 0,
  } as React.CSSProperties,
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    flexShrink: 0,
  } as React.CSSProperties,
  toggle: {
    fontSize: 10,
    padding: "2px 8px",
    borderRadius: 4,
    border: "1px solid var(--border-color)",
    background: "var(--bg-glass)",
    color: "var(--text-secondary)",
    cursor: "pointer",
    flexShrink: 0,
  } as React.CSSProperties,
  empty: {
    fontSize: 12,
    color: "var(--text-dim)",
    textAlign: "center" as const,
    padding: 40,
  } as React.CSSProperties,
  totals: {
    display: "flex",
    gap: 16,
    marginBottom: 16,
    flexWrap: "wrap" as const,
  } as React.CSSProperties,
  totalItem: {
    fontSize: 11,
    color: "var(--text-dim)",
  } as React.CSSProperties,
  totalNum: {
    fontWeight: 600,
    color: "var(--text-primary)",
  } as React.CSSProperties,
  expandIcon: {
    fontSize: 10,
    color: "var(--text-dim)",
    flexShrink: 0,
    transition: "transform 0.15s",
  } as React.CSSProperties,
  disabled: {
    opacity: 0.5,
  } as React.CSSProperties,
  actionBtn: {
    fontSize: 10,
    padding: "3px 10px",
    borderRadius: 4,
    border: "1px solid var(--border-color)",
    background: "var(--bg-glass)",
    color: "var(--text-secondary)",
    cursor: "pointer",
    flexShrink: 0,
    fontWeight: 500,
  } as React.CSSProperties,
  dangerBtn: {
    fontSize: 10,
    padding: "3px 10px",
    borderRadius: 4,
    border: "1px solid rgba(224, 108, 117, 0.3)",
    background: "rgba(224, 108, 117, 0.08)",
    color: "#e06c75",
    cursor: "pointer",
    flexShrink: 0,
    fontWeight: 500,
  } as React.CSSProperties,
  installBox: {
    display: "flex",
    gap: 8,
    marginBottom: 8,
    alignItems: "end",
  } as React.CSSProperties,
  installInput: {
    flex: 1,
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid var(--border-color)",
    background: "var(--bg-glass)",
    color: "var(--text-primary)",
    fontSize: 12,
    outline: "none",
    fontFamily: "inherit",
  } as React.CSSProperties,
  label: {
    fontSize: 10,
    color: "var(--text-dim)",
    marginBottom: 4,
  } as React.CSSProperties,
};

// ── Helpers ─────────────────────────────────────────────────────────

const RESOURCE_ICONS: Record<SdkResourceInfo["kind"], string> = {
  extension: "🧩",
  skill: "🛠️",
  prompt: "📝",
  theme: "🎨",
};

const SCOPE_LABELS: Record<string, string> = {
  user: "global",
  project: "project",
};

const STATUS_COLORS: Record<string, string> = {
  loaded: "var(--green, #34d399)",
  disabled: "var(--text-dim, #888)",
  installed: "var(--yellow, #fbbf24)",
  missing: "var(--red, #ef4444)",
};

const CATEGORY_LABELS: Record<string, string> = {
  orchestration: "🎯 Orchestration",
  tools: "🛠️ Tools & Integrations",
  productivity: "⚡ Productivity",
  integration: "🔗 Integrations",
  ui: "🎨 UI Enhancements",
};

function groupByCategory(items: RecommendedExtension[]): [string, RecommendedExtension[]][] {
  const map = new Map<string, RecommendedExtension[]>();
  for (const item of items) {
    const arr = map.get(item.category) ?? [];
    arr.push(item);
    map.set(item.category, arr);
  }
  return Array.from(map.entries());
}

const INPUT_STYLE: React.CSSProperties = {
  width: 80,
  padding: "4px 6px",
  fontSize: 11,
  borderRadius: 6,
  border: "1px solid var(--border-color)",
  background: "var(--bg-glass)",
  color: "var(--text-primary)",
  outline: "none",
};

const SELECT_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  cursor: "pointer",
};

// ── Recommended Extension Card (with scope toggle) ────────────────

function RecommendedExtCard({
  ext,
  installedScope,
  installing,
  projectPath,
  onInstall,
}: {
  ext: RecommendedExtension;
  installedScope?: "user" | "project";
  installing: boolean;
  projectPath?: string;
  onInstall: (scope: "user" | "project") => void;
}) {
  const hasProject = projectPath !== undefined && projectPath.length > 0;
  const [scope, setScope] = useState<"user" | "project">(hasProject ? "project" : "user");
  const canBeProject = hasProject;
  // Only grey out if installed in the SAME scope as current selection.
  // Project-scoped installs are per-project, so user can install to other projects.
  const alreadyInstalled = installedScope === scope;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 8,
        background: "var(--bg-glass)",
        border: "1px solid var(--border-color)",
        marginBottom: 6,
        opacity: alreadyInstalled ? 0.6 : 1,
      }}
    >
      <span style={{ fontSize: 16 }}>{ext.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text-primary)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {ext.name}
          {ext.verified && (
            <span
              style={{
                fontSize: 9,
                padding: "1px 5px",
                borderRadius: 3,
                background: "rgba(52, 211, 153, 0.12)",
                color: "#34d399",
                fontWeight: 500,
              }}
            >
              ✓ Verified
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "var(--text-dim)",
            marginTop: 2,
            lineHeight: 1.4,
          }}
        >
          {ext.description}
        </div>
      </div>

      {/* Scope toggle — only when a project is selected */}
      {canBeProject && !alreadyInstalled && (
        <div
          style={{
            display: "inline-flex",
            border: "1px solid var(--border-color)",
            borderRadius: 5,
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          {(["user", "project"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              style={{
                padding: "2px 8px",
                fontSize: 9,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.03em",
                border: "none",
                borderRight: s === "user" ? "1px solid var(--border-color)" : "none",
                background: scope === s ? "var(--bg-surface)" : "transparent",
                color: scope === s ? "var(--text-primary)" : "var(--text-dim)",
                cursor: "pointer",
              }}
            >
              {s === "user" ? "global" : "project"}
            </button>
          ))}
        </div>
      )}

      <button
        style={{
          fontSize: 10,
          padding: "4px 12px",
          borderRadius: 5,
          border: "none",
          background: alreadyInstalled
            ? "var(--bg-surface)"
            : "var(--accent-bg, #3b82f6)",
          color: alreadyInstalled ? "var(--text-dim)" : "white",
          cursor: alreadyInstalled ? "default" : "pointer",
          fontWeight: 500,
          flexShrink: 0,
        }}
        onClick={() => {
          if (!alreadyInstalled) onInstall(scope);
        }}
        disabled={installing || alreadyInstalled}
      >
        {installing ? "…" : alreadyInstalled ? (scope === "project" ? `Installed (project)` : "Installed") : "Install"}
      </button>
    </div>
  );
}

// ── Package Card ──────────────────────────────────────────────────

function PackageCard({
  pkg,
  expanded,
  pkgUpdate,
  busy,
  installing,
  uninstalling,
  updating,
  onToggleExpand,
  onToggle,
  onUninstall,
  onUpdate,
}: {
  pkg: SdkPackageInfo;
  expanded: boolean;
  pkgUpdate?: ExtensionUpdateInfo;
  busy: boolean;
  installing: string | null;
  uninstalling: string | null;
  updating: string | null;
  onToggleExpand: () => void;
  onToggle: () => void;
  onUninstall: () => void;
  onUpdate: (pkgSource: string) => void;
}) {
  const key = `${pkg.scope}\0${pkg.source}`;
  const hasResources = pkg.resources.length > 0;

  return (
    <div
      style={{
        ...s.card,
        ...(pkg.disabled ? s.disabled : {}),
      }}
    >
      {/* Header — click to expand */}
      <div>
        {/* Row 1: identity */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px 4px",
            cursor: "pointer",
            userSelect: "none" as const,
          }}
          onClick={onToggleExpand}
        >
          <span
            style={{
              ...s.expandIcon,
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            }}
          >
            ▶
          </span>

          <span
            style={{
              ...s.statusDot,
              background: STATUS_COLORS[pkg.status] ?? "var(--text-dim)",
            }}
          />

          <span style={s.cardTitle}>
            {pkg.packageName || pkg.source}
          </span>

          {pkg.version && (
            <span
              style={{
                ...s.badge,
                background: "var(--bg-surface)",
                color: "var(--text-dim)",
              }}
            >
              v{pkg.version}
            </span>
          )}
        </div>

        {/* Row 2: actions */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 12px 10px 38px",
            flexWrap: "wrap" as const,
          }}
        >
          {pkgUpdate?.updateAvailable && (
            <button
              style={s.actionBtn}
              onClick={(e) => {
                e.stopPropagation();
                onUpdate(pkgUpdate.package);
              }}
              disabled={updating === pkgUpdate.package}
              title={`Update: ${pkgUpdate.installed} → ${pkgUpdate.latest}`}
            >
              {updating === pkgUpdate.package ? "…" : "Update"}
            </button>
          )}

          <button
            style={s.toggle}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            disabled={busy}
          >
            {pkg.disabled ? "Enable" : "Disable"}
          </button>

          <button
            style={s.dangerBtn}
            onClick={(e) => {
              e.stopPropagation();
              onUninstall();
            }}
            disabled={uninstalling === pkg.source}
          >
            {uninstalling === pkg.source ? "…" : "Uninstall"}
          </button>
        </div>
      </div>

      {/* Expanded resources */}
      {expanded && (
        <div style={s.resourceSection}>
          {!hasResources && (
            <div style={{ fontSize: 11, color: "var(--text-dim)", padding: "4px 8px" }}>
              {pkg.status === "missing"
                ? "Package not installed."
                : "No resources loaded from this package."}
            </div>
          )}

          {(["extension", "skill", "prompt", "theme"] as const).map((kind) => {
            const items = pkg.resources.filter((r) => r.kind === kind);
            if (items.length === 0) return null;
            return (
              <div key={kind} style={{ marginBottom: 6 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: "var(--text-dim)",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    marginBottom: 2,
                    padding: "0 8px",
                  }}
                >
                  {RESOURCE_ICONS[kind]} {kind}s ({items.length})
                </div>
                {items.map((r, i) => (
                  <div key={r.path + i} style={s.resourceItem}>
                    <span style={{ color: "var(--text-dim)", fontSize: 10 }}>
                      {r.relativePath}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────

interface Props {
  onError: (msg: string | undefined) => void;
  /** Active project's filesystem path (for project-local installs). */
  projectPath?: string;
}

export function PackagesTab({ onError, projectPath }: Props) {
  // ── SDK packages ──
  const [sdkData, setSdkData] = useState<SdkPackagesResponse | undefined>();
  const [extData, setExtData] = useState<ExtensionsResponse | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // ── Actions ──
  const [installing, setInstalling] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [installSource, setInstallSource] = useState("");
  const [installScope, setInstallScope] = useState<"user" | "project">(projectPath ? "project" : "user");
  const [manualInput, setManualInput] = useState("");

  // ── Updates ──
  const [updates, setUpdates] = useState<ExtensionUpdateInfo[] | undefined>(undefined);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  // ── Vision tool ──
  const [visionConfig, setVisionConfig] = useState<VisionConfigResponse | null>(null);
  const [visionProviders, setVisionProviders] = useState<ProviderGroup[]>([]);
  const [visionCfgSaving, setVisionCfgSaving] = useState(false);

  // ── Reload ──
  const [reloading, setReloading] = useState(false);
  const [reloadSuccess, setReloadSuccess] = useState(false);

  // ── Data loading ──

  const loadSdk = useCallback(async () => {
    try {
      const result = await fetchSdkPackages(projectPath);
      setSdkData(result);
    } catch (err) {
      onError(`Failed to load packages: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [onError, projectPath]);

  const loadExt = useCallback(async () => {
    try {
      const result = await fetchExtensions();
      setExtData(result);
    } catch (err) {
      onError(`Failed to load extensions catalog: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [onError]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadSdk(), loadExt()]);
  }, [loadSdk, loadExt]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Vision tool detection
  const hasVisionTool =
    extData?.detected.some(
      (d) => d.name === "pi-vision-tool" || d.package === "npm:pi-vision-tool",
    ) ?? false;

  useEffect(() => {
    if (!hasVisionTool) {
      setVisionConfig(null);
      return;
    }
    getVisionConfig().then(setVisionConfig).catch(() => {});
    (async () => {
      try {
        const r = await fetchProviders();
        setVisionProviders(r.providers);
      } catch {
        // providers not critical
      }
    })();
  }, [hasVisionTool]);

  // ── Build verified set from recommended catalog ──
  const verifiedSources = new Set<string>();
  if (extData) {
    for (const r of extData.recommended) {
      if (r.verified) {
        // Store both npm: prefixed and bare for cross-ref with SDK source
        const bare = r.package.replace(/^npm:/, "");
        verifiedSources.add(r.package);
        verifiedSources.add(bare);
      }
    }
  }

  // ── Build update lookup ──
  const updateMap = new Map<string, ExtensionUpdateInfo>();
  if (updates) {
    for (const u of updates) {
      updateMap.set(u.package, u);
    }
  }

  // ── Actions ──

  const handleInstall = async (source: string, scope?: "user" | "project") => {
    if (!source) return;
    const effectiveScope = scope ?? installScope;
    setInstalling(source);
    onError(undefined);
    try {
      const isLocal = effectiveScope === "project" && projectPath !== undefined;
      await installSdkPackage(source, isLocal, isLocal ? projectPath : undefined);
      setInstallSource("");
      await loadSdk();
    } catch (err) {
      onError(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInstalling(null);
    }
  };

  const handleManualInstall = async () => {
    const spec = manualInput.trim();
    if (!spec) return;
    // Use regular install endpoint — it handles npm:, git:, etc.
    await handleInstall(spec);
    setManualInput("");
  };

  const handleUninstall = async (pkg: SdkPackageInfo) => {
    if (!confirm(`Uninstall "${pkg.packageName || pkg.source}"?`)) return;
    setUninstalling(pkg.source);
    onError(undefined);
    try {
      const isLocal = pkg.scope === "project" && projectPath !== undefined;
      await removeSdkPackage(pkg.source, isLocal, isLocal ? projectPath : undefined);
      await loadSdk();
    } catch (err) {
      onError(`Uninstall failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUninstalling(null);
    }
  };

  const handleToggle = async (pkg: SdkPackageInfo) => {
    setBusy(true);
    onError(undefined);
    try {
      const isLocal = pkg.scope === "project" && projectPath !== undefined;
      await toggleSdkPackage(pkg.source, pkg.scope, !pkg.disabled, isLocal ? projectPath : undefined);
      await loadSdk();
    } catch (err) {
      onError(`Toggle failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    onError(undefined);
    try {
      const result = await apiCheckUpdates();
      setUpdates(result);
    } catch (err) {
      onError(`Check updates failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleUpdate = async (pkgSource: string) => {
    setUpdating(pkgSource);
    onError(undefined);
    try {
      await apiUpdateExtension(pkgSource);
      await loadSdk();
      // Re-check updates after update
      const result = await apiCheckUpdates();
      setUpdates(result);
    } catch (err) {
      onError(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUpdating(null);
    }
  };

  const handleReload = async () => {
    setReloading(true);
    setReloadSuccess(false);
    onError(undefined);
    try {
      await reloadAgent();
      setReloadSuccess(true);
      setTimeout(() => setReloadSuccess(false), 2000);
    } catch (err) {
      onError(`Reload failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReloading(false);
    }
  };

  const handleSaveVisionConfig = async (patch: SetVisionConfigPayload) => {
    setVisionCfgSaving(true);
    onError(undefined);
    try {
      await apiSetVisionConfig(patch);
      const updated = await getVisionConfig();
      setVisionConfig(updated);
    } catch (err) {
      onError(`Failed to save vision config: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setVisionCfgSaving(false);
    }
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── Derived ──

  const totalResources = sdkData
    ? sdkData.packages.reduce(
        (sum, p) =>
          sum + p.counts.extensions + p.counts.skills + p.counts.prompts + p.counts.themes,
        0,
      )
    : 0;

  const hasUpdates = updates?.some((u) => u.updateAvailable) ?? false;

  // ── Render ──

  return (
    <div style={{ padding: "0 4px" }}>
      {/* ── Totals ── */}
      {sdkData && (
        <div style={s.totals}>
          <span style={s.totalItem}>
            Packages: <span style={s.totalNum}>{sdkData.packages.length}</span>
          </span>
          <span style={s.totalItem}>
            Resources: <span style={s.totalNum}>{totalResources}</span>
          </span>
          {(["extensions", "skills", "prompts", "themes"] as const).map((k) => {
            const iconKey =
              k === "extensions"
                ? "extension"
                : k === "skills"
                  ? "skill"
                  : k === "prompts"
                    ? "prompt"
                    : "theme";
            return (
              <span key={k} style={s.totalItem}>
                {RESOURCE_ICONS[iconKey]} {k}:{" "}
                <span style={s.totalNum}>{sdkData.totals[k]}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* ── Install ── */}
      <div style={s.section}>
        <div style={s.heading}>📥 Install Package</div>
        <div style={s.subheading}>
          Install from npm (<code>npm:@org/package</code>), git (<code>git:github.com/...</code>),
          or a local path.
        </div>

        {/* Primary install row */}
        <div style={s.installBox}>
          <div style={{ flex: 1 }}>
            <div style={s.label}>Package source</div>
            <input
              style={s.installInput}
              placeholder="npm:@org/package"
              value={installSource}
              onChange={(e) => setInstallSource(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleInstall(installSource);
              }}
            />
          </div>
          <div>
            <div style={s.label}>Scope</div>
            <select
              style={{ ...SELECT_STYLE, width: 80 }}
              value={installScope}
              onChange={(e) => setInstallScope(e.target.value as "user" | "project")}
            >
              <option value="user">global</option>
              <option value="project">project</option>
            </select>
          </div>
          <button
            style={{
              ...s.actionBtn,
              background: installing ? "var(--bg-glass)" : "var(--accent-bg, #3b82f6)",
              color: installing ? "var(--text-dim)" : "white",
              border: "none",
              padding: "6px 14px",
              fontSize: 11,
            }}
            onClick={() => void handleInstall(installSource)}
            disabled={installing !== null || !installSource.trim()}
          >
            {installing ? "Installing…" : "Install"}
          </button>
        </div>

        {/* Manual install row */}
        <details style={{ fontSize: 11, color: "var(--text-dim)" }}>
          <summary style={{ cursor: "pointer", marginBottom: 4 }}>
            Manual install (advanced)
          </summary>
          <div style={s.installBox}>
            <div style={{ flex: 1 }}>
              <div style={s.label}>Full install spec</div>
              <input
                style={s.installInput}
                placeholder="npm:pi-free or git:github.com/user/repo"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleManualInstall();
                }}
              />
            </div>
            <button
              style={{
                ...s.actionBtn,
                background: "var(--accent-bg, #3b82f6)",
                color: "white",
                border: "none",
                padding: "6px 14px",
                fontSize: 11,
              }}
              onClick={() => void handleManualInstall()}
              disabled={installing !== null || !manualInput.trim()}
            >
              pi install
            </button>
          </div>
        </details>
      </div>

      {/* ── Package cards (grouped by scope) ── */}
      {sdkData && sdkData.packages.length === 0 && !extData?.detected.length && (
        <div style={s.empty}>
          No extension packages configured yet.
        </div>
      )}

      {sdkData && (() => {
        const globalPkgs = sdkData.packages.filter((p) => p.scope === "user");
        const projectPkgs = sdkData.packages.filter((p) => p.scope === "project");

        return (
          <>
            {/* Global scope section */}
            {globalPkgs.length > 0 && (
              <div style={s.section}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                    🌐 Global scope
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                    ~/.pi/agent/
                  </div>
                </div>
                {globalPkgs.map((pkg) => (
                  <PackageCard
                    key={`${pkg.scope}\0${pkg.source}`}
                    pkg={pkg}
                    expanded={expanded.has(`${pkg.scope}\0${pkg.source}`)}
                    pkgUpdate={updateMap.get(pkg.packageName ?? pkg.source)}
                    busy={busy}
                    installing={installing}
                    uninstalling={uninstalling}
                    updating={updating}
                    onToggleExpand={() => toggleExpand(`${pkg.scope}\0${pkg.source}`)}
                    onToggle={() => void handleToggle(pkg)}
                    onUninstall={() => void handleUninstall(pkg)}
                    onUpdate={(src) => void handleUpdate(src)}
                  />
                ))}
              </div>
            )}

            {/* Project scope section */}
            {projectPkgs.length > 0 && (
              <div style={s.section}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                    📁 Project scope
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {projectPath?.replace(/^\/[^/]+\/[^/]+/, "~") ?? "unknown"}
                  </div>
                </div>
                {projectPkgs.map((pkg) => (
                  <PackageCard
                    key={`${pkg.scope}\0${pkg.source}`}
                    pkg={pkg}
                    expanded={expanded.has(`${pkg.scope}\0${pkg.source}`)}
                    pkgUpdate={updateMap.get(pkg.packageName ?? pkg.source)}
                    busy={busy}
                    installing={installing}
                    uninstalling={uninstalling}
                    updating={updating}
                    onToggleExpand={() => toggleExpand(`${pkg.scope}\0${pkg.source}`)}
                    onToggle={() => void handleToggle(pkg)}
                    onUninstall={() => void handleUninstall(pkg)}
                    onUpdate={(src) => void handleUpdate(src)}
                  />
                ))}
              </div>
            )}
          </>
        );
      })()}

      {/* ── Recommended ── */}
      {extData && extData.recommended.length > 0 && (
        <div style={s.section}>
          <div style={s.heading}>💎 Recommended</div>
          <div style={s.subheading}>
            Curated extensions optimised for pi-kot.
          </div>
          {groupByCategory(extData.recommended).map(([cat, items]) => (
            <div key={cat} style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--text-dim)",
                  marginBottom: 6,
                  padding: "0 4px",
                }}
              >
                {CATEGORY_LABELS[cat] ?? cat}
              </div>
              {items.map((ext) => {
                const matchedPkg = sdkData?.packages.find(
                  (p) =>
                    p.packageName === ext.name ||
                    p.source === ext.package ||
                    p.source.includes(ext.name),
                );
                const installedScope = matchedPkg?.scope;

                return (
                  <RecommendedExtCard
                    key={ext.id}
                    ext={ext}
                    installedScope={installedScope}
                    installing={installing === ext.package}
                    projectPath={projectPath}
                    onInstall={(scope) => {
                      void handleInstall(ext.package, scope);
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* ── Update check ── */}
      <div style={s.section}>
        <div style={s.heading}>🔄 Updates</div>
        <button
          style={s.actionBtn}
          onClick={() => void handleCheckUpdates()}
          disabled={checkingUpdates}
        >
          {checkingUpdates ? "Checking…" : "Check Updates"}
        </button>

        {hasUpdates && (
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-dim)" }}>
            {updates!.filter((u) => u.updateAvailable).length} update(s) available.
            Use the <strong>Update</strong> button on each package card above.
          </div>
        )}

        {updates && !hasUpdates && (
          <div style={{ marginTop: 8, fontSize: 11, color: "#34d399" }}>
            All packages are up to date.
          </div>
        )}
      </div>

      {/* ── Vision Tool Config (only when pi-vision-tool installed) ── */}
      {hasVisionTool && visionConfig?.installed && (
        <div style={s.section}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={s.heading}>👁️ Vision Tool Settings</div>
              <div style={s.subheading}>
                Select which provider/model to delegate image analysis to.{" "}
                <code style={{ fontSize: 10 }}>describe_image</code> will route to this model.
              </div>
            </div>
            <span style={s.badge}>pi-vision-tool detected</span>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "end", marginTop: 8, flexWrap: "wrap" }}>
            {/* Provider */}
            <div style={{ flex: 1, minWidth: 120 }}>
              <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>
                Provider
              </div>
              <select
                style={{ ...SELECT_STYLE, width: "100%" }}
                value={visionConfig.provider ?? ""}
                onChange={(e) =>
                  void handleSaveVisionConfig({ provider: e.target.value || undefined })
                }
                disabled={visionCfgSaving}
              >
                <option value="">— auto —</option>
                {visionProviders.map((g) => (
                  <option key={g.provider} value={g.provider}>{g.provider}</option>
                ))}
              </select>
            </div>

            {/* Model */}
            <div style={{ flex: 1, minWidth: 120 }}>
              <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>
                Model
              </div>
              <select
                style={{ ...SELECT_STYLE, width: "100%" }}
                value={visionConfig.model ?? ""}
                onChange={(e) =>
                  void handleSaveVisionConfig({ model: e.target.value || undefined })
                }
                disabled={visionCfgSaving}
              >
                <option value="">— auto —</option>
                {visionProviders
                  .find((g) => g.provider === visionConfig.provider)
                  ?.models?.filter((m) => m.input?.includes("image"))
                  .map((m) => (
                    <option key={m.id} value={m.id}>{m.name ?? m.id}</option>
                  ))}
              </select>
            </div>

            {/* Max dimension */}
            <div>
              <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>
                Max dimension
              </div>
              <input
                style={INPUT_STYLE}
                type="number"
                min={256}
                max={4096}
                value={visionConfig.maxDimension ?? 1568}
                onChange={(e) =>
                  void handleSaveVisionConfig({
                    maxDimension: parseInt(e.target.value) || undefined,
                  })
                }
                disabled={visionCfgSaving}
              />
            </div>

            {/* JPEG quality */}
            <div>
              <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>
                JPEG quality
              </div>
              <input
                style={INPUT_STYLE}
                type="number"
                min={10}
                max={100}
                value={visionConfig.jpegQuality ?? 85}
                onChange={(e) =>
                  void handleSaveVisionConfig({
                    jpegQuality: parseInt(e.target.value) || undefined,
                  })
                }
                disabled={visionCfgSaving}
              />
            </div>

            {/* Reasoning effort */}
            <div>
              <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>
                Reasoning
              </div>
              <select
                style={SELECT_STYLE}
                value={visionConfig.defaultReasoningEffort ?? "off"}
                onChange={(e) =>
                  void handleSaveVisionConfig({
                    defaultReasoningEffort: e.target.value as ReasoningLevel,
                  })
                }
                disabled={visionCfgSaving}
              >
                {REASONING_LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl}
                  </option>
                ))}
              </select>
            </div>

            {/* Enable toggle */}
            <div>
              <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>
                &nbsp;
              </div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  cursor: "pointer",
                  color: "var(--text-secondary)",
                }}
              >
                <input
                  type="checkbox"
                  checked={visionConfig.enabled !== false}
                  onChange={(e) =>
                    void handleSaveVisionConfig({ enabled: e.target.checked })
                  }
                  disabled={visionCfgSaving}
                />
                Enabled
              </label>
            </div>
          </div>
        </div>
      )}

      {/* ── Reload ── */}
      <div style={s.section}>
        <div style={s.heading}>🔄 Agent Reload</div>
        <div style={s.subheading}>
          Reload the pi agent configuration (MCP + extension cache) after installing
          or updating extensions.
        </div>
        <button
          onClick={() => void handleReload()}
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
