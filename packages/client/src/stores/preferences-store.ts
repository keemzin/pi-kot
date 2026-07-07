import { create } from "zustand";

const LS_STICKY_USER_HEADER = "pi-kot/sticky-user-header";
const LS_SHOW_TOKEN_USAGE = "pi-kot/show-token-usage";
const LS_COMPRESS_IMAGES = "pi-kot/compress-images";

function loadStickyUserHeader(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = localStorage.getItem(LS_STICKY_USER_HEADER);
    return v === null ? false : v === "true";
  } catch {
    return false;
  }
}

function loadShowTokenUsage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = localStorage.getItem(LS_SHOW_TOKEN_USAGE);
    return v === null ? false : v === "true";
  } catch {
    return false;
  }
}

function loadCompressImages(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = localStorage.getItem(LS_COMPRESS_IMAGES);
    return v === null ? true : v === "true";
  } catch {
    return true;
  }
}

interface PreferencesState {
  stickyUserHeader: boolean;
  setStickyUserHeader: (enabled: boolean) => void;
  showTokenUsage: boolean;
  setShowTokenUsage: (enabled: boolean) => void;
  compressImages: boolean;
  setCompressImages: (enabled: boolean) => void;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  stickyUserHeader: loadStickyUserHeader(),
  showTokenUsage: loadShowTokenUsage(),

  setStickyUserHeader: (enabled) => {
    try {
      localStorage.setItem(LS_STICKY_USER_HEADER, String(enabled));
    } catch {
      // private mode
    }
    set({ stickyUserHeader: enabled });
  },

  setShowTokenUsage: (enabled) => {
    try {
      localStorage.setItem(LS_SHOW_TOKEN_USAGE, String(enabled));
    } catch {
      // private mode
    }
    set({ showTokenUsage: enabled });
  },

  compressImages: loadCompressImages(),

  setCompressImages: (enabled) => {
    try {
      localStorage.setItem(LS_COMPRESS_IMAGES, String(enabled));
    } catch {
      // private mode
    }
    set({ compressImages: enabled });
  },
}));
