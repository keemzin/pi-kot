/**
 * SDK-powered package management for pi extensions.
 *
 * Uses DefaultPackageManager + SettingsManager from @earendil-works/pi-coding-agent
 * to list, install, remove, enable/disable extension packages with scope
 * (global / project).
 *
 * This is the pi-web-style plugin management layer, kept separate from the
 * existing custom extension detection in extensions.ts so both coexist.
 *
 * GET  /extensions/sdk-packages         — list all configured packages + resources
 * POST /extensions/sdk-packages/install — install a package (npm:, git:, local)
 * POST /extensions/sdk-packages/remove  — remove a package
 * POST /extensions/sdk-packages/toggle  — enable / disable a package
 */

import { type FastifyPluginAsync } from "fastify";
import {
  DefaultPackageManager,
  SettingsManager,
  type PackageSource,
} from "@earendil-works/pi-coding-agent";
import type { ResolvedPaths, ResolvedResource } from "@earendil-works/pi-coding-agent";
import { config } from "../config.js";
import { listSessions, rebuildSessionTools } from "../session-store.js";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative } from "node:path";

// ── API types (matching pi-web's shape) ─────────────────────────────

interface ResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

interface ResourceInfo {
  kind: "extension" | "skill" | "prompt" | "theme";
  name: string;
  path: string;
  relativePath: string;
}

interface PackageInfo {
  source: string;
  scope: "user" | "project";
  filtered: boolean;
  disabled: boolean;
  installedPath?: string;
  packageName?: string;
  version?: string;
  counts: ResourceCounts;
  resources: ResourceInfo[];
  status: "loaded" | "disabled" | "installed" | "missing";
}

interface PackagesResponse {
  packages: PackageInfo[];
  totals: ResourceCounts;
}

// ── Helpers ─────────────────────────────────────────────────────────

function emptyCounts(): ResourceCounts {
  return { extensions: 0, skills: 0, prompts: 0, themes: 0 };
}

function isDisabledPackage(entry: PackageSource): boolean {
  if (typeof entry === "string") return false;
  return (
    Array.isArray(entry.extensions) && entry.extensions.length === 0 &&
    Array.isArray(entry.skills) && entry.skills.length === 0 &&
    Array.isArray(entry.prompts) && entry.prompts.length === 0 &&
    Array.isArray(entry.themes) && entry.themes.length === 0
  );
}

function getPackageSource(entry: PackageSource): string {
  return typeof entry === "string" ? entry : entry.source;
}

function getResourceName(path: string, kind: string): string {
  const file = basename(path);
  const ext = extname(file);
  if (kind === "skill" && file.toLowerCase() === "skill.md") return basename(dirname(path));
  if ((kind === "extension" || kind === "theme" || kind === "prompt") && ext) {
    if (kind === "extension" && /^index\.(ts|js)$/.test(file)) return basename(dirname(path));
    return file.slice(0, -ext.length);
  }
  return file;
}

function getConfiguredVersion(source: string): string | undefined {
  const npmSpec = source.startsWith("npm:") ? source.slice(4) : undefined;
  if (npmSpec) {
    const lastAt = npmSpec.lastIndexOf("@");
    const packageNameEnd = npmSpec.startsWith("@") ? npmSpec.indexOf("/", 1) : 0;
    if (lastAt > packageNameEnd) return npmSpec.slice(lastAt + 1) || undefined;
    return undefined;
  }
  if (source.startsWith("git:") || /^[a-z]+:\/\//.test(source)) {
    const lastAt = source.lastIndexOf("@");
    const lastSlash = source.lastIndexOf("/");
    const lastColon = source.lastIndexOf(":");
    if (lastAt > Math.max(lastSlash, lastColon)) return source.slice(lastAt + 1) || undefined;
  }
  return undefined;
}

function readPackageMetadata(installedPath?: string): { packageName?: string; version?: string } {
  if (!installedPath) return {};
  try {
    const stats = statSync(installedPath);
    const packageJsonPath = stats.isDirectory()
      ? join(installedPath, "package.json")
      : join(dirname(installedPath), "package.json");
    if (!existsSync(packageJsonPath)) return {};
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      name?: unknown;
      version?: unknown;
    };
    return {
      packageName: typeof parsed.name === "string" ? parsed.name : undefined,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
    };
  } catch {
    return {};
  }
}

function collectResource(
  resource: ResolvedResource,
  kind: keyof ResourceCounts,
  countsByPackage: Map<string, ResourceCounts>,
  resourcesByPackage: Map<string, ResourceInfo[]>,
  totals: ResourceCounts,
): void {
  if (!resource.enabled || resource.metadata.origin !== "package") return;
  const key = resource.metadata.source + "\0" + resource.metadata.scope;
  const counts = countsByPackage.get(key) ?? emptyCounts();
  counts[kind] += 1;
  totals[kind] += 1;
  countsByPackage.set(key, counts);

  const resources = resourcesByPackage.get(key) ?? [];
  const resourceKind = kind === "extensions"
    ? "extension"
    : kind === "skills"
      ? "skill"
      : kind === "prompts"
        ? "prompt"
        : "theme";
  resources.push({
    kind: resourceKind,
    name: getResourceName(resource.path, resourceKind),
    path: resource.path,
    relativePath: getRelativePath(resource),
  });
  resourcesByPackage.set(key, resources);
}

function getRelativePath(resource: ResolvedResource): string {
  const baseDir = resource.metadata.baseDir;
  if (!baseDir) return resource.path;
  const rel = relative(baseDir, resource.path);
  return rel && !rel.startsWith("..") ? rel : resource.path;
}

// ── Route plugin ────────────────────────────────────────────────────

export const extensionPackagesRoutes: FastifyPluginAsync = async (fastify) => {
  const errorSchema = {
    type: "object",
    required: ["error"],
    properties: { error: { type: "string" } },
  } as const;
  const autoError = { "4xx": errorSchema, "5xx": errorSchema } as const;

  const packageInfoSchema = {
    type: "object",
    properties: {
      source: { type: "string" },
      scope: { type: "string", enum: ["user", "project"] },
      filtered: { type: "boolean" },
      disabled: { type: "boolean" },
      installedPath: { type: "string" },
      packageName: { type: "string" },
      version: { type: "string" },
      counts: {
        type: "object",
        properties: {
          extensions: { type: "integer" },
          skills: { type: "integer" },
          prompts: { type: "integer" },
          themes: { type: "integer" },
        },
      },
      resources: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string" },
            name: { type: "string" },
            path: { type: "string" },
            relativePath: { type: "string" },
          },
        },
      },
      status: { type: "string", enum: ["loaded", "disabled", "installed", "missing"] },
    },
  };

  // ── GET /api/v1/extensions/sdk-packages ──────────────────────────────

  fastify.get(
    "/extensions/sdk-packages",
    {
      config: { public: true },
      schema: {
        description: "List all configured extension packages with resource details (SDK-powered)",
        tags: ["extensions"],
        querystring: {
          type: "object",
          properties: {
            cwd: { type: "string", description: "Working directory (defaults to ~)" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["packages", "totals"],
            properties: {
              packages: {
                type: "array",
                items: packageInfoSchema,
              },
              totals: {
                type: "object",
                properties: {
                  extensions: { type: "integer" },
                  skills: { type: "integer" },
                  prompts: { type: "integer" },
                  themes: { type: "integer" },
                },
              },
            },
          },
          ...autoError,
        },
      },
    },
    async (req, reply) => {
      try {
        const query = req.query as { cwd?: string };
        const cwd = query.cwd || homedir();
        const result = await readPackages(cwd);
        return reply.send(result);
      } catch (err) {
        req.log.error(err, "Failed to list SDK packages");
        return reply.status(500).send({ error: String(err) });
      }
    },
  );

  // ── POST /api/v1/extensions/sdk-packages/install ─────────────────────

  fastify.post(
    "/extensions/sdk-packages/install",
    {
      schema: {
        description: "Install an extension package",
        tags: ["extensions"],
        body: {
          type: "object",
          required: ["source"],
          properties: {
            source: { type: "string", description: "Package source (npm:, git:, or local path)" },
            local: { type: "boolean", description: "Install as project-local (default false = global)" },
          },
        },
        response: { 200: packageInfoSchema, ...autoError },
      },
    },
    async (req, reply) => {
      try {
        const { source, local } = req.body as { source: string; local?: boolean };
        // Normalize: bare npm package names need npm: prefix
        // (e.g. "@org/name" → "npm:@org/name", "pi-free" → "npm:pi-free")
        const normalized = source.startsWith("npm:") || source.startsWith("git:") || source.startsWith("/") || source.startsWith(".") || source.includes("://")
          ? source
          : `npm:${source}`;
        const cwd = homedir();
        const settingsManager = SettingsManager.create(cwd, config.piConfigDir);
        const packageManager = new DefaultPackageManager({
          cwd,
          agentDir: config.piConfigDir,
          settingsManager,
        });
        await packageManager.installAndPersist(normalized, { local });
        await sessionReload(req.log);
        const result = await readPackages(cwd);
        return reply.send(result);
      } catch (err) {
        req.log.error(err, "Failed to install package");
        return reply.status(500).send({ error: String(err) });
      }
    },
  );

  // ── POST /api/v1/extensions/sdk-packages/remove ──────────────────────

  fastify.post(
    "/extensions/sdk-packages/remove",
    {
      schema: {
        description: "Remove an extension package",
        tags: ["extensions"],
        body: {
          type: "object",
          required: ["source"],
          properties: {
            source: { type: "string", description: "Package source to remove" },
            local: { type: "boolean", description: "Remove from project scope (default false = global)" },
          },
        },
        response: { 200: packageInfoSchema, ...autoError },
      },
    },
    async (req, reply) => {
      try {
        const { source, local } = req.body as { source: string; local?: boolean };
        const cwd = homedir();
        const agentDir = config.piConfigDir;
        const settingsManager = SettingsManager.create(cwd, agentDir);
        const packageManager = new DefaultPackageManager({
          cwd,
          agentDir,
          settingsManager,
        });
        try {
          await packageManager.removeAndPersist(source, { local });
        } catch {
          // npm uninstall may fail if package isn't actually installed
          // in the npm prefix. Fall back to removing from settings.json directly.
          const scope = local ? "project" : "user";
          const current =
            scope === "project"
              ? settingsManager.getProjectSettings().packages ?? []
              : settingsManager.getGlobalSettings().packages ?? [];
          const filtered = current.filter((p: PackageSource) => {
            const src = typeof p === "string" ? p : p.source;
            return src !== source;
          });
          if (scope === "project") settingsManager.setProjectPackages(filtered);
          else settingsManager.setPackages(filtered);
          await settingsManager.flush();
        }
        await sessionReload(req.log);
        const result = await readPackages(cwd);
        return reply.send(result);
      } catch (err) {
        req.log.error(err, "Failed to remove package");
        return reply.status(500).send({ error: String(err) });
      }
    },
  );

  // ── POST /api/v1/extensions/sdk-packages/toggle ──────────────────────

  fastify.post(
    "/extensions/sdk-packages/toggle",
    {
      schema: {
        description: "Enable or disable an extension package",
        tags: ["extensions"],
        body: {
          type: "object",
          required: ["source", "disabled", "scope"],
          properties: {
            source: { type: "string", description: "Package source to toggle" },
            disabled: { type: "boolean", description: "true = disable, false = enable" },
            scope: { type: "string", enum: ["user", "project"], description: "Package scope" },
          },
        },
        response: { 200: packageInfoSchema, ...autoError },
      },
    },
    async (req, reply) => {
      try {
        const { source, disabled, scope } = req.body as {
          source: string;
          disabled: boolean;
          scope: "user" | "project";
        };
        const cwd = homedir();
        const settingsManager = SettingsManager.create(cwd, config.piConfigDir);
        setPackageDisabled(settingsManager, source, scope, disabled);
        await settingsManager.flush();
        await sessionReload(req.log);
        const result = await readPackages(cwd);
        return reply.send(result);
      } catch (err) {
        req.log.error(err, "Failed to toggle package");
        return reply.status(500).send({ error: String(err) });
      }
    },
  );
};

// ── Core logic ───────────────────────────────────────────────────────

async function readPackages(cwd: string): Promise<PackagesResponse> {
  const agentDir = config.piConfigDir;
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir,
    settingsManager,
  });

  const countsByPackage = new Map<string, ResourceCounts>();
  const resourcesByPackage = new Map<string, ResourceInfo[]>();
  const totals = emptyCounts();

  try {
    const resolved = await packageManager.resolve(async (source) => {
      // Log missing packages but don't block
      console.warn(`[extension-packages] Package not installed: ${source}`);
      return "skip" as const;
    });
    for (const resource of resolved.extensions) collectResource(resource, "extensions", countsByPackage, resourcesByPackage, totals);
    for (const resource of resolved.skills) collectResource(resource, "skills", countsByPackage, resourcesByPackage, totals);
    for (const resource of resolved.prompts) collectResource(resource, "prompts", countsByPackage, resourcesByPackage, totals);
    for (const resource of resolved.themes) collectResource(resource, "themes", countsByPackage, resourcesByPackage, totals);
  } catch (error) {
    console.error("[extension-packages] Resolve error:", error);
    // Return partial results on resolve failure
  }

  // Build disabled map
  const disabledByPackage = new Map<string, boolean>();
  for (const entry of settingsManager.getGlobalSettings().packages ?? []) {
    const source = getPackageSource(entry);
    disabledByPackage.set(source + "\0" + "user", isDisabledPackage(entry));
  }
  for (const entry of settingsManager.getProjectSettings().packages ?? []) {
    const source = getPackageSource(entry);
    disabledByPackage.set(source + "\0" + "project", isDisabledPackage(entry));
  }

  const packages = packageManager.listConfiguredPackages().map((pkg) => {
    const key = pkg.source + "\0" + pkg.scope;
    const disabled = disabledByPackage.get(key) ?? false;
    const counts = countsByPackage.get(key) ?? emptyCounts();
    const resources = resourcesByPackage.get(key) ?? [];
    const resourceCount = counts.extensions + counts.skills + counts.prompts + counts.themes;
    const pkgMeta = readPackageMetadata(pkg.installedPath);

    let status: PackageInfo["status"];
    if (disabled) {
      status = "disabled";
    } else if (resourceCount > 0) {
      status = "loaded";
    } else if (pkg.installedPath) {
      status = "installed";
    } else {
      status = "missing";
    }

    return {
      source: pkg.source,
      scope: pkg.scope,
      filtered: pkg.filtered,
      disabled,
      installedPath: pkg.installedPath,
      packageName: pkgMeta.packageName,
      version: pkgMeta.version || getConfiguredVersion(pkg.source),
      counts,
      resources,
      status,
    };
  });

  return { packages, totals };
}

function setPackageDisabled(
  settingsManager: SettingsManager,
  source: string,
  scope: "user" | "project",
  disabled: boolean,
): void {
  const current = scope === "project"
    ? settingsManager.getProjectSettings().packages ?? []
    : settingsManager.getGlobalSettings().packages ?? [];
  const next = current.map((entry): PackageSource => {
    if (getPackageSource(entry) !== source) return entry;
    if (disabled) {
      return {
        ...(typeof entry === "string" ? { source: entry } : entry),
        extensions: [],
        skills: [],
        prompts: [],
        themes: [],
      };
    }
    return getPackageSource(entry);
  });
  if (scope === "project") settingsManager.setProjectPackages(next);
  else settingsManager.setPackages(next);
}

/**
 * Reload all active sessions so they pick up package changes immediately.
 */
async function sessionReload(logger: {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}): Promise<void> {
  const sessions = listSessions();
  for (const live of sessions) {
    try {
      // session.reload() re-reads settings from disk, re-discovers resources,
      // and rebuilds the extension runtime — exactly what we need after a
      // package enable/disable/install/remove.
      await live.session.reload();
      logger.info({ sessionId: live.sessionId }, "Session reloaded after package change");
    } catch (err) {
      logger.error({ err, sessionId: live.sessionId }, "Failed to reload session after package change");
    }
    try {
      // rebuildSessionTools re-wires customTools (ask-user-question, plan-mode
      // question, etc.) so that newly enabled/disabled extensions are picked up
      // immediately — without a server restart.
      await rebuildSessionTools(live.sessionId);
      logger.info({ sessionId: live.sessionId }, "Session tools rebuilt after package change");
    } catch (err) {
      logger.error({ err, sessionId: live.sessionId }, "Failed to rebuild session tools after package change");
    }
  }
}
