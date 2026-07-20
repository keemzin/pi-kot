import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { getSavedTheme, getSavedAccent, applyTheme, THEME_MIGRATIONS } from "./lib/theme";

// ── localStorage keys for bubble color fallback (must match AppearanceTab) ──
const LS_BUBBLE_BG = "pi-kot/user-bubble-bg";
const LS_BUBBLE_TEXT = "pi-kot/user-bubble-text";
const LS_BUBBLE_BORDER = "pi-kot/user-bubble-border";

function loadLocalBubble(key: string): string | null {
  try { const v = localStorage.getItem(key); return v !== null ? v : null; } catch { return null; }
}
import { usePreferencesStore } from "./stores/preferences-store";
import "./styles/themes.css";

// Apply saved theme + accent before first render (no flash)
applyTheme(getSavedTheme(), getSavedAccent());

// Pre-fetch server settings and apply before render
// This ensures zustand stores have server values, not just stale localStorage
getUiSettingsPreload().then((settings) => {
  if (!settings) return;

  // Apply theme + accent (migrate old theme names)
  const rawTheme = settings.theme;
  const migratedTheme = rawTheme && THEME_MIGRATIONS[rawTheme] ? THEME_MIGRATIONS[rawTheme] : rawTheme;
  if (migratedTheme || settings.accent) {
    applyTheme(
      migratedTheme ?? getSavedTheme(),
      settings.accent ?? getSavedAccent(),
    );
  }

  // Apply toggle settings to zustand (components read from here)
  const { setState } = usePreferencesStore;
  if (typeof settings.stickyUserHeader === "boolean") {
    setState({ stickyUserHeader: settings.stickyUserHeader });
  }
  if (typeof settings.showTokenUsage === "boolean") {
    setState({ showTokenUsage: settings.showTokenUsage });
  }
  if (typeof settings.compressImages === "boolean") {
    setState({ compressImages: settings.compressImages });
  }
  if (typeof settings.showThinking === "boolean") {
    setState({ showThinking: settings.showThinking });
  }

  // Apply bubble overrides to CSS (server value first, then localStorage fallback)
  const bubbleBg = settings.userBubbleColor !== undefined ? settings.userBubbleColor : loadLocalBubble(LS_BUBBLE_BG);
  const bubbleText = settings.userBubbleTextColor !== undefined ? settings.userBubbleTextColor : loadLocalBubble(LS_BUBBLE_TEXT);
  const bubbleBorder = settings.userBubbleBorderColor !== undefined ? settings.userBubbleBorderColor : loadLocalBubble(LS_BUBBLE_BORDER);
  if (bubbleBg) document.documentElement.style.setProperty("--user-bubble", bubbleBg);
  if (bubbleText) document.documentElement.style.setProperty("--user-bubble-text", bubbleText);
  if (bubbleBorder) document.documentElement.style.setProperty("--user-bubble-border", bubbleBorder);
}).catch(() => {});

// Inline fetch — avoids circular imports
async function getUiSettingsPreload() {
  try {
    const res = await fetch("/api/v1/config/ui-settings");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const root = document.getElementById("root");
if (root === null) throw new Error("root element not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
