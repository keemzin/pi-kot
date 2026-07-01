/**
 * Settings Panel — modal overlay with config tabs.
 *
 * Ported from a reference template
 * Simplified for pi-kot: Appearance, Providers, Agent, General tabs.
 */
import { useEffect, useMemo, useState } from "react";
import {
  fetchProviders,
  getAuthSummary,
  setApiKey,
  removeApiKey,
  getSettings,
  updateSettings,
  getModelsJson,
  putModelsJson,
  getEnabledModels,
  setEnabledModels as saveEnabledModels,
  getVersions,
  checkSdkUpdate,
  removeCustomProvider,
  type ProvidersResponse,
  type AuthSummaryResponse,
} from "../lib/api-client";
import { getSavedTheme, applyTheme, themes } from "../lib/theme";
import { usePreferencesStore } from "../stores/preferences-store";
import { ExtensionsTab } from "./ExtensionsTab";
import { SkillsTab } from "./SkillsTab";
import { AddProviderDialog } from "./AddProviderDialog";
import { ConfirmDialog } from "./Modal";

type Tab = "appearance" | "providers" | "agent" | "general" | "extensions" | "skills";

interface Props {
  onClose: () => void;
  initialTab?: Tab;
}

export function SettingsPanel({ onClose, initialTab }: Props) {
  const visibleTabs: Tab[] = ["appearance", "providers", "agent", "general", "extensions", "skills"];

  const [tab, setTab] = useState<Tab>(initialTab ?? "appearance");
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!visibleTabs.includes(tab)) setTab("appearance");
  }, [tab]);

  useEffect(() => {
    if (initialTab !== undefined && visibleTabs.includes(initialTab)) {
      setTab(initialTab);
    } else if (initialTab === undefined || !visibleTabs.includes(initialTab)) {
      setTab("appearance");
    }
  }, [initialTab]);

  return (
    <div
      className="settings-overlay"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="settings-panel"
        style={{ width: 720, maxWidth: "92vw", height: "520px" }}
      >
        <header className="settings-header">
          <div className="settings-tabs" style={{ display: "flex", gap: 2 }}>
            {visibleTabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`settings-tab ${tab === t ? "settings-tab-active" : ""}`}
              >
                {t === "appearance"
                  ? "Appearance"
                  : t === "providers"
                    ? "Providers"
                    : t === "agent"
                      ? "Agent"
                      : t === "extensions"
                        ? "Extensions ⚗️"
                        : t === "skills"
                          ? "Skills"
                          : "General"}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            className="settings-close"
            title="Close (Esc)"
          >
            ✕
          </button>
        </header>

        {error !== undefined && (
          <div className="settings-error">
            {error}
          </div>
        )}

        <div className="settings-body">
          {tab === "appearance" && <AppearanceTab />}
          {tab === "providers" && <ProvidersTab onError={setError} />}
          {tab === "agent" && <AgentTab onError={setError} />}
          {tab === "extensions" && <ExtensionsTab onError={setError} />}
          {tab === "skills" && <SkillsTab onError={setError} />}
          {tab === "general" && <GeneralTab />}
        </div>
      </div>
    </div>
  );
}

// ---------------- Utilities ----------------

function useSavedFlash(
  savedAt: number | undefined,
  clear: () => void,
): void {
  useEffect(() => {
    if (savedAt === undefined) return undefined;
    const id = window.setTimeout(clear, 2500);
    return () => window.clearTimeout(id);
  }, [savedAt, clear]);
}

function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------- Appearance tab ----------------

function AppearanceTab() {
  const [current, setCurrent] = useState(() => getSavedTheme());
  const stickyUserHeader = usePreferencesStore((s) => s.stickyUserHeader);
  const setStickyUserHeader = usePreferencesStore((s) => s.setStickyUserHeader);
  const showTokenUsage = usePreferencesStore((s) => s.showTokenUsage);
  const setShowTokenUsage = usePreferencesStore((s) => s.setShowTokenUsage);

  const select = (id: string) => {
    setCurrent(id);
    applyTheme(id);
  };

  return (
    <div className="settings-fields">
      <p className="settings-hint">Choose a theme. Saved to localStorage.</p>
      <div className="settings-theme-grid">
        {themes.map((t) => (
          <button
            key={t.id}
            onClick={() => select(t.id)}
            className={`settings-theme-swatch ${current === t.id ? "settings-theme-active" : ""}`}
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className="settings-field">
        <label className="settings-label">Chat</label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
            userSelect: "none",
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          <input
            type="checkbox"
            checked={stickyUserHeader}
            onChange={(e) => setStickyUserHeader(e.target.checked)}
            style={{
              width: 16,
              height: 16,
              accentColor: "var(--accent-text)",
              cursor: "pointer",
            }}
          />
          Sticky user header — pin your message at the top while scrolling
          through the assistant&rsquo;s reply
        </label>
      </div>

      <div className="settings-field">
        <label className="settings-label">Chat</label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
            userSelect: "none",
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          <input
            type="checkbox"
            checked={showTokenUsage}
            onChange={(e) => setShowTokenUsage(e.target.checked)}
            style={{
              width: 16,
              height: 16,
              accentColor: "var(--accent-text)",
              cursor: "pointer",
            }}
          />
          Show token usage — display input/output/cached tokens on each assistant message
        </label>
      </div>
    </div>
  );
}

// ---------------- Providers tab ----------------

function ProvidersTab({ onError }: { onError: (msg: string | undefined) => void }) {
  const [providers, setProviders] = useState<ProvidersResponse | undefined>(undefined);
  const [auth, setAuth] = useState<AuthSummaryResponse | undefined>(undefined);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [customProviders, setCustomProviders] = useState<Set<string>>(new Set());
  const [removingProvider, setRemovingProvider] = useState<string | undefined>(undefined);
  const [editingProvider, setEditingProvider] = useState<string | undefined>(undefined);
  const [keyDraft, setKeyDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showModelsJson, setShowModelsJson] = useState(false);
  const [rawJson, setRawJson] = useState<string | undefined>(undefined);
  const [jsonSavedAt, setJsonSavedAt] = useState<number | undefined>(undefined);

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
      // Identify providers that come from models.json (custom).
      // Built-in providers won't appear in the keys of models.json's providers.
      const custom = new Set(Object.keys(m.providers));
      setCustomProviders(custom);
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

  if (providers === undefined) {
    return <p className="settings-hint">Loading providers…</p>;
  }

  return (
    <div className="space-y-3">
      <p className="settings-hint">
        Built-in providers and anything in <code className="font-mono">models.json</code>. Stored
        API keys are presence-only — actual values are never sent to the browser.
      </p>
      {providers.providers.length === 0 && (
        <p className="settings-hint italic">No providers configured.</p>
      )}
      {providers.providers.map((p) => {
        const presence = auth?.providers[p.provider];
        const configured = presence?.configured === true;
        const editing = editingProvider === p.provider;
        return (
          <div key={p.provider} className="settings-card">
            <div className="settings-card-header">
              <div className="settings-card-left">
                <span className="font-mono text-sm">{p.provider}</span>
                <span className={`settings-badge ${configured ? "settings-badge-on" : "settings-badge-off"}`}>
                  {configured ? "key set" : "no key"}
                </span>
                {presence?.source !== undefined && (
                  <span className="text-xs text-dim">via {presence.source}</span>
                )}
              </div>
              <div className="settings-card-actions">
                {!editing && (
                  <button
                    onClick={() => {
                      setEditingProvider(p.provider);
                      setKeyDraft("");
                    }}
                    className="settings-btn"
                  >
                    {configured ? "Replace key" : "Add key"}
                  </button>
                )}
                {configured && !editing && (
                  <button
                    onClick={() => void removeKey(p.provider)}
                    disabled={busy}
                    className="settings-btn settings-btn-danger"
                  >
                    Remove
                  </button>
                )}
                {customProviders.has(p.provider) && !editing && (
                  <button
                    onClick={() => setRemovingProvider(p.provider)}
                    disabled={busy}
                    className="settings-btn settings-btn-danger"
                    title="Remove from models.json"
                  >
                    Delete provider
                  </button>
                )}
              </div>
            </div>
            {editing && (
              <div className="settings-card-edit">
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder="Paste API key"
                  autoFocus
                  className="settings-input"
                />
                <button
                  onClick={() => void saveKey(p.provider)}
                  disabled={busy || keyDraft.trim().length === 0}
                  className="settings-btn settings-btn-primary"
                >
                  {busy ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => {
                    setEditingProvider(undefined);
                    setKeyDraft("");
                  }}
                  className="settings-btn"
                >
                  Cancel
                </button>
              </div>
            )}
            <details className="settings-details">
              <summary className="settings-summary">
                {p.models.length} model{p.models.length === 1 ? "" : "s"}
              </summary>
              <ul className="settings-model-list">
                {p.models.map((m) => (
                  <li key={m.id} className="settings-model-item">
                    <span className={m.hasAuth ? "" : "text-dim"}>{m.name}</span>
                    <span className="text-dim">ctx {Math.round(m.contextWindow / 1000)}k</span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        );
      })}

      <div className="add-provider-actions" style={{ marginTop: 16, marginBottom: 8 }}>
        <button
          onClick={() => setShowAddDialog(true)}
          className="settings-btn settings-btn-primary"
        >
          + Add Custom Provider
        </button>
      </div>

      <AddProviderDialog
        open={showAddDialog}
        onClose={() => {
          setShowAddDialog(false);
          void refresh();
        }}
        onError={onError}
        onSaved={() => {
          void refresh();
        }}
      />

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
        title="Delete provider"
        message={`Remove "${removingProvider ?? ""}" from models.json? This can be undone by adding it again.`}
        primaryLabel="Delete"
        tone="danger"
      />

      <div className="settings-raw-json">
        <button
          onClick={() => {
            if (showModelsJson) {
              setShowModelsJson(false);
            } else {
              setShowModelsJson(true);
              if (rawJson === undefined) void loadModelsJson();
            }
          }}
          className="settings-btn"
        >
          {showModelsJson ? "Hide" : "Show"} models.json raw editor
        </button>
        {showModelsJson && rawJson !== undefined && (
          <div className="settings-json-area">
            <textarea
              value={rawJson}
              onChange={(e) => setRawJson(e.target.value)}
              spellCheck={false}
              rows={12}
              className="settings-textarea"
            />
            <div className="settings-json-actions">
              {jsonSavedAt !== undefined && (
                <span className="settings-json-flash">Saved</span>
              )}
              <button
                onClick={() => void loadModelsJson()}
                disabled={busy}
                className="settings-btn"
              >
                Reload
              </button>
              <button
                onClick={() => void saveRawJson()}
                disabled={busy}
                className="settings-btn settings-btn-primary"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- Agent tab ----------------

function AgentTab({ onError }: { onError: (msg: string | undefined) => void }) {
  const [settings, setSettings] = useState<Record<string, unknown> | undefined>(undefined);
  const [allProviders, setAllProviders] = useState<ProvidersResponse | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [orchProvider, setOrchProvider] = useState<string>("");
  const [orchModel, setOrchModel] = useState<string>("");

  // ── Scoped models state ──────────────────────────────────────────────
  const [enabledModels, setEnabledModelsState] = useState<string[] | null>(null);
  const [scopedOn, setScopedOn] = useState(false);
  const [scopedDraft, setScopedDraft] = useState<string[] | null>(null);
  const [showScopePicker, setShowScopePicker] = useState(false);
  const [scopeSearch, setScopeSearch] = useState("");

  const refresh = async (): Promise<void> => {
    onError(undefined);
    try {
      const [s, p, em] = await Promise.all([
        getSettings(),
        fetchProviders(),
        getEnabledModels(),
      ]);
      setSettings(s);
      setAllProviders(p);
      const models = em.enabledModels;
      setEnabledModelsState(models);
      setScopedOn(models !== null && !(Array.isArray(models) && models.length === 0));
      setScopedDraft(models);
      const sp = typeof s.defaultProvider === "string" ? s.defaultProvider : "";
      const sm = typeof s.defaultModel === "string" ? s.defaultModel : "";
      setSelectedProvider(sp);
      setSelectedModel(sm);
      setOrchProvider(typeof s.orchProvider === "string" ? s.orchProvider : "");
      setOrchModel(typeof s.orchModel === "string" ? s.orchModel : "");
    } catch (err) {
      onError(`Failed to load settings: ${errorMsg(err)}`);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (patch: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    try {
      const next = await updateSettings(patch);
      setSettings(next);
    } catch (err) {
      onError(`Save failed: ${errorMsg(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // ── Derive scoped provider listing ───────────────────────────────────
  const scopedProviders = useMemo(() => {
    if (!allProviders) return undefined;
    if (!scopedOn || enabledModels === null || enabledModels.length === 0) {
      return allProviders;
    }
    return {
      providers: allProviders.providers
        .map((p) => ({
          ...p,
          models: p.models.filter((m) =>
            enabledModels.includes(`${p.provider}/${m.id}`),
          ),
        }))
        .filter((p) => p.models.length > 0),
    };
  }, [allProviders, scopedOn, enabledModels]);

  // Providers used for dropdowns (scoped when on)
  const activeProviders = scopedOn ? scopedProviders : allProviders;

  // Build provider/model options
  const providerOptions = activeProviders
    ? activeProviders.providers.map((p) => ({ value: p.provider, label: p.provider }))
    : [];

  // Models for the currently selected default provider
  const currentGroup = activeProviders?.providers.find((p) => p.provider === selectedProvider);
  const modelOptions = currentGroup
    ? currentGroup.models.map((m) => ({ value: m.id, label: m.name }))
    : [];

  // Models for the currently selected orch provider
  const orchGroup = activeProviders?.providers.find((p) => p.provider === orchProvider);
  const orchModelOptions = orchGroup
    ? orchGroup.models.map((m) => ({ value: m.id, label: m.name }))
    : [];

  const handleProviderChange = (v: string) => {
    setSelectedProvider(v);
    const group = activeProviders?.providers.find((p) => p.provider === v);
    const modelAvailable = group?.models.some((m) => m.id === selectedModel);
    if (!modelAvailable) {
      setSelectedModel("");
    }
    void save({ defaultProvider: v.length === 0 ? null : v });
  };

  const handleModelChange = (v: string) => {
    setSelectedModel(v);
    void save({ defaultModel: v.length === 0 ? null : v });
  };

  const handleOrchProviderChange = (v: string) => {
    setOrchProvider(v);
    const group = activeProviders?.providers.find((p) => p.provider === v);
    const modelAvailable = group?.models.some((m) => m.id === orchModel);
    if (!modelAvailable) {
      setOrchModel("");
    }
    void save({ orchProvider: v.length === 0 ? null : v });
  };

  const handleOrchModelChange = (v: string) => {
    setOrchModel(v);
    void save({ orchModel: v.length === 0 ? null : v });
  };

  // ── Scoped model handlers ────────────────────────────────────────────

  const persistScope = async (models: string[] | null): Promise<void> => {
    setBusy(true);
    try {
      await saveEnabledModels(models);
      setEnabledModelsState(models);
      setScopedOn(models !== null && !(Array.isArray(models) && models.length === 0));
      setScopedDraft(models);
    } catch (err) {
      onError(`Save scope failed: ${errorMsg(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleScopedOn = async (on: boolean) => {
    if (on) {
      // Enable scoping: start with current draft or all models
      const allIds = allProviders
        ? allProviders.providers.flatMap((p) => p.models.map((m) => `${p.provider}/${m.id}`))
        : [];
      const draft = scopedDraft ?? allIds;
      setScopedDraft(draft);
      setScopedOn(true);
      setShowScopePicker(true);
      // Don't save yet — user must pick models first
    } else {
      // Disable scoping: clear enabledModels
      setShowScopePicker(false);
      await persistScope(null);
    }
  };

  // Only show models that have API keys configured — no point scoping
  // models the user can't actually use.
  const allModelEntries = useMemo(() => {
    if (!allProviders) return [];
    return allProviders.providers.flatMap((p) =>
      p.models
        .filter((m) => m.hasAuth)
        .map((m) => ({
          fullId: `${p.provider}/${m.id}`,
          provider: p.provider,
          modelName: m.name,
          modelId: m.id,
          hasAuth: m.hasAuth,
        })),
    );
  }, [allProviders]);

  const filteredEntries = useMemo(() => {
    if (!scopeSearch) return allModelEntries;
    const q = scopeSearch.toLowerCase();
    return allModelEntries.filter(
      (e) =>
        e.fullId.toLowerCase().includes(q) ||
        e.modelName.toLowerCase().includes(q) ||
        e.provider.toLowerCase().includes(q),
    );
  }, [allModelEntries, scopeSearch]);

  const toggleModelInDraft = (fullId: string) => {
    const draft = scopedDraft ?? allModelEntries.map((e) => e.fullId);
    const next = draft.includes(fullId)
      ? draft.filter((id) => id !== fullId)
      : [...draft, fullId];
    const allCount = allModelEntries.length;
    const isAllEnabled = next.length === allCount;
    setScopedDraft(isAllEnabled ? null : next);
  };

  const saveScopeDraft = async () => {
    await persistScope(scopedDraft);
  };

  if (settings === undefined) {
    return <p className="settings-hint">Loading settings…</p>;
  }

  return (
    <div className="settings-fields">
      <Field label="Default provider" hint="Select an LLM provider">
        <select
          value={selectedProvider}
          disabled={busy}
          onChange={(e) => handleProviderChange(e.target.value)}
          className="settings-select"
        >
          <option value="">(none)</option>
          {providerOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Default model" hint="Model from the selected provider">
        <select
          value={selectedModel}
          disabled={busy || selectedProvider.length === 0}
          onChange={(e) => handleModelChange(e.target.value)}
          className="settings-select"
        >
          <option value="">(none)</option>
          {modelOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Thinking level" hint="off, minimal, low, medium, high, xhigh">
        <SelectSetting
          value={
            settings && typeof settings.defaultThinkingLevel === "string"
              ? settings.defaultThinkingLevel
              : ""
          }
          options={["", "off", "minimal", "low", "medium", "high", "xhigh"]}
          onSave={(v) => save({ defaultThinkingLevel: v.length === 0 ? null : v })}
          disabled={busy}
        />
      </Field>

      <hr className="settings-divider" />

      <p className="settings-section-title">Model Scope</p>
      <div className="settings-field">
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
            userSelect: "none",
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          <input
            type="checkbox"
            checked={scopedOn}
            onChange={(e) => void toggleScopedOn(e.target.checked)}
            style={{
              width: 16,
              height: 16,
              accentColor: "var(--accent-text)",
              cursor: "pointer",
            }}
          />
          Hide unused models — only show selected models in dropdowns
        </label>
        {scopedOn && !showScopePicker && (
          <div style={{ marginTop: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {scopedDraft === null
                ? "All models visible"
                : `${scopedDraft.length} of ${allModelEntries.length} models selected`}
            </span>
            <button
              onClick={() => setShowScopePicker(true)}
              className="settings-btn"
              style={{ marginLeft: 12 }}
            >
              Select models
            </button>
          </div>
        )}
      </div>

      {scopedOn && showScopePicker && (
        <div className="scope-picker-section">
          <input
            type="text"
            value={scopeSearch}
            onChange={(e) => setScopeSearch(e.target.value)}
            placeholder="Search models…"
            className="settings-input"
            style={{ marginBottom: 8, width: "100%" }}
            autoFocus
          />
          <div className="scope-model-list">
            {filteredEntries.map((entry) => {
              const draft = scopedDraft ?? allModelEntries.map((e) => e.fullId);
              const checked = draft.includes(entry.fullId);
              return (
                <label
                  key={entry.fullId}
                  className="scope-model-item"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    cursor: "pointer",
                    padding: "4px 0",
                    fontSize: 13,
                    userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleModelInDraft(entry.fullId)}
                    style={{
                      width: 14,
                      height: 14,
                      accentColor: "var(--accent-text)",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: 12,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {entry.provider}/
                  </span>
                  <span style={{ fontSize: 13 }}>{entry.modelName}</span>
                  {!entry.hasAuth && (
                    <span className="settings-badge settings-badge-off">
                      no key
                    </span>
                  )}
                </label>
              );
            })}
            {filteredEntries.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--text-secondary)", padding: "8px 0" }}>
                No models match &ldquo;{scopeSearch}&rdquo;
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={() => void saveScopeDraft()}
              disabled={busy}
              className="settings-btn settings-btn-primary"
            >
              {busy ? "Saving…" : "Save selection"}
            </button>
            <button
              onClick={() => {
                setShowScopePicker(false);
                setScopeSearch("");
                // Revert draft to saved state
                setScopedDraft(enabledModels);
                // If the saved state has no scoping, turn scoping off too
                if (enabledModels === null || enabledModels.length === 0) {
                  setScopedOn(false);
                }
              }}
              className="settings-btn"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <hr className="settings-divider" />

      <p className="settings-section-title">Orchestrator</p>
      <Field label="Orch provider" hint="Model for supervisor/worker sessions (leave empty to use default)">
        <select
          value={orchProvider}
          disabled={busy}
          onChange={(e) => handleOrchProviderChange(e.target.value)}
          className="settings-select"
        >
          <option value="">(use default)</option>
          {providerOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Orch model" hint="Model for supervisor/worker sessions">
        <select
          value={orchModel}
          disabled={busy || orchProvider.length === 0}
          onChange={(e) => handleOrchModelChange(e.target.value)}
          className="settings-select"
        >
          <option value="">(use default)</option>
          {orchModelOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>
    </div>
  );
}

// ---------------- General tab ----------------

function GeneralTab() {
  const [versions, setVersions] = useState<{ serverVersion: string; sdkVersion: string } | undefined>(undefined);
  const [checkResult, setCheckResult] = useState<{
    latestSdkVersion: string;
    updateAvailable: boolean;
    error?: string;
  } | undefined>(undefined);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    getVersions()
      .then(setVersions)
      .catch(() => {});
  }, []);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setCheckResult(undefined);
    try {
      const res = await checkSdkUpdate();
      setCheckResult({
        latestSdkVersion: res.latestSdkVersion,
        updateAvailable: res.updateAvailable,
      });
    } catch (err) {
      setCheckResult({ latestSdkVersion: "?", updateAvailable: false, error: errorMsg(err) });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="settings-fields">
      <div className="settings-field">
        <label className="settings-label">About</label>
        <p className="settings-hint">
          pi-kot — a web UI for the pi coding agent.
        </p>
      </div>

      <hr className="settings-divider" />

      <div className="settings-field">
        <label className="settings-label">Versions</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
          <div style={{ display: "flex", gap: 16, fontSize: 13, alignItems: "center" }}>
            <span style={{ color: "var(--text-secondary)", minWidth: 100 }}>pi-kot server</span>
            <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>
              {versions?.serverVersion ?? "…"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 13, alignItems: "center" }}>
            <span style={{ color: "var(--text-secondary)", minWidth: 100 }}>pi SDK</span>
            <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>
              {versions?.sdkVersion ?? "…"}
            </span>
          </div>
          {checkResult !== undefined && (
            <div style={{ display: "flex", gap: 16, fontSize: 13, alignItems: "center" }}>
              <span style={{ color: "var(--text-secondary)", minWidth: 100 }}>Latest SDK</span>
              <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>
                {checkResult.error !== undefined ? (
                  <span style={{ color: "var(--danger, #e74c3c)" }}>Check failed</span>
                ) : (
                  checkResult.latestSdkVersion
                )}
              </span>
              {checkResult.error === undefined && checkResult.updateAvailable && (
                <span style={{
                  fontSize: 11,
                  color: "#fff",
                  background: "var(--accent-text, #3b82f6)",
                  padding: "1px 8px",
                  borderRadius: 4,
                  fontWeight: 600,
                }}>
                  Update available
                </span>
              )}
              {checkResult.error === undefined && !checkResult.updateAvailable && (
                <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Up to date</span>
              )}
            </div>
          )}
          {checkResult?.error !== undefined && (
            <p style={{ fontSize: 12, color: "var(--danger, #e74c3c)", margin: 0 }}>
              {checkResult.error}
            </p>
          )}
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <button
            onClick={() => void handleCheckUpdate()}
            disabled={checking}
            className="settings-btn"
          >
            {checking ? "Checking…" : checkResult !== undefined ? "Check again" : "Check for updates"}
          </button>
        </div>
      </div>

      <hr className="settings-divider" />

      <div className="settings-field">
        <button
          onClick={() => {
            window.location.reload();
          }}
          className="settings-btn"
        >
          Reload page
        </button>
      </div>
    </div>
  );
}

// ---------------- Shared field components ----------------

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-field">
      <label className="settings-label">{label}</label>
      {hint !== undefined && <p className="settings-hint">{hint}</p>}
      {children}
    </div>
  );
}

function TextSetting({
  value,
  onSave,
  disabled,
}: {
  value: string;
  onSave: (v: string) => void | Promise<void>;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const dirty = draft !== value;
  return (
    <div className="settings-field-row">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={disabled}
        className="settings-input"
      />
      <button
        onClick={() => void onSave(draft)}
        disabled={disabled || !dirty}
        className="settings-btn settings-btn-primary"
      >
        Save
      </button>
    </div>
  );
}

function SelectSetting({
  value,
  options,
  onSave,
  disabled,
}: {
  value: string;
  options: string[];
  onSave: (v: string) => void | Promise<void>;
  disabled: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => void onSave(e.target.value)}
      className="settings-select"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o.length === 0 ? "(unset)" : o}
        </option>
      ))}
    </select>
  );
}
