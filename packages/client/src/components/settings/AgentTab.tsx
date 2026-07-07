import { useState, useEffect, useMemo } from "react";
import {
  fetchProviders,
  getSettings,
  updateSettings,
  getEnabledModels,
  setEnabledModels as saveEnabledModels,
  type ProvidersResponse,
} from "../../lib/api-client";
import { Field, errorMsg } from "./shared";

interface Props {
  onError: (msg: string | undefined) => void;
}

export function AgentTab({ onError }: Props) {
  const [settings, setSettings] = useState<Record<string, unknown> | undefined>(undefined);
  const [allProviders, setAllProviders] = useState<ProvidersResponse | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [orchProvider, setOrchProvider] = useState<string>("");
  const [orchModel, setOrchModel] = useState<string>("");

  // ── Scoped models state ──
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

  const activeProviders = scopedOn ? scopedProviders : allProviders;
  const providerOptions = activeProviders
    ? activeProviders.providers.map((p) => ({ value: p.provider, label: p.provider }))
    : [];

  const currentGroup = activeProviders?.providers.find((p) => p.provider === selectedProvider);
  const modelOptions = currentGroup
    ? currentGroup.models.map((m) => ({ value: m.id, label: m.name }))
    : [];

  const orchGroup = activeProviders?.providers.find((p) => p.provider === orchProvider);
  const orchModelOptions = orchGroup
    ? orchGroup.models.map((m) => ({ value: m.id, label: m.name }))
    : [];

  const handleProviderChange = (v: string) => {
    setSelectedProvider(v);
    const group = activeProviders?.providers.find((p) => p.provider === v);
    const modelAvailable = group?.models.some((m) => m.id === selectedModel);
    if (!modelAvailable) setSelectedModel("");
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
    if (!modelAvailable) setOrchModel("");
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
      const allIds = allProviders
        ? allProviders.providers.flatMap((p) => p.models.map((m) => `${p.provider}/${m.id}`))
        : [];
      const draft = scopedDraft ?? allIds;
      setScopedDraft(draft);
      setScopedOn(true);
      setShowScopePicker(true);
    } else {
      setShowScopePicker(false);
      await persistScope(null);
    }
  };

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
                setScopedDraft(enabledModels);
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

// ── Inline select setting (used locally) ───────────────────────────────

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
