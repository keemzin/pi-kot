import { useState, useEffect, useMemo } from "react";
import {
  fetchProviders,
  getSettings,
  updateSettings,
  getEnabledModels,
  setEnabledModels as saveEnabledModels,
  type ProvidersResponse,
} from "../../lib/api-client";
import { Bot, Filter, Network, SlidersHorizontal, Search, X } from "lucide-react";
import { SettingCard, SettingRow, SettingToggle, SettingDivider, errorMsg } from "./shared";
import { useI18n } from "../../hooks/useI18n";

interface Props {
  onError: (msg: string | undefined) => void;
}

export function AgentTab({ onError }: Props) {
  const { t } = useI18n();
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
    return <p className="settings-hint">{t("settings.agent.loading")}</p>;
  }

  return (
    <div className="settings-fields">
      {/* Card 1: Default Model & Reasoning */}
      <SettingCard
        icon={<Bot size={15} />}
        title="Primary Model & Reasoning"
        subtitle="Default model configuration and reasoning effort for new chats"
      >
        <SettingRow
          label={t("settings.agent.defaultProvider")}
          hint={t("settings.agent.defaultProviderHint")}
        >
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
        </SettingRow>

        <SettingDivider />

        <SettingRow
          label={t("settings.agent.defaultModel")}
          hint={t("settings.agent.defaultModelHint")}
        >
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
        </SettingRow>

        <SettingDivider />

        <SettingRow
          label={t("settings.agent.thinkingLevel")}
          hint={t("settings.agent.thinkingLevelHint")}
        >
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
        </SettingRow>
      </SettingCard>

      {/* Card 2: Model Scope & Filtering */}
      <SettingCard
        icon={<Filter size={15} />}
        title={t("settings.agent.modelScope")}
        subtitle="Filter which models appear in dropdown selectors across the app"
        action={
          scopedOn && !showScopePicker ? (
            <button
              type="button"
              onClick={() => setShowScopePicker(true)}
              className="settings-btn settings-btn-xs"
            >
              <SlidersHorizontal size={11} />
              <span>{t("settings.agent.selectModels")}</span>
            </button>
          ) : undefined
        }
      >
        <SettingRow
          label={t("settings.agent.hideUnusedModels")}
          hint="Only display ticked models in new session and chat model pickers"
        >
          <SettingToggle
            checked={scopedOn}
            onChange={(on) => void toggleScopedOn(on)}
            ariaLabel={t("settings.agent.hideUnusedModels")}
          />
        </SettingRow>

        {scopedOn && !showScopePicker && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 12px",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-glass-strong)",
              border: "1px solid var(--border)",
              marginTop: 4,
            }}
          >
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {scopedDraft === null
                ? t("settings.agent.allModelsVisible")
                : t("settings.agent.modelsSelected")
                    .replace("{n}", String(scopedDraft.length))
                    .replace("{m}", String(allModelEntries.length))}
            </span>
            <button
              type="button"
              onClick={() => setShowScopePicker(true)}
              className="settings-btn settings-btn-xs"
            >
              <SlidersHorizontal size={11} />
              <span>{t("settings.agent.selectModels")}</span>
            </button>
          </div>
        )}

        {scopedOn && showScopePicker && (
          <div
            className="scope-picker-section"
            style={{
              marginTop: 6,
              padding: 12,
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-glass-strong)",
              border: "1px solid var(--border)",
            }}
          >
            <div className="providers-search-wrapper" style={{ marginBottom: 10 }}>
              <Search size={13} className="providers-search-icon" />
              <input
                type="search"
                value={scopeSearch}
                onChange={(e) => setScopeSearch(e.target.value)}
                placeholder={t("settings.agent.searchModels")}
                className="providers-search-input"
                autoFocus
              />
              {scopeSearch && (
                <button
                  type="button"
                  onClick={() => setScopeSearch("")}
                  className="providers-search-clear"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <div style={{ display: "flex", gap: 12, marginBottom: 8, padding: "0 2px" }}>
              <button
                type="button"
                onClick={() => setScopedDraft(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--accent-text)",
                  fontSize: 12,
                  cursor: "pointer",
                  padding: 0,
                  fontWeight: 500,
                }}
              >
                {t("settings.agent.selectAll")}
              </button>
              <button
                type="button"
                onClick={() => setScopedDraft([])}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--accent-text)",
                  fontSize: 12,
                  cursor: "pointer",
                  padding: 0,
                  fontWeight: 500,
                }}
              >
                {t("settings.agent.untickAll")}
              </button>
            </div>

            <div
              className="scope-model-list"
              style={{
                maxHeight: 240,
                overflowY: "auto",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: "6px 10px",
                background: "var(--bg-glass)",
              }}
            >
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
                      padding: "6px 0",
                      fontSize: 13,
                      userSelect: "none",
                      borderBottom: "1px solid var(--border-subtle, rgba(255,255,255,0.04))",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleModelInDraft(entry.fullId)}
                      style={{
                        width: 15,
                        height: 15,
                        accentColor: "var(--accent)",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: 11,
                        color: "var(--text-dim)",
                      }}
                    >
                      {entry.provider}/
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: checked ? 500 : 400,
                        color: "var(--text-primary)",
                      }}
                    >
                      {entry.modelName}
                    </span>
                    {!entry.hasAuth && (
                      <span
                        className="settings-badge settings-badge-off"
                        style={{ marginLeft: "auto" }}
                      >
                        {t("settings.providers.noKey")}
                      </span>
                    )}
                  </label>
                );
              })}
              {filteredEntries.length === 0 && (
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--text-dim)",
                    padding: "12px 0",
                    textAlign: "center",
                  }}
                >
                  {t("settings.agent.noModelsMatch").replace("{search}", scopeSearch)}
                </p>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => void saveScopeDraft()}
                disabled={busy}
                className="settings-btn settings-btn-primary"
              >
                {busy ? t("settings.agent.saving") : t("settings.agent.saveSelection")}
              </button>
              <button
                type="button"
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
                {t("settings.agent.cancel")}
              </button>
            </div>
          </div>
        )}
      </SettingCard>

      {/* Card 3: Supervisor & Orchestrator */}
      <SettingCard
        icon={<Network size={15} />}
        title={t("settings.agent.orchestrator")}
        subtitle="Dedicated provider and model for supervisor & worker multi-agent runs"
      >
        <SettingRow
          label={t("settings.agent.orchProvider")}
          hint={t("settings.agent.orchProviderHint")}
        >
          <select
            value={orchProvider}
            disabled={busy}
            onChange={(e) => handleOrchProviderChange(e.target.value)}
            className="settings-select"
          >
            <option value="">{t("settings.agent.useDefault")}</option>
            {providerOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </SettingRow>

        <SettingDivider />

        <SettingRow
          label={t("settings.agent.orchModel")}
          hint={t("settings.agent.orchModelHint")}
        >
          <select
            value={orchModel}
            disabled={busy || orchProvider.length === 0}
            onChange={(e) => handleOrchModelChange(e.target.value)}
            className="settings-select"
          >
            <option value="">{t("settings.agent.useDefault")}</option>
            {orchModelOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </SettingRow>
      </SettingCard>
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
