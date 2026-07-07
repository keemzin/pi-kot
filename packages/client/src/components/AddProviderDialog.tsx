/**
 * AddProviderDialog — Step-by-step wizard for adding custom LLM providers.
 *
 * Steps:
 *  1. Enter base URL + provider name + optional API key
 *  2. Test connection (probe endpoint, auto-detect API type, fetch models)
 *  3. Review discovered models, adjust names, set context windows
 *  4. Confirm and save to models.json
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Globe,
  Key,
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
  Save,
  Settings,
  Zap,
  X,
  ChevronRight,
  Image,
} from "lucide-react";
import {
  probeProvider,
  addCustomProvider,
  fetchProviders,
} from "../lib/api-client";
import type { ProbeResult } from "../lib/api-client";

// ── API type options ──────────────────────────────────────────────────────

const API_TYPE_OPTIONS = [
  { value: "openai-completions", label: "OpenAI Compatible (Chat Completions)" },
  { value: "openai-responses", label: "OpenAI Responses API" },
  { value: "anthropic-messages", label: "Anthropic Messages API" },
  { value: "google-generative-ai", label: "Google Generative AI" },
  { value: "mistral-conversations", label: "Mistral Conversations" },
] as const;

// ── Model configuration interface ─────────────────────────────────────────

interface ModelEntry {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  vision: boolean;
  selected: boolean;
}

// ── Steps ─────────────────────────────────────────────────────────────────

type Step = "url" | "testing" | "models" | "save";

interface Props {
  open: boolean;
  onClose: () => void;
  onError: (msg: string | undefined) => void;
  onSaved: () => void;
}

export function AddProviderDialog({ open, onClose, onError, onSaved }: Props) {
  // ── Step 1 state ──────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("url");
  const [baseUrl, setBaseUrl] = useState("");
  const [providerName, setProviderName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiType, setApiType] = useState("openai-completions");
  const [showKey, setShowKey] = useState(false);
  const [connectionTested, setConnectionTested] = useState(false);

  // ── Step 2 state (testing) ────────────────────────────────────────────
  const [testResult, setTestResult] = useState<ProbeResult | undefined>(undefined);
  const [testing, setTesting] = useState(false);

  // ── Step 3 state (model review) ───────────────────────────────────────
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [selectAll, setSelectAll] = useState(true);

  // ── Step 4 (saving) ───────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Refs
  const urlRef = useRef<HTMLInputElement>(null);

  // ── Reset on open ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setStep("url");
    setBaseUrl("");
    setProviderName("");
    setApiKey("");
    setApiType("openai-completions");
    setShowKey(false);
    setConnectionTested(false);
    setTestResult(undefined);
    setTesting(false);
    setModels([]);
    setSelectAll(true);
    setSaving(false);
    setSaved(false);
    onError(undefined);
    requestAnimationFrame(() => urlRef.current?.focus());
  }, [open, onError]);

  // ── Step 2: Test connection ───────────────────────────────────────────

  const handleTestConnection = useCallback(async () => {
    if (!baseUrl.trim()) return;
    setTesting(true);
    setTestResult(undefined);
    onError(undefined);

    try {
      const result = await probeProvider({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        apiType,
      });
      setTestResult(result);

      if (result.reachable && result.models && result.models.length > 0) {
        // Auto-suggest a provider name from the probe result
        if (!providerName.trim() && result.suggestedName) {
          setProviderName(result.suggestedName);
        }

        setModels(
          result.models.map((m) => ({
            id: m.id,
            name: m.name ?? m.id,
            contextWindow: 128000,
            maxTokens: 4096,
            reasoning: false,
            vision: false,
            selected: true,
          })),
        );
        setConnectionTested(true);
        setStep("models");
      } else if (result.reachable) {
        // Reachable but no models — let user add models manually
        setConnectionTested(true);
        setModels([]);
        setStep("models");
      } else {
        // Not reachable — stay on url step to let user fix
        setConnectionTested(false);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Test connection failed");
      setTestResult({
        reachable: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setTesting(false);
    }
  }, [baseUrl, apiKey, apiType, providerName, onError]);

  // ── Auto-test when Enter is pressed on the URL step ───────────────────
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && step === "url" && baseUrl.trim()) {
        e.preventDefault();
        void handleTestConnection();
      }
    },
    [step, baseUrl, handleTestConnection],
  );

  // ── Toggle all models ─────────────────────────────────────────────────
  const toggleSelectAll = useCallback(() => {
    setSelectAll((prev) => {
      const next = !prev;
      setModels((ms) => ms.map((m) => ({ ...m, selected: next })));
      return next;
    });
  }, []);

  // ── Toggle individual model ───────────────────────────────────────────
  const toggleModel = useCallback((id: string) => {
    setModels((ms) =>
      ms.map((m) => (m.id === id ? { ...m, selected: !m.selected } : m)),
    );
  }, []);

  // ── Update model field (contextWindow, maxTokens, name, reasoning) ────
  const updateModel = useCallback(
    (id: string, field: keyof ModelEntry, value: string | number | boolean) => {
      setModels((ms) =>
        ms.map((m) => (m.id === id ? { ...m, [field]: value } : m)),
      );
    },
    [],
  );

  // ── Step 4: Save ──────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!providerName.trim() || !baseUrl.trim()) return;
    setSaving(true);
    onError(undefined);

    // Build the provider config for models.json
    const selectedModels = models.filter((m) => m.selected);
    const providerConfig: Record<string, unknown> = {
      baseUrl: baseUrl.trim(),
      api: apiType,
    };

    // Only include apiKey if provided
    if (apiKey.trim()) {
      providerConfig.apiKey = apiKey.trim();
    }

    // Include models if we have any
    if (selectedModels.length > 0) {
      providerConfig.models = selectedModels.map((m) => {
        const modelConfig: Record<string, unknown> = {
          id: m.id,
          name: m.name,
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
          input: m.vision ? ["text", "image"] : ["text"],
        };
        if (m.reasoning) {
          modelConfig.reasoning = true;
        }
        // Only include cost if non-zero
        modelConfig.cost = {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        };
        return modelConfig;
      });
    }

    try {
      await addCustomProvider(providerName.trim(), providerConfig);
      setSaved(true);
      setStep("save");
      onSaved();
      // Auto-close after a moment
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save provider");
    } finally {
      setSaving(false);
    }
  }, [baseUrl, providerName, apiKey, apiType, models, onSaved, onClose, onError]);

  // ── Re-test (go back to testing) ──────────────────────────────────────
  const handleRetest = useCallback(() => {
    setStep("url");
    setTestResult(undefined);
    setConnectionTested(false);
  }, []);

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 640, maxWidth: "92vw", height: "540px" }}
      >
        {/* Header */}
        <header className="settings-header">
          <span
            style={{
              fontSize: "14px",
              fontWeight: 700,
              color: "var(--accent-text)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {step === "url" && <><Zap size={16} /> Add Custom Provider</>}
            {step === "testing" && <><Loader2 size={16} className="animate-spin" /> Testing Connection…</>}
            {step === "models" && <><Settings size={16} /> Configure Models</>}
            {step === "save" && <><CheckCircle size={16} /> Provider Added</>}
          </span>
          <button className="settings-close" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </header>

        {/* Step indicator */}
        <div className="add-provider-steps">
          {(["url", "models", "save"] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`add-provider-step ${
                step === s || (step === "testing" && s === "url")
                  ? "active"
                  : step === "models" && s === "url"
                    ? "done"
                    : step === "save" && (s === "url" || s === "models")
                      ? "done"
                      : ""
              }`}
            >
              <span className="add-provider-step-num">
                {s === "url" && step !== "save" ? "1" : s === "url" ? "✓" : s === "models" ? "2" : "✓"}
              </span>
              <span className="add-provider-step-label">
                {s === "url" ? "Connect" : s === "models" ? "Models" : "Save"}
              </span>
              {i < 2 && <ChevronRight size={14} className="add-provider-step-arrow" />}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="add-provider-body">
          {/* ── STEP 1: URL / Provider Name / API Key ── */}
          {step === "url" && (
            <div className="add-provider-form">
              <div className="add-provider-field">
                <label className="add-provider-label">Base URL</label>
                <div className="add-provider-input-row">
                  <Globe size={14} className="add-provider-input-icon" />
                  <input
                    ref={urlRef}
                    type="url"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="https://api.example.com/v1"
                    className="add-provider-input"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="add-provider-field">
                <label className="add-provider-label">Provider Name</label>
                <div className="add-provider-input-row">
                  <input
                    type="text"
                    value={providerName}
                    onChange={(e) => setProviderName(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="my-local-llm"
                    className="add-provider-input"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
                <p className="add-provider-hint">
                  Used as the identifier in models.json. Auto-suggested from URL.
                </p>
              </div>

              <div className="add-provider-field">
                <label className="add-provider-label">API Key (optional)</label>
                <div className="add-provider-input-row">
                  <Key size={14} className="add-provider-input-icon" />
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="sk-... or leave blank"
                    className="add-provider-input"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button
                    className="add-provider-toggle-btn"
                    onClick={() => setShowKey((v) => !v)}
                    tabIndex={-1}
                    title={showKey ? "Hide key" : "Show key"}
                  >
                    {showKey ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              <div className="add-provider-field">
                <label className="add-provider-label">API Type</label>
                <select
                  value={apiType}
                  onChange={(e) => setApiType(e.target.value)}
                  className="add-provider-select"
                >
                  {API_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="add-provider-hint">
                  Most OpenAI-compatible endpoints use "OpenAI Compatible". Auto-detected when possible.
                </p>
              </div>

              {testResult && !testResult.reachable && (
                <div className="add-provider-error-row">
                  <XCircle size={14} />
                  <span>{testResult.error ?? "Connection failed"}</span>
                </div>
              )}

              <div className="add-provider-actions">
                <button
                  className="add-provider-btn-primary"
                  disabled={!baseUrl.trim() || testing}
                  onClick={() => void handleTestConnection()}
                >
                  {testing ? (
                    <><Loader2 size={14} className="animate-spin" /> Testing…</>
                  ) : (
                    <><Zap size={14} /> Test Connection</>
                  )}
                </button>
                <button
                  className="add-provider-btn"
                  onClick={onClose}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Testing (brief interstitial) — testing state is handled above ── */}
          {step === "testing" && (
            <div className="add-provider-testing">
              <Loader2 size={32} className="animate-spin" style={{ color: "var(--accent-text)" }} />
              <p>Testing connection to {baseUrl}…</p>
              {/* This step auto-transitions in handleTestConnection */}
            </div>
          )}

          {/* ── STEP 3: Model Review ── */}
          {step === "models" && (
            <div className="add-provider-model-review">
              {testResult?.reachable && (
                <div className="add-provider-success-banner">
                  <CheckCircle size={14} />
                  <span>
                    Connected to {baseUrl} — detected API: <strong>{testResult.detectedApiType}</strong>
                  </span>
                </div>
              )}

              {models.length > 0 ? (
                <>
                  <div className="add-provider-model-toolbar">
                    <label className="add-provider-checkbox-label">
                      <input
                        type="checkbox"
                        checked={selectAll}
                        onChange={toggleSelectAll}
                        className="add-provider-checkbox"
                      />
                      {selectAll ? "Deselect all" : "Select all"} ({models.filter((m) => m.selected).length}/{models.length})
                    </label>
                  </div>

                  <div className="add-provider-model-list">
                    {models.map((m) => (
                      <div
                        key={m.id}
                        className={`add-provider-model-card ${m.selected ? "" : "dimmed"}`}
                      >
                        <div className="add-provider-model-header">
                          <label className="add-provider-checkbox-label">
                            <input
                              type="checkbox"
                              checked={m.selected}
                              onChange={() => toggleModel(m.id)}
                              className="add-provider-checkbox"
                            />
                            <span className="add-provider-model-id">{m.id}</span>
                          </label>
                        </div>
                        {m.selected && (
                          <div className="add-provider-model-fields">
                            <div className="add-provider-model-field">
                              <label>Name</label>
                              <input
                                type="text"
                                value={m.name}
                                onChange={(e) => updateModel(m.id, "name", e.target.value)}
                                className="add-provider-small-input"
                              />
                            </div>
                            <div className="add-provider-model-field">
                              <label>Context</label>
                              <select
                                value={m.contextWindow}
                                onChange={(e) =>
                                  updateModel(m.id, "contextWindow", Number(e.target.value))
                                }
                                className="add-provider-small-select"
                              >
                                <option value={4096}>4K</option>
                                <option value={8192}>8K</option>
                                <option value={16384}>16K</option>
                                <option value={32768}>32K</option>
                                <option value={65536}>64K</option>
                                <option value={128000}>128K</option>
                                <option value={200000}>200K</option>
                                <option value={262144}>256K</option>
                                <option value={524288}>512K</option>
                                <option value={1048576}>1M</option>
                                <option value={2097152}>2M</option>
                              </select>
                            </div>
                            <div className="add-provider-model-field">
                              <label>Max tokens</label>
                              <select
                                value={m.maxTokens}
                                onChange={(e) =>
                                  updateModel(m.id, "maxTokens", Number(e.target.value))
                                }
                                className="add-provider-small-select"
                              >
                                <option value={2048}>2K</option>
                                <option value={4096}>4K</option>
                                <option value={8192}>8K</option>
                                <option value={16384}>16K</option>
                                <option value={32768}>32K</option>
                                <option value={65536}>64K</option>
                                <option value={131072}>128K</option>
                              </select>
                            </div>
                            <div className="add-provider-model-field">
                              <label>Thinking</label>
                              <label className="add-provider-toggle-label">
                                <input
                                  type="checkbox"
                                  checked={m.reasoning}
                                  onChange={(e) => updateModel(m.id, "reasoning", e.target.checked)}
                                  className="add-provider-checkbox"
                                />
                                Extended thinking
                              </label>
                            </div>
                            <div className="add-provider-model-field">
                              <label>Vision</label>
                              <label className="add-provider-toggle-label">
                                <input
                                  type="checkbox"
                                  checked={m.vision}
                                  onChange={(e) => updateModel(m.id, "vision", e.target.checked)}
                                  className="add-provider-checkbox"
                                />
                                Image input
                              </label>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="add-provider-empty-models">
                  {testResult?.reachable && testResult?.detectedApiType === "anthropic-messages" ? (
                    <p>
                      Anthropic does not expose a models endpoint. Add models manually below.
                    </p>
                  ) : (
                    <p>
                      No models were discovered. You can still save the provider and add models
                      manually to models.json.
                    </p>
                  )}
                  {/* Allow adding a model manually */}
                  <div className="add-provider-manual-model">
                    <input
                      type="text"
                      placeholder="model-id (e.g. claude-sonnet-4)"
                      className="add-provider-input"
                      id="manual-model-id"
                      style={{ flex: 1 }}
                    />
                    <button
                      className="add-provider-btn-primary"
                      onClick={() => {
                        const input = document.getElementById("manual-model-id") as HTMLInputElement;
                        if (input?.value.trim()) {
                          setModels((prev) => [
                            ...prev,
                            {
                              id: input.value.trim(),
                              name: input.value.trim(),
                              contextWindow: 128000,
                              maxTokens: 4096,
                              reasoning: false,
                              vision: false,
                              selected: true,
                            },
                          ]);
                          input.value = "";
                        }
                      }}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      Add model
                    </button>
                  </div>
                </div>
              )}

              <div className="add-provider-actions" style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 8 }}>
                <button
                  className="add-provider-btn-primary"
                  disabled={saving || !baseUrl.trim()}
                  onClick={() => void handleSave()}
                >
                  {saving ? (
                    <><Loader2 size={14} className="animate-spin" /> Saving…</>
                  ) : (
                    <><Save size={14} /> Save Provider</>
                  )}
                </button>
                <button className="add-provider-btn" onClick={handleRetest}>
                  <RefreshCw size={14} /> Retest
                </button>
                <button className="add-provider-btn" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Saved ── */}
          {step === "save" && (
            <div className="add-provider-saved">
              <CheckCircle size={48} style={{ color: "var(--accent-text)" }} />
              <h3>Provider Added</h3>
              <p>
                <strong>{providerName}</strong> has been saved to{" "}
                <code className="font-mono">models.json</code> with{" "}
                {models.filter((m) => m.selected).length} model
                {models.filter((m) => m.selected).length !== 1 ? "s" : ""}.
              </p>
              <p className="add-provider-hint">
                Reload the page or open the model picker to use the new provider.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
