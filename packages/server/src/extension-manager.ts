/**
 * Extension manager — runtime discovery + install for pi.dev extensions.
 * Scans ~/.pi/agent/ for installed extensions, agents, and packages,
 * and exposes a curated recommendation catalog optimised for pi-kot.
 *
 * Architecture adapted from pi-forge's extension dynamic detection pattern:
 *   detect → activate — UI features light up based on what's installed.
 *
 * Update checking:
 *   checkExtensionUpdates() compares installed vs. npm registry latest.
 *   updateExtension() runs npm install to upgrade to latest.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { config } from "./config.js";

// ── Types ────────────────────────────────────────────────────────────

export interface DiscoveredExtension {
  /** Package / extension name */
  name: string;
  /** Where it was found: 'extensions_dir' | 'agents_dir' | 'package' | 'builtin' */
  source: "extensions_dir" | "agents_dir" | "package" | "builtin";
  /** Human description */
  description: string;
  /** Version string if available */
  version?: string;
  /** Original package identifier (e.g. "npm:@ayulab/pi-rewind"). Only set for package source. */
  package?: string;
  /** The agent type definitions this extension provides (e.g. scout, planner) */
  agentTypes?: string[];
  /** What UI features this extension enables */
  enablesFeatures?: string[];
}

export interface RecommendedExtension {
  id: string;
  name: string;
  description: string;
  /** npm package name (including npm: prefix for pi) */
  package: string;
  /** Category for grouping in UI */
  category: "orchestration" | "tools" | "ui" | "integration" | "productivity";
  /** Whether this extension is already installed */
  installed: boolean;
  /** True when this extension has been tested and verified to work with pi-kot */
  verified?: boolean;
  /** What agent types this extension provides */
  providesAgentTypes?: string[];
  /** What UI features this enables */
  enablesFeatures?: string[];
  /** Icon emoji */
  icon: string;
}

export interface ExtensionsResponse {
  /** Extensions currently detected in the pi agent directory */
  detected: DiscoveredExtension[];
  /** Curated recommendations optimised for pi-kot */
  recommended: RecommendedExtension[];
  /** Agent definitions found (scout, planner, etc.) */
  agents: AgentDef[];
}

export interface AgentDef {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  source: "file" | "builtin";
}

// ── Path helpers ────────────────────────────────────────────────────

function piAgentDir(): string {
  // getAgentDir in pi SDK defaults to ~/.pi/agent
  return join(homedir(), ".pi", "agent");
}

function extensionsDir(): string {
  return join(piAgentDir(), "extensions");
}

function agentsDir(): string {
  return join(piAgentDir(), "agents");
}

function settingsPath(): string {
  return join(piAgentDir(), "settings.json");
}

function npmPackagePath(): string {
  return join(piAgentDir(), "npm", "package.json");
}

// ── Known extension registry (curated) ──────────────────────────────

const knownExtensions: Omit<RecommendedExtension, "installed">[] = [
  // ── Tools ──
  {
    id: "pi-web-access",
    name: "pi-web-access",
    description:
      "Web search, content extraction, and API interaction tools for pi. Essential for research-aware coding sessions.",
    package: "npm:pi-web-access",
    category: "tools",
    verified: true,
    enablesFeatures: ["Web search in agent sessions"],
    icon: "🌐",
  },
  {
    id: "pi-playwright",
    name: "pi-playwright",
    description:
      "Automated browser testing and web scraping via Playwright. Steer the agent through real web UI.",
    package: "npm:pi-playwright",
    category: "tools",
    enablesFeatures: ["Browser automation in agent sessions"],
    icon: "🎭",
  },
  {
    id: "pi-vision-tool",
    name: "pi-vision-tool",
    description:
      "Delegates image analysis to a vision-capable model. Non-vision models can call describe_image to understand screenshots, diagrams, and photos.",
    package: "npm:pi-vision-tool",
    category: "tools",
    verified: true,
    enablesFeatures: ["Image analysis via vision model delegation"],
    icon: "👁️",
  },
  // ── Productivity ──
  {
    id: "pi-rewind",
    name: "pi-rewind",
    description:
      "Session history navigation — checkpoint, rewind, and branch from any prior state. Like undo for your agent.",
    package: "npm:@ayulab/pi-rewind",
    category: "productivity",
    verified: true,
    enablesFeatures: ["Checkpoint/rewind in session history"],
    icon: "⏪",
  },
  {
    id: "pi-processes",
    name: "pi-processes",
    description:
      "Long-running background processes (dev servers, watchers, builds) that outlive a single turn. Log capture, regex watches, exit alerts.",
    package: "npm:@aliou/pi-processes",
    category: "productivity",
    verified: true,
    enablesFeatures: ["Background process management"],
    icon: "⚙️",
  },


];

// ── Discovery ───────────────────────────────────────────────────────

/** Get installed npm packages from ~/.pi/agent/npm/package.json */
async function readInstalledPackages(): Promise<Set<string>> {
  const installed = new Set<string>();
  try {
    const pkg = JSON.parse(await readFile(npmPackagePath(), "utf-8"));
    for (const name of Object.keys(pkg.dependencies || {})) {
      installed.add(`npm:${name}`);
      installed.add(name);
    }
  } catch {
    // No npm dir yet — that's fine
  }
  return installed;
}

/** Scan ~/.pi/agent/extensions/ for *.ts files and subdirectories */
async function scanExtensionsDir(): Promise<DiscoveredExtension[]> {
  const results: DiscoveredExtension[] = [];
  try {
    const dir = extensionsDir();
    if (!existsSync(dir)) return results;
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.endsWith(".ts")) {
        const name = entry.name.replace(/\.ts$/, "");
        const desc = await extractDescriptionFromExtension(join(dir, entry.name));
        results.push({
          name,
          description: desc || `Custom extension at ~/.pi/agent/extensions/${entry.name}`,
          source: "extensions_dir",
          enablesFeatures: ["Custom extension loaded"],
        });
      } else if (entry.isDirectory()) {
        results.push({
          name: entry.name,
          description: `Extension directory at ~/.pi/agent/extensions/${entry.name}/`,
          source: "extensions_dir",
          enablesFeatures: ["Custom extension loaded"],
        });
      }
    }
  } catch {
    // No extensions dir
  }
  return results;
}

/** Scan ~/.pi/agent/agents/ for *.md agent definitions */
async function scanAgentsDir(): Promise<AgentDef[]> {
  const agents: AgentDef[] = [];
  try {
    const dir = agentsDir();
    if (!existsSync(dir)) return agents;
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.name.endsWith(".md")) continue;
      const content = await readFile(join(dir, entry.name), "utf-8");
      const name = entry.name.replace(/\.md$/, "");

      // Parse YAML frontmatter (basic, no external dep)
      const fM = parseFrontmatter(content);

      agents.push({
        name: fM.name || name,
        description: fM.description || `Agent definition from ~/.pi/agent/agents/${entry.name}`,
        model: fM.model,
        tools: fM.tools?.split(",").map((t: string) => t.trim()).filter(Boolean),
        source: "file",
      });
    }
  } catch {
    // No agents dir
  }
  return agents;
}

/** Crude frontmatter parser — enough for YAML name/desc/model/tools */
function parseFrontmatter(
  content: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return result;

  for (const line of match[1].split("\n")) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim().replace(/^["']|["']$/g, "");
    result[key] = value;
  }
  return result;
}

/** Try to grab a one-liner description from an extension file */
async function extractDescriptionFromExtension(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n").slice(0, 30);
    for (const line of lines) {
      const trimmed = line.trim();
      // Look for description in JSDoc
      if (trimmed.startsWith("*") && !trimmed.startsWith("* ")) continue;
      if (trimmed.startsWith("* ") && trimmed.length > 5) {
        const text = trimmed.replace(/^\*\s?/, "");
        if (text.length > 10) return text;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/** Read settings.json for configured packages */
async function readConfiguredPackages(): Promise<string[]> {
  try {
    const raw = await readFile(settingsPath(), "utf-8");
    const settings = JSON.parse(raw);
    return settings.packages || [];
  } catch {
    return [];
  }
}

// ── Main API ────────────────────────────────────────────────────────

export async function discoverExtensions(): Promise<ExtensionsResponse> {
  const installed = await readInstalledPackages();
  const configured = new Set(await readConfiguredPackages());

  // Scan filesystem
  const [extFiles, agents] = await Promise.all([
    scanExtensionsDir(),
    scanAgentsDir(),
  ]);

  // Build detected list from packages
  const detectedPkgs: DiscoveredExtension[] = [];
  for (const pkg of configured) {
    // Look up known info
    const known = knownExtensions.find((k) => k.package === pkg);
    detectedPkgs.push({
      name: known?.name ?? pkg.replace("npm:", ""),
      description:
        known?.description ?? `Installed package: ${pkg}`,
      source: "package",
      version: known ? undefined : undefined,
      package: pkg,
      agentTypes: known?.providesAgentTypes,
      enablesFeatures: known?.enablesFeatures,
    });
  }

  // Build recommended list with install status
  const allInstalled = new Set<string>();
  for (const pkg of configured) allInstalled.add(pkg);
  installed.forEach((p) => allInstalled.add(p));
  // Also check if agents dir has the agent types
  const agentNames = new Set(agents.map((a) => a.name));
  for (const ext of extFiles) allInstalled.add(ext.name);

  const recommended: RecommendedExtension[] = knownExtensions.map(
    (k) => ({
      ...k,
      installed:
        allInstalled.has(k.package) ||
        allInstalled.has(k.id) ||
        allInstalled.has(
          k.package.replace("npm:", "").replace("@", ""),
        ) ||
        (k.providesAgentTypes?.some((t) => agentNames.has(t)) ?? false),
    }),
  );

  return {
    detected: [...detectedPkgs, ...extFiles],
    recommended,
    agents,
  };
}

export async function uninstallExtension(
  packageName: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const npmName = packageName.replace(/^npm:/, "");
    const pkgEntry = packageName.startsWith("npm:") ? packageName : `npm:${npmName}`;

    // Remove from settings.json packages array
    const settingsRaw = await readFile(settingsPath(), "utf-8");
    const settings = JSON.parse(settingsRaw);
    if (settings.packages) {
      settings.packages = settings.packages.filter((p: string) => p !== pkgEntry);
    }

    // Write settings back atomically
    const tmpPath = settingsPath() + ".tmp";
    const { writeFile, rename } = await import("node:fs/promises");
    await writeFile(tmpPath, JSON.stringify(settings, null, 2), "utf-8");
    await rename(tmpPath, settingsPath());

    // Uninstall via npm in the agent dir (keep settings clean even if npm uninstall fails)
    const npmDir = join(piAgentDir(), "npm");
    try {
      execSync(`npm uninstall ${npmName}`, {
        cwd: npmDir,
        stdio: "pipe",
        timeout: 60_000,
      });
    } catch {
      // npm uninstall may fail if the package isn't actually installed
      // but we already cleaned the settings — best effort
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

export async function installExtension(
  packageName: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Strip npm: prefix if present
    const npmName = packageName.replace(/^npm:/, "");

    // Add to settings.json packages array
    const settingsRaw = await readFile(settingsPath(), "utf-8");
    const settings = JSON.parse(settingsRaw);
    if (!settings.packages) settings.packages = [];

    const pkgEntry = packageName.startsWith("npm:") ? packageName : `npm:${npmName}`;
    if (!settings.packages.includes(pkgEntry)) {
      settings.packages.push(pkgEntry);
    }

    // Write settings back atomically
    const tmpPath = settingsPath() + ".tmp";
    const { writeFile, rename } = await import("node:fs/promises");
    await writeFile(tmpPath, JSON.stringify(settings, null, 2), "utf-8");
    await rename(tmpPath, settingsPath());

    // Install via npm in the agent dir
    const npmDir = join(piAgentDir(), "npm");
    execSync(`npm install ${npmName}`, {
      cwd: npmDir,
      stdio: "pipe",
      timeout: 120_000,
    });

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ── Update checking ─────────────────────────────────────────────────

export interface ExtensionUpdateInfo {
  /** npm package name (without npm: prefix) */
  package: string;
  /** Display name */
  name: string;
  /** Currently installed version from node_modules/package.json */
  installed: string | undefined;
  /** Latest version available on npm registry */
  latest: string | undefined;
  /** Whether a newer version is available */
  updateAvailable: boolean;
}

/**
 * Hold a short-lived cache of check results to avoid hammering npm
 * registry on every UI render. Cleared after 60 seconds.
 */
let _updateCache: { data: ExtensionUpdateInfo[]; timestamp: number } | undefined;

/** Clear the update cache so the next `checkExtensionUpdates()` hits npm fresh. */
export function clearExtensionCache(): void {
  _updateCache = undefined;
}

/**
 * Check for updates on all installed npm packages.
 * Reads installed versions from node_modules, then fetches latest
 * from registry.npmjs.org. Results are cached for 60 seconds.
 */
export async function checkExtensionUpdates(): Promise<ExtensionUpdateInfo[]> {
  const now = Date.now();
  if (_updateCache && now - _updateCache.timestamp < 60_000) {
    return _updateCache.data;
  }

  const results: ExtensionUpdateInfo[] = [];
  const npmDir = join(piAgentDir(), "npm");

  // Read installed packages list
  let packageNames: string[] = [];
  try {
    const pkg = JSON.parse(await readFile(join(npmDir, "package.json"), "utf-8"));
    packageNames = Object.keys(pkg.dependencies || {});
  } catch {
    // No npm dir or no packages yet
  }

  for (const name of packageNames) {
    // Read installed version
    let installed: string | undefined;
    try {
      const installedPkg = JSON.parse(
        await readFile(join(npmDir, "node_modules", name, "package.json"), "utf-8"),
      );
      installed = installedPkg.version;
    } catch {
      installed = undefined;
    }

    // Fetch latest from npm registry
    let latest: string | undefined;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json() as { version?: string };
        latest = data.version;
      }
    } catch {
      latest = undefined;
    }

    // Look up display name from curated list
    const known = knownExtensions.find((k) => k.package === `npm:${name}`);

    results.push({
      package: name,
      name: known?.name ?? name,
      installed,
      latest,
      updateAvailable: installed !== undefined && latest !== undefined && installed !== latest,
    });
  }

  _updateCache = { data: results, timestamp: now };
  return results;
}

/**
 * Manual install — accepts any pi install spec through the SDK config path
 * (settings.json + npm install). No CLI dependency.
 *
 * Supported formats:
 *   npm:package-name    → npm install
 *   git:github.com/user/repo → npm install via git URL
 *   pi install <spec>   → strips prefix first (user typed the full command)
 */
export async function installManualExtension(
  installSpec: string,
): Promise<{ success: boolean; error?: string }> {
  // Strip leading "pi install " or "pi " if the user typed the full CLI command
  const spec = installSpec
    .replace(/^pi\s+install\s+/i, "")
    .replace(/^pi\s+/i, "")
    .trim();

  if (spec.length === 0) {
    return { success: false, error: "Empty install spec." };
  }

  try {
    const settingsRaw = await readFile(settingsPath(), "utf-8");
    const settings = JSON.parse(settingsRaw);
    if (!settings.packages) settings.packages = [];

    // Add the raw spec (npm:..., git:...) to settings.json packages[]
    if (!settings.packages.includes(spec)) {
      settings.packages.push(spec);
    }

    // Write settings back atomically
    const tmpPath = settingsPath() + ".tmp";
    const { writeFile, rename } = await import("node:fs/promises");
    await writeFile(tmpPath, JSON.stringify(settings, null, 2), "utf-8");
    await rename(tmpPath, settingsPath());

    // Translate spec to an npm-compatible package reference
    const npmRef = specToNpmRef(spec);

    // Install via npm in the agent dir
    const npmDir = join(piAgentDir(), "npm");
    execSync(`npm install ${npmRef}`, {
      cwd: npmDir,
      stdio: "pipe",
      timeout: 180_000,
    });

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Translate a pi install spec to an npm package reference.
 *
 *   npm:foo          → foo
 *   git:github.com/user/repo → github:user/repo  (npm's GitHub shortcut)
 *   git:github.com/user/repo.git → same logic
 *   Anything else    → passed through as-is
 */
function specToNpmRef(spec: string): string {
  if (spec.startsWith("npm:")) {
    return spec.slice(4);
  }
  if (spec.startsWith("git:")) {
    const path = spec.slice(4); // github.com/user/repo
    // npm supports "github:user/repo" directly
    const match = path.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
    if (match) {
      return `github:${match[1]}`;
    }
    // For other git hosts, use the full git+https URL
    return `git+https://${path}`;
  }
  // Pass through as-is (bare package name, local path, etc.)
  return spec;
}

/**
 * Update an installed extension to the latest version via npm install.
 * Equivalent to re-running the install but without touching settings.json
 * (since it's already in the packages list).
 */
export async function updateExtension(
  packageName: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const npmName = packageName.replace(/^npm:/, "");
    const npmDir = join(piAgentDir(), "npm");
    execSync(`npm install ${npmName}`, {
      cwd: npmDir,
      stdio: "pipe",
      timeout: 120_000,
    });
    // Invalidate cache so next check picks up the new version
    _updateCache = undefined;
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/** Built-in agent definitions (builtin defaults like pi-subagents examples) */
export const builtinAgentDefs: AgentDef[] = [
  {
    name: "scout",
    description: "Fast codebase recon — returns compressed context for handoff to other agents",
    model: "claude-haiku-4-5",
    tools: ["read", "grep", "find", "ls", "bash"],
    source: "builtin",
  },
  {
    name: "planner",
    description: "Creates implementation plans with structured analysis",
    model: "claude-sonnet-4-5",
    tools: ["read", "grep", "find", "ls"],
    source: "builtin",
  },
  {
    name: "reviewer",
    description: "Code review & quality assurance — checks for issues, security, and style",
    model: "claude-sonnet-4-5",
    tools: ["read", "grep", "find", "ls", "bash"],
    source: "builtin",
  },
  {
    name: "worker",
    description: "General-purpose task execution with full capabilities",
    model: "claude-sonnet-4-5",
    tools: [],
    source: "builtin",
  },
];
