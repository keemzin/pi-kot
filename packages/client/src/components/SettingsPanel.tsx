/**
 * Settings Panel — modal overlay with config tabs.
 *
 * Ported from pi-forge/packages/client/src/components/SettingsPanel.tsx
 * Simplified for pi-kot: Appearance, Providers, Agent, General tabs.
 */
import { useEffect, useState } from "react";
import {
  fetchProviders,
  getAuthSummary,
  setApiKey,
  removeApiKey,
  getSettings,
  updateSettings,
  getModelsJson,
  putModelsJson,
  type ProvidersResponse,
  type AuthSummaryResponse,
} from "../lib/api-client";
import { getSavedTheme, applyTheme, themes } from "../lib/theme";
import { usePreferencesStore } from "../stores/preferences-store";

type Tab = "appearance" | "providers" | "agent" | "general";

interface Props {
  onClose: () => void;
  initialTab?: Tab;
}

export function SettingsPanel({ onClose, initialTab }: Props) {
  const visibleTabs: Tab[] = ["appearance", "providers", "agent", "general"];

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
    </div>
  );
}

// ---------------- Providers tab ----------------

function ProvidersTab({ onError }: { onError: (msg: string | undefined) => void }) {
  const [providers, setProviders] = useState<ProvidersResponse | undefined>(undefined);
  const [auth, setAuth] = useState<AuthSummaryResponse | undefined>(undefined);
  const [editingProvider, setEditingProvider] = useState<string | undefined>(undefined);
  const [keyDraft, setKeyDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showModelsJson, setShowModelsJson] = useState(false);
  const [rawJson, setRawJson] = useState<string | undefined>(undefined);
  const [jsonSavedAt, setJsonSavedAt] = useState<number | undefined>(undefined);

  const refresh = async (): Promise<void> => {
    onError(undefined);
    try {
      const [p, a] = await Promise.all([fetchProviders(), getAuthSummary()]);
      setProviders(p);
      setAuth(a);
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
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => {
    onError(undefined);
    try {
      setSettings(await getSettings());
    } catch (err) {
      onError(`Failed to load settings: ${errorMsg(err)}`);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const get = (key: string): string => {
    if (settings === undefined) return "";
    const v = settings[key];
    return typeof v === "string" ? v : "";
  };

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

  if (settings === undefined) {
    return <p className="settings-hint">Loading settings…</p>;
  }

  return (
    <div className="settings-fields">
      <Field label="Default provider" hint="e.g. anthropic, openai, google">
        <TextSetting
          value={get("defaultProvider")}
          onSave={(v) => save({ defaultProvider: v.length === 0 ? null : v })}
          disabled={busy}
        />
      </Field>
      <Field label="Default model" hint="model id from the chosen provider">
        <TextSetting
          value={get("defaultModel")}
          onSave={(v) => save({ defaultModel: v.length === 0 ? null : v })}
          disabled={busy}
        />
      </Field>
      <Field label="Thinking level" hint="off, minimal, low, medium, high, xhigh">
        <SelectSetting
          value={get("defaultThinkingLevel")}
          options={["", "off", "minimal", "low", "medium", "high", "xhigh"]}
          onSave={(v) => save({ defaultThinkingLevel: v.length === 0 ? null : v })}
          disabled={busy}
        />
      </Field>
    </div>
  );
}

// ---------------- General tab ----------------

function GeneralTab() {
  return (
    <div className="settings-fields">
      <div className="settings-field">
        <label className="settings-label">About</label>
        <p className="settings-hint">
          pi-kot — a web UI for the pi coding agent. Based on pi-forge.
        </p>
      </div>
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
