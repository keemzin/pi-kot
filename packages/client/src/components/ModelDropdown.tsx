import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  fetchProviders,
  setSessionModel,
  getSettings,
  type ProviderGroup,
  type ModelInfo,
} from "../lib/api-client";

interface Props {
  sessionId: string | undefined;
  /** Currently selected model id (empty string = using default) */
  selected: string;
  /** Called when a model is successfully set on the session */
  onSelect: (modelId: string, provider: string) => void;
  /** Called on error */
  onError: (error: string) => void;
}

interface FlatModel {
  value: string;
  provider: string;
  name: string;
  hasAuth: boolean;
  contextWindow: number;
}

function flattenModels(providers: ProviderGroup[]): FlatModel[] {
  const out: FlatModel[] = [];
  for (const p of providers) {
    for (const m of p.models) {
      out.push({
        value: m.id,
        provider: p.provider,
        name: m.name,
        hasAuth: m.hasAuth,
        contextWindow: m.contextWindow,
      });
    }
  }
  return out;
}

function scoreOption(opt: FlatModel, query: string): number | undefined {
  const q = query.toLowerCase();
  // Exact prefix match on name → highest priority
  if (opt.name.toLowerCase().startsWith(q)) return 0;
  // Provider match → second priority
  if (opt.provider.toLowerCase().includes(q)) return 1;
  // Name contains → third
  if (opt.name.toLowerCase().includes(q)) return 2;
  // ID match → lowest
  if (opt.value.toLowerCase().includes(q)) return 3;
  return undefined;
}

export function ModelDropdown({ sessionId, selected, onSelect, onError }: Props) {
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderGroup[]>([]);
  const [defaultModel, setDefaultModel] = useState<{ provider: string; modelId: string } | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [activeIdx, setActiveIdx] = useState(-1);
  const [setting, setSetting] = useState<string | undefined>(undefined);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load providers + default model on mount
  useEffect(() => {
    (async () => {
      try {
        const [providersRes, settingsRes] = await Promise.all([
          fetchProviders(),
          getSettings(),
        ]);
        setProviders(providersRes.providers);
        const dp = settingsRes.defaultProvider as string | undefined;
        const dm = settingsRes.defaultModel as string | undefined;
        if (dp && dm) {
          setDefaultModel({ provider: dp, modelId: dm });
        }
      } catch {
        // server not reachable
      }
    })();
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  // Reset search + active index on open, focus input
  useEffect(() => {
    if (open) {
      setSearch("");
      setActiveIdx(-1);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const options = useMemo(() => flattenModels(providers), [providers]);

  const filtered = useMemo(() => {
    const configured = options.filter((o) => o.hasAuth);
    if (search.trim().length === 0) {
      return configured;
    }
    const scored: { opt: FlatModel; score: number }[] = [];
    for (const opt of configured) {
      const score = scoreOption(opt, search);
      if (score !== undefined) scored.push({ opt, score });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.map((x) => x.opt);
  }, [options, search]);

  const selectedOption = options.find((o) => o.value === selected);

  const triggerLabel =
    selectedOption !== undefined
      ? `${selectedOption.provider} / ${selectedOption.name}`
      : defaultModel !== undefined && defaultModel.provider.length > 0 && defaultModel.modelId.length > 0
        ? `${defaultModel.provider} / ${defaultModel.modelId} (default)`
        : "default model";

  const commit = (idx: number): void => {
    setOpen(false);
    if (idx === -1) {
      // "Use default" — clear session override
      if (sessionId !== undefined) {
        setSetting("default");
        setSessionModel(sessionId, defaultModel?.provider ?? "", defaultModel?.modelId ?? "")
          .then(() => onSelect("", ""))
          .catch((err) => onError(err instanceof Error ? err.message : "Failed"))
          .finally(() => setSetting(undefined));
      } else {
        onSelect("", "");
      }
      return;
    }
    const opt = filtered[idx];
    if (opt === undefined) return;

    if (sessionId === undefined) {
      onSelect(opt.value, opt.provider);
      return;
    }

    setSetting(opt.value);
    setSessionModel(sessionId, opt.provider, opt.value)
      .then(() => onSelect(opt.value, opt.provider))
      .catch((err) => onError(err instanceof Error ? err.message : "Failed"))
      .finally(() => setSetting(undefined));
  };

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, filtered.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        commit(activeIdx);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    },
    [filtered, activeIdx],
  );

  // Scroll active item into view
  useEffect(() => {
    if (!open || listRef.current === null || activeIdx < 0) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIdx]);

  return (
    <div ref={wrapperRef} className="model-dropdown">
      <button
        type="button"
        className="model-dropdown-btn"
        onClick={() => setOpen((o) => !o)}
        disabled={setting !== undefined}
        title={triggerLabel}
        style={{ opacity: setting !== undefined ? 0.6 : 1 }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {setting !== undefined
            ? "Setting..."
            : triggerLabel}
        </span>
        <span className="model-dropdown-chevron">▾</span>
      </button>

      {open && (
        <div className="model-dropdown-menu" style={{ left: "auto", right: 0, maxWidth: "calc(100vw - 32px)" }}>
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setActiveIdx(-1);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search provider or model…"
            className="model-dropdown-search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          <div ref={listRef} className="model-dropdown-list">
            {/* "Use agent default" row */}
            <button
              data-idx={-1}
              onMouseEnter={() => setActiveIdx(-1)}
              onClick={() => commit(-1)}
              className={`model-dropdown-item ${activeIdx === -1 ? "model-dropdown-active" : ""}`}
            >
              <span>Use agent default</span>
              {defaultModel !== undefined && defaultModel.provider.length > 0 && (
                <span className="model-dropdown-item-ctx">
                  {defaultModel.provider} / {defaultModel.modelId}
                </span>
              )}
              {selected === "" && <span className="text-green">●</span>}
            </button>

            {filtered.length === 0 ? (
              <div className="model-dropdown-empty">
                {search ? "No models match" : "No models available"}
              </div>
            ) : (
              filtered.map((opt, i) => (
                <button
                  key={opt.value}
                  data-idx={i}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => commit(i)}
                  className={`model-dropdown-item ${activeIdx === i ? "model-dropdown-active" : ""}`}
                  style={{
                    opacity: opt.hasAuth ? 1 : 0.4,
                    cursor: opt.hasAuth ? "pointer" : "not-allowed",
                  }}
                  title={!opt.hasAuth ? `No API key for ${opt.provider}` : undefined}
                >
                  <span className="model-dropdown-item-main">
                    <span className="model-dropdown-provider">{opt.provider}</span>
                    <span className="model-dropdown-name">{opt.name}</span>
                  </span>
                  {!opt.hasAuth && (
                    <span className="model-dropdown-warn">⚠</span>
                  )}
                  {opt.value === selected && <span className="text-green">●</span>}
                </button>
              ))
            )}
          </div>
          <div className="model-dropdown-footer">
            {filtered.length} of {options.length} models — ↑↓ move, Enter pick, Esc close
          </div>
        </div>
      )}
    </div>
  );
}
