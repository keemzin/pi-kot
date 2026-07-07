/**
 * Terminal tab store — persisted to sessionStorage.
 *
 * Tab metadata (id, projectId, label) is stored here. The actual
 * WebSocket + xterm instances live outside React in a module-level
 * Map inside TerminalPanel.tsx.
 *
 * Persisting to sessionStorage means a page reload reattaches each
 * tab to its existing PTY on the server (via tabId). After the
 * idle timeout (10 min) the server kills the PTY.
 */

import { create } from "zustand";

export interface TerminalTab {
  id: string;
  projectId: string;
  label: string;
  createdAt: number;
}

interface TerminalState {
  tabs: TerminalTab[];
  activeTabId: string | undefined;

  openTab: (projectId: string) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string | undefined) => void;
  closeProjectTabs: (projectId: string) => void;
}

const STORAGE_KEY = "pi-kot.terminal.tabs.v1";

interface PersistedShape {
  tabs: TerminalTab[];
  activeTabId: string | undefined;
}

function readPersisted(): PersistedShape {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return { tabs: [], activeTabId: undefined };
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as { tabs?: unknown }).tabs)
    ) {
      return { tabs: [], activeTabId: undefined };
    }
    const tabs: TerminalTab[] = [];
    for (const t of (parsed as { tabs: unknown[] }).tabs) {
      if (
        typeof t === "object" &&
        t !== null &&
        typeof (t as TerminalTab).id === "string" &&
        typeof (t as TerminalTab).projectId === "string" &&
        typeof (t as TerminalTab).label === "string" &&
        typeof (t as TerminalTab).createdAt === "number"
      ) {
        tabs.push(t as TerminalTab);
      }
    }
    const activeRaw = (parsed as { activeTabId?: unknown }).activeTabId;
    const activeTabId = typeof activeRaw === "string" ? activeRaw : undefined;
    return {
      tabs,
      activeTabId: tabs.some((t) => t.id === activeTabId) ? activeTabId : tabs[0]?.id,
    };
  } catch {
    return { tabs: [], activeTabId: undefined };
  }
}

function writePersisted(state: PersistedShape): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // private mode
  }
}

let counter = 0;
const newId = (): string => `term-${Date.now().toString(36)}-${(counter++).toString(36)}`;

const initial = readPersisted();

export const useTerminalStore = create<TerminalState>((set) => ({
  tabs: initial.tabs,
  activeTabId: initial.activeTabId,

  openTab: (projectId) => {
    const id = newId();
    set((s) => {
      const projectTabs = s.tabs.filter((t) => t.projectId === projectId);
      const tab: TerminalTab = {
        id,
        projectId,
        label: `Terminal ${projectTabs.length + 1}`,
        createdAt: Date.now(),
      };
      const next = { tabs: [...s.tabs, tab], activeTabId: id };
      writePersisted(next);
      return next;
    });
    return id;
  },

  closeTab: (id) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return {};
      const tabs = s.tabs.slice(0, idx).concat(s.tabs.slice(idx + 1));
      const activeTabId =
        s.activeTabId === id ? (tabs[idx] ?? tabs[idx - 1] ?? tabs[0])?.id : s.activeTabId;
      const next = { tabs, activeTabId };
      writePersisted(next);
      return next;
    });
  },

  setActiveTab: (id) =>
    set((s) => {
      const next = { ...s, activeTabId: id };
      writePersisted({ tabs: next.tabs, activeTabId: id });
      return { activeTabId: id };
    }),

  closeProjectTabs: (projectId) => {
    set((s) => {
      const tabs = s.tabs.filter((t) => t.projectId !== projectId);
      const activeTabId = tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : tabs[0]?.id;
      const next = { tabs, activeTabId };
      writePersisted(next);
      return next;
    });
  },
}));
