import { create } from "zustand";

const LS_STICKY_USER_HEADER = "pi-kot/sticky-user-header";
const LS_FLY_TO_TOP = "pi-kot/fly-to-top";
const LS_SHOW_TOKEN_USAGE = "pi-kot/show-token-usage";
const LS_COMPRESS_IMAGES = "pi-kot/compress-images";
const LS_SHOW_THINKING = "pi-kot/show-thinking";
const LS_GROUPED_TOOL_DISPLAY = "pi-kot/grouped-tool-display";
const LS_TRAIL_DEFAULT_VIEW = "pi-kot/trail-default-view";
const LS_SHOW_TURN_FILES = "pi-kot/show-turn-files";
const LS_SWIPE_TO_OPEN_SIDEBAR = "pi-kot/swipe-to-open-sidebar";
const LS_EMPTY_FLAP_ENABLED = "pi-kot/empty-flap-enabled";
const LS_EMPTY_FLAP_WORDS = "pi-kot/empty-flap-words";
const LS_EMPTY_FLAP_SIZE = "pi-kot/empty-flap-size";

const DEFAULT_EMPTY_FLAP_WORDS = ["PI-KOT 0.1.36", "PI-SDK 0.83.0"];

function loadGroupedToolDisplay(): boolean {
	if (typeof window === "undefined") return true;
	try {
		const v = localStorage.getItem(LS_GROUPED_TOOL_DISPLAY);
		return v === null ? true : v === "true";
	} catch {
		return true;
	}
}

/** Trail card resting view: "justify" (collapsed per-step previews) or
 *  "full" (everything expanded). While a turn streams, trails always show
 *  Full regardless; this decides what they settle on afterwards. */
export type TrailViewMode = "full" | "justify";

function loadTrailDefaultView(): TrailViewMode {
	if (typeof window === "undefined") return "justify";
	try {
		const v = localStorage.getItem(LS_TRAIL_DEFAULT_VIEW);
		return v === "full" || v === "justify" ? v : "justify";
	} catch {
		return "justify";
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

/** ChatGPT-style positioning: anchoring the newest user message near the top
 *  of the viewport when you send, with a dynamic spacer that shrinks as the
 *  reply streams in and normal bottom auto-scroll once it fills the screen. */
function loadFlyToTop(): boolean {
	if (typeof window === "undefined") return true;
	try {
		const v = localStorage.getItem(LS_FLY_TO_TOP);
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

function loadEmptyFlapEnabled(): boolean {
	if (typeof window === "undefined") return true;
	try {
		const v = localStorage.getItem(LS_EMPTY_FLAP_ENABLED);
		return v === null ? true : v === "true";
	} catch {
		return true;
	}
}

function loadEmptyFlapWords(): string[] {
	if (typeof window === "undefined") return DEFAULT_EMPTY_FLAP_WORDS;
	try {
		const raw = localStorage.getItem(LS_EMPTY_FLAP_WORDS);
		if (!raw) return DEFAULT_EMPTY_FLAP_WORDS;
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return DEFAULT_EMPTY_FLAP_WORDS;
		const words = parsed
			.filter((w): w is string => typeof w === "string" && w.trim().length > 0)
			.map((w) => w.trim())
			.slice(0, 8)
			.map((w) => w.slice(0, 32));
		return words.length > 0 ? words : DEFAULT_EMPTY_FLAP_WORDS;
	} catch {
		return DEFAULT_EMPTY_FLAP_WORDS;
	}
}

function loadEmptyFlapSize(): number {
	if (typeof window === "undefined") return 30;
	try {
		const v = Number(localStorage.getItem(LS_EMPTY_FLAP_SIZE));
		if (!Number.isFinite(v)) return 30;
		return Math.min(64, Math.max(14, Math.round(v)));
	} catch {
		return 30;
	}
}

export interface PreferencesState {
	stickyUserHeader: boolean;
	setStickyUserHeader: (enabled: boolean) => void;
	flyToTop: boolean;
	setFlyToTop: (enabled: boolean) => void;
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
	/** Trail card resting view (Justify = collapsed per-step previews, Full =
	 *  everything expanded). Streaming turns always show Full regardless. */
	trailDefaultView: TrailViewMode;
	setTrailDefaultView: (view: TrailViewMode) => void;
	/** Turn-written-file chips under each reply. */
	showTurnFiles: boolean;
	setShowTurnFiles: (enabled: boolean) => void;
	/** Horizontal swipe (left/right) on touch screens opens/collapses the sidebar. */
	swipeToOpenSidebar: boolean;
	setSwipeToOpenSidebar: (enabled: boolean) => void;
	/** Split-flap departure board on the empty chat state. */
	emptyFlapEnabled: boolean;
	setEmptyFlapEnabled: (enabled: boolean) => void;
	emptyFlapWords: string[];
	setEmptyFlapWords: (words: string[]) => void;
	emptyFlapSize: number;
	setEmptyFlapSize: (size: number) => void;
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
	stickyUserHeader: loadStickyUserHeader(),
	flyToTop: loadFlyToTop(),
	showTokenUsage: loadShowTokenUsage(),

	setStickyUserHeader: (enabled) => {
		try {
			localStorage.setItem(LS_STICKY_USER_HEADER, String(enabled));
		} catch {
			// private mode
		}
		set({ stickyUserHeader: enabled });
	},

	setFlyToTop: (enabled) => {
		try {
			localStorage.setItem(LS_FLY_TO_TOP, String(enabled));
		} catch {
			// private mode
		}
		set({ flyToTop: enabled });
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

	trailDefaultView: loadTrailDefaultView(),

	setTrailDefaultView: (view) => {
		const v: TrailViewMode = view === "full" ? "full" : "justify";
		try {
			localStorage.setItem(LS_TRAIL_DEFAULT_VIEW, v);
		} catch {
			// private mode
		}
		set({ trailDefaultView: v });
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
	emptyFlapEnabled: loadEmptyFlapEnabled(),
	emptyFlapWords: loadEmptyFlapWords(),
	emptyFlapSize: loadEmptyFlapSize(),

	setSwipeToOpenSidebar: (enabled) => {
		try {
			localStorage.setItem(LS_SWIPE_TO_OPEN_SIDEBAR, String(enabled));
		} catch {
			// private mode
		}
		set({ swipeToOpenSidebar: enabled });
	},

	setEmptyFlapEnabled: (enabled) => {
		try {
			localStorage.setItem(LS_EMPTY_FLAP_ENABLED, String(enabled));
		} catch {
			// private mode
		}
		set({ emptyFlapEnabled: enabled });
	},

	setEmptyFlapWords: (words) => {
		const cleaned = Array.isArray(words)
			? words
					.map((w) => String(w).trim())
					.filter((w) => w.length > 0)
					.slice(0, 8)
					.map((w) => w.slice(0, 32))
			: [...DEFAULT_EMPTY_FLAP_WORDS];
		try {
			localStorage.setItem(LS_EMPTY_FLAP_WORDS, JSON.stringify(cleaned));
		} catch {
			// private mode
		}
		set({
			emptyFlapWords: cleaned.length > 0 ? cleaned : DEFAULT_EMPTY_FLAP_WORDS,
		});
	},

	setEmptyFlapSize: (size) => {
		const clamped = Math.min(64, Math.max(14, Math.round(Number(size) || 30)));
		try {
			localStorage.setItem(LS_EMPTY_FLAP_SIZE, String(clamped));
		} catch {
			// private mode
		}
		set({ emptyFlapSize: clamped });
	},
}));
