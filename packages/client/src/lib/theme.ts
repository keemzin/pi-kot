export interface ThemeInfo {
  id: string;
  name: string;
  dark: boolean;
  colors: string[];
}

export const themes: ThemeInfo[] = [
  { id: "night", name: "Dusk", dark: true, colors: ["#212121", "#a0a0a0", "#777777", "#666666"] },
  { id: "midnight", name: "Midnight", dark: true, colors: ["#000000", "#5a7a9a", "#4a5565", "#4a5a72"] },
  { id: "dawn", name: "Dawn", dark: true, colors: ["#1a1d26", "#7a8ab0", "#6a5a80", "#5a7a9a"] },
  { id: "clean", name: "Clean", dark: false, colors: ["#ffffff", "#0580c4", "#007aff", "#5ac8fa"] },
  { id: "terracotta", name: "Terracotta", dark: false, colors: ["#f4f1ec", "#b06a48", "#5c2860", "#3a6a9b"] },
  { id: "sage", name: "Sage", dark: false, colors: ["#f0f2ec", "#6a7d5a", "#4a3860", "#3a6a7a"] },
];

export function getSavedTheme(): string {
  try {
    const saved = localStorage.getItem("pi-kot-theme");
    if (saved && themes.some((t) => t.id === saved)) return saved;
  } catch {
    // private mode
  }
  // Auto-detect from OS
  if (window.matchMedia?.("(prefers-color-scheme: light)").matches) return "terracotta";
  return "night";
}

export function applyTheme(themeId: string): void {
  document.documentElement.setAttribute("data-theme", themeId);
  try {
    localStorage.setItem("pi-kot-theme", themeId);
  } catch {
    // private mode
  }
}
