import { useEffect, useState, useRef, useCallback } from "react";
import {
  fetchProviders,
  setSessionModel,
  type ProviderGroup,
} from "../lib/api-client";

interface Props {
  sessionId: string | undefined;
  /** Currently selected model id */
  selected: string;
  /** Called when a model is successfully set on the session */
  onSelect: (modelId: string, provider: string) => void;
  /** Called on error */
  onError: (error: string) => void;
}

export function ModelDropdown({ sessionId, selected, onSelect, onError }: Props) {
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderGroup[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [setting, setSetting] = useState<string | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load providers on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetchProviders();
        setProviders(res.providers);
      } catch {
        // server not reachable
      }
      setLoading(false);
    })();
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus search when dropdown opens
  useEffect(() => {
    if (open) {
      searchRef.current?.focus();
    } else {
      setSearch("");
    }
  }, [open]);

  const selectedModel = providers
    .flatMap((p) => p.models)
    .find((m) => m.id === selected);

  const filtered = providers
    .map((p) => ({
      ...p,
      models: p.models.filter(
        (m) =>
          m.id.toLowerCase().includes(search.toLowerCase()) ||
          m.name.toLowerCase().includes(search.toLowerCase()),
      ),
    }))
    .filter((p) => p.models.length > 0);

  const handleSelect = useCallback(
    async (modelId: string, provider: string) => {
      setOpen(false);

      if (sessionId === undefined) {
        // No active session yet — just store selection locally
        onSelect(modelId, provider);
        return;
      }

      setSetting(modelId);
      try {
        await setSessionModel(sessionId, provider, modelId);
        onSelect(modelId, provider);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to set model";
        onError(msg);
      } finally {
        setSetting(undefined);
      }
    },
    [sessionId, onSelect, onError],
  );

  return (
    <div ref={ref} className="model-dropdown">
      <button
        type="button"
        className="model-dropdown-btn"
        onClick={() => setOpen(!open)}
        disabled={setting !== undefined}
        title={selectedModel?.name ?? selected}
        style={{ opacity: setting !== undefined ? 0.6 : 1 }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {setting !== undefined
            ? "Setting..."
            : selectedModel?.name ?? selected ?? "Model"}
        </span>
        <svg
          className="model-dropdown-chevron"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
        >
          <path
            d="M2 4L5 7L8 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="model-dropdown-menu" style={{ left: "auto", right: 0 }}>
          {/* Search */}
          <input
            ref={searchRef}
            type="text"
            className="model-dropdown-search"
            placeholder="Search models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {loading && (
            <div className="model-dropdown-empty">Loading...</div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="model-dropdown-empty">
              {search ? "No models match" : "No models available"}
            </div>
          )}

          {/* Provider groups */}
          {filtered.map((group) => (
            <div key={group.provider}>
              <div
                style={{
                  padding: "6px 12px 2px",
                  fontSize: "10px",
                  fontWeight: 700,
                  color: "var(--text-dim)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {group.provider}
              </div>
              {group.models.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  className={`model-dropdown-item${model.id === selected ? " active" : ""}`}
                  onClick={() => handleSelect(model.id, group.provider)}
                  disabled={setting !== undefined}
                  style={{
                    opacity: model.hasAuth ? 1 : 0.4,
                    cursor: setting !== undefined ? "wait" : model.hasAuth ? "pointer" : "not-allowed",
                  }}
                  title={
                    !model.hasAuth
                      ? `No API key configured for ${group.provider}`
                      : undefined
                  }
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span>{model.name}</span>
                    <span className="model-dropdown-item-ctx">
                      {model.contextWindow.toLocaleString()} ctx
                    </span>
                  </span>
                  {!model.hasAuth && (
                    <span style={{ fontSize: "9px", color: "var(--error)", marginLeft: "4px" }}>
                      ⚠️
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
