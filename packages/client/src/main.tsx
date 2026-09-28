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
import { fetchAndApplyUiSettings } from "./lib/apply-ui-settings";
import { I18nProvider } from "./hooks/useI18n";
import "./styles/themes.css";

// Apply saved theme + accent before first render (no flash)
applyTheme(getSavedTheme(), getSavedAccent());

// Pre-fetch server settings and apply before/during initial render
void fetchAndApplyUiSettings();

const root = document.getElementById("root");
if (root === null) throw new Error("root element not found");

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
