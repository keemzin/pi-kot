/**
 * Cross-platform executable discovery, including Windows Store app aliases.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function getEnvValue(
  env: Record<string, string | undefined>,
  keys: string[],
): string {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return "";
}

function normalizeSearchDirectoryKey(
  directory: string,
  platform: string,
): string {
  const trimmed = typeof directory === "string" ? directory.trim() : "";
  return platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

function getWindowsAppsDirectory(env: Record<string, string | undefined>): string {
  const localAppData = getEnvValue(env, ["LOCALAPPDATA", "LocalAppData", "localappdata"]);
  if (localAppData) {
    return path.win32.join(localAppData, "Microsoft", "WindowsApps");
  }

  const userProfile = getEnvValue(env, ["USERPROFILE", "UserProfile", "userprofile"]);
  if (userProfile) {
    return path.win32.join(userProfile, "AppData", "Local", "Microsoft", "WindowsApps");
  }

  return path.win32.join(os.homedir(), "AppData", "Local", "Microsoft", "WindowsApps");
}

export interface SearchDirectoriesOptions {
  env?: Record<string, string | undefined>;
  platform?: string;
}

/**
 * Get the ordered list of directories to search for executables.
 * Includes PATH entries and, on Windows, the WindowsApps directory.
 */
export function getExecutableSearchDirectories(
  options: SearchDirectoriesOptions = {},
): string[] {
  const env = options.env ?? process.env as Record<string, string | undefined>;
  const platform = options.platform ?? process.platform;

  const delimiter = platform === "win32" ? ";" : ":";
  const pathValue = getEnvValue(env, ["PATH", "Path", "path"]);
  const directories = pathValue.split(delimiter).map((entry) => entry.trim()).filter(Boolean);

  if (platform === "win32") {
    directories.push(getWindowsAppsDirectory(env));
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const directory of directories) {
    const key = normalizeSearchDirectoryKey(directory, platform);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(directory);
  }

  return unique;
}

export interface EnvOptions {
  env?: Record<string, string | undefined>;
  platform?: string;
}

/**
 * Create an environment object with PATH (and Path/path on Windows) set
 * to the union of all search directories.
 */
export function createExecutableSearchEnv(
  options: EnvOptions = {},
): Record<string, string> {
  const env = options.env ?? process.env as Record<string, string | undefined>;
  const platform = options.platform ?? process.platform;

  const delimiter = platform === "win32" ? ";" : ":";
  const pathValue = getExecutableSearchDirectories({ env, platform }).join(delimiter);
  const nextEnv: Record<string, string> = { ...env as Record<string, string> };

  if (platform === "win32") {
    nextEnv.PATH = pathValue;
    nextEnv.Path = pathValue;
    nextEnv.path = pathValue;
  } else {
    nextEnv.PATH = pathValue;
  }

  return nextEnv;
}

export interface FindOptions {
  env?: Record<string, string | undefined>;
  platform?: string;
  fsLike?: typeof fs;
}

function getExecutableExtensions(
  options: { env?: Record<string, string | undefined>; platform?: string } = {},
): string[] {
  const env = options.env ?? process.env as Record<string, string | undefined>;
  const platform = options.platform ?? process.platform;

  if (platform !== "win32") {
    return [""];
  }

  return (env.PATHEXT || env.PathExt || env.pathext || ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean)
    .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`));
}

/**
 * Find an executable on the system PATH.
 * Returns the first matching absolute path, or null.
 */
export function findExecutableOnPath(
  command: string,
  options: FindOptions = {},
): string | null {
  if (typeof command !== "string" || command.trim().length === 0) {
    return null;
  }

  const env = options.env ?? process.env as Record<string, string | undefined>;
  const platform = options.platform ?? process.platform;
  const fsLike = options.fsLike ?? fs;

  const pathApi = platform === "win32" ? path.win32 : path;
  const directories = getExecutableSearchDirectories({ env, platform });
  const extensions = getExecutableExtensions({ env, platform });
  const commandName = command.trim();

  for (const directory of directories) {
    for (const extension of extensions) {
      const fileName = platform === "win32" ? `${commandName}${extension}` : commandName;
      const candidate = pathApi.join(directory, fileName);
      try {
        const stats = fsLike.statSync(candidate);
        if (!stats.isFile()) {
          continue;
        }
        if (platform !== "win32") {
          try {
            fsLike.accessSync(candidate, fs.constants.X_OK);
          } catch {
            continue;
          }
        }
        return candidate;
      } catch {
        continue;
      }
    }
  }

  return null;
}

export interface LaunchTarget {
  command: string;
  env: Record<string, string>;
}

/**
 * Resolve the launch target for an executable command.
 * Returns { command, env } where command is the resolved path (or the raw
 * command name on Windows as a fallback for Store app aliases).
 */
export function resolveExecutableLaunchTarget(
  command: string,
  options: FindOptions = {},
): LaunchTarget | null {
  const platform = options.platform ?? process.platform;
  const resolvedPath = findExecutableOnPath(command, { ...options, platform });
  const env = createExecutableSearchEnv({ env: options.env ?? process.env as Record<string, string | undefined>, platform });

  if (resolvedPath) {
    return { command: resolvedPath, env };
  }

  // Windows Store app execution aliases are launchable through CreateProcess
  // but can reject fs.stat/fs.access with EACCES. Let the version probe decide.
  if (platform === "win32" && typeof command === "string" && command.trim().length > 0) {
    return { command: command.trim(), env };
  }

  return null;
}
