import { create } from "zustand";
import {
  getMcpSettings,
  setMcpEnabled,
  listMcpServers,
  upsertMcpServer,
  deleteMcpServer,
  probeMcpServer,
  grantStdioMcpTrust,
  revokeStdioMcpTrust,
} from "../lib/api-client";
import type { McpSettingsResponse, McpServerStatus, McpServerConfig } from "../lib/api-client/types";

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
  probeServer: (name: string) => Promise<void>;
  grantStdioTrust: (projectId: string) => Promise<void>;
  revokeStdioTrust: (projectId: string) => Promise<void>;
}

export const useMcpStore = create<McpState>((set, get) => ({
  settings: undefined,
  globalServers: {},
  globalStatus: [],
  byProject: {},
  loading: false,
  error: null,
  pollHandle: undefined,

  startPolling: () => {
    const h = setInterval(async () => {
      if (!document.hidden) {
        await get().refreshSettings();
      }
    }, 30000);
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
    try {
      const [settings, serversRes] = await Promise.all([
        getMcpSettings(),
        listMcpServers(),
      ]);
      set({ settings, globalServers: serversRes.servers, globalStatus: serversRes.status, loading: false, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to load MCP settings", loading: false });
    }
  },

  refreshProject: async (projectId: string) => {
    try {
      const res = await listMcpServers(projectId);
      set({
        byProject: {
          ...get().byProject,
          [projectId]: { status: res.status, stdioTrust: res.stdioTrust },
        },
      });
    } catch {
      // silently ignore
    }
  },

  setMcpEnabled: async (enabled: boolean) => {
    const res = await setMcpEnabled(enabled);
    set({ settings: res });
  },

  upsertServer: async (name: string, config: McpServerConfig) => {
    await upsertMcpServer(name, config);
    await get().refreshSettings();
  },

  deleteServer: async (name: string) => {
    await deleteMcpServer(name);
    await get().refreshSettings();
  },

  probeServer: async (name: string) => {
    await probeMcpServer(name);
    await get().refreshSettings();
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
