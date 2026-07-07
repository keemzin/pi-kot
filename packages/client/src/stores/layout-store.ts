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

  /** Close every panel and sidebar (useful for deep-link "reset") */
  closeAllPanels: () => void;

  setIsMobile: (v: boolean) => void;
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
      // same tab → close
      set({ explorerTab: undefined });
    } else {
      // different tab or closed → open at this tab
      set({ explorerTab: tab, sidebarCollapsed: true });
    }
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
