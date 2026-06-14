import { create } from "zustand";

const LS_STICKY_USER_HEADER = "pi-kot/sticky-user-header";

function loadStickyUserHeader(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = localStorage.getItem(LS_STICKY_USER_HEADER);
    return v === null ? false : v === "true";
  } catch {
    return false;
  }
}

interface PreferencesState {
  stickyUserHeader: boolean;
  setStickyUserHeader: (enabled: boolean) => void;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  stickyUserHeader: loadStickyUserHeader(),

  setStickyUserHeader: (enabled) => {
    try {
      localStorage.setItem(LS_STICKY_USER_HEADER, String(enabled));
    } catch {
      // private mode
    }
    set({ stickyUserHeader: enabled });
  },
}));
