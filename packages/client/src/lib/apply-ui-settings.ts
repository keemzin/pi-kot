import { getSavedTheme, getSavedAccent, applyTheme, THEME_MIGRATIONS, type ThemeMode } from "./theme";
import { usePreferencesStore } from "../stores/preferences-store";
import { useFavoriteStore } from "../stores/favorite-store";

const LS_BUBBLE_BG = "pi-kot/user-bubble-bg";
const LS_BUBBLE_TEXT = "pi-kot/user-bubble-text";
const LS_BUBBLE_BORDER = "pi-kot/user-bubble-border";

function loadLocalBubble(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? v : null;
  } catch {
    return null;
  }
}

export function applyServerUiSettings(settings: Record<string, unknown> | null | undefined): void {
  if (!settings) return;

  // Apply theme + accent (migrate old theme names)
  const rawTheme = typeof settings.theme === "string" ? settings.theme : undefined;
  const migratedTheme = (rawTheme && THEME_MIGRATIONS[rawTheme] ? THEME_MIGRATIONS[rawTheme] : rawTheme) as ThemeMode | undefined;
  const accent = typeof settings.accent === "string" ? settings.accent : undefined;
  if (migratedTheme || accent) {
    applyTheme(migratedTheme ?? getSavedTheme(), accent ?? getSavedAccent());
  }

  // Apply toggle settings to zustand (components read from here)
  const { setState } = usePreferencesStore;
  if (typeof settings.stickyUserHeader === "boolean") {
    setState({ stickyUserHeader: settings.stickyUserHeader });
  }
  if (typeof settings.flyToTop === "boolean") {
    setState({ flyToTop: settings.flyToTop });
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

  // Apply favorite sessions
  if (Array.isArray(settings.favoriteSessions)) {
    const MIGRATED_KEY = "pi-kot/favorite-sessions-migrated";
    let migrated = false;
    try {
      migrated = Boolean(localStorage.getItem(MIGRATED_KEY));
    } catch {
      // private mode
    }
    const localFavs = useFavoriteStore.getState().favorites;

    if (!migrated && localFavs.length > 0 && settings.favoriteSessions.length === 0) {
      // First boot after upgrade: migrate existing local favorites to server
      useFavoriteStore.getState().setFavorites(localFavs, true);
    } else {
      // Server is authoritative across devices
      useFavoriteStore.getState().setFavorites(settings.favoriteSessions as string[], false);
    }
    try {
      localStorage.setItem(MIGRATED_KEY, "1");
    } catch {
      // private mode
    }
  }

  // Apply bubble overrides to CSS
  const bubbleBg = settings.userBubbleColor !== undefined ? (settings.userBubbleColor as string | null) : loadLocalBubble(LS_BUBBLE_BG);
  const bubbleText = settings.userBubbleTextColor !== undefined ? (settings.userBubbleTextColor as string | null) : loadLocalBubble(LS_BUBBLE_TEXT);
  const bubbleBorder = settings.userBubbleBorderColor !== undefined ? (settings.userBubbleBorderColor as string | null) : loadLocalBubble(LS_BUBBLE_BORDER);
  if (bubbleBg) document.documentElement.style.setProperty("--user-bubble", bubbleBg);
  if (bubbleText) document.documentElement.style.setProperty("--user-bubble-text", bubbleText);
  if (bubbleBorder) document.documentElement.style.setProperty("--user-bubble-border", bubbleBorder);
}

export async function fetchAndApplyUiSettings(): Promise<void> {
  try {
    const headers: Record<string, string> = {};
    try {
      const token = localStorage.getItem("pi-kot/auth-token");
      if (token) headers["Authorization"] = `Bearer ${token}`;
    } catch {}
    const res = await fetch("/api/v1/config/ui-settings", { headers });
    if (!res.ok) return;
    const settings = await res.json();
    applyServerUiSettings(settings);
  } catch {
    // offline or unauthenticated
  }
}
