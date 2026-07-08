import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

/**
 * Per-project system prompt addenda stored in
 * `${FORGE_DATA_DIR}/system-prompt-overrides.json`. Each project can
 * store free-form text that gets appended (via pi's `appendSystemPrompt`
 * hook) to the agent's base system prompt for every session in that project.
 */

interface SystemPromptOverrides {
  /** Map from projectId → that project's addendum text. */
  projects: Record<string, string>;
}

/** Hard cap on the stored addendum. Keeps a runaway paste from
 * silently bloating every system prompt. */
export const MAX_ADDENDUM_BYTES = 20_000;

async function ensureDir(): Promise<void> {
  await mkdir(dirname(config.systemPromptOverridesFile), { recursive: true });
}

async function atomicWrite(data: SystemPromptOverrides): Promise<void> {
  await ensureDir();
  const path = config.systemPromptOverridesFile;
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

async function readAll(): Promise<SystemPromptOverrides> {
  try {
    const raw = await readFile(config.systemPromptOverridesFile, "utf8");
    if (raw.trim().length === 0) return { projects: {} };
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("projects" in parsed)) {
      return { projects: {} };
    }
    const projects = (parsed as { projects?: unknown }).projects;
    if (typeof projects !== "object" || projects === null) return { projects: {} };
    const out: SystemPromptOverrides = { projects: {} };
    for (const [pid, val] of Object.entries(projects as Record<string, unknown>)) {
      if (typeof val !== "string") continue;
      out.projects[pid] = val;
    }
    return out;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { projects: {} };
    throw err;
  }
}

/**
 * Return the project's saved addendum, or an empty string.
 */
export async function getProjectSystemPromptAddendum(projectId: string): Promise<string> {
  const cur = await readAll();
  return cur.projects[projectId] ?? "";
}

/**
 * Set the project's addendum. Passing empty string clears the entry.
 * Caller is responsible for length validation.
 */
export async function setProjectSystemPromptAddendum(
  projectId: string,
  text: string,
): Promise<void> {
  const cur = await readAll();
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    if (cur.projects[projectId] === undefined) return;
    delete cur.projects[projectId];
  } else {
    cur.projects[projectId] = text;
  }
  await atomicWrite(cur);
}

/**
 * Drop the project's addendum entry — called from the project delete path.
 */
export async function clearProjectSystemPromptAddendum(projectId: string): Promise<void> {
  const cur = await readAll();
  if (cur.projects[projectId] === undefined) return;
  delete cur.projects[projectId];
  await atomicWrite(cur);
}
