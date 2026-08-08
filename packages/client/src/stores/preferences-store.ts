import { create } from "zustand";

const LS_STICKY_USER_HEADER = "pi-kot/sticky-user-header";
const LS_SHOW_TOKEN_USAGE = "pi-kot/show-token-usage";
const LS_COMPRESS_IMAGES = "pi-kot/compress-images";
const LS_SHOW_THINKING = "pi-kot/show-thinking";
const LS_GROUPED_TOOL_DISPLAY = "pi-kot/grouped-tool-display";
const LS_SHOW_TURN_FILES = "pi-kot/show-turn-files";
const LS_SWIPE_TO_OPEN_SIDEBAR = "pi-kot/swipe-to-open-sidebar";

function loadGroupedToolDisplay(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = localStorage.getItem(LS_GROUPED_TOOL_DISPLAY);
    return v === null ? true : v === "true";
  } catch {
    return true;
  }
}

function loadStickyUserHeader(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = localStorage.getItem(LS_STICKY_USER_HEADER);
    return v === null ? true : v === "true";
  } catch {
    return true;
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

function loadShowThinking(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = localStorage.getItem(LS_SHOW_THINKING);
    return v === null ? false : v === "true";
  } catch {
    return false;
  }
}

function loadShowTurnFiles(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = localStorage.getItem(LS_SHOW_TURN_FILES);
    return v === null ? true : v === "true";
  } catch {
    return true;
  }
}

function loadSwipeToOpenSidebar(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = localStorage.getItem(LS_SWIPE_TO_OPEN_SIDEBAR);
    return v === null ? true : v === "true";
  } catch {
    return true;
  }
}

export interface PreferencesState {
  stickyUserHeader: boolean;
  setStickyUserHeader: (enabled: boolean) => void;
  showTokenUsage: boolean;
  setShowTokenUsage: (enabled: boolean) => void;
  compressImages: boolean;
  setCompressImages: (enabled: boolean) => void;
  showThinking: boolean;
  setShowThinking: (enabled: boolean) => void;
  /** openkot-style tool trail grouping (one Trail card per turn, interstitial
   *  text collapsed into justification previews). */
  groupedToolDisplay: boolean;
  setGroupedToolDisplay: (enabled: boolean) => void;
  /** Turn-written-file chips under each reply. */
  showTurnFiles: boolean;
  setShowTurnFiles: (enabled: boolean) => void;
  /** Horizontal swipe (left/right) on touch screens opens/collapses the sidebar. */
  swipeToOpenSidebar: boolean;
  setSwipeToOpenSidebar: (enabled: boolean) => void;
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

  showThinking: loadShowThinking(),
  groupedToolDisplay: loadGroupedToolDisplay(),

  setShowThinking: (enabled) => {
    try {
      localStorage.setItem(LS_SHOW_THINKING, String(enabled));
    } catch {
      // private mode
    }
    set({ showThinking: enabled });
  },

  setGroupedToolDisplay: (enabled) => {
    try {
      localStorage.setItem(LS_GROUPED_TOOL_DISPLAY, String(enabled));
    } catch {
      // private mode
    }
    set({ groupedToolDisplay: enabled });
  },

  showTurnFiles: loadShowTurnFiles(),

  setShowTurnFiles: (enabled) => {
    try {
      localStorage.setItem(LS_SHOW_TURN_FILES, String(enabled));
    } catch {
      // private mode
    }
    set({ showTurnFiles: enabled });
  },

  swipeToOpenSidebar: loadSwipeToOpenSidebar(),

  setSwipeToOpenSidebar: (enabled) => {
    try {
      localStorage.setItem(LS_SWIPE_TO_OPEN_SIDEBAR, String(enabled));
    } catch {
      // private mode
    }
    set({ swipeToOpenSidebar: enabled });
  },
}));
