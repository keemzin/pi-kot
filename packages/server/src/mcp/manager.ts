import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { isStdioConfig, readMcpJson, type McpServerConfig, type McpTransport } from "./config.js";
import { isStdioTrustedForProject } from "./stdio-trust.js";
import { bridgeMcpTool } from "./tool-bridge.js";

interface ClosableTransport {
  close(): Promise<void> | void;
}

export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "disabled"
  | "trust_required";
export type Scope = "global" | { project: string };

const PROJECT_MCP_FILE = ".mcp.json";

interface PoolEntry {
  scope: Scope;
  name: string;
  config: McpServerConfig;
  client?: Client;
  transport?: ClosableTransport;
  state: ConnectionState;
  lastError?: string;
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
  bridged: ToolDefinition[];
  reconnecting?: Promise<boolean>;
}

function entryKey(scope: Scope, name: string): string {
  return scope === "global" ? `global::${name}` : `project:${scope.project}::${name}`;
}

const pool = new Map<string, PoolEntry>();
const loadedProjects = new Set<string>();
let globallyEnabled = true;
let globalLoaded = false;
let globalLoadPromise: Promise<void> | undefined;

export function isGloballyEnabled(): boolean {
  return globallyEnabled;
}

export async function loadGlobal(): Promise<void> {
  if (globalLoadPromise !== undefined) return globalLoadPromise;
  globalLoadPromise = loadGlobalNow();
  try {
    await globalLoadPromise;
  } finally {
    globalLoadPromise = undefined;
  }
}

export async function ensureGlobalLoaded(): Promise<void> {
  if (globalLoaded) return;
  await loadGlobal();
}

async function loadGlobalNow(): Promise<void> {
  const cfg = await readMcpJson();
  globallyEnabled = cfg.disabled !== true;
  await syncScope("global", cfg.servers);
  globalLoaded = true;
}

export async function loadProject(projectId: string, projectPath: string): Promise<void> {
  cachedProjectPaths.set(projectId, projectPath);
  const cfg = await readProjectMcpJson(projectPath);
  await syncScope({ project: projectId }, cfg);
  loadedProjects.add(projectId);
}

export async function ensureProjectLoaded(projectId: string, projectPath: string): Promise<void> {
  if (loadedProjects.has(projectId)) return;
  await loadProject(projectId, projectPath);
}

export async function reloadGlobal(): Promise<void> {
  loadedProjects.clear();
  globalLoadPromise = loadGlobalNow();
  try {
    await globalLoadPromise;
  } finally {
    globalLoadPromise = undefined;
  }
}

export function customToolsForProject(projectId: string): ToolDefinition[] {
  const projectServerNames = new Set<string>();
  for (const e of pool.values()) {
    if (e.scope === "global") continue;
    if (e.scope.project !== projectId) continue;
    projectServerNames.add(e.name);
  }
  const seenToolNames = new Set<string>();
  const out: ToolDefinition[] = [];
  for (const e of pool.values()) {
    if (e.scope === "global") continue;
    if (e.scope.project !== projectId) continue;
    if (e.state !== "connected") continue;
    for (const t of e.bridged) {
      if (seenToolNames.has(t.name)) continue;
      seenToolNames.add(t.name);
      out.push(t);
    }
  }
  for (const e of pool.values()) {
    if (e.scope !== "global") continue;
    if (projectServerNames.has(e.name)) continue;
    if (e.state !== "connected") continue;
    for (const t of e.bridged) {
      if (seenToolNames.has(t.name)) continue;
      seenToolNames.add(t.name);
      out.push(t);
    }
  }
  return out;
}

export interface ServerStatus {
  scope: "global" | "project";
  projectId?: string;
  name: string;
  kind: "remote" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  enabled: boolean;
  state: ConnectionState;
  toolCount: number;
  tools: { name: string; shortName: string; description: string }[];
  lastError?: string;
  transport?: McpTransport;
}

export function getStatus(opts?: { projectId?: string }): ServerStatus[] {
  const out: ServerStatus[] = [];
  for (const e of pool.values()) {
    if (e.scope !== "global") {
      if (opts?.projectId !== undefined && e.scope.project !== opts.projectId) continue;
      if (opts?.projectId === undefined) continue;
    }
    const tools = e.tools.map((t, i) => ({
      name: e.bridged[i]?.name ?? `${e.name}__${t.name}`,
      shortName: t.name,
      description: t.description,
    }));
    const isStdio = isStdioConfig(e.config);
    const status: ServerStatus = {
      scope: e.scope === "global" ? "global" : "project",
      name: e.name,
      kind: isStdio ? "stdio" : "remote",
      enabled: e.config.enabled !== false,
      state: e.state,
      toolCount: e.tools.length,
      tools,
    };
    if (isStdio) {
      if (e.config.command !== undefined) status.command = e.config.command;
      if (e.config.args !== undefined) status.args = [...e.config.args];
    } else {
      if (e.config.url !== undefined) status.url = e.config.url;
      if (e.config.transport !== undefined) status.transport = e.config.transport;
    }
    if (e.scope !== "global") status.projectId = e.scope.project;
    if (e.lastError !== undefined) status.lastError = e.lastError;
    out.push(status);
  }
  return out;
}

export async function probe(scope: Scope, name: string): Promise<ServerStatus | undefined> {
  const entry = pool.get(entryKey(scope, name));
  if (entry === undefined) return undefined;
  await disconnectEntry(entry);
  await connectEntry(entry);
  const opts = scope === "global" ? undefined : { projectId: scope.project };
  return getStatus(opts).find(
    (s) => s.name === name && s.scope === (scope === "global" ? "global" : "project"),
  );
}

export async function reconnectGatedStdioForProject(projectId: string): Promise<void> {
  const toConnect: PoolEntry[] = [];
  for (const e of pool.values()) {
    if (e.scope === "global") continue;
    if (e.scope.project !== projectId) continue;
    if (e.state !== "trust_required") continue;
    toConnect.push(e);
  }
  for (const entry of toConnect) {
    await connectEntry(entry);
  }
}

export async function unloadProject(projectId: string): Promise<void> {
  const toClose: PoolEntry[] = [];
  for (const [key, entry] of Array.from(pool.entries())) {
    if (entry.scope === "global") continue;
    if (entry.scope.project !== projectId) continue;
    toClose.push(entry);
    pool.delete(key);
  }
  await Promise.allSettled(toClose.map((e) => disconnectEntry(e)));
  loadedProjects.delete(projectId);
  cachedProjectPaths.delete(projectId);
}

export async function disposeAll(): Promise<void> {
  await Promise.allSettled(Array.from(pool.values()).map((entry) => disconnectEntry(entry)));
  pool.clear();
  loadedProjects.clear();
  cachedProjectPaths.clear();
  globalLoaded = false;
  globalLoadPromise = undefined;
}

async function syncScope(scope: Scope, configs: Record<string, McpServerConfig>): Promise<void> {
  const wantNames = new Set(Object.keys(configs));
  for (const [key, entry] of Array.from(pool.entries())) {
    if (entryScopeMatches(entry.scope, scope) && !wantNames.has(entry.name)) {
      await disconnectEntry(entry);
      pool.delete(key);
    }
  }
  const toConnect: PoolEntry[] = [];
  for (const [name, cfg] of Object.entries(configs)) {
    const key = entryKey(scope, name);
    const existing = pool.get(key);
    if (existing !== undefined) {
      const sameEnabled = (existing.config.enabled !== false) === (cfg.enabled !== false);
      const sameConnectionFields = sameConnectionConfig(existing.config, cfg);
      existing.config = cfg;
      if (sameEnabled && sameConnectionFields && existing.state === "connected") {
        continue;
      }
      await disconnectEntry(existing);
      if (cfg.enabled === false) {
        existing.state = "disabled";
        continue;
      }
      toConnect.push(existing);
      continue;
    }
    const entry: PoolEntry = {
      scope,
      name,
      config: cfg,
      state: cfg.enabled === false ? "disabled" : "idle",
      tools: [],
      bridged: [],
    };
    pool.set(key, entry);
    if (cfg.enabled !== false) {
      toConnect.push(entry);
    }
  }
  for (const entry of toConnect) {
    await connectEntry(entry);
  }
}

function sameConnectionConfig(a: McpServerConfig, b: McpServerConfig): boolean {
  if (a.url !== b.url) return false;
  if (a.transport !== b.transport) return false;
  if (a.command !== b.command) return false;
  if (a.cwd !== b.cwd) return false;
  if (JSON.stringify(a.args ?? []) !== JSON.stringify(b.args ?? [])) return false;
  if (JSON.stringify(a.headers ?? {}) !== JSON.stringify(b.headers ?? {})) return false;
  if (JSON.stringify(a.env ?? {}) !== JSON.stringify(b.env ?? {})) return false;
  return true;
}

function entryScopeMatches(a: Scope, b: Scope): boolean {
  if (a === "global" && b === "global") return true;
  if (a !== "global" && b !== "global") return a.project === b.project;
  return false;
}

async function connectEntry(entry: PoolEntry): Promise<void> {
  if (isStdioConfig(entry.config) && entry.scope !== "global") {
    const trusted = await isStdioTrustedForProject(entry.scope.project).catch(() => false);
    if (!trusted) {
      entry.state = "trust_required";
      entry.lastError = "stdio MCP servers from this project require trust";
      entry.tools = [];
      entry.bridged = [];
      return;
    }
  }
  entry.state = "connecting";
  delete entry.lastError;
  try {
    const { client, transport, resolvedTransport } = await openConnection(
      entry.config,
      entry.scope,
    );
    entry.client = client;
    entry.transport = transport;
    if (resolvedTransport !== undefined) entry.config.transport = resolvedTransport;
    const list = await client.listTools();
    entry.tools = (list.tools ?? []).map((t) => ({
      name: t.name,
      description: typeof t.description === "string" ? t.description : "",
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? {
        type: "object",
        properties: {},
      },
    }));
    entry.bridged = entry.tools.map((t) =>
      bridgeMcpTool({
        serverName: entry.name,
        toolName: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        getClient: () => pool.get(entryKey(entry.scope, entry.name))?.client,
        recoverStaleSession: () => recoverStaleSession(entry.scope, entry.name),
      }),
    );
    entry.state = "connected";
  } catch (err) {
    delete entry.client;
    delete entry.transport;
    entry.tools = [];
    entry.bridged = [];
    entry.state = "error";
    entry.lastError = err instanceof Error ? err.message : String(err);
  }
}

async function recoverStaleSession(scope: Scope, name: string): Promise<boolean> {
  const entry = pool.get(entryKey(scope, name));
  if (entry === undefined || entry.config.enabled === false) return false;
  if (entry.reconnecting !== undefined) return await entry.reconnecting;
  entry.reconnecting = (async () => {
    await disconnectEntry(entry);
    await connectEntry(entry);
    return entry.state === "connected" && entry.client !== undefined;
  })();
  try {
    return await entry.reconnecting;
  } finally {
    if (entry.reconnecting !== undefined) delete entry.reconnecting;
  }
}

async function disconnectEntry(entry: PoolEntry): Promise<void> {
  const client = entry.client;
  const transport = entry.transport;
  delete entry.client;
  delete entry.transport;
  entry.tools = [];
  entry.bridged = [];
  if (entry.state !== "disabled") entry.state = "idle";
  await Promise.resolve(client?.close()).catch(() => undefined);
  await Promise.resolve(transport?.close()).catch(() => undefined);
}

interface OpenedConnection {
  client: Client;
  transport: ClosableTransport;
  resolvedTransport: McpTransport | undefined;
}

async function openConnection(cfg: McpServerConfig, scope: Scope): Promise<OpenedConnection> {
  if (isStdioConfig(cfg)) {
    return await openStdio(cfg, scope);
  }
  if (cfg.url === undefined) {
    throw new Error("mcp: server has neither url nor command");
  }
  const url = new URL(cfg.url);
  const requested: McpTransport = cfg.transport ?? "auto";
  if (requested === "streamable-http") {
    return await openStreamableHttp(url, cfg.headers);
  }
  if (requested === "sse") {
    return await openSse(url, cfg.headers);
  }
  try {
    return await openStreamableHttp(url, cfg.headers);
  } catch {
    return await openSse(url, cfg.headers);
  }
}

async function openStdio(cfg: McpServerConfig, scope: Scope): Promise<OpenedConnection> {
  if (cfg.command === undefined || cfg.command.length === 0) {
    throw new Error("mcp: stdio server requires a command");
  }
  const resolvedCwd = cfg.cwd ?? (scope === "global" ? undefined : projectCwdHint(scope.project));
  const env: Record<string, string> = {
    ...getDefaultEnvironment(),
    ...(cfg.env ?? {}),
  };
  const transport = new StdioClientTransport({
    command: cfg.command,
    args: cfg.args ?? [],
    env,
    ...(resolvedCwd !== undefined ? { cwd: resolvedCwd } : {}),
    stderr: "inherit",
  });
  const client = new Client({ name: "pi-kot", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport, resolvedTransport: undefined };
}

function projectCwdHint(projectId: string): string | undefined {
  for (const e of pool.values()) {
    if (e.scope !== "global" && e.scope.project === projectId) {
      return e.config.cwd ?? cachedProjectPaths.get(projectId);
    }
  }
  return cachedProjectPaths.get(projectId);
}

const cachedProjectPaths = new Map<string, string>();

type SdkTransport = Parameters<Client["connect"]>[0];

async function openStreamableHttp(
  url: URL,
  headers: Record<string, string> | undefined,
): Promise<OpenedConnection> {
  const transport = new StreamableHTTPClientTransport(
    url,
    headers !== undefined ? { requestInit: { headers } } : undefined,
  );
  const client = new Client({ name: "pi-kot", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport as unknown as SdkTransport);
  return { client, transport, resolvedTransport: "streamable-http" };
}

async function openSse(
  url: URL,
  headers: Record<string, string> | undefined,
): Promise<OpenedConnection> {
  const transport =
    headers !== undefined
      ? new SSEClientTransport(url, {
          requestInit: { headers },
          eventSourceInit: {
            fetch: (input: string | URL, init?: RequestInit) =>
              fetch(input, {
                ...init,
                headers: { ...((init?.headers as Record<string, string>) ?? {}), ...headers },
              }),
          } as unknown as EventSourceInit,
        })
      : new SSEClientTransport(url);
  const client = new Client({ name: "pi-kot", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport, resolvedTransport: "sse" };
}

async function readProjectMcpJson(projectPath: string): Promise<Record<string, McpServerConfig>> {
  const path = join(projectPath, PROJECT_MCP_FILE);
  try {
    const raw = await readFile(path, "utf8");
    if (raw.trim().length === 0) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const servers =
      (parsed as { servers?: unknown }).servers ?? (parsed as { mcpServers?: unknown }).mcpServers;
    if (typeof servers !== "object" || servers === null) return {};
    return servers as Record<string, McpServerConfig>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}
