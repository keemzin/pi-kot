import { useCallback, useState } from "react";

/* ── Types matching models.json format ── */

export interface ModelEntry {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  compat?: Record<string, unknown>;
}

/* ── Thinking level map ── */

const THINKING_LEVELS = ["low", "medium", "high"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];
const LEVEL_COLORS: Record<ThinkingLevel, string> = { low: "#22c55e", medium: "#eab308", high: "#ef4444" };

function ThinkingLevelMapEditor({
  value,
  onChange,
}: {
  value: Record<string, string | null> | undefined;
  onChange: (v: Record<string, string | null> | undefined) => void;
}) {
  const map = value ?? {};

  const setLevel = (level: ThinkingLevel, entry: string | null | "omit") => {
    const next = { ...map };
    if (entry === "omit") {
      delete next[level];
    } else {
      next[level] = entry;
    }
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {THINKING_LEVELS.map((level) => {
        const raw = map[level];
        const state: "omit" | "null" | "string" =
          !(level in map) ? "omit" : raw === null ? "null" : "string";
        const strVal = typeof raw === "string" ? raw : "";

        const baseBtn = {
          padding: "4px 10px",
          fontSize: 10,
          border: "none",
          cursor: "pointer",
          fontWeight: 400,
          background: "var(--bg-glass)",
          color: "var(--text-dim)",
          transition: "background 0.1s, color 0.1s",
          whiteSpace: "nowrap" as const,
        };
        const activeBtn = { background: "var(--accent)", color: "#fff", fontWeight: 600 };
        const disabledBtn = { background: "#ef4444", color: "#fff", fontWeight: 600 };

        return (
          <div key={level} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, width: 64, flexShrink: 0 }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%", background: LEVEL_COLORS[level], flexShrink: 0,
                opacity: state === "null" ? 0.3 : 1,
              }} />
              <span style={{
                fontSize: 11, fontFamily: "var(--font-mono, monospace)",
                color: state === "null" ? "var(--text-dim)" : "var(--text-secondary)",
                textDecoration: state === "null" ? "line-through" : "none",
              }}>
                {level}
              </span>
            </div>
            <div style={{ display: "flex", borderRadius: 5, border: "1px solid var(--border)", overflow: "hidden" }}>
              <button onClick={() => setLevel(level, "omit")}
                style={{ ...baseBtn, borderRight: "1px solid var(--border)", ...(state === "omit" ? activeBtn : {}) }}>
                Default
              </button>
              <button onClick={() => setLevel(level, null)}
                style={{ ...baseBtn, ...(state === "null" ? disabledBtn : {}) }}>
                Disabled
              </button>
            </div>
            <div style={{ display: "flex", borderRadius: 5, border: `1px solid ${state === "string" ? "var(--accent)" : "var(--border)"}`, overflow: "hidden" }}>
              <button onClick={() => setLevel(level, strVal || level)}
                style={{ ...baseBtn, borderRight: "1px solid var(--border)", ...(state === "string" ? activeBtn : {}) }}>
                Custom
              </button>
              <input value={strVal}
                onChange={(e) => setLevel(level, e.target.value)}
                onFocus={() => { if (state !== "string") setLevel(level, strVal || level); }}
                placeholder={level} maxLength={10}
                style={{
                  width: "12ch", outline: "none", border: "none", padding: "4px 7px",
                  background: state === "string" ? "var(--bg-solid)" : "var(--bg-glass)",
                  color: state === "string" ? "var(--text-primary)" : "var(--text-dim)",
                  fontFamily: "var(--font-mono, monospace)", fontSize: 11,
                }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── DeepSeek compat helpers ── */

const DEEPSEEK_COMPAT = { thinkingFormat: "deepseek", requiresReasoningContentOnAssistantMessages: true } as const;

function hasDeepseekCompat(model: ModelEntry): boolean {
  return (model.compat as Record<string, unknown> | undefined)?.thinkingFormat === "deepseek";
}

function setDeepseekCompat(model: ModelEntry, enabled: boolean): ModelEntry {
  if (enabled) {
    return { ...model, compat: { ...(model.compat ?? {}), ...DEEPSEEK_COMPAT } };
  }
  if (!model.compat) return model;
  const rest = { ...model.compat } as Record<string, unknown>;
  delete rest.thinkingFormat;
  delete rest.requiresReasoningContentOnAssistantMessages;
  return { ...model, compat: Object.keys(rest).length ? rest : undefined };
}

/* ── Form field helpers ── */

const inputStyle: React.CSSProperties = {
  padding: "6px 9px", background: "var(--bg-glass)", border: "1px solid var(--border)",
  borderRadius: 5, color: "var(--text-primary)", fontSize: 12, outline: "none", width: "100%",
  boxSizing: "border-box", fontFamily: "var(--font-mono, monospace)",
};

/* ── ModelEditor ── */

interface Props {
  model: ModelEntry;
  onChange: (m: ModelEntry) => void;
  onDelete: () => void;
}

export function ModelEditor({ model, onChange, onDelete }: Props) {
  const set = <K extends keyof ModelEntry>(k: K, v: ModelEntry[K]) => onChange({ ...model, [k]: v });

  const costVal = (k: keyof NonNullable<ModelEntry["cost"]>) =>
    model.cost?.[k] !== undefined ? String(model.cost[k]) : "";
  const setCost = (k: keyof NonNullable<ModelEntry["cost"]>, v: string) => {
    const n = parseFloat(v);
    onChange({ ...model, cost: { ...(model.cost ?? {}), [k]: isNaN(n) ? undefined : n } });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0 8px" }}>
      {/* ID / Name */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>ID *</label>
          <input value={model.id} onChange={(e) => set("id", e.target.value)} placeholder="model-id" style={inputStyle} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>Name</label>
          <input value={model.name ?? ""} onChange={(e) => set("name", e.target.value || undefined)} placeholder="Display name" style={inputStyle} />
        </div>
      </div>

      {/* API override */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <label style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>API override</label>
        <select value={model.api ?? ""} onChange={(e) => set("api", e.target.value || undefined)}
          style={{ ...inputStyle, cursor: "pointer" }}>
          <option value="">Default</option>
          <option value="openai-completions">OpenAI Compatible</option>
          <option value="openai-responses">OpenAI Responses API</option>
          <option value="anthropic-messages">Anthropic Messages API</option>
          <option value="google-generative-ai">Google Generative AI</option>
        </select>
      </div>

      {/* Toggles */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-primary)", cursor: "pointer", userSelect: "none" }}>
          <input type="checkbox" checked={model.reasoning ?? false}
            onChange={(e) => set("reasoning", e.target.checked || undefined)}
            style={{ accentColor: "var(--accent-text)" }} />
          Reasoning / thinking
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-primary)", cursor: "pointer", userSelect: "none" }}>
          <input type="checkbox" checked={model.input?.includes("image") ?? false}
            onChange={(e) => set("input", e.target.checked ? ["text", "image"] : undefined)}
            style={{ accentColor: "var(--accent-text)" }} />
          Image input
        </label>
      </div>

      {/* Conditional: reasoning settings */}
      {model.reasoning && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 10px", borderRadius: 6, background: "var(--bg-glass)", border: "1px solid var(--border)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-primary)", cursor: "pointer", userSelect: "none" }}>
            <input type="checkbox" checked={hasDeepseekCompat(model)}
              onChange={(e) => onChange(setDeepseekCompat(model, e.target.checked))}
              style={{ accentColor: "var(--accent-text)" }} />
            DeepSeek thinking compatibility
          </label>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>Thinking level map</span>
              {model.thinkingLevelMap && (
                <button onClick={() => set("thinkingLevelMap", undefined)}
                  style={{ fontSize: 10, padding: "2px 7px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-dim)", cursor: "pointer" }}>
                  clear all
                </button>
              )}
            </div>
            <ThinkingLevelMapEditor value={model.thinkingLevelMap} onChange={(v) => set("thinkingLevelMap", v)} />
          </div>
        </div>
      )}

      {/* Context / Max tokens */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>Context window (tokens)</label>
          <input value={model.contextWindow !== undefined ? String(model.contextWindow) : ""}
            onChange={(e) => set("contextWindow", e.target.value ? parseInt(e.target.value) : undefined)}
            placeholder="128000" style={inputStyle} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>Max output tokens</label>
          <input value={model.maxTokens !== undefined ? String(model.maxTokens) : ""}
            onChange={(e) => set("maxTokens", e.target.value ? parseInt(e.target.value) : undefined)}
            placeholder="16384" style={inputStyle} />
        </div>
      </div>

      {/* Cost */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>Cost (per million tokens)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
          {(["input", "output", "cacheRead", "cacheWrite"] as const).map((k) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <label style={{ fontSize: 10, color: "var(--text-dim)" }}>{k}</label>
              <input value={costVal(k)} onChange={(e) => setCost(k, e.target.value)} placeholder="0" style={inputStyle} />
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
        <button onClick={onDelete}
          style={{ padding: "6px 12px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 5, color: "#ef4444", cursor: "pointer", fontSize: 12 }}>
          Remove model
        </button>
      </div>
    </div>
  );
}
