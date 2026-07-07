/**
 * Skill Overrides — JSON persistence for per-skill enable/disable state.
 *
 * Mirrors the tool-policy.ts pattern. Skills can be toggled globally
 * (all projects) or per-project. The state is stored as a simple JSON
 * file at the path configured in `config.skillOverridesFile`.
 *
 * Format:
 * ```json
 * {
 *   "global": ["skill-name"],
 *   "projects": {
 *     "<projectId>": { "enable": ["skill-name"], "disable": ["skill-name"] }
 *   }
 * }
 * ```
 *
 * - `global` lists skill *names* that are globally disabled.
 * - `projects.<id>.enable` lists skill names explicitly enabled for that project.
 * - `projects.<id>.disable` lists skill names explicitly disabled for that project.
 * - A project override takes precedence over the global setting.
 */
import { chmodSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

export type SkillOverrideState = "enabled" | "disabled";

interface ProjectSkillOverrides {
  enable: string[];
  disable: string[];
}

interface SkillOverrides {
  global: string[];
  projects: Record<string, ProjectSkillOverrides>;
}

function empty(): SkillOverrides {
  return { global: [], projects: {} };
}

async function ensureDir(): Promise<void> {
  await mkdir(dirname(config.skillOverridesFile), { recursive: true });
}

async function readSkillOverrides(): Promise<SkillOverrides> {
  try {
    const raw = await readFile(config.skillOverridesFile, "utf8");
    if (raw.trim().length === 0) return empty();
    const parsed = JSON.parse(raw) as SkillOverrides;
    if (typeof parsed !== "object" || parsed === null) return empty();
    return {
      global: Array.isArray(parsed.global) ? parsed.global : [],
      projects:
        typeof parsed.projects === "object" && parsed.projects !== null
          ? parsed.projects
          : {},
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw err;
  }
}

async function writeSkillOverrides(data: SkillOverrides): Promise<void> {
  await ensureDir();
  const path = config.skillOverridesFile;
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    /* best-effort */
  }
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/**
 * Set the global enabled/disabled state for a skill.
 * - `enabled = true`  → removes the skill name from the global disabled list
 * - `enabled = false` → adds the skill name to the global disabled list
 */
export async function setSkillEnabled(name: string, enabled: boolean): Promise<void> {
  const data = await readSkillOverrides();
  const idx = data.global.indexOf(name);
  if (enabled && idx !== -1) {
    data.global.splice(idx, 1);
  } else if (!enabled && idx === -1) {
    data.global.push(name);
  }
  await writeSkillOverrides(data);
}

/**
 * Check whether a skill is effectively enabled for a given project.
 * - Per-project override takes precedence
 * - Falls back to global setting (not in global disabled list)
 */
export function isSkillEffective(
  data: SkillOverrides,
  projectId: string | undefined,
  name: string,
): boolean {
  if (projectId !== undefined) {
    const proj = data.projects[projectId];
    if (proj !== undefined) {
      if (proj.enable.includes(name)) return true;
      if (proj.disable.includes(name)) return false;
    }
  }
  return !data.global.includes(name);
}

/**
 * Get the per-project override state for a skill.
 * Returns undefined when the project has no explicit override (inherits global).
 */
export function getProjectOverride(
  data: SkillOverrides,
  projectId: string | undefined,
  name: string,
): SkillOverrideState | undefined {
  if (projectId === undefined) return undefined;
  const proj = data.projects[projectId];
  if (proj === undefined) return undefined;
  if (proj.enable.includes(name)) return "enabled";
  if (proj.disable.includes(name)) return "disabled";
  return undefined;
}

/**
 * Set a per-project override for a skill.
 * - `state = "enabled"`  → add to project enable list, remove from project disable list
 * - `state = "disabled"` → add to project disable list, remove from project enable list
 * - `state = undefined`  → clear any project override (revert to inherit global)
 */
export async function setProjectSkillOverride(
  projectId: string,
  name: string,
  state: SkillOverrideState | undefined,
): Promise<void> {
  const data = await readSkillOverrides();
  if (!data.projects[projectId]) {
    data.projects[projectId] = { enable: [], disable: [] };
  }
  const proj = data.projects[projectId];
  const enableIdx = proj.enable.indexOf(name);
  const disableIdx = proj.disable.indexOf(name);

  if (state === "enabled") {
    if (enableIdx === -1) proj.enable.push(name);
    if (disableIdx !== -1) proj.disable.splice(disableIdx, 1);
  } else if (state === "disabled") {
    if (disableIdx === -1) proj.disable.push(name);
    if (enableIdx !== -1) proj.enable.splice(enableIdx, 1);
  } else {
    // Clear override
    if (enableIdx !== -1) proj.enable.splice(enableIdx, 1);
    if (disableIdx !== -1) proj.disable.splice(disableIdx, 1);
  }

  // Clean up empty project entries
  if (proj.enable.length === 0 && proj.disable.length === 0) {
    delete data.projects[projectId];
  }

  await writeSkillOverrides(data);
}

/**
 * List all per-project skill overrides.
 */
export async function listSkillOverrides(): Promise<
  Record<string, { enable: string[]; disable: string[] }>
> {
  const data = await readSkillOverrides();
  return data.projects;
}

/**
 * Clear all overrides for a project (e.g. when the project is deleted).
 */
export async function clearProjectSkillOverrides(projectId: string): Promise<void> {
  const data = await readSkillOverrides();
  delete data.projects[projectId];
  await writeSkillOverrides(data);
}

export { readSkillOverrides };
