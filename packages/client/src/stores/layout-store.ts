/**
 * Layout store — sidebar collapse, panel visibility, mobile detection.
 *
 * Consolidates UI layout state that was previously scattered across
 * a dozen useState calls in App.tsx. Panels use a simple boolean or
 * tab selector; the store provides compound actions for common
 * interactions (e.g. open panel + close sidebar).
 */

import { create } from "zustand";

export type ExplorerTab = "files" | "git";
export type PanelName = "settings" | "mcp" | "terminal" | "tree" | "orch";

export interface ViewerTab {
  path: string;
  name: string;
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
  setViewerActivePath: (path: string | undefined) => void;
  setViewerWidth: (width: number) => void;

  /** Close every panel and sidebar (useful for deep-link "reset") */
  closeAllPanels: () => void;

  setIsMobile: (v: boolean) => void;
}

const VIEWER_DEFAULT_WIDTH = 480;
const VIEWER_MIN_WIDTH = 280;
const VIEWER_MAX_WIDTH = 900;

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
  viewerWidth: VIEWER_DEFAULT_WIDTH,
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
    set({ viewerWidth: clamped });
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
