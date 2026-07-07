/**
 * Tunnel module types — constants, error class, normalizers, validators,
 * and the provider interface contract.
 */

import path from "node:path";
import os from "node:os";

// ── Provider constants ────────────────────────────────────────────────────

export const TUNNEL_PROVIDER_CLOUDFLARE = "cloudflare" as const;
export const TUNNEL_PROVIDER_NGROK = "ngrok" as const;

export type TunnelProviderId = typeof TUNNEL_PROVIDER_CLOUDFLARE | typeof TUNNEL_PROVIDER_NGROK | (string & {});

// ── Mode constants ────────────────────────────────────────────────────────

export const TUNNEL_MODE_QUICK = "quick" as const;
export const TUNNEL_MODE_MANAGED_REMOTE = "managed-remote" as const;
export const TUNNEL_MODE_MANAGED_LOCAL = "managed-local" as const;

export type TunnelMode = typeof TUNNEL_MODE_QUICK | typeof TUNNEL_MODE_MANAGED_REMOTE | typeof TUNNEL_MODE_MANAGED_LOCAL;

// ── Intent constants ──────────────────────────────────────────────────────

export const TUNNEL_INTENT_EPHEMERAL_PUBLIC = "ephemeral-public" as const;
export const TUNNEL_INTENT_PERSISTENT_PUBLIC = "persistent-public" as const;
export const TUNNEL_INTENT_PRIVATE_NETWORK = "private-network" as const;

export type TunnelIntent = typeof TUNNEL_INTENT_EPHEMERAL_PUBLIC | typeof TUNNEL_INTENT_PERSISTENT_PUBLIC | typeof TUNNEL_INTENT_PRIVATE_NETWORK;

// ── Sets for validation ───────────────────────────────────────────────────

const SUPPORTED_TUNNEL_PROVIDERS: ReadonlySet<string> = new Set([
  TUNNEL_PROVIDER_CLOUDFLARE,
  TUNNEL_PROVIDER_NGROK,
]);

const SUPPORTED_TUNNEL_MODES: ReadonlySet<string> = new Set([
  TUNNEL_MODE_QUICK,
  TUNNEL_MODE_MANAGED_REMOTE,
  TUNNEL_MODE_MANAGED_LOCAL,
]);

const SUPPORTED_TUNNEL_INTENTS: ReadonlySet<string> = new Set([
  TUNNEL_INTENT_EPHEMERAL_PUBLIC,
  TUNNEL_INTENT_PERSISTENT_PUBLIC,
  TUNNEL_INTENT_PRIVATE_NETWORK,
]);

// ── Error class ───────────────────────────────────────────────────────────

export class TunnelServiceError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, details: unknown = null) {
    super(message);
    this.name = "TunnelServiceError";
    this.code = code;
    this.details = details;
  }
}

// ── Provider interface types ──────────────────────────────────────────────

export interface TunnelModeDescriptor {
  key: string;
  label: string;
  intent: string;
  requires: string[];
  supports: string[];
  stability: string;
}

export interface TunnelProviderCapabilities {
  provider: string;
  defaults: {
    mode: string;
    optionDefaults: Record<string, unknown>;
  };
  modes: TunnelModeDescriptor[];
}

export interface TunnelAvailability {
  available: boolean;
  path: string | null;
  version: string | null;
  dependency?: string;
  installCommand?: string;
  installUrl?: string;
  platform?: string;
  message?: string;
}

export interface TunnelStartRequest {
  provider: string;
  mode: string;
  intent?: string;
  configPath?: string | null;
  token?: string;
  hostname?: string;
}

export interface TunnelContext {
  activePort?: number | null;
  originUrl?: string;
}

export interface TunnelController {
  /** Set by the provider on start(). */
  mode: string;
  /** Set by the service after start(). */
  provider: string;
  /** Kill the tunnel process. */
  stop(): void;
  /** Resolve the public URL from internal state. */
  getPublicUrl(): string | null;
  /** The underlying child process, if any. */
  process?: import("node:child_process").ChildProcess;
  /** Resolve the effective config path (cloudflare managed-local). */
  getEffectiveConfigPath?(): string | null;
  /** Resolve the resolved hostname (cloudflare managed-local). */
  getResolvedHostname?(): string | null;
}

export interface TunnelCheck {
  id: string;
  label: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

export interface TunnelModeDiagnosis {
  mode: string;
  checks: TunnelCheck[];
  summary: { ready: boolean; failures: number; warnings: number };
  ready: boolean;
  blockers: string[];
}

export interface TunnelDiagnosis {
  providerChecks: TunnelCheck[];
  modes: TunnelModeDiagnosis[];
}

export interface DoctorRequest {
  mode?: string | null;
  hostname?: string;
  token?: string;
  tokenProvided?: boolean;
  hostnameProvided?: boolean;
  configPath?: string | null;
  hasSavedManagedRemoteProfile?: boolean;
}

export interface TunnelProvider {
  readonly id: string;
  readonly capabilities: TunnelProviderCapabilities;
  checkAvailability(): Promise<TunnelAvailability>;
  diagnose?(request?: DoctorRequest, context?: { capabilities: TunnelProviderCapabilities }): Promise<TunnelDiagnosis>;
  start(request: TunnelStartRequest, context: TunnelContext): Promise<TunnelController>;
  stop(controller: TunnelController): void;
  resolvePublicUrl(controller: TunnelController): string | null;
  getMetadata?(controller: TunnelController | null): Record<string, unknown> | null;
}

export interface TunnelStartResult {
  publicUrl: string;
  request: TunnelStartRequest;
  activeMode: string;
  provider: string;
  providerMetadata: Record<string, unknown> | null;
}

export interface TunnelServiceDeps {
  registry: TunnelProviderRegistry;
  getController: () => TunnelController | null;
  setController: (controller: TunnelController | null) => void;
  getActivePort: () => number | null;
  onQuickTunnelWarning: () => void;
}

export interface TunnelService {
  start(rawRequest: Partial<TunnelStartRequest>, options?: Record<string, unknown>): Promise<TunnelStartResult>;
  stop(): boolean;
  checkAvailability(providerId: string): Promise<TunnelAvailability>;
  getPublicUrl(): string | null;
  getProviderMetadata(): Record<string, unknown> | null;
  resolveActiveMode(): string | null;
  resolveActiveProvider(): string | null;
}

export interface TunnelProviderRegistry {
  register(provider: TunnelProvider): TunnelProvider;
  get(providerId: string): TunnelProvider | null;
  list(): TunnelProvider[];
  listCapabilities(): TunnelProviderCapabilities[];
  seal(): void;
}

// ── Path helpers ──────────────────────────────────────────────────────────

function getPathApiForPlatform(platform: string): typeof path.posix | typeof path.win32 {
  return platform === "win32" ? path.win32 : path;
}

export function isPathWithinDirectory(
  candidatePath: string,
  directoryPath: string,
  platform: string = process.platform,
): boolean {
  if (typeof candidatePath !== "string" || typeof directoryPath !== "string") {
    return false;
  }

  const pathApi = getPathApiForPlatform(platform);
  const resolvedCandidate = pathApi.resolve(candidatePath);
  const resolvedDirectory = pathApi.resolve(directoryPath);
  const comparableCandidate = platform === "win32" ? resolvedCandidate.toLowerCase() : resolvedCandidate;
  const comparableDirectory = platform === "win32" ? resolvedDirectory.toLowerCase() : resolvedDirectory;
  const directoryPrefix = comparableDirectory.endsWith(pathApi.sep)
    ? comparableDirectory
    : `${comparableDirectory}${pathApi.sep}`;

  return comparableCandidate === comparableDirectory || comparableCandidate.startsWith(directoryPrefix);
}

export function resolveTunnelConfigPath(
  value: string,
  home: string = os.homedir(),
  platform: string = process.platform,
): string {
  const pathApi = getPathApiForPlatform(platform);
  let resolved: string;
  if (value === "~") {
    resolved = home;
  } else if (value.startsWith("~/") || value.startsWith("~\\")) {
    resolved = pathApi.join(home, value.slice(2));
  } else {
    resolved = pathApi.resolve(value);
  }

  if (!isPathWithinDirectory(resolved, home, platform)) {
    throw new TunnelServiceError(
      "validation_error",
      `Config path must be within the home directory (${home}). Got: ${resolved}`,
    );
  }
  return resolved;
}

// ── Normalizers ───────────────────────────────────────────────────────────

export function normalizeTunnelProvider(value: unknown): string {
  if (typeof value !== "string") {
    return TUNNEL_PROVIDER_CLOUDFLARE;
  }
  const provider = value.trim().toLowerCase();
  if (!provider || !SUPPORTED_TUNNEL_PROVIDERS.has(provider)) {
    return TUNNEL_PROVIDER_CLOUDFLARE;
  }
  return provider;
}

export function normalizeTunnelMode(value: unknown): string {
  if (typeof value !== "string") {
    return TUNNEL_MODE_QUICK;
  }
  const mode = value.trim().toLowerCase();
  if (!mode) {
    return TUNNEL_MODE_QUICK;
  }
  if (mode === TUNNEL_MODE_QUICK) return TUNNEL_MODE_QUICK;
  return TUNNEL_MODE_QUICK;
}

function normalizeTunnelIntent(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const intent = value.trim().toLowerCase();
  if (!intent || !SUPPORTED_TUNNEL_INTENTS.has(intent)) {
    return undefined;
  }
  return intent;
}

function modeIntentFallback(mode: string): string | undefined {
  if (mode === TUNNEL_MODE_QUICK) return TUNNEL_INTENT_EPHEMERAL_PUBLIC;
  return undefined;
}

function normalizeTunnelModeForRequest(value: unknown): string {
  if (typeof value === "string") {
    const mode = value.trim().toLowerCase();
    if (mode === TUNNEL_MODE_QUICK) {
      return mode;
    }
  }
  return TUNNEL_MODE_QUICK;
}

export function normalizeOptionalPath(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return resolveTunnelConfigPath(trimmed);
}

export function isSupportedTunnelMode(mode: string): boolean {
  return SUPPORTED_TUNNEL_MODES.has(mode);
}

export interface NormalizedTunnelStartRequest {
  provider: string;
  mode: string;
  intent?: string;
  configPath?: string | null;
  token: string;
  hostname: string;
}

export function normalizeTunnelStartRequest(
  input: Record<string, unknown> = {},
  defaults: Record<string, unknown> = {},
): NormalizedTunnelStartRequest {
  const provider = normalizeTunnelProvider(
    (input.provider as string | undefined) ?? (defaults.provider as string | undefined),
  );
  const mode = normalizeTunnelModeForRequest(
    (input.mode as string | undefined) ?? (defaults.mode as string | undefined),
  );
  const explicitIntent = normalizeTunnelIntent(
    (input.intent as string | undefined) ?? (defaults.intent as string | undefined),
  );
  const intent = explicitIntent ?? modeIntentFallback(mode);
  const configPathValue = Object.prototype.hasOwnProperty.call(input, "configPath")
    ? (input as { configPath?: unknown }).configPath
    : defaults.configPath;
  const configPath = normalizeOptionalPath(configPathValue);

  const rawToken = (input.token as string | undefined) ?? (defaults.token as string | undefined);
  const token = typeof rawToken === "string"
    ? rawToken.trim()
    : "";

  const rawHostname = (input.hostname as string | undefined) ?? (defaults.hostname as string | undefined);
  const hostname = typeof rawHostname === "string"
    ? rawHostname.trim().toLowerCase()
    : "";

  return {
    provider,
    mode,
    intent,
    configPath,
    token,
    hostname,
  };
}

// ── Validator ─────────────────────────────────────────────────────────────

export function validateTunnelStartRequest(
  request: NormalizedTunnelStartRequest,
  capabilities: TunnelProviderCapabilities,
): void {
  if (!request || typeof request !== "object") {
    throw new TunnelServiceError("validation_error", "Tunnel start request must be an object");
  }

  if (!request.provider) {
    throw new TunnelServiceError("validation_error", "Tunnel provider is required");
  }

  if (!isSupportedTunnelMode(request.mode)) {
    throw new TunnelServiceError("mode_unsupported", `Unsupported tunnel mode: ${request.mode}`);
  }

  if (!capabilities || capabilities.provider !== request.provider) {
    throw new TunnelServiceError("provider_unsupported", `Unsupported tunnel provider: ${request.provider}`);
  }

  if (!Array.isArray(capabilities.modes)) {
    throw new TunnelServiceError("mode_unsupported", `Provider '${request.provider}' does not declare tunnel modes`);
  }

  const modeDescriptor = capabilities.modes.find((entry) => entry?.key === request.mode);
  if (!modeDescriptor) {
    throw new TunnelServiceError(
      "mode_unsupported",
      `Provider '${request.provider}' does not support mode '${request.mode}'`,
    );
  }

  if (typeof request.intent === "string" && request.intent.length > 0) {
    if (!SUPPORTED_TUNNEL_INTENTS.has(request.intent)) {
      throw new TunnelServiceError("validation_error", `Unsupported tunnel intent: ${request.intent}`);
    }
    if (modeDescriptor.intent !== request.intent) {
      throw new TunnelServiceError(
        "validation_error",
        `Tunnel intent '${request.intent}' does not match mode '${request.mode}' (expected '${modeDescriptor.intent}')`,
      );
    }
  }

  const requiredFields = Array.isArray(modeDescriptor.requires) ? modeDescriptor.requires : [];

  if (requiredFields.includes("token")) {
    if (!request.token) {
      throw new TunnelServiceError("validation_error", "Managed remote tunnel token is required");
    }
  }

  if (requiredFields.includes("hostname")) {
    if (!request.hostname) {
      throw new TunnelServiceError("validation_error", "Managed remote tunnel hostname is required");
    }
  }

  if (requiredFields.includes("configPath")) {
    if (request.configPath === undefined || request.configPath === null || request.configPath === "") {
      throw new TunnelServiceError("validation_error", `Mode '${request.mode}' requires a configPath`);
    }
  }
}
