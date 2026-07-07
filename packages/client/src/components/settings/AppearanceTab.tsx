import { useState, useEffect, useCallback } from "react";
import { getSavedTheme, applyTheme, themes } from "../../lib/theme";
import {
  usePreferencesStore,
  type PreferencesState,
} from "../../stores/preferences-store";
import { getUiSettings, updateUiSettings } from "../../lib/api-client";

type UiSettings = {
  theme?: string;
  stickyUserHeader?: boolean;
  showTokenUsage?: boolean;
  compressImages?: boolean;
};

export function AppearanceTab() {
  const [current, setCurrent] = useState(() => getSavedTheme());
  const [serverSynced, setServerSynced] = useState(false);

  const stickyUserHeader = usePreferencesStore(
    (s: PreferencesState) => s.stickyUserHeader,
  );
  const setStickyUserHeader = usePreferencesStore(
    (s: PreferencesState) => s.setStickyUserHeader,
  );
  const showTokenUsage = usePreferencesStore(
    (s: PreferencesState) => s.showTokenUsage,
  );
  const setShowTokenUsage = usePreferencesStore(
    (s: PreferencesState) => s.setShowTokenUsage,
  );
  const compressImages = usePreferencesStore(
    (s: PreferencesState) => s.compressImages,
  );
  const setCompressImages = usePreferencesStore(
    (s: PreferencesState) => s.setCompressImages,
  );

  // ── Load server-persisted settings on mount ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    getUiSettings()
      .then((server: UiSettings) => {
        if (cancelled) return;
        setServerSynced(true);

        // Apply server theme if present
        if (server.theme && server.theme !== current) {
          setCurrent(server.theme);
          applyTheme(server.theme);
        }

        // Apply server toggles (zustand handles localStorage sync)
        if (typeof server.stickyUserHeader === "boolean") {
          setStickyUserHeader(server.stickyUserHeader);
        }
        if (typeof server.showTokenUsage === "boolean") {
          setShowTokenUsage(server.showTokenUsage);
        }
        if (typeof server.compressImages === "boolean") {
          setCompressImages(server.compressImages);
        }
      })
      .catch(() => {
        // Server not available — fall back to localStorage/zustand (no-op)
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist both locally and server-side ────────────────────────────────
  const persist = useCallback(
    (patch: UiSettings) => {
      // Fire-and-forget server sync (best-effort)
      updateUiSettings(patch).catch(() => {});
    },
    [],
  );

  const select = (id: string) => {
    setCurrent(id);
    applyTheme(id);
    persist({ theme: id });
  };

  const handleStickyChange = (checked: boolean) => {
    setStickyUserHeader(checked);
    persist({ stickyUserHeader: checked });
  };

  const handleTokenUsageChange = (checked: boolean) => {
    setShowTokenUsage(checked);
    persist({ showTokenUsage: checked });
  };

  const handleCompressChange = (checked: boolean) => {
    setCompressImages(checked);
    persist({ compressImages: checked });
  };

  return (
    <div className="settings-fields">
      <p className="settings-hint">
        Choose a theme. 
        {serverSynced
          ? " Preferences saved server-side (survives cache clears)."
          : " Server offline — saved locally only."}
      </p>
      <div className="settings-theme-grid">
        {themes.map((t: { id: string; name: string }) => (
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
            onChange={(e) => handleStickyChange(e.target.checked)}
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
            onChange={(e) => handleTokenUsageChange(e.target.checked)}
            style={{
              width: 16,
              height: 16,
              accentColor: "var(--accent-text)",
              cursor: "pointer",
            }}
          />
          Show token usage — display input/output/cached tokens on each
          assistant message
        </label>
      </div>

      <div className="settings-field">
        <label className="settings-label">Images</label>
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
            checked={compressImages}
            onChange={(e) => handleCompressChange(e.target.checked)}
            style={{
              width: 16,
              height: 16,
              accentColor: "var(--accent-text)",
              cursor: "pointer",
            }}
          />
          Compress images — downscale large images before sending (saves
          bandwidth, reduces token cost)
        </label>
      </div>
    </div>
  );
}
