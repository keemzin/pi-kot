import { chmodSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

interface TrustState {
  projects: Record<string, { trustedAt: string }>;
}

async function ensureDir(): Promise<void> {
  await mkdir(dirname(config.mcpStdioTrustFile), { recursive: true });
}

async function atomicWrite(data: TrustState): Promise<void> {
  await ensureDir();
  const path = config.mcpStdioTrustFile;
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

async function readAll(): Promise<TrustState> {
  try {
    const raw = await readFile(config.mcpStdioTrustFile, "utf8");
    if (raw.trim().length === 0) return { projects: {} };
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("projects" in parsed)) {
      return { projects: {} };
    }
    const projects = (parsed as { projects?: unknown }).projects;
    if (typeof projects !== "object" || projects === null) return { projects: {} };
    const out: TrustState = { projects: {} };
    for (const [pid, val] of Object.entries(projects as Record<string, unknown>)) {
      if (typeof val !== "object" || val === null) continue;
      const trustedAt = (val as { trustedAt?: unknown }).trustedAt;
      if (typeof trustedAt !== "string") continue;
      out.projects[pid] = { trustedAt };
    }
    return out;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { projects: {} };
    throw err;
  }
}

export async function isStdioTrustedForProject(projectId: string): Promise<boolean> {
  const cur = await readAll();
  return cur.projects[projectId] !== undefined;
}

export async function grantStdioTrust(projectId: string): Promise<void> {
  const cur = await readAll();
  if (cur.projects[projectId] !== undefined) return;
  cur.projects[projectId] = { trustedAt: new Date().toISOString() };
  await atomicWrite(cur);
}

export async function revokeStdioTrust(projectId: string): Promise<void> {
  const cur = await readAll();
  if (cur.projects[projectId] === undefined) return;
  delete cur.projects[projectId];
  await atomicWrite(cur);
}

export async function clearProjectStdioTrust(projectId: string): Promise<void> {
  await revokeStdioTrust(projectId);
}
