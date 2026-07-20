/**
 * UI Settings Store — persists frontend preferences server-side.
 *
 * Like pi-web's server/settings.ts pattern: typed schema, atomic writes,
 * cached reads, patch with validation.
 *
 * Settings survive browser cache clears and can be shared across devices.
 */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { config } from "./config.js";

// ── Types ─────────────────────────────────────────────────────────────────

export type UiSettings = {
  version: 1;
  theme?: string;
  accent?: string;
  stickyUserHeader: boolean;
  showTokenUsage: boolean;
  compressImages: boolean;
  showThinking: boolean;
  viewerWidth: number;
  artifactViewerWidth: number;
  // User bubble customization (null = use accent default)
  userBubbleColor?: string | null;
  userBubbleTextColor?: string | null;
  userBubbleBorderColor?: string | null;
};

// ── Defaults ──────────────────────────────────────────────────────────────

const DEFAULTS: UiSettings = {
  version: 1,
  theme: undefined,
  accent: undefined,
  stickyUserHeader: true,
  showTokenUsage: false,
  compressImages: true,
  showThinking: false,
  viewerWidth: 480,
  artifactViewerWidth: 480,
  userBubbleColor: null,
  userBubbleTextColor: null,
  userBubbleBorderColor: null,
};

// ── Path ──────────────────────────────────────────────────────────────────

function uiSettingsPath(): string {
  return join(config.piConfigDir, "ui-settings.json");
}

// ── Normalization ─────────────────────────────────────────────────────────

function normalize(value: unknown): UiSettings {
  const settings = structuredClone(DEFAULTS);
  if (!value || typeof value !== "object" || Array.isArray(value)) return settings;

  const v = value as Record<string, unknown>;

  if (typeof v.theme === "string") settings.theme = v.theme;
  if (typeof v.accent === "string") settings.accent = v.accent;
  if (typeof v.stickyUserHeader === "boolean") settings.stickyUserHeader = v.stickyUserHeader;
  if (typeof v.showTokenUsage === "boolean") settings.showTokenUsage = v.showTokenUsage;
  if (typeof v.compressImages === "boolean") settings.compressImages = v.compressImages;
  if (typeof v.showThinking === "boolean") settings.showThinking = v.showThinking;
  if (typeof v.viewerWidth === "number") settings.viewerWidth = v.viewerWidth;
  if (typeof v.artifactViewerWidth === "number") settings.artifactViewerWidth = v.artifactViewerWidth;
  // User bubble: null = use accent default, string = custom hex
  if (v.userBubbleColor === null || typeof v.userBubbleColor === "string") settings.userBubbleColor = v.userBubbleColor;
  if (v.userBubbleTextColor === null || typeof v.userBubbleTextColor === "string") settings.userBubbleTextColor = v.userBubbleTextColor;
  if (v.userBubbleBorderColor === null || typeof v.userBubbleBorderColor === "string") settings.userBubbleBorderColor = v.userBubbleBorderColor;

  return settings;
}

// ── Store ─────────────────────────────────────────────────────────────────

let cached: UiSettings | undefined;

export function createUiSettingsStore() {
  return { read, write, patch, reset };
}

async function ensureDir(): Promise<void> {
  await mkdir(dirname(uiSettingsPath()), { recursive: true });
}

async function read(): Promise<UiSettings> {
  if (cached) return structuredClone(cached);
  try {
    const raw = await readFile(uiSettingsPath(), "utf-8");
    cached = normalize(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`ui-settings: could not read — ${(err as Error).message}`);
    }
    cached = structuredClone(DEFAULTS);
  }
  return structuredClone(cached);
}

async function write(settings: UiSettings): Promise<UiSettings> {
  cached = normalize(settings);
  await ensureDir();
  const file = uiSettingsPath();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(cached, null, 2)}\n`, "utf-8");
  await rename(tmp, file);
  return structuredClone(cached);
}

async function patch(patch: Partial<UiSettings>): Promise<UiSettings> {
  const current = await read();
  console.log("[ui-settings] patch received:", JSON.stringify(patch));
  const merged: UiSettings = {
    ...current,
    ...Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    ),
  };
  console.log("[ui-settings] merged:", JSON.stringify(merged));
  return write(merged);
}

async function reset(): Promise<UiSettings> {
  cached = structuredClone(DEFAULTS);
  await ensureDir();
  const file = uiSettingsPath();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(DEFAULTS, null, 2)}\n`, "utf-8");
  await rename(tmp, file);
  return structuredClone(DEFAULTS);
}

// ── Singleton ─────────────────────────────────────────────────────────────

export const uiSettings = { read, write, patch, reset };
