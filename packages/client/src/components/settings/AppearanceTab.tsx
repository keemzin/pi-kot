import { useState, useEffect } from "react";
import { getSavedTheme, applyTheme, themes } from "../../lib/theme";
import { usePreferencesStore, type PreferencesState } from "../../stores/preferences-store";

export function AppearanceTab() {
  const [current, setCurrent] = useState(() => getSavedTheme());
  const stickyUserHeader = usePreferencesStore((s: PreferencesState) => s.stickyUserHeader);
  const setStickyUserHeader = usePreferencesStore((s: PreferencesState) => s.setStickyUserHeader);
  const showTokenUsage = usePreferencesStore((s: PreferencesState) => s.showTokenUsage);
  const setShowTokenUsage = usePreferencesStore((s: PreferencesState) => s.setShowTokenUsage);
  const compressImages = usePreferencesStore((s: PreferencesState) => s.compressImages);
  const setCompressImages = usePreferencesStore((s: PreferencesState) => s.setCompressImages);

  const select = (id: string) => {
    setCurrent(id);
    applyTheme(id);
  };

  return (
    <div className="settings-fields">
      <p className="settings-hint">Choose a theme. Saved to localStorage.</p>
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
            onChange={(e) => setCompressImages(e.target.checked)}
            style={{
              width: 16,
              height: 16,
              accentColor: "var(--accent-text)",
              cursor: "pointer",
            }}
          />
          Compress images — downscale large images before sending (saves bandwidth, reduces token cost)
        </label>
      </div>
    </div>
  );
}
