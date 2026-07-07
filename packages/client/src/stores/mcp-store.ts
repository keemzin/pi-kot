import { create } from "zustand";
import {
  getMcpSettings,
  setMcpEnabled as apiSetMcpEnabled,
  listMcpServers,
  upsertMcpServer,
  deleteMcpServer,
  probeMcpServer,
  grantStdioMcpTrust,
  revokeStdioMcpTrust,
} from "../lib/api-client";
import type {
  McpServerConfig,
  McpServerStatus,
  McpSettingsResponse,
} from "../lib/api-client/types";

const POLL_INTERVAL_MS = 30_000;

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function sameSettings(a: McpSettingsResponse | undefined, b: McpSettingsResponse): boolean {
  return a?.enabled === b.enabled && a.connected === b.connected && a.total === b.total;
}

function sameProjectData(a: McpProjectData | undefined, b: McpProjectData): boolean {
  return (
    a !== undefined &&
    stableJson(a.status) === stableJson(b.status) &&
    stableJson(a.stdioTrust) === stableJson(b.stdioTrust)
  );
}

/**
 * Module-level stable empty array. Zustand selectors compare return
 * values by reference; returning a fresh `[]` from a `useMcpStore(s
 * => ... ?? [])` selector triggers a re-render on every store update
 * (the new literal is a different reference even when the underlying
 * value didn't change), eventually crashing the React tree with
 * "Maximum update depth exceeded."
 */
export const EMPTY_STATUS: McpServerStatus[] = [];

interface McpProjectData {
  status: McpServerStatus[];
  stdioTrust?: { trusted: boolean };
}

interface McpState {
  settings: McpSettingsResponse | undefined;
  globalServers: Record<string, McpServerConfig>;
  globalStatus: McpServerStatus[];
  byProject: Record<string, McpProjectData>;
  loading: boolean;
  error: string | null;
  pollHandle: ReturnType<typeof setInterval> | undefined;

  startPolling: () => void;
  stopPolling: () => void;
  refreshSettings: () => Promise<void>;
  refreshProject: (projectId: string) => Promise<void>;
  setMcpEnabled: (enabled: boolean) => Promise<void>;
  upsertServer: (name: string, config: McpServerConfig) => Promise<void>;
  deleteServer: (name: string) => Promise<void>;
  probeServer: (name: string, projectId?: string) => Promise<void>;
  grantStdioTrust: (projectId: string) => Promise<void>;
  revokeStdioTrust: (projectId: string) => Promise<void>;
}

let refreshInFlight = false;

export const useMcpStore = create<McpState>((set, get) => ({
  settings: undefined,
  globalServers: {},
  globalStatus: EMPTY_STATUS,
  byProject: {},
  loading: false,
  error: null,
  pollHandle: undefined,

  startPolling: () => {
    const h = setInterval(async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (refreshInFlight) return;
      await get().refreshSettings();
    }, POLL_INTERVAL_MS);
    set({ pollHandle: h });
    get().refreshSettings();
  },

  stopPolling: () => {
    const h = get().pollHandle;
    if (h !== undefined) {
      clearInterval(h);
      set({ pollHandle: undefined });
    }
  },

  refreshSettings: async () => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const [settings, serversRes] = await Promise.all([
        getMcpSettings(),
        listMcpServers(),
      ]);
      set((state) => {
        const nextGlobalServers = serversRes.servers;
        const nextGlobalStatus = serversRes.status;
        const serversChanged = stableJson(state.globalServers) !== stableJson(nextGlobalServers);
        const statusChanged = stableJson(state.globalStatus) !== stableJson(nextGlobalStatus);
        const s = sameSettings(state.settings, settings);
        if (!serversChanged && !statusChanged && s) {
          return { loading: false, error: null };
        }
        return {
          settings,
          globalServers: nextGlobalServers,
          globalStatus: nextGlobalStatus,
          loading: false,
          error: null,
        };
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to load MCP settings", loading: false });
    } finally {
      refreshInFlight = false;
    }
  },

  refreshProject: async (projectId: string) => {
    try {
      const res = await listMcpServers(projectId);
      const data: McpProjectData = { status: res.status, stdioTrust: res.stdioTrust };
      set((state) => {
        const existing = state.byProject[projectId];
        if (sameProjectData(existing, data)) return state;
        return {
          byProject: {
            ...state.byProject,
            [projectId]: data,
          },
        };
      });
    } catch {
      // silently ignore
    }
  },

  setMcpEnabled: async (enabled: boolean) => {
    const res = await apiSetMcpEnabled(enabled);
    set((state) => sameSettings(state.settings, res) ? state : { settings: res });
  },

  upsertServer: async (name: string, config: McpServerConfig) => {
    await upsertMcpServer(name, config);
    await get().refreshSettings();
  },

  deleteServer: async (name: string) => {
    await deleteMcpServer(name);
    await get().refreshSettings();
  },

  probeServer: async (name: string, projectId?: string) => {
    await probeMcpServer(name, projectId);
    if (projectId !== undefined) {
      await get().refreshProject(projectId);
    } else {
      await get().refreshSettings();
    }
  },

  grantStdioTrust: async (projectId: string) => {
    await grantStdioMcpTrust(projectId);
    await get().refreshProject(projectId);
  },

  revokeStdioTrust: async (projectId: string) => {
    await revokeStdioMcpTrust(projectId);
    await get().refreshProject(projectId);
  },
}));
