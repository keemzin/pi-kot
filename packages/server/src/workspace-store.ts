import { readFile, rename, unlink, writeFile, mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`project not found: ${id}`);
    this.name = "ProjectNotFoundError";
  }
}

export class InvalidNameError extends Error {
  constructor(msg = "invalid project name") {
    super(msg);
    this.name = "InvalidNameError";
  }
}

export class DuplicatePathError extends Error {
  constructor(path: string) {
    super(`a project already points at: ${path}`);
    this.name = "DuplicatePathError";
  }
}

const PROJECTS_FILE = (): string => join(config.forgeDataDir, "projects.json");

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

// Simple per-process lock for read-modify-write on projects.json
let projectsLock: Promise<unknown> = Promise.resolve();
function withProjectsLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = projectsLock.then(fn, fn);
  projectsLock = next.catch(() => undefined);
  return next;
}

function isProject(v: unknown): v is Project {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    typeof r.path === "string" &&
    typeof r.createdAt === "string"
  );
}

export async function readProjects(): Promise<Project[]> {
  try {
    const raw = await readFile(PROJECTS_FILE(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isProject);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeProjects(projects: Project[]): Promise<void> {
  await ensureDir(config.forgeDataDir);
  const target = PROJECTS_FILE();
  const tmp = `${target}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(projects, null, 2), "utf8");
  try {
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

export async function listProjects(): Promise<Project[]> {
  return withProjectsLock(async () => {
    return readProjects();
  });
}

export async function getProject(id: string): Promise<Project | undefined> {
  const projects = await readProjects();
  return projects.find((p) => p.id === id);
}

export async function createProject(
  name: string,
  path: string,
): Promise<Project> {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new InvalidNameError("project name cannot be empty");

  // Expand ~/ to home directory
  const expanded = path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  const resolvedPath = resolve(expanded);

  return withProjectsLock(async () => {
    const projects = await readProjects();

    // Check duplicate path
    for (const p of projects) {
      if (resolve(p.path) === resolvedPath) {
        throw new DuplicatePathError(resolvedPath);
      }
    }

    // Verify path exists and is a directory (warn if not, but still allow)
    try {
      const st = await stat(resolvedPath);
      if (!st.isDirectory()) {
        throw new InvalidNameError(`Path exists but is not a directory: ${resolvedPath}`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new InvalidNameError(
          `Directory does not exist: ${resolvedPath}. Create it first or choose an existing folder.`,
        );
      }
      if (err instanceof InvalidNameError) throw err;
      throw err;
    }

    const project: Project = {
      id: randomUUID(),
      name: trimmed,
      path: resolvedPath,
      createdAt: new Date().toISOString(),
    };

    projects.push(project);
    await writeProjects(projects);
    return project;
  });
}

export async function updateProject(
  id: string,
  updates: { name?: string; path?: string },
): Promise<Project> {
  return withProjectsLock(async () => {
    const projects = await readProjects();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) throw new ProjectNotFoundError(id);

    if (updates.name !== undefined) {
      const trimmed = updates.name.trim();
      if (trimmed.length === 0) throw new InvalidNameError();
      projects[idx].name = trimmed;
    }

    if (updates.path !== undefined) {
      const resolvedPath = resolve(updates.path);
      // Check duplicate
      for (let i = 0; i < projects.length; i++) {
        if (i !== idx && resolve(projects[i].path) === resolvedPath) {
          throw new DuplicatePathError(resolvedPath);
        }
      }
      projects[idx].path = resolvedPath;
    }

    await writeProjects(projects);
    return projects[idx];
  });
}

export async function deleteProject(id: string): Promise<void> {
  return withProjectsLock(async () => {
    const projects = await readProjects();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) throw new ProjectNotFoundError(id);
    projects.splice(idx, 1);
    await writeProjects(projects);
  });
}
