/**
 * Theme system — 2 layers:
 *   Theme: surface identity (dark, dark-warm, light, light-warm)
 *   Accent: a single primary color (everything else derives from it)
 */

export interface ThemeInfo {
  id: string;
  name: string;
  icon: string;
}

export interface AccentInfo {
  id: string;
  name: string;
  color: string;
}

export const themes: ThemeInfo[] = [
  { id: "dark",      name: "Dark",      icon: "🌙" },
  { id: "dark-warm", name: "Dark Warm", icon: "🟤" },
  { id: "light",     name: "Light",     icon: "☀️" },
  { id: "light-warm",name: "Light Warm",icon: "📜" },
];

// ── Old theme name → new theme name migration ──
export const THEME_MIGRATIONS: Record<string, ThemeMode> = {
  "night": "dark",
  "midnight": "dark",
  "dawn": "dark-warm",
  "flexoki-dark": "dark-warm",
  "monokai": "dark",
  "dracula": "dark",
  "nord": "dark",
  "bourbon": "dark-warm",
  "clean": "light",
  "terracotta": "light-warm",
  "sage": "light-warm",
  "flexoki-light": "light-warm",
};

export const accents: AccentInfo[] = [
  { id: "slate",   name: "Slate",   color: "#64748b" },
  { id: "blue",    name: "Blue",    color: "#2563eb" },
  { id: "violet",  name: "Violet",  color: "#7c3aed" },
  { id: "emerald", name: "Emerald", color: "#059669" },
  { id: "amber",   name: "Amber",   color: "#d97706" },
  { id: "rose",    name: "Rose",    color: "#e11d48" },
  { id: "teal",    name: "Teal",    color: "#0d9488" },
  { id: "orange",  name: "Orange",  color: "#ea580c" },
  { id: "flexoki", name: "Flexoki", color: "#da702c" },
];

export type ThemeMode = "dark" | "dark-warm" | "light" | "light-warm";

const STORAGE_KEY = "pi-kot-theme";
const STORAGE_ACCENT = "pi-kot-accent";

function defaults(): { theme: ThemeMode; accent: string } {
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return { theme: prefersDark ? "dark" : "light", accent: "blue" };
}

export function getSavedTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (themes.some((t) => t.id === v)) return v as ThemeMode;
    // Check for old theme names
    if (v && v in THEME_MIGRATIONS) {
      const migrated = THEME_MIGRATIONS[v];
      // Immediately save the migrated value so next load is clean
      try { localStorage.setItem(STORAGE_KEY, migrated); } catch {}
      return migrated;
    }
  } catch {}
  return defaults().theme;
}

export function getSavedAccent(): string {
  try {
    const v = localStorage.getItem(STORAGE_ACCENT);
    if (v && accents.some((a) => a.id === v)) return v;
  } catch {}
  return defaults().accent;
}

export function applyTheme(theme: ThemeMode, accent?: string): void {
  document.documentElement.setAttribute("data-theme", theme);
  if (accent) {
    document.documentElement.setAttribute("data-accent", accent);
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme);
    if (accent) localStorage.setItem(STORAGE_ACCENT, accent);
  } catch {}
}
