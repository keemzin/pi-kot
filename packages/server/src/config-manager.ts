/**
 * Config Manager — wraps SDK config files (auth.json, settings.json, models.json).
 *
 * Ported from pi-forge/packages/server/src/config-manager.ts
 * Simplified for pi-kot: no prompt/skill/tool overrides, no export/import.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
  AuthStorage,
  SettingsManager,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import { config } from "./config.js";

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
  return mgr.getGlobalSettings() as unknown as Record<string, unknown>;
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

// ── Live providers listing (from SDK ModelRegistry) ──────────────────────

export function liveProvidersListing(): {
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
  const all = registry.getAll();
  console.log("[config] total models:", all.length);

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

    const supportedThinkingLevels: string[] = (() => {
      try {
        return getSupportedThinkingLevels(m as Parameters<typeof getSupportedThinkingLevels>[0]);
      } catch {
        return [];
      }
    })();

    entry.models.push({
      id: m.id,
      name: m.name,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      reasoning: m.reasoning,
      input: m.input,
      hasAuth: registry.hasConfiguredAuth(m),
      supportedThinkingLevels,
    });
  }

  return { providers: Array.from(grouped.values()) };
}
