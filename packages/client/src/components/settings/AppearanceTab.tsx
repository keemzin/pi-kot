import { useState, useEffect, useCallback, useRef } from "react";
import {
  getSavedTheme,
  getSavedAccent,
  applyTheme,
  themes,
  accents,
  THEME_MIGRATIONS,
  type ThemeMode,
} from "../../lib/theme";
import { getUiSettings, updateUiSettings } from "../../lib/api-client";
import { usePreferencesStore } from "../../stores/preferences-store";

type UiSettings = {
  theme?: string;
  accent?: string;
  stickyUserHeader?: boolean;
  showTokenUsage?: boolean;
  compressImages?: boolean;
  showThinking?: boolean;
  userBubbleColor?: string | null;
  userBubbleTextColor?: string | null;
  userBubbleBorderColor?: string | null;
};

// ── Apply user bubble overrides to CSS :root ──
function applyBubbleOverrides(
  bg: string | null | undefined,
  text: string | null | undefined,
  border: string | null | undefined,
) {
  const root = document.documentElement;
  if (bg) root.style.setProperty("--user-bubble", bg);
  else root.style.removeProperty("--user-bubble");
  if (text) root.style.setProperty("--user-bubble-text", text);
  else root.style.removeProperty("--user-bubble-text");
  if (border) root.style.setProperty("--user-bubble-border", border);
  else root.style.removeProperty("--user-bubble-border");
}

// ── localStorage keys for bubble color fallback ──
const LS_BUBBLE_BG = "pi-kot/user-bubble-bg";
const LS_BUBBLE_TEXT = "pi-kot/user-bubble-text";
const LS_BUBBLE_BORDER = "pi-kot/user-bubble-border";

function loadLocalBubble(key: string): string | null {
  try { const v = localStorage.getItem(key); return v !== null ? v : null; } catch { return null; }
}

function saveLocalBubble(key: string, value: string | null | undefined): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* private mode */ }
}

// ── Preset bubble colors ──
const BUBBLE_PRESETS = [
  { name: "Accent", bg: null, text: null, border: null },
  { name: "Blue", bg: "#1e40af", text: "#dbeafe", border: "#3b82f6" },
  { name: "Violet", bg: "#5b21b6", text: "#ede9fe", border: "#8b5cf6" },
  { name: "Emerald", bg: "#065f46", text: "#d1fae5", border: "#10b981" },
  { name: "Amber", bg: "#92400e", text: "#fef3c7", border: "#f59e0b" },
  { name: "Rose", bg: "#9f1239", text: "#ffe4e6", border: "#f43f5e" },
  { name: "Teal", bg: "#115e59", text: "#ccfbf1", border: "#14b8a8" },
  { name: "Orange", bg: "#9a3412", text: "#ffedd5", border: "#f97316" },
  { name: "Slate", bg: "#334155", text: "#f1f5f9", border: "#64748b" },
  { name: "Custom", bg: "__custom__", text: "__custom__", border: "__custom__" },
];

export function AppearanceTab() {
  const [theme, setTheme] = useState<ThemeMode>(() => getSavedTheme());
  const [accent, setAccent] = useState(() => getSavedAccent());
  const [serverSynced, setServerSynced] = useState(false);

  // ── Toggle state — init from zustand (which reads localStorage) ──
  const zSticky = usePreferencesStore((s) => s.stickyUserHeader);
  const zToken = usePreferencesStore((s) => s.showTokenUsage);
  const zCompress = usePreferencesStore((s) => s.compressImages);
  const zThinking = usePreferencesStore((s) => s.showThinking);
  const zSetSticky = usePreferencesStore((s) => s.setStickyUserHeader);
  const zSetToken = usePreferencesStore((s) => s.setShowTokenUsage);
  const zSetCompress = usePreferencesStore((s) => s.setCompressImages);
  const zSetThinking = usePreferencesStore((s) => s.setShowThinking);

  const [stickyUserHeader, setStickyUserHeader] = useState(zSticky);
  const [showTokenUsage, setShowTokenUsage] = useState(zToken);
  const [compressImages, setCompressImages] = useState(zCompress);
  const [showThinking, setShowThinking] = useState(zThinking);

  // ── User bubble (use ref to avoid stale closure in updateBubbleColor) ──
  const [bubbleBg, setBubbleBg] = useState<string | null>(() => loadLocalBubble(LS_BUBBLE_BG));
  const [bubbleText, setBubbleText] = useState<string | null>(() => loadLocalBubble(LS_BUBBLE_TEXT));
  const [bubbleBorder, setBubbleBorder] = useState<string | null>(() => loadLocalBubble(LS_BUBBLE_BORDER));
  const [selectedPreset, setSelectedPreset] = useState(0);
  const bubbleRef = useRef({ bg: null as string | null, text: null as string | null, border: null as string | null });
  const syncBubbleRef = () => { bubbleRef.current = { bg: bubbleBg, text: bubbleText, border: bubbleBorder }; };

  // ── Load server settings on mount ──
  useEffect(() => {
    let cancelled = false;
    getUiSettings()
      .then((server: UiSettings) => {
        if (cancelled) return;
        setServerSynced(true);

        // Theme + accent (save both together)
        const rawTheme = server.theme;
        // Handle old theme names from server
        const migratedTheme = rawTheme && THEME_MIGRATIONS[rawTheme] ? THEME_MIGRATIONS[rawTheme] : rawTheme;
        const t = migratedTheme && themes.some((t) => t.id === migratedTheme)
          ? (migratedTheme as ThemeMode)
          : getSavedTheme();
        const a = server.accent && accents.some((a) => a.id === server.accent)
          ? server.accent
          : getSavedAccent();
        setTheme(t);
        setAccent(a);
        applyTheme(t, a);

        // Also persist theme+accent to server if they don't exist yet
        if (!server.theme || !server.accent) {
          persist({ theme: t, accent: a });
        }

        // Toggles — update local state AND zustand
        if (typeof server.stickyUserHeader === "boolean") {
          setStickyUserHeader(server.stickyUserHeader);
          zSetSticky(server.stickyUserHeader);
        }
        if (typeof server.showTokenUsage === "boolean") {
          setShowTokenUsage(server.showTokenUsage);
          zSetToken(server.showTokenUsage);
        }
        if (typeof server.compressImages === "boolean") {
          setCompressImages(server.compressImages);
          zSetCompress(server.compressImages);
        }
        if (typeof server.showThinking === "boolean") {
          setShowThinking(server.showThinking);
          zSetThinking(server.showThinking);
        }

        // Bubble overrides — use server value, or fallback to localStorage, or null
        const bg = server.userBubbleColor !== undefined ? server.userBubbleColor : loadLocalBubble(LS_BUBBLE_BG);
        const text = server.userBubbleTextColor !== undefined ? server.userBubbleTextColor : loadLocalBubble(LS_BUBBLE_TEXT);
        const border = server.userBubbleBorderColor !== undefined ? server.userBubbleBorderColor : loadLocalBubble(LS_BUBBLE_BORDER);
        setBubbleBg(bg);
        setBubbleText(text);
        setBubbleBorder(border);
        applyBubbleOverrides(bg, text, border);

        // Sync server values to localStorage for future fallback
        saveLocalBubble(LS_BUBBLE_BG, bg);
        saveLocalBubble(LS_BUBBLE_TEXT, text);
        saveLocalBubble(LS_BUBBLE_BORDER, border);

        const matchIdx = BUBBLE_PRESETS.findIndex(
          (p) => p.bg === bg && p.text === text && p.border === border,
        );
        setSelectedPreset(matchIdx >= 0 ? matchIdx : BUBBLE_PRESETS.length - 1);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync ref whenever state changes
  useEffect(() => { syncBubbleRef(); });

  const persist = useCallback((patch: UiSettings) => {
    updateUiSettings(patch).catch(() => {});
  }, []);

  const selectTheme = (t: ThemeMode) => {
    setTheme(t);
    applyTheme(t, accent);
    // Save theme + accent together so both are persisted
    persist({ theme: t, accent });
  };

  const selectAccent = (id: string) => {
    setAccent(id);
    applyTheme(theme, id);
    persist({ accent: id, theme });
  };

  // ── Toggle handlers ──
  const toggleSticky = (val: boolean) => {
    setStickyUserHeader(val);
    zSetSticky(val);
    persist({ stickyUserHeader: val });
  };
  const toggleToken = (val: boolean) => {
    setShowTokenUsage(val);
    zSetToken(val);
    persist({ showTokenUsage: val });
  };
  const toggleCompress = (val: boolean) => {
    setCompressImages(val);
    zSetCompress(val);
    persist({ compressImages: val });
  };
  const toggleThinking = (val: boolean) => {
    setShowThinking(val);
    zSetThinking(val);
    persist({ showThinking: val });
  };

  const selectBubblePreset = (idx: number) => {
    const p = BUBBLE_PRESETS[idx];
    setSelectedPreset(idx);
    if (p.bg === "__custom__") return;
    setBubbleBg(p.bg);
    setBubbleText(p.text);
    setBubbleBorder(p.border);
    applyBubbleOverrides(p.bg, p.text, p.border);
    saveLocalBubble(LS_BUBBLE_BG, p.bg);
    saveLocalBubble(LS_BUBBLE_TEXT, p.text);
    saveLocalBubble(LS_BUBBLE_BORDER, p.border);
    persist({
      userBubbleColor: p.bg,
      userBubbleTextColor: p.text,
      userBubbleBorderColor: p.border,
    });
  };

  const updateBubbleColor = (
    field: "bg" | "text" | "border",
    value: string,
  ) => {
    // Use ref to avoid stale closure — ref is always current
    const cur = bubbleRef.current;
    const bg = field === "bg" ? value : cur.bg;
    const text = field === "text" ? value : cur.text;
    const border = field === "border" ? value : cur.border;
    if (field === "bg") setBubbleBg(value);
    if (field === "text") setBubbleText(value);
    if (field === "border") setBubbleBorder(value);
    setSelectedPreset(BUBBLE_PRESETS.length - 1);
    applyBubbleOverrides(bg, text, border);
    saveLocalBubble(LS_BUBBLE_BG, bg);
    saveLocalBubble(LS_BUBBLE_TEXT, text);
    saveLocalBubble(LS_BUBBLE_BORDER, border);
    persist({
      userBubbleColor: bg,
      userBubbleTextColor: text,
      userBubbleBorderColor: border,
    });
  };

  const resetBubble = () => {
    setBubbleBg(null);
    setBubbleText(null);
    setBubbleBorder(null);
    setSelectedPreset(0);
    applyBubbleOverrides(null, null, null);
    saveLocalBubble(LS_BUBBLE_BG, null);
    saveLocalBubble(LS_BUBBLE_TEXT, null);
    saveLocalBubble(LS_BUBBLE_BORDER, null);
    persist({
      userBubbleColor: null,
      userBubbleTextColor: null,
      userBubbleBorderColor: null,
    });
  };

  return (
    <div className="settings-fields">
      <p className="settings-hint">
        {serverSynced
          ? "Preferences saved server-side (survives cache clears)."
          : "Server offline — saved locally only."}
      </p>

      {/* ── Theme ── */}
      <div className="settings-field">
        <label className="settings-label">Theme</label>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {themes.map((t) => (
            <button
              key={t.id}
              onClick={() => selectTheme(t.id as ThemeMode)}
              style={{
                padding: "6px 12px",
                borderRadius: "var(--radius-sm)",
                border: `1px solid ${theme === t.id ? "var(--accent)" : "var(--border)"}`,
                background: theme === t.id ? "var(--accent-subtle)" : "var(--bg-glass)",
                color: theme === t.id ? "var(--accent-text)" : "var(--text-secondary)",
                fontSize: "12px",
                fontWeight: theme === t.id ? 600 : 400,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.15s",
              }}
              type="button"
            >
              {t.icon} {t.name}
            </button>
          ))}
        </div>
      </div>

      {/* ── Accent ── */}
      <div className="settings-field">
        <label className="settings-label">Accent</label>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {accents.map((a) => (
            <button
              key={a.id}
              onClick={() => selectAccent(a.id)}
              title={a.name}
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                border: accent === a.id
                  ? `2px solid ${a.color}`
                  : "2px solid var(--border)",
                background: a.color,
                cursor: "pointer",
                boxShadow: accent === a.id
                  ? `0 0 0 2px var(--bg-solid), 0 0 0 4px ${a.color}`
                  : "none",
                transition: "all 0.15s",
              }}
              type="button"
            />
          ))}
        </div>
      </div>

      {/* ── User Bubble ── */}
      <div className="settings-field">
        <label className="settings-label">Your Message Bubble</label>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: 8 }}>
          {BUBBLE_PRESETS.map((p, i) => (
            <button
              key={p.name}
              onClick={() => selectBubblePreset(i)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: "var(--radius-sm)",
                border: `1px solid ${selectedPreset === i ? "var(--accent)" : "var(--border)"}`,
                background: selectedPreset === i ? "var(--accent-subtle)" : "var(--bg-glass)",
                color: selectedPreset === i ? "var(--accent-text)" : "var(--text-secondary)",
                fontSize: "11px",
                fontWeight: selectedPreset === i ? 600 : 400,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.15s",
              }}
              type="button"
            >
              {p.bg !== "__custom__" && p.bg !== null && (
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    background: p.bg,
                    border: `1px solid ${p.border ?? "transparent"}`,
                    flexShrink: 0,
                  }}
                />
              )}
              {p.name}
            </button>
          ))}
        </div>

        {selectedPreset === BUBBLE_PRESETS.length - 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 11, color: "var(--text-dim)", width: 60 }}>Background</label>
              <input
                type="color"
                value={bubbleBg ?? "#1e40af"}
                onChange={(e) => updateBubbleColor("bg", e.target.value)}
                style={{ width: 32, height: 24, padding: 0, border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}
              />
              <input
                type="text"
                value={bubbleBg ?? ""}
                onChange={(e) => updateBubbleColor("bg", e.target.value || "")}
                placeholder="accent default"
                style={{ flex: 1, padding: "3px 6px", fontSize: 11, fontFamily: "var(--font-mono)", background: "var(--bg-glass)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-primary)" }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 11, color: "var(--text-dim)", width: 60 }}>Text</label>
              <input
                type="color"
                value={bubbleText ?? "#ffffff"}
                onChange={(e) => updateBubbleColor("text", e.target.value)}
                style={{ width: 32, height: 24, padding: 0, border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}
              />
              <input
                type="text"
                value={bubbleText ?? ""}
                onChange={(e) => updateBubbleColor("text", e.target.value || "")}
                placeholder="accent default"
                style={{ flex: 1, padding: "3px 6px", fontSize: 11, fontFamily: "var(--font-mono)", background: "var(--bg-glass)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-primary)" }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 11, color: "var(--text-dim)", width: 60 }}>Border</label>
              <input
                type="color"
                value={bubbleBorder ?? "#3b82f6"}
                onChange={(e) => updateBubbleColor("border", e.target.value)}
                style={{ width: 32, height: 24, padding: 0, border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer" }}
              />
              <input
                type="text"
                value={bubbleBorder ?? ""}
                onChange={(e) => updateBubbleColor("border", e.target.value || "")}
                placeholder="accent default"
                style={{ flex: 1, padding: "3px 6px", fontSize: 11, fontFamily: "var(--font-mono)", background: "var(--bg-glass)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-primary)" }}
              />
            </div>
            <button
              onClick={resetBubble}
              style={{
                alignSelf: "flex-start",
                padding: "4px 10px",
                fontSize: 11,
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg-glass)",
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
              type="button"
            >
              Reset to accent default
            </button>
          </div>
        )}
      </div>

      {/* ── Toggles ── */}
      <div className="settings-field">
        <label className="settings-label">Chat</label>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none", fontSize: 13, color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={stickyUserHeader} onChange={(e) => toggleSticky(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--accent)", cursor: "pointer" }} />
          Sticky user header
        </label>
      </div>

      <div className="settings-field">
        <label className="settings-label">Chat</label>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none", fontSize: 13, color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={showTokenUsage} onChange={(e) => toggleToken(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--accent)", cursor: "pointer" }} />
          Show token usage
        </label>
      </div>

      <div className="settings-field">
        <label className="settings-label">Images</label>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none", fontSize: 13, color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={compressImages} onChange={(e) => toggleCompress(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--accent)", cursor: "pointer" }} />
          Compress images
        </label>
      </div>

      <div className="settings-field">
        <label className="settings-label">Chat</label>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none", fontSize: 13, color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={showThinking} onChange={(e) => toggleThinking(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--accent)", cursor: "pointer" }} />
          Show thinking blocks
        </label>
      </div>
    </div>
  );
}
