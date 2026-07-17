import { useState, useEffect } from "react";
import {
  fetchProviders,
  getAuthSummary,
  setApiKey,
  removeApiKey,
  getModelsJson,
  putModelsJson,
  removeCustomProvider,
  type ProvidersResponse,
  type AuthSummaryResponse,
} from "../../lib/api-client";
import { AddProviderDialog } from "../AddProviderDialog";
import { ConfirmDialog } from "../Modal";
import { errorMsg } from "./shared";
import { ModelEditor, type ModelEntry } from "./ModelEditor";

interface Props {
  onError: (msg: string | undefined) => void;
}

export function ProvidersTab({ onError }: Props) {
  const [providers, setProviders] = useState<ProvidersResponse | undefined>(undefined);
  const [auth, setAuth] = useState<AuthSummaryResponse | undefined>(undefined);
  const [showAddDialog, setShowAddDialog] = useState(false);
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
                {customProviders.has(p.provider) && (
                  <span className="settings-badge-custom">models.json</span>
                )}
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
                    className="settings-btn-delete"
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
                {p.models.map((m, mi) => (
                  <li key={m.id} className="settings-model-item" style={{ cursor: customProviders.has(p.provider) ? "pointer" : undefined }}>
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
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                          <button onClick={() => setEditingModel(undefined)} className="settings-btn">Cancel</button>
                          <button onClick={async () => {
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
                          }} className="settings-btn settings-btn-primary" disabled={busy}>
                            {busy ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div onClick={() => {
                        if (!customProviders.has(p.provider)) return;
                        setEditingModel({ provider: p.provider, index: mi });
                      }} style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                        <span className={m.hasAuth ? "" : "text-dim"}>{m.name}</span>
                        <span className="text-dim">ctx {Math.round(m.contextWindow / 1000)}k</span>
                      </div>
                    )}
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
