/**
 * Config Manager — wraps SDK config files (auth.json, settings.json, models.json).
 *
 * Ported from a reference config-manager
 * Simplified for pi-kot: no prompt/skill/tool overrides, no export/import.
 */
import { readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
  AuthStorage,
  SettingsManager,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import { config } from "./config.js";

// ── Provider Discovery / Probing ─────────────────────────────────────────

interface ProbeRequest {
  baseUrl: string;
  apiKey?: string;
  apiType?: string;
  headers?: Record<string, string>;
}

interface ProbeResult {
  reachable: boolean;
  error?: string;
  detectedApiType?: string;
  models?: Array<{ id: string; name?: string }>;
  suggestedName?: string;
  /** Full response from the models endpoint for debugging */
  rawResponse?: unknown;
}

/**
 * Probe a provider endpoint to test connectivity, detect API type,
 * and fetch available models.
 */
export async function probeProvider(req: ProbeRequest): Promise<ProbeResult> {
  const baseUrl = req.baseUrl.replace(/\/+$/, "");

  // Build headers
  const headers: Record<string, string> = {
    ...(req.headers ?? {}),
  };
  if (req.apiKey) {
    headers["Authorization"] = `Bearer ${req.apiKey}`;
  }

  // Detect API type if not provided
  const urlLower = baseUrl.toLowerCase();
  const apiType =
    req.apiType ??
    (urlLower.includes("anthropic")
      ? "anthropic-messages"
      : urlLower.includes("google")
        ? "google-generative-ai"
        : "openai-completions");

  // Try to fetch models — different endpoints per API type
  let modelsEndpoint: string;
  if (apiType === "google-generative-ai") {
    // Google uses /v1beta/models or /v1/models
    modelsEndpoint = baseUrl.endsWith("/v1beta") || baseUrl.endsWith("/v1")
      ? `${baseUrl}/models`
      : `${baseUrl}/v1beta/models`;
  } else if (apiType === "anthropic-messages") {
    // Anthropic doesn't have a public models endpoint — try common patterns
    modelsEndpoint = `${baseUrl}/models`;
  } else {
    // OpenAI-compatible: /v1/models or /models
    modelsEndpoint = baseUrl.endsWith("/v1")
      ? `${baseUrl}/models`
      : `${baseUrl}/v1/models`;
  }

  // First test basic connectivity
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(modelsEndpoint, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return {
        reachable: false,
        error: `HTTP ${res.status}: ${res.statusText}. Tried ${modelsEndpoint}`,
        detectedApiType: apiType,
      };
    }

    const body = (await res.json()) as Record<string, unknown>;

    // Parse models from response
    let models: Array<{ id: string; name?: string }> = [];

    if (Array.isArray(body.data)) {
      // OpenAI-compatible { data: [{ id, ... }] }
      models = body.data.map((m: Record<string, unknown>) => ({
        id: String(m.id ?? ""),
        name: String(m.name ?? m.id ?? ""),
      }));
    } else if (Array.isArray(body.models)) {
      // Google-style { models: [{ name, ... }] }
      models = body.models.map((m: Record<string, unknown>) => {
        const name = String(m.name ?? "");
        const shortId = name.includes("/") ? name.split("/").pop() ?? name : name;
        return { id: shortId, name };
      });
    }

    // Filter out empty ids
    models = models.filter((m) => m.id.length > 0);

    // Derive a suggested provider name from the hostname
    let suggestedName: string;
    try {
      const hostname = new URL(baseUrl).hostname;
      suggestedName = hostname
        .replace(/^api[.-]/, "")
        .replace(/[.-]api$/, "")
        .replace(/\./g, "-")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .toLowerCase()
        .slice(0, 24) || "custom";
    } catch {
      suggestedName = "custom";
    }

    return {
      reachable: true,
      detectedApiType: apiType,
      models,
      suggestedName,
      rawResponse: models.length > 0 ? undefined : body,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      reachable: false,
      error: `Connection failed: ${message}`,
      detectedApiType: apiType,
    };
  }
}

/**
 * Add or update a custom provider in models.json.
 */
export async function addCustomProvider(
  providerName: string,
  config: Record<string, unknown>,
): Promise<{ providers: Record<string, unknown> }> {
  const current = await readModelsJsonRaw();
  current.providers[providerName] = config;
  await writeModelsJson(current);
  return { providers: current.providers };
}

/**
 * Remove a custom provider from models.json.
 */
export async function removeCustomProvider(
  providerName: string,
): Promise<{ providers: Record<string, unknown> }> {
  const current = await readModelsJsonRaw();
  delete current.providers[providerName];
  await writeModelsJson(current);
  return { providers: current.providers };
}

/**
 * Read models.json raw (without redaction).
 */
async function readModelsJsonRaw(): Promise<ModelsJson> {
  try {
    const raw = await readFile(MODELS_PATH, "utf-8");
    return JSON.parse(raw) as ModelsJson;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { providers: {} };
    }
    throw err;
  }
}

// ── Paths ─────────────────────────────────────────────────────────────────

const PI_CONFIG_DIR = config.piConfigDir;
const AUTH_PATH = join(PI_CONFIG_DIR, "auth.json");
const MODELS_PATH = join(PI_CONFIG_DIR, "models.json");

// ── Errors ─────────────────────────────────────────────────────────────────

export class AuthProviderNotFoundError extends Error {
  constructor(provider: string) {
    super(`Auth provider "${provider}" not found`);
    this.name = "AuthProviderNotFoundError";
  }
}

// ── Auth (auth.json) ──────────────────────────────────────────────────────

export interface AuthPresence {
  configured: boolean;
  source?: string;
  label?: string;
}

export interface AuthSummary {
  providers: Record<string, AuthPresence>;
}

export function readAuthSummary(): AuthSummary {
  const store = AuthStorage.create(AUTH_PATH);
  const providers: Record<string, AuthPresence> = {};
  for (const name of store.list()) {
    providers[name] = {
      configured: store.has(name),
      source: "stored",
    };
  }
  return { providers };
}

export function writeApiKey(provider: string, apiKey: string): void {
  const store = AuthStorage.create(AUTH_PATH);
  store.set(provider, { type: "api_key", key: apiKey });
}

export function removeApiKey(provider: string): void {
  const store = AuthStorage.create(AUTH_PATH);
  if (!store.has(provider)) {
    throw new AuthProviderNotFoundError(provider);
  }
  store.remove(provider);
}

// ── Settings (settings.json) ──────────────────────────────────────────────

export function readSettings(): Record<string, unknown> {
  const mgr = SettingsManager.create(PI_CONFIG_DIR);
  return mgr.getGlobalSettings() as unknown as Record<string, unknown>;
}

export function updateSettings(patch: Record<string, unknown>): Record<string, unknown> {
  const mgr = SettingsManager.create(PI_CONFIG_DIR);
  // Apply overrides for the fields that have individual setters
  if (patch.defaultProvider !== undefined && patch.defaultProvider !== null) {
    mgr.setDefaultProvider(String(patch.defaultProvider));
  }
  if (patch.defaultModel !== undefined && patch.defaultModel !== null) {
    mgr.setDefaultModel(String(patch.defaultModel));
  }
  if (patch.defaultThinkingLevel !== undefined && patch.defaultThinkingLevel !== null) {
    mgr.setDefaultThinkingLevel(
      patch.defaultThinkingLevel as "off" | "minimal" | "low" | "medium" | "high" | "xhigh",
    );
  }
  if (patch.skills !== undefined) {
    mgr.setSkillPaths(patch.skills === null ? [] : (patch.skills as string[]));
  }
  if (patch.enableSkillCommands !== undefined) {
    mgr.setEnableSkillCommands(patch.enableSkillCommands === null ? false : Boolean(patch.enableSkillCommands));
  }
  mgr.flush();

  // Handle orchestrator model fields (not managed by SDK SettingsManager)
  const raw = mgr.getGlobalSettings() as Record<string, unknown>;
  if (patch.orchProvider !== undefined) {
    raw.orchProvider = patch.orchProvider === null ? undefined : String(patch.orchProvider);
  }
  if (patch.orchModel !== undefined) {
    raw.orchModel = patch.orchModel === null ? undefined : String(patch.orchModel);
  }
  // Write back to persist the extra fields
  writeSettings(raw).catch(() => undefined);

  return raw;
}

// ── Models (models.json) ──────────────────────────────────────────────────

export interface ModelsJson {
  providers: Record<string, unknown>;
}

/**
 * Read models.json, redacting secret fields (apiKey, apiKeyCommand).
 */
export async function readModelsJsonRedacted(): Promise<ModelsJson> {
  try {
    const raw = await readFile(MODELS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as ModelsJson;
    // Redact secrets in every provider config
    const redacted = { providers: {} as Record<string, unknown> };
    for (const [key, val] of Object.entries(parsed.providers ?? {})) {
      if (typeof val === "object" && val !== null) {
        const v = val as Record<string, unknown>;
        const redactedVal: Record<string, unknown> = {};
        for (const [k, vv] of Object.entries(v)) {
          if ((k === "apiKey" || k === "apiKeyCommand") && vv !== undefined) {
            redactedVal[k] = "***REDACTED***";
          } else {
            redactedVal[k] = vv;
          }
        }
        redacted.providers[key] = redactedVal;
      } else {
        redacted.providers[key] = val;
      }
    }
    return redacted;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { providers: {} };
    }
    throw err;
  }
}

export async function writeModelsJson(data: ModelsJson): Promise<void> {
  await mkdir(dirname(MODELS_PATH), { recursive: true });
  await writeFile(MODELS_PATH, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Atomic JSON write (tmp + rename) for config files.
 * Pattern: crash-safe writes, no partial writes.
 */
async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/**
 * Write settings.json atomically. Used by the per-session setModel route
 * to restore the global default after the SDK mutates it as a side effect
 * of session.setModel().
 * Pattern from reference writeSettings().
 */
export async function writeSettings(settings: Record<string, unknown>): Promise<void> {
  const SETTINGS_FILE = join(PI_CONFIG_DIR, "settings.json");
  await atomicWriteJson(SETTINGS_FILE, settings);
}

// ── Enabled Models (settings.json → enabledModels) ─────────────────────────

/**
 * Read the enabledModels array from settings via the SDK SettingsManager.
 * Returns undefined when no scoping is active (all models visible).
 */
export function readEnabledModels(): string[] | undefined {
  const mgr = SettingsManager.create(PI_CONFIG_DIR);
  return mgr.getEnabledModels();
}

/**
 * Persist the enabledModels array to settings. Pass undefined or null
 * to disable scoping (all models visible).
 */
export function writeEnabledModels(patterns: string[] | null | undefined): void {
  const mgr = SettingsManager.create(PI_CONFIG_DIR);
  mgr.setEnabledModels(patterns === null || patterns === undefined ? undefined : patterns);
}

// ── Live providers listing (from SDK ModelRegistry) ──────────────────────

function buildModelDetail(m: import("@earendil-works/pi-ai").Model<import("@earendil-works/pi-ai").Api>, registry: ModelRegistry) {
  const supportedThinkingLevels: string[] = (() => {
    try {
      return getSupportedThinkingLevels(m as Parameters<typeof getSupportedThinkingLevels>[0]);
    } catch {
      return [];
    }
  })();

  return {
    id: m.id,
    name: m.name,
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
    reasoning: m.reasoning,
    input: m.input,
    hasAuth: registry.hasConfiguredAuth(m),
    supportedThinkingLevels,
  };
}

export interface ProvidersListingOptions {
  /** When true, only return models listed in enabledModels. */
  scoped?: boolean;
}

export function liveProvidersListing(opts?: ProvidersListingOptions): {
  providers: Array<{
    provider: string;
    models: Array<{
      id: string;
      name: string;
      contextWindow: number;
      maxTokens: number;
      reasoning: boolean;
      input: string[];
      hasAuth: boolean;
      supportedThinkingLevels: string[];
    }>;
  }>;
} {
  const store = AuthStorage.create(AUTH_PATH);
  const registry = ModelRegistry.create(store, MODELS_PATH);
  let all = registry.getAll();
  console.log("[config] total models:", all.length);

  // Filter to enabled models when scoped mode is on
  if (opts?.scoped === true) {
    const enabled = readEnabledModels();
    if (enabled !== undefined && enabled.length > 0) {
      // enabledModels are stored as "provider/modelId" patterns
      all = all.filter((m) => enabled.includes(`${m.provider}/${m.id}`));
      console.log("[config] scoped models:", all.length);
    }
  }

  const grouped = new Map<string, {
    provider: string;
    models: Array<{
      id: string;
      name: string;
      contextWindow: number;
      maxTokens: number;
      reasoning: boolean;
      input: string[];
      hasAuth: boolean;
      supportedThinkingLevels: string[];
    }>;
  }>();

  for (const m of all) {
    let entry = grouped.get(m.provider);
    if (entry === undefined) {
      entry = { provider: m.provider, models: [] };
      grouped.set(m.provider, entry);
    }

    entry.models.push(buildModelDetail(m, registry));
  }

  return { providers: Array.from(grouped.values()) };
}
