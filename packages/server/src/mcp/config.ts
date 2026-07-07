import { chmodSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

export type McpTransport = "auto" | "streamable-http" | "sse";

export interface McpServerConfig {
  enabled?: boolean;
  url?: string;
  transport?: McpTransport;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpJson {
  disabled?: boolean;
  servers: Record<string, McpServerConfig>;
}

export function isStdioConfig(cfg: McpServerConfig): boolean {
  return typeof cfg.command === "string" && cfg.command.length > 0;
}

const SECRET_PLACEHOLDER = "***REDACTED***";

async function ensureDir(): Promise<void> {
  await mkdir(dirname(config.mcpConfigFile), { recursive: true });
}

async function atomicWriteJson(data: unknown): Promise<void> {
  await ensureDir();
  const path = config.mcpConfigFile;
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // best-effort
  }
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

export async function readMcpJson(): Promise<McpJson> {
  try {
    const raw = await readFile(config.mcpConfigFile, "utf8");
    if (raw.trim().length === 0) return { servers: {} };
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("servers" in parsed)) {
      return { servers: {} };
    }
    const servers = (parsed as { servers?: unknown }).servers;
    const disabled = (parsed as { disabled?: unknown }).disabled === true;
    if (typeof servers !== "object" || servers === null) {
      return { disabled, servers: {} };
    }
    return { disabled, servers: servers as Record<string, McpServerConfig> };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { servers: {} };
    throw err;
  }
}

function copyServerCleaned(src: McpServerConfig): McpServerConfig {
  const out: McpServerConfig = {};
  if (src.enabled !== undefined) out.enabled = src.enabled;
  if (src.url !== undefined) out.url = src.url;
  if (src.transport !== undefined) out.transport = src.transport;
  if (src.command !== undefined) out.command = src.command;
  if (src.args !== undefined) out.args = [...src.args];
  if (src.cwd !== undefined) out.cwd = src.cwd;
  return out;
}

export async function readMcpJsonRedacted(): Promise<McpJson> {
  const raw = await readMcpJson();
  const out: Record<string, McpServerConfig> = {};
  for (const [name, server] of Object.entries(raw.servers)) {
    const cleaned = copyServerCleaned(server);
    if (server.headers !== undefined) {
      cleaned.headers = {};
      for (const k of Object.keys(server.headers)) {
        cleaned.headers[k] = SECRET_PLACEHOLDER;
      }
    }
    if (server.env !== undefined) {
      cleaned.env = {};
      for (const k of Object.keys(server.env)) {
        cleaned.env[k] = SECRET_PLACEHOLDER;
      }
    }
    out[name] = cleaned;
  }
  return { disabled: raw.disabled === true, servers: out };
}

function mergeSecretMap(
  next: Record<string, string>,
  prior: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(next)) {
    if (v === SECRET_PLACEHOLDER) {
      if (prior?.[k] !== undefined) out[k] = prior[k];
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function writeMcpJson(next: McpJson): Promise<void> {
  const existing: McpJson = await readMcpJson().catch(() => ({ servers: {} }));
  const safe: McpJson = { servers: {} };
  if (next.disabled === true) safe.disabled = true;
  for (const [name, server] of Object.entries(next.servers ?? {})) {
    const merged = copyServerCleaned(server);
    if (server.headers !== undefined) {
      merged.headers = mergeSecretMap(server.headers, existing.servers[name]?.headers);
    }
    if (server.env !== undefined) {
      merged.env = mergeSecretMap(server.env, existing.servers[name]?.env);
    }
    safe.servers[name] = merged;
  }
  await atomicWriteJson(safe);
}

export async function upsertMcpServer(name: string, server: McpServerConfig): Promise<void> {
  const cur = await readMcpJson();
  cur.servers[name] = server;
  await writeMcpJson(cur);
}

export async function setMcpDisabled(disabled: boolean): Promise<void> {
  const cur = await readMcpJson();
  cur.disabled = disabled;
  await writeMcpJson(cur);
}

export async function deleteMcpServer(name: string): Promise<boolean> {
  const cur = await readMcpJson();
  if (cur.servers[name] === undefined) return false;
  delete cur.servers[name];
  await writeMcpJson(cur);
  return true;
}
