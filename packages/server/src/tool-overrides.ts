import { chmodSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

interface ProjectOverrides {
  builtin: { enable: string[]; disable: string[] };
  mcp: { enable: string[]; disable: string[] };
  extension: { enable: string[]; disable: string[] };
}

interface ToolOverrides {
  builtin: string[];
  mcp: string[];
  extension: string[];
  projects: Record<string, ProjectOverrides>;
}

function empty(): ToolOverrides {
  return { builtin: [], mcp: [], extension: [], projects: {} };
}

async function ensureDir(): Promise<void> {
  await mkdir(dirname(config.toolOverridesFile), { recursive: true });
}

async function readToolOverrides(): Promise<ToolOverrides> {
  try {
    const raw = await readFile(config.toolOverridesFile, "utf8");
    if (raw.trim().length === 0) return empty();
    const parsed = JSON.parse(raw) as ToolOverrides;
    if (typeof parsed !== "object" || parsed === null) return empty();
    return {
      builtin: Array.isArray(parsed.builtin) ? parsed.builtin : [],
      mcp: Array.isArray(parsed.mcp) ? parsed.mcp : [],
      extension: Array.isArray(parsed.extension) ? parsed.extension : [],
      projects: typeof parsed.projects === "object" && parsed.projects !== null ? parsed.projects : {},
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw err;
  }
}

async function writeToolOverrides(data: ToolOverrides): Promise<void> {
  await ensureDir();
  const path = config.toolOverridesFile;
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch { /* best-effort */ }
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

export async function setToolEnabled(family: "builtin" | "mcp" | "extension", name: string, enabled: boolean): Promise<void> {
  const data = await readToolOverrides();
  const arr = data[family];
  const idx = arr.indexOf(name);
  if (enabled && idx !== -1) {
    arr.splice(idx, 1);
  } else if (!enabled && idx === -1) {
    arr.push(name);
  }
  await writeToolOverrides(data);
}

export function isToolEffective(data: ToolOverrides, projectId: string | undefined, family: "builtin" | "mcp" | "extension", name: string): boolean {
  // Per-project override takes precedence
  if (projectId !== undefined) {
    const proj = data.projects[projectId];
    if (proj !== undefined) {
      if (proj[family].enable.includes(name)) return true;
      if (proj[family].disable.includes(name)) return false;
    }
  }
  // Fall back to global disabled set
  return !data[family].includes(name);
}

export async function setProjectToolOverride(
  projectId: string,
  family: "builtin" | "mcp" | "extension",
  name: string,
  state: "enabled" | "disabled" | undefined,
): Promise<void> {
  const data = await readToolOverrides();
  if (!data.projects[projectId]) {
    data.projects[projectId] = { builtin: { enable: [], disable: [] }, mcp: { enable: [], disable: [] }, extension: { enable: [], disable: [] } };
  }
  const proj = data.projects[projectId];
  const enableIdx = proj[family].enable.indexOf(name);
  const disableIdx = proj[family].disable.indexOf(name);
  if (state === "enabled") {
    if (enableIdx === -1) proj[family].enable.push(name);
    if (disableIdx !== -1) proj[family].disable.splice(disableIdx, 1);
  } else if (state === "disabled") {
    if (disableIdx === -1) proj[family].disable.push(name);
    if (enableIdx !== -1) proj[family].enable.splice(enableIdx, 1);
  } else {
    if (enableIdx !== -1) proj[family].enable.splice(enableIdx, 1);
    if (disableIdx !== -1) proj[family].disable.splice(disableIdx, 1);
  }
  await writeToolOverrides(data);
}

export async function listToolOverrides(): Promise<Record<string, ProjectOverrides>> {
  const data = await readToolOverrides();
  return data.projects;
}

export { readToolOverrides };

export async function clearProjectOverrides(projectId: string): Promise<void> {
  const data = await readToolOverrides();
  delete data.projects[projectId];
  await writeToolOverrides(data);
}
