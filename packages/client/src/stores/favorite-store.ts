import { create } from "zustand";

const STORAGE_KEY = "pi-kot/favorite-sessions";

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function save(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // private mode
  }
}

interface FavoriteStore {
  favorites: string[];
  toggle: (sessionId: string) => void;
}

export const useFavoriteStore = create<FavoriteStore>((set, get) => ({
  favorites: load(),
  toggle: (sessionId) => {
    const current = get().favorites;
    const next = current.includes(sessionId)
      ? current.filter((id) => id !== sessionId)
      : [...current, sessionId];
    save(next);
    set({ favorites: next });
  },
}));
