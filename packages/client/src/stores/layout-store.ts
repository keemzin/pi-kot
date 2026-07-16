/**
 * Layout store — sidebar collapse, panel visibility, mobile detection.
 *
 * Consolidates UI layout state that was previously scattered across
 * a dozen useState calls in App.tsx. Panels use a simple boolean or
 * tab selector; the store provides compound actions for common
 * interactions (e.g. open panel + close sidebar).
 */

import { create } from "zustand";

export type ExplorerTab = "files" | "git" | "artifacts" | "system-prompt";
export type PanelName = "settings" | "mcp" | "terminal" | "tree" | "orch";

export interface ViewerTab {
  path: string;
  name: string;
}

export interface ArtifactItem {
  id: string;
  title: string;
  /** Determines how the artifact is displayed */
  type: "html" | "svg" | "markdown" | "json" | "text" | "image";
  content: string;
  /** session that produced this artifact */
  sessionId: string;
  createdAt: number;
}

export interface ArtifactViewerTab {
  id: string;
  title: string;
  type: ArtifactItem["type"];
}

interface LayoutState {
  /* ── Sidebar ── */
  sidebarCollapsed: boolean;

  /* ── Panels and dialogs (boolean visibility) ── */
  showTreePanel: boolean;
  showSettings: boolean;
  showOrch: boolean;
  showMCP: boolean;
  showTerminal: boolean;
  showAddProjectDialog: boolean;

  /* ── File explorer / git tab (tri-state: undefined = closed) ── */
  explorerTab: ExplorerTab | undefined;

  /* ── File viewer (slides between chat and explorer) ── */
  viewerTabs: ViewerTab[];
  viewerActivePath: string | undefined;
  viewerWidth: number;

  /* ── Artifacts panel ── */
  artifactItems: ArtifactItem[];
  artifactActiveId: string | undefined;
  artifactWidth: number;
  showArtifacts: boolean;

  /* ── Artifact viewer (slides between chat and explorer) ── */
  artifactViewerTabs: ArtifactViewerTab[];
  artifactViewerActiveId: string | undefined;
  artifactViewerWidth: number;

  /* ── Derived ── */
  isMobile: boolean;

  /* ── Actions ── */
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  closeSidebarOnMobile: () => void;

  setShowTreePanel: (open: boolean) => void;
  setShowSettings: (open: boolean) => void;
  setShowOrch: (open: boolean) => void;
  setShowMCP: (open: boolean) => void;
  setShowTerminal: (open: boolean) => void;
  setShowAddProjectDialog: (open: boolean) => void;

  /** Set explorer tab to a specific value (undefined = close) */
  setExplorerTab: (tab: ExplorerTab | undefined) => void;
  /** Toggle files tab — opens if closed, switches to files if on git, closes if on files */
  toggleExplorerTab: (tab: ExplorerTab) => void;

  /* ── File viewer actions ── */
  openFileViewer: (path: string, name: string) => void;
  closeFileViewerTab: (path: string) => void;
  closeAllViewerTabs: () => void;
  setViewerActivePath: (path: string | undefined) => void;
  setViewerWidth: (width: number) => void;

  /* ── Artifact actions ── */
  pushArtifact: (item: Omit<ArtifactItem, "id" | "createdAt">) => void;
  setArtifactActiveId: (id: string | undefined) => void;
  setArtifactWidth: (width: number) => void;
  clearArtifacts: (sessionId: string) => void;
  setShowArtifacts: (show: boolean) => void;

  /* ── Artifact viewer actions ── */
  openArtifactViewer: (id: string, title: string, type: ArtifactItem["type"]) => void;
  closeArtifactViewerTab: (id: string) => void;
  closeAllArtifactViewerTabs: () => void;
  setArtifactViewerActiveId: (id: string | undefined) => void;
  setArtifactViewerWidth: (width: number) => void;

  /** Close every panel and sidebar (useful for deep-link "reset") */
  closeAllPanels: () => void;

  setIsMobile: (v: boolean) => void;
}

const VIEWER_DEFAULT_WIDTH = 480;
const VIEWER_MIN_WIDTH = 280;
const VIEWER_MAX_WIDTH = 900;

const VIEWER_WIDTH_STORAGE_KEY = "pi-kot/viewer-width";

/** Read viewer width from localStorage (synchronous, instant on refresh). */
function readStoredViewerWidth(): number {
  try {
    const raw = localStorage.getItem(VIEWER_WIDTH_STORAGE_KEY);
    if (raw !== null) {
      const n = Number(raw);
      if (!isNaN(n) && n >= VIEWER_MIN_WIDTH && n <= VIEWER_MAX_WIDTH) return n;
    }
  } catch { /* private mode */ }
  return VIEWER_DEFAULT_WIDTH;
}

const ARTIFACT_VIEWER_WIDTH_STORAGE_KEY = "pi-kot/artifact-viewer-width";

function readStoredArtifactViewerWidth(): number {
  try {
    const raw = localStorage.getItem(ARTIFACT_VIEWER_WIDTH_STORAGE_KEY);
    if (raw !== null) {
      const n = Number(raw);
      if (!isNaN(n) && n >= VIEWER_MIN_WIDTH && n <= VIEWER_MAX_WIDTH) return n;
    }
  } catch { /* private mode */ }
  return VIEWER_DEFAULT_WIDTH;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  sidebarCollapsed: false,
  showTreePanel: false,
  showSettings: false,
  showOrch: false,
  showMCP: false,
  showTerminal: false,
  showAddProjectDialog: false,
  explorerTab: undefined,
  viewerTabs: [],
  viewerActivePath: undefined,
  artifactItems: [],
  artifactActiveId: undefined,
  artifactWidth:
    typeof window !== "undefined" && window.innerWidth <= 600
      ? Math.max(280, Math.min(420, window.innerWidth - 40))
      : 420,
  showArtifacts: false,
  artifactViewerTabs: [],
  artifactViewerActiveId: undefined,
  artifactViewerWidth:
    typeof window !== "undefined" && window.innerWidth <= 600
      ? Math.max(VIEWER_MIN_WIDTH, Math.min(readStoredArtifactViewerWidth(), window.innerWidth - 40))
      : readStoredArtifactViewerWidth(),
  // Try localStorage first (instant on refresh), then fall back to default
  // Mobile gets clamped to viewport minus 40px gutter for the chat column.
  viewerWidth:
    typeof window !== "undefined" && window.innerWidth <= 600
      ? Math.max(VIEWER_MIN_WIDTH, Math.min(readStoredViewerWidth(), window.innerWidth - 40))
      : readStoredViewerWidth(),
  isMobile: typeof window !== "undefined" ? window.innerWidth <= 600 : false,

  /* ── Sidebar actions ── */

  toggleSidebar: () => {
    const { sidebarCollapsed, setExplorerTab } = get();
    // opening the sidebar also closes the explorer (keeps one panel at a time on mobile)
    if (sidebarCollapsed) {
      setExplorerTab(undefined);
    }
    set({ sidebarCollapsed: !sidebarCollapsed });
  },

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  closeSidebarOnMobile: () => {
    if (window.innerWidth <= 600) {
      set({ sidebarCollapsed: true });
    }
  },

  /* ── Panel toggles ── */

  setShowTreePanel: (open) => set({ showTreePanel: open }),
  setShowSettings: (open) => set({ showSettings: open }),
  setShowOrch: (open) => set({ showOrch: open }),
  setShowMCP: (open) => set({ showMCP: open }),
  setShowTerminal: (open) => set({ showTerminal: open }),
  setShowAddProjectDialog: (open) => set({ showAddProjectDialog: open }),

  /* ── Explorer ── */

  setExplorerTab: (tab) => set({ explorerTab: tab }),

  toggleExplorerTab: (tab) => {
    const { explorerTab } = get();
    if (explorerTab === tab) {
      set({ explorerTab: undefined });
    } else {
      set({ explorerTab: tab, sidebarCollapsed: true });
    }
  },

  /* ── File viewer ── */

  openFileViewer: (path, name) => {
    const { viewerTabs } = get();
    const exists = viewerTabs.find((t) => t.path === path);
    if (exists) {
      set({ viewerActivePath: path });
    } else {
      set({
        viewerTabs: [...viewerTabs, { path, name }],
        viewerActivePath: path,
      });
    }
  },

  closeAllViewerTabs: () => set({ viewerTabs: [], viewerActivePath: undefined }),

  closeFileViewerTab: (path) => {
    const { viewerTabs, viewerActivePath } = get();
    const remaining = viewerTabs.filter((t) => t.path !== path);
    let nextActive = viewerActivePath;
    if (viewerActivePath === path) {
      const idx = viewerTabs.findIndex((t) => t.path === path);
      if (remaining.length > 0) {
        nextActive = remaining[Math.min(idx, remaining.length - 1)].path;
      } else {
        nextActive = undefined;
      }
    }
    set({
      viewerTabs: remaining,
      viewerActivePath: nextActive,
    });
  },

  setViewerActivePath: (path) => set({ viewerActivePath: path }),

  setViewerWidth: (width) => {
    const clamped = Math.min(VIEWER_MAX_WIDTH, Math.max(VIEWER_MIN_WIDTH, Math.round(width)));
    // Sync to localStorage for instant reads on next page load
    try {
      localStorage.setItem(VIEWER_WIDTH_STORAGE_KEY, String(clamped));
    } catch { /* private mode */ }
    set({ viewerWidth: clamped });
  },

  /* ── Artifacts ── */

  pushArtifact: (item) => {
    const id = `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newItem: ArtifactItem = { ...item, id, createdAt: Date.now() };
    set((s) => {
      // Deduplicate by content — skip if identical artifact already exists
      const exists = s.artifactItems.some(
        (a) => a.title === item.title && a.content === item.content && a.type === item.type,
      );
      if (exists) return {};
      return {
        artifactItems: [...s.artifactItems, newItem],
        artifactActiveId: id,
      };
    });
  },

  setArtifactActiveId: (id) => set({ artifactActiveId: id }),

  setArtifactWidth: (width) =>
    set({ artifactWidth: Math.min(900, Math.max(280, Math.round(width))) }),

  clearArtifacts: (sessionId) =>
    set((s) => ({
      artifactItems: s.artifactItems.filter((a) => a.sessionId !== sessionId),
      artifactActiveId: undefined,
      showArtifacts: false,
    })),

  setShowArtifacts: (show) => set({ showArtifacts: show }),

  /* ── Artifact viewer ── */

  openArtifactViewer: (id, title, type) => {
    const { artifactViewerTabs } = get();
    const exists = artifactViewerTabs.find((t) => t.id === id);
    if (exists) {
      set({ artifactViewerActiveId: id });
    } else {
      set({
        artifactViewerTabs: [...artifactViewerTabs, { id, title, type }],
        artifactViewerActiveId: id,
      });
    }
  },

  closeAllArtifactViewerTabs: () => set({ artifactViewerTabs: [], artifactViewerActiveId: undefined }),

  closeArtifactViewerTab: (id) => {
    const { artifactViewerTabs, artifactViewerActiveId } = get();
    const remaining = artifactViewerTabs.filter((t) => t.id !== id);
    let nextActive = artifactViewerActiveId;
    if (artifactViewerActiveId === id) {
      const idx = artifactViewerTabs.findIndex((t) => t.id === id);
      if (remaining.length > 0) {
        nextActive = remaining[Math.min(idx, remaining.length - 1)].id;
      } else {
        nextActive = undefined;
      }
    }
    set({
      artifactViewerTabs: remaining,
      artifactViewerActiveId: nextActive,
    });
  },

  setArtifactViewerActiveId: (id) => set({ artifactViewerActiveId: id }),

  setArtifactViewerWidth: (width) => {
    const clamped = Math.min(VIEWER_MAX_WIDTH, Math.max(VIEWER_MIN_WIDTH, Math.round(width)));
    try {
      localStorage.setItem(ARTIFACT_VIEWER_WIDTH_STORAGE_KEY, String(clamped));
    } catch { /* private mode */ }
    set({ artifactViewerWidth: clamped });
  },

  /* ── Bulk ── */

  closeAllPanels: () =>
    set({
      showTreePanel: false,
      showSettings: false,
      showOrch: false,
      showMCP: false,
      showTerminal: false,
      showAddProjectDialog: false,
      explorerTab: undefined,
    }),

  /* ── Responsive ── */

  setIsMobile: (v) => set({ isMobile: v }),
}));

export { VIEWER_DEFAULT_WIDTH, VIEWER_MIN_WIDTH, VIEWER_MAX_WIDTH };
