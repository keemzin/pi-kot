/**
 * Extension manager — runtime discovery + install for pi.dev extensions.
 * Scans ~/.pi/agent/ for installed extensions, agents, and packages,
 * and exposes a curated recommendation catalog optimised for pi-kot.
 *
 * Architecture adapted from pi-forge's extension dynamic detection pattern:
 *   detect → activate — UI features light up based on what's installed.
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
  // ── Orchestration ──
  {
    id: "pi-subagents",
    name: "pi-subagents",
    description:
      "Delegates tasks to specialised subagents (scout, planner, worker, reviewer) with isolated context windows. The core multi-agent extension.",
    package: "npm:pi-subagents",
    category: "orchestration",
    providesAgentTypes: ["scout", "planner", "worker", "reviewer"],
    enablesFeatures: [
      "Agent type config (planner/reviewer/scout/worker models)",
      "Orchestration panel agent detail view",
    ],
    icon: "🧩",
  },
  {
    id: "pi-orchestration",
    name: "pi-orchestration",
    description:
      "Agnostic subagent orchestration with depth limiting, worktree isolation, and per-agent model selection. Supports chain and parallel execution.",
    package: "npm:pi-orchestration",
    category: "orchestration",
    providesAgentTypes: ["scout", "specialist", "worker", "reviewer", "coordinator"],
    enablesFeatures: [
      "Advanced orchestration with depth limits",
      "Worktree isolation for parallel agents",
    ],
    icon: "⚡",
  },

  // ── Tools ──
  {
    id: "pi-web-access",
    name: "pi-web-access",
    description:
      "Web search, content extraction, and API interaction tools for pi. Essential for research-aware coding sessions.",
    package: "npm:pi-web-access",
    category: "tools",
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
    id: "pi-kilocode",
    name: "pi-kilocode",
    description:
      "Kilo Code integration for structured output, code analysis, and AI-powered code transformations.",
    package: "npm:pi-kilocode",
    category: "tools",
    enablesFeatures: ["Structured code analysis"],
    icon: "📐",
  },

  // ── Productivity ──
  {
    id: "pi-rewind",
    name: "pi-rewind",
    description:
      "Session history navigation — checkpoint, rewind, and branch from any prior state. Like undo for your agent.",
    package: "npm:@ayulab/pi-rewind",
    category: "productivity",
    enablesFeatures: ["Checkpoint/rewind in session history"],
    icon: "⏪",
  },
  {
    id: "pi-processes",
    name: "pi-processes",
    description:
      "Long-running background processes (dev servers, watchers, builds) that outlive a single turn. Log capture, regex watches, exit alerts.",
    package: "npm:pi-processes",
    category: "productivity",
    enablesFeatures: ["Background process management"],
    icon: "⚙️",
  },

  // ── Integration ──
  {
    id: "@ifi/pi-extension-subagents",
    name: "pi-extension-subagents (ifi)",
    description:
      "Alternative subagent implementation with built-in agent configs, conversation viewer, and cross-extension RPC.",
    package: "npm:@ifi/pi-extension-subagents",
    category: "orchestration",
    providesAgentTypes: [
      "scout",
      "planner",
      "worker",
      "reviewer",
      "context-builder",
      "researcher",
      "artist",
      "frontend-designer",
    ],
    enablesFeatures: ["Built-in agent configs", "Conversation overlay UI"],
    icon: "🔧",
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
