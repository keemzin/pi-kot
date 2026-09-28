import { create } from "zustand";
import { updateUiSettings } from "../lib/api-client";

const STORAGE_KEY = "pi-kot/favorite-sessions";

function load(): string[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function save(ids: string[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // private mode
  }
}

function syncToServer(ids: string[]): void {
  try {
    void updateUiSettings({ favoriteSessions: ids }).catch(() => {
      // offline or unauthenticated — localStorage already updated
    });
  } catch {
    // ignore
  }
}

interface FavoriteStore {
  favorites: string[];
  favoriteSet: Set<string>;
  isFavorite: (sessionId: string) => boolean;
  toggle: (sessionId: string) => void;
  unfavorite: (sessionId: string) => void;
  prune: (validIds: string[]) => void;
  setFavorites: (ids: string[], sync?: boolean) => void;
}

const initial = load();

export const useFavoriteStore = create<FavoriteStore>((set, get) => ({
  favorites: initial,
  favoriteSet: new Set(initial),
  isFavorite: (sessionId) => get().favoriteSet.has(sessionId),
  toggle: (sessionId) => {
    const current = get().favorites;
    const next = current.includes(sessionId)
      ? current.filter((id) => id !== sessionId)
      : [...current, sessionId];
    save(next);
    syncToServer(next);
    set({ favorites: next, favoriteSet: new Set(next) });
  },
  unfavorite: (sessionId) => {
    const current = get().favorites;
    if (!current.includes(sessionId)) return;
    const next = current.filter((id) => id !== sessionId);
    save(next);
    syncToServer(next);
    set({ favorites: next, favoriteSet: new Set(next) });
  },
  prune: (validIds) => {
    const validSet = new Set(validIds);
    const current = get().favorites;
    const next = current.filter((id) => validSet.has(id));
    if (next.length === current.length) return;
    save(next);
    syncToServer(next);
    set({ favorites: next, favoriteSet: new Set(next) });
  },
  setFavorites: (ids, sync = false) => {
    const unique = Array.from(new Set(ids));
    save(unique);
    if (sync) syncToServer(unique);
    set({ favorites: unique, favoriteSet: new Set(unique) });
  },
}));
