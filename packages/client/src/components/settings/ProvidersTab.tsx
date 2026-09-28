import { useState, useEffect, useMemo } from "react";
import {
  Server,
  Cpu,
  Sparkles,
  Plus,
  Search,
  Key,
  Trash2,
  ChevronDown,
  RefreshCw,
  Code2,
  X,
} from "lucide-react";
import {
  fetchProviders,
  getAuthSummary,
  setApiKey,
  removeApiKey,
  getModelsJson,
  putModelsJson,
  removeCustomProvider,
  probeProvider,
  addCustomProvider,
  type ProvidersResponse,
  type AuthSummaryResponse,
} from "../../lib/api-client";
import { AddProviderDialog, LOCAL_PROVIDER_PRESETS, type ProviderPreset } from "../AddProviderDialog";
import { ConfirmDialog } from "../Modal";
import { errorMsg } from "./shared";
import { ModelEditor, type ModelEntry } from "./ModelEditor";
import { useI18n } from "../../hooks/useI18n";

interface Props {
  onError: (msg: string | undefined) => void;
}

export function ProvidersTab({ onError }: Props) {
  const { t } = useI18n();
  const [providers, setProviders] = useState<ProvidersResponse | undefined>(undefined);
  const [auth, setAuth] = useState<AuthSummaryResponse | undefined>(undefined);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<ProviderPreset | null>(null);
  const [customProviders, setCustomProviders] = useState<Set<string>>(new Set());
  const [modelsData, setModelsData] = useState<{ providers: Record<string, any> } | undefined>(undefined);
  const [editingModel, setEditingModel] = useState<{ provider: string; index: number } | undefined>(undefined);
  const [removingProvider, setRemovingProvider] = useState<string | undefined>(undefined);
  const [editingProvider, setEditingProvider] = useState<string | undefined>(undefined);
  const [keyDraft, setKeyDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showModelsJson, setShowModelsJson] = useState(false);
  const [rawJson, setRawJson] = useState<string | undefined>(undefined);
  const [jsonSavedAt, setJsonSavedAt] = useState<number | undefined>(undefined);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "configured" | "custom" | "missing">("all");
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());

  const refresh = async (): Promise<void> => {
    onError(undefined);
    try {
      const [p, a, m] = await Promise.all([
        fetchProviders(),
        getAuthSummary(),
        getModelsJson(),
      ]);
      setProviders(p);
      setAuth(a);
      const custom = new Set(Object.keys(m.providers));
      setCustomProviders(custom);
      setModelsData(m);
    } catch (err) {
      onError(`Failed to load providers: ${errorMsg(err)}`);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveKey = async (provider: string): Promise<void> => {
    if (keyDraft.trim().length === 0) return;
    setBusy(true);
    try {
      await setApiKey(provider, keyDraft.trim());
      setEditingProvider(undefined);
      setKeyDraft("");
      await refresh();
    } catch (err) {
      onError(`Save key failed: ${errorMsg(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async (provider: string): Promise<void> => {
    if (!confirm(`Remove the stored key for "${provider}"?`)) return;
    setBusy(true);
    try {
      await removeApiKey(provider);
      await refresh();
    } catch (err) {
      onError(`Remove key failed: ${errorMsg(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const saveRawJson = async (): Promise<void> => {
    if (rawJson === undefined) return;
    setBusy(true);
    try {
      const parsed = JSON.parse(rawJson);
      await putModelsJson(parsed);
      setJsonSavedAt(Date.now());
      await refresh();
    } catch {
      onError("models.json: invalid JSON");
    } finally {
      setBusy(false);
    }
  };

  const loadModelsJson = async (): Promise<void> => {
    try {
      const m = await getModelsJson();
      setRawJson(JSON.stringify(m, null, 2));
    } catch (err) {
      onError(`Load models.json failed: ${errorMsg(err)}`);
    }
  };

  const [syncingProvider, setSyncingProvider] = useState<string | undefined>(undefined);

  const syncProviderModels = async (providerName: string): Promise<void> => {
    const customConfig = modelsData?.providers[providerName];
    if (!customConfig || !customConfig.baseUrl) {
      onError(`Cannot sync ${providerName}: No baseUrl configured in models.json`);
      return;
    }

    setSyncingProvider(providerName);
    onError(undefined);
    try {
      const probeRes = await probeProvider({
        baseUrl: customConfig.baseUrl,
        apiKey: customConfig.apiKey,
        apiType: customConfig.api,
      });

      if (!probeRes.reachable) {
        onError(`Could not reach ${providerName} on ${customConfig.baseUrl}. Is the runner running?`);
        return;
      }

      if (!probeRes.models || probeRes.models.length === 0) {
        onError(`${providerName} responded but returned 0 models.`);
        return;
      }

      // Merge newly discovered models with existing models (preserving previous configs/context)
      const existingModels: Array<Record<string, unknown>> = Array.isArray(customConfig.models)
        ? customConfig.models
        : [];
      const existingMap = new Map(existingModels.map((m) => [m.id, m]));

      const mergedModels = [...existingModels];
      for (const probed of probeRes.models) {
        if (!existingMap.has(probed.id)) {
          mergedModels.push({
            id: probed.id,
            name: probed.name ?? probed.id,
          });
        }
      }

      const updatedConfig = {
        ...customConfig,
        models: mergedModels,
      };

      await addCustomProvider(providerName, updatedConfig);
      await refresh();
      setExpandedProviders((prev) => new Set(prev).add(providerName));
    } catch (err) {
      onError(`Failed to sync models for ${providerName}: ${errorMsg(err)}`);
    } finally {
      setSyncingProvider(undefined);
    }
  };

  const toggleExpanded = (provider: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) {
        next.delete(provider);
      } else {
        next.add(provider);
      }
      return next;
    });
  };

  const configuredCount = useMemo(() => {
    if (!providers || !auth) return 0;
    return providers.providers.filter((p) => auth.providers[p.provider]?.configured).length;
  }, [providers, auth]);

  const filteredProviders = useMemo(() => {
    if (!providers) return [];
    const q = searchQuery.trim().toLowerCase();
    return providers.providers.filter((p) => {
      const isConfigured = auth?.providers[p.provider]?.configured === true;
      const isCustom = customProviders.has(p.provider);
      if (filterTab === "configured" && !isConfigured) return false;
      if (filterTab === "custom" && !isCustom) return false;
      if (filterTab === "missing" && isConfigured) return false;

      if (!q) return true;
      if (p.provider.toLowerCase().includes(q)) return true;
      if (p.models.some((m) => m.id.toLowerCase().includes(q) || (m.name && m.name.toLowerCase().includes(q)))) {
        return true;
      }
      return false;
    });
  }, [providers, auth, customProviders, filterTab, searchQuery]);

  if (providers === undefined) {
    return <p className="settings-hint">{t("settings.providers.loading")}</p>;
  }

  return (
    <div className="providers-tab-container">
      {/* ── Top Header Toolbar ── */}
      <div className="providers-header-toolbar">
        <div className="providers-header-top-row">
          <div className="providers-header-title-wrap">
            <span className="providers-main-title">Providers</span>
            <div className="providers-title-badges">
              <span className="providers-count-pill">{providers.providers.length} total</span>
              <span className="providers-count-pill configured">{configuredCount} configured</span>
              {customProviders.size > 0 && (
                <span className="providers-count-pill custom">{customProviders.size} custom</span>
              )}
            </div>
          </div>

          <div className="providers-header-actions">
            <button
              onClick={() => {
                setSelectedPreset(null);
                setShowAddDialog(true);
              }}
              className="settings-btn settings-btn-primary"
              title="Add a custom or local provider"
            >
              <Plus size={13} />
              <span className="providers-btn-label-desktop">{t("settings.providers.addCustom").replace(/^\+\s*/, "")}</span>
              <span className="providers-btn-label-mobile">Add</span>
            </button>

            <button
              onClick={() => {
                if (showModelsJson) {
                  setShowModelsJson(false);
                } else {
                  setShowModelsJson(true);
                  if (rawJson === undefined) void loadModelsJson();
                }
              }}
              className={`settings-btn ${showModelsJson ? "settings-btn-active" : ""}`}
              title="Edit models.json configuration directly"
            >
              <Code2 size={13} />
              <span className="providers-btn-label-desktop">models.json</span>
              <span className="providers-btn-label-mobile">JSON</span>
            </button>

            <button
              onClick={() => void refresh()}
              disabled={busy}
              className="settings-btn settings-btn-icon"
              title="Refresh providers and status"
            >
              <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

      <p className="providers-header-sub">
        {t("settings.providers.description")}
      </p>
    </div>

      {/* ── Quick Add Local Providers Banner ── */}
      <div className="providers-quick-local-banner">
        <div className="quick-local-banner-left">
          <Server size={14} className="quick-local-icon" />
          <div className="quick-local-text">
            <span className="quick-local-label">Quick Add Local:</span>
            <span className="quick-local-sub">One-click connect to local runners</span>
          </div>
        </div>
        <div className="quick-local-chips">
          {LOCAL_PROVIDER_PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              className="quick-local-chip"
              onClick={() => {
                setSelectedPreset(p);
                setShowAddDialog(true);
              }}
              title={`Connect to local ${p.label} on ${p.baseUrl}`}
            >
              <span className="chip-name">{p.label}</span>
              {p.port && <span className="chip-port">:{p.port}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ── Search & Filter Bar ── */}
      <div className="providers-filter-bar">
        <div className="providers-search-wrapper">
          <Search size={13} className="providers-search-icon" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search providers or models…"
            className="providers-search-input"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="providers-search-clear"
              title="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="providers-filter-tabs">
          <button
            type="button"
            className={`providers-filter-tab ${filterTab === "all" ? "active" : ""}`}
            onClick={() => setFilterTab("all")}
          >
            All ({providers.providers.length})
          </button>
          <button
            type="button"
            className={`providers-filter-tab ${filterTab === "configured" ? "active" : ""}`}
            onClick={() => setFilterTab("configured")}
          >
            Configured ({configuredCount})
          </button>
          {customProviders.size > 0 && (
            <button
              type="button"
              className={`providers-filter-tab ${filterTab === "custom" ? "active" : ""}`}
              onClick={() => setFilterTab("custom")}
            >
              Custom ({customProviders.size})
            </button>
          )}
          <button
            type="button"
            className={`providers-filter-tab ${filterTab === "missing" ? "active" : ""}`}
            onClick={() => setFilterTab("missing")}
          >
            No Key ({providers.providers.length - configuredCount})
          </button>
        </div>
      </div>

      {/* ── Raw models.json Editor (if toggled) ── */}
      {showModelsJson && rawJson !== undefined && (
        <div className="settings-raw-json-panel">
          <div className="settings-json-header">
            <span className="settings-json-title">
              <Code2 size={13} />
              <span>models.json Raw Editor</span>
            </span>
            <div className="settings-json-actions">
              {jsonSavedAt !== undefined && (
                <span className="settings-json-flash">{t("settings.agent.saved")}</span>
              )}
              <button
                onClick={() => void loadModelsJson()}
                disabled={busy}
                className="settings-btn settings-btn-xs"
              >
                {t("settings.providers.reload")}
              </button>
              <button
                onClick={() => void saveRawJson()}
                disabled={busy}
                className="settings-btn settings-btn-primary settings-btn-xs"
              >
                {busy ? t("settings.providers.saving") : t("settings.providers.save")}
              </button>
              <button
                onClick={() => setShowModelsJson(false)}
                className="settings-btn settings-btn-xs"
              >
                Close
              </button>
            </div>
          </div>
          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            spellCheck={false}
            rows={12}
            className="settings-textarea"
          />
        </div>
      )}

      {/* ── Provider Cards List ── */}
      {filteredProviders.length === 0 ? (
        <div className="providers-empty-state">
          <p className="settings-hint italic">
            {searchQuery
              ? `No providers match "${searchQuery}"`
              : t("settings.providers.noProviders")}
          </p>
        </div>
      ) : (
        <div className="providers-card-list">
          {filteredProviders.map((p) => {
            const presence = auth?.providers[p.provider];
            const configured = presence?.configured === true;
            const editing = editingProvider === p.provider;
            const isCustom = customProviders.has(p.provider);
            const isExpanded = expandedProviders.has(p.provider);

            return (
              <div key={p.provider} className="provider-card">
                <div className="provider-card-header">
                  <div className="provider-card-main-info">
                    <div className={`provider-avatar ${isCustom ? "custom" : configured ? "configured" : "unconfigured"}`}>
                      {isCustom ? <Server size={14} /> : configured ? <Cpu size={14} /> : <Sparkles size={14} />}
                    </div>

                    <div className="provider-text-meta">
                      <div className="provider-name-row">
                        <span className="provider-name">{p.provider}</span>
                        {isCustom && (
                          <span className="provider-badge-custom" title="Custom provider defined in models.json">
                            models.json
                          </span>
                        )}
                        {presence?.source !== undefined && (
                          <span className="provider-source-tag">via {presence.source}</span>
                        )}
                      </div>

                      <div className="provider-sub-row">
                        <span className={`provider-status-badge ${configured ? "online" : "offline"}`}>
                          <span className="status-dot" />
                          <span>{configured ? t("settings.providers.keySet") : t("settings.providers.noKey")}</span>
                        </span>
                        <span className="provider-meta-divider">•</span>
                        <button
                          type="button"
                          className="provider-models-count-btn"
                          onClick={() => toggleExpanded(p.provider)}
                        >
                          {p.models.length} {p.models.length === 1 ? "model" : t("settings.providers.modelsCount")}
                          <ChevronDown size={11} className={`count-chevron ${isExpanded ? "open" : ""}`} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="provider-card-actions">
                    {!editing && (
                      <button
                        onClick={() => {
                          setEditingProvider(p.provider);
                          setKeyDraft("");
                        }}
                        className={`settings-btn ${configured ? "settings-btn-subtle" : "settings-btn-primary"}`}
                        title={configured ? t("settings.providers.replaceKey") : t("settings.providers.addKey")}
                      >
                        <Key size={12} />
                        <span className="providers-btn-label-desktop">
                          {configured ? t("settings.providers.replaceKey") : t("settings.providers.addKey")}
                        </span>
                        <span className="providers-btn-label-mobile">
                          {configured ? "Key" : "+ Key"}
                        </span>
                      </button>
                    )}

                    {configured && !editing && (
                      <button
                        onClick={() => void removeKey(p.provider)}
                        disabled={busy}
                        className="settings-btn-icon danger"
                        title={t("settings.providers.remove")}
                      >
                        <X size={13} />
                      </button>
                    )}

                    {isCustom && !editing && (
                      <button
                        type="button"
                        onClick={() => void syncProviderModels(p.provider)}
                        disabled={busy || syncingProvider === p.provider}
                        className="settings-btn settings-btn-subtle settings-btn-xs"
                        title="Probe and sync models currently loaded in this runner"
                      >
                        <RefreshCw
                          size={11}
                          className={syncingProvider === p.provider ? "animate-spin" : ""}
                        />
                        <span>Sync</span>
                      </button>
                    )}

                    {isCustom && !editing && (
                      <button
                        onClick={() => setRemovingProvider(p.provider)}
                        disabled={busy}
                        className="settings-btn-icon danger"
                        title={t("settings.providers.removeFromModels")}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Inline API Key Editor */}
                {editing && (
                  <div className="provider-key-editor">
                    <div className="provider-key-input-row">
                      <Key size={13} className="provider-key-icon" />
                      <input
                        type="password"
                        value={keyDraft}
                        onChange={(e) => setKeyDraft(e.target.value)}
                        placeholder={t("settings.providers.pasteKey")}
                        autoFocus
                        className="provider-key-input"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveKey(p.provider);
                          if (e.key === "Escape") {
                            setEditingProvider(undefined);
                            setKeyDraft("");
                          }
                        }}
                      />
                      <button
                        onClick={() => void saveKey(p.provider)}
                        disabled={busy || keyDraft.trim().length === 0}
                        className="settings-btn settings-btn-primary"
                      >
                        {busy ? t("settings.providers.saving") : t("settings.providers.save")}
                      </button>
                      <button
                        onClick={() => {
                          setEditingProvider(undefined);
                          setKeyDraft("");
                        }}
                        className="settings-btn"
                      >
                        {t("settings.providers.cancel")}
                      </button>
                    </div>
                  </div>
                )}

                {/* Expanded Models List */}
                {isExpanded && (
                  <div className="provider-models-drawer">
                    <div className="models-drawer-header">
                      <span>Available Models ({p.models.length})</span>
                      {isCustom && (
                        <span className="models-custom-note">Click a model to edit configuration</span>
                      )}
                    </div>
                    <ul className="settings-model-list">
                      {p.models.map((m, mi) => (
                        <li
                          key={m.id}
                          className="settings-model-item"
                          style={{ cursor: isCustom ? "pointer" : undefined }}
                        >
                          {editingModel?.provider === p.provider && editingModel?.index === mi && modelsData ? (
                            <div style={{ width: "100%" }}>
                              <ModelEditor
                                model={modelsData.providers[p.provider]?.models?.[mi] as ModelEntry ?? { id: m.id, name: m.name }}
                                onChange={(updated) => {
                                  setModelsData((prev) => {
                                    if (!prev) return prev;
                                    const prov = { ...(prev.providers[p.provider] ?? {}) };
                                    const mods = [...(prov.models ?? [])];
                                    mods[mi] = updated;
                                    prov.models = mods;
                                    return { ...prev, providers: { ...prev.providers, [p.provider]: prov } };
                                  });
                                }}
                                onDelete={() => {
                                  setEditingModel(undefined);
                                  setModelsData((prev) => {
                                    if (!prev) return prev;
                                    const prov = { ...(prev.providers[p.provider] ?? {}) };
                                    const mods = [...(prov.models ?? [])];
                                    mods.splice(mi, 1);
                                    prov.models = mods.length ? mods : undefined;
                                    return { ...prev, providers: { ...prev.providers, [p.provider]: prov } };
                                  });
                                }}
                              />
                              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                                <button onClick={() => setEditingModel(undefined)} className="settings-btn">{t("settings.providers.cancel")}</button>
                                <button
                                  onClick={async () => {
                                    if (!modelsData) return;
                                    setBusy(true);
                                    try {
                                      await putModelsJson(modelsData);
                                      setEditingModel(undefined);
                                      setJsonSavedAt(Date.now());
                                      await refresh();
                                    } catch (err) {
                                      onError(`Save failed: ${errorMsg(err)}`);
                                    } finally {
                                      setBusy(false);
                                    }
                                  }}
                                  className="settings-btn settings-btn-primary"
                                  disabled={busy}
                                >
                                  {busy ? t("settings.providers.saving") : t("settings.providers.save")}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div
                              onClick={() => {
                                if (!isCustom) return;
                                setEditingModel({ provider: p.provider, index: mi });
                              }}
                              className="model-item-row"
                            >
                              <div className="model-item-name-col">
                                <span className={`model-item-name ${m.hasAuth ? "" : "text-dim"}`}>{m.name || m.id}</span>
                                {m.name && m.name !== m.id && (
                                  <span className="model-item-id">{m.id}</span>
                                )}
                              </div>
                              <span className="model-item-ctx">ctx {Math.round(m.contextWindow / 1000)}k</span>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Custom Provider Dialog */}
      <AddProviderDialog
        open={showAddDialog}
        initialPreset={selectedPreset}
        onClose={() => {
          setShowAddDialog(false);
          setSelectedPreset(null);
          void refresh();
        }}
        onError={onError}
        onSaved={() => {
          void refresh();
        }}
      />

      {/* Confirm Remove Dialog */}
      <ConfirmDialog
        open={removingProvider !== undefined}
        onClose={() => setRemovingProvider(undefined)}
        onConfirm={async () => {
          const name = removingProvider;
          setRemovingProvider(undefined);
          if (name === undefined) return;
          setBusy(true);
          try {
            await removeCustomProvider(name);
            await refresh();
          } catch (err) {
            onError(`Remove failed: ${errorMsg(err)}`);
          } finally {
            setBusy(false);
          }
        }}
        title={t("settings.providers.deleteProvider")}
        message={t("settings.providers.deleteProviderConfirm")}
        primaryLabel={t("settings.providers.delete")}
        tone="danger"
      />
    </div>
  );
}
