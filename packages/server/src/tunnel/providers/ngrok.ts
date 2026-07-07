/**
 * Ngrok tunnel provider — spawns ngrok as a child process, parses JSON-log
 * output for the public URL, and manages the tunnel lifecycle.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  createExecutableSearchEnv,
  resolveExecutableLaunchTarget,
} from "../executable-search.js";
import { getTunnelDependencyInstallInfo } from "../install-help.js";
import {
  TUNNEL_INTENT_EPHEMERAL_PUBLIC,
  TUNNEL_MODE_QUICK,
  TUNNEL_PROVIDER_NGROK,
  TunnelServiceError,
  type TunnelProvider,
  type TunnelProviderCapabilities,
  type TunnelController,
  type TunnelAvailability,
  type TunnelStartRequest,
  type TunnelContext,
  type DoctorRequest,
  type TunnelDiagnosis,
} from "../types.js";

// ── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const NGROK_API_URL = "http://127.0.0.1:4040/api/tunnels";
const NGROK_PUBLIC_URL_REGEX = /https:\/\/[^\s"']+/i;
const NGROK_AUTHTOKEN_HELP = "Run: ngrok config add-authtoken <your-ngrok-token>";

function getNgrokInstallInfo() {
  return getTunnelDependencyInstallInfo(TUNNEL_PROVIDER_NGROK);
}

// ── Capabilities ──────────────────────────────────────────────────────────

export const ngrokTunnelProviderCapabilities: TunnelProviderCapabilities = {
  provider: TUNNEL_PROVIDER_NGROK,
  defaults: {
    mode: TUNNEL_MODE_QUICK,
    optionDefaults: {},
  },
  modes: [
    {
      key: TUNNEL_MODE_QUICK,
      label: "Quick Tunnel",
      intent: TUNNEL_INTENT_EPHEMERAL_PUBLIC,
      requires: [],
      supports: ["sessionTTL"],
      stability: "beta",
    },
  ],
};

// ── Dependency checks ─────────────────────────────────────────────────────

export async function checkNgrokAvailable(): Promise<TunnelAvailability> {
  const target = resolveExecutableLaunchTarget("ngrok");
  if (target) {
    try {
      const result = spawnSync(target.command, ["version"], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: target.env,
      });
      if (result.status === 0) {
        const version = (result.stdout || result.stderr || "").trim();
        return {
          available: true,
          path: target.command,
          version: (version || undefined) ?? null,
        };
      }
    } catch {
      // Ignore and report unavailable below.
    }
  }
  return { available: false, path: null, version: null };
}

export async function checkNgrokAuthtokenConfigured(
  ngrokPath: string | null = null,
): Promise<{ configured: boolean; detail: string }> {
  const authTokenEnv = process.env.NGROK_AUTHTOKEN;
  if (typeof authTokenEnv === "string" && authTokenEnv.trim().length > 0) {
    return { configured: true, detail: "NGROK_AUTHTOKEN is set." };
  }

  const target = ngrokPath
    ? { command: ngrokPath, env: createExecutableSearchEnv() }
    : resolveExecutableLaunchTarget("ngrok");
  if (!target) {
    return { configured: false, detail: getNgrokInstallInfo().message };
  }

  try {
    const result = spawnSync(target.command, ["config", "check"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: target.env,
    });
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    if (result.status === 0) {
      return { configured: true, detail: output || "ngrok config is valid." };
    }
    return { configured: false, detail: output || NGROK_AUTHTOKEN_HELP };
  } catch (error: unknown) {
    return {
      configured: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkNgrokApiReachability(
  options: { fetchImpl?: typeof globalThis.fetch; timeoutMs?: number } = {},
): Promise<{ reachable: boolean; status: number | null; error: string | null }> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 5000;

  if (typeof fetchImpl !== "function") {
    return { reachable: false, status: null, error: "Fetch API is unavailable in this runtime." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl("https://api.ngrok.com/", {
      method: "GET",
      signal: controller.signal,
    });
    return { reachable: true, status: response.status, error: null };
  } catch (error: unknown) {
    return {
      reachable: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ── URL extraction ────────────────────────────────────────────────────────

function normalizeNgrokPublicUrl(value: string): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" && parsed.hostname.includes("ngrok")) {
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {
    return null;
  }
  return null;
}

export function extractNgrokPublicUrlFromText(text: string): string | null {
  if (typeof text !== "string" || text.trim().length === 0) {
    return null;
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    // Try JSON parse (ngrok --log-format=json)
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const parsedUrl =
        normalizeNgrokPublicUrl(parsed?.url as string) ??
        normalizeNgrokPublicUrl(parsed?.public_url as string);
      if (parsedUrl) {
        return parsedUrl;
      }
    } catch {
      // ngrok may emit non-JSON diagnostics even when log-format=json.
    }

    // Fallback: regex scan
    const match = line.match(NGROK_PUBLIC_URL_REGEX);
    const matchedUrl = normalizeNgrokPublicUrl(match?.[0] ?? "");
    if (matchedUrl) {
      return matchedUrl;
    }
  }

  return null;
}

// ── Output summarization ──────────────────────────────────────────────────

function normalizeNgrokDiagnosticText(value: string): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function summarizeNgrokOutput(lines: string[]): string {
  const nonEmptyLines = Array.isArray(lines)
    ? lines.map((line) => String(line || "").trim()).filter(Boolean)
    : [];
  if (nonEmptyLines.length === 0) {
    return "";
  }

  // Scan for error-level JSON lines first
  for (const line of [...nonEmptyLines].reverse()) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const level = typeof parsed?.lvl === "string" ? parsed.lvl.toLowerCase() : "";
      if (level !== "eror" && level !== "error" && level !== "crit") {
        continue;
      }
      const err = normalizeNgrokDiagnosticText(parsed?.err as string);
      if (err && err !== "<nil>") {
        return err;
      }
    } catch {
      // Not a JSON ngrok log line.
    }
  }

  // Scan for any JSON line with a meaningful error
  for (const line of [...nonEmptyLines].reverse()) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const err = normalizeNgrokDiagnosticText(parsed?.err as string);
      if (err && err !== "<nil>" && !/context canceled/i.test(err)) {
        return err;
      }
      const msg = normalizeNgrokDiagnosticText(parsed?.msg as string);
      if (msg && /failed|error|invalid|auth/i.test(msg)) {
        return msg;
      }
    } catch {
      // Not a JSON ngrok log line.
    }
  }

  // Fallback: scan for ERROR: prefix lines
  const errorLines = nonEmptyLines
    .filter((line) => /^ERROR:/i.test(line))
    .map((line) => normalizeNgrokDiagnosticText(line.replace(/^ERROR:\s*/i, "")))
    .filter(Boolean);
  if (errorLines.length > 0) {
    return errorLines.slice(0, 4).join(" ");
  }

  // Last resort: return the last non-empty line
  const lastLine = [...nonEmptyLines].reverse().find((line) => line.trim().length > 0);
  if (!lastLine) {
    return "";
  }
  try {
    const parsed = JSON.parse(lastLine) as Record<string, unknown>;
    if (typeof parsed?.err === "string" && parsed.err.trim().length > 0) {
      return normalizeNgrokDiagnosticText(parsed.err);
    }
    if (typeof parsed?.msg === "string" && parsed.msg.trim().length > 0) {
      return normalizeNgrokDiagnosticText(parsed.msg);
    }
  } catch {
    // Fall through to plain text.
  }
  return normalizeNgrokDiagnosticText(lastLine);
}

function appendNgrokOutputSummary(message: string, lines: string[]): string {
  const summary = summarizeNgrokOutput(lines);
  return summary ? `${message}: ${summary}` : message;
}

// ── API-based URL fetch ───────────────────────────────────────────────────

async function fetchNgrokPublicUrl(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<string | null> {
  if (typeof fetchImpl !== "function") {
    return null;
  }
  try {
    const response = await fetchImpl(NGROK_API_URL, { method: "GET" });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { tunnels?: Array<{ proto?: string; public_url?: string }> };
    const tunnels = Array.isArray(payload?.tunnels) ? payload.tunnels : [];
    const httpsTunnel = tunnels.find(
      (entry) => entry?.proto === "https" && normalizeNgrokPublicUrl(entry?.public_url ?? ""),
    );
    const fallbackTunnel = tunnels.find(
      (entry) => normalizeNgrokPublicUrl(entry?.public_url ?? ""),
    );
    return (
      normalizeNgrokPublicUrl(httpsTunnel?.public_url ?? "") ??
      normalizeNgrokPublicUrl(fallbackTunnel?.public_url ?? "")
    );
  } catch {
    return null;
  }
}

// ── Tunnel starter ────────────────────────────────────────────────────────

function spawnNgrok(
  args: string[],
  resolvedBinaryPath: string = "ngrok",
): ChildProcess {
  return spawn(resolvedBinaryPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: createExecutableSearchEnv(),
    killSignal: "SIGINT",
  });
}

export interface NgrokController extends TunnelController {
  process: ChildProcess;
}

export async function startNgrokQuickTunnel(
  params: { port: number },
): Promise<NgrokController> {
  const ngrokCheck = await checkNgrokAvailable();
  if (!ngrokCheck.available) {
    throw new Error(getNgrokInstallInfo().message);
  }

  const authtokenCheck = await checkNgrokAuthtokenConfigured(ngrokCheck.path);
  if (!authtokenCheck.configured) {
    throw new Error(`ngrok authtoken is not configured. ${authtokenCheck.detail || NGROK_AUTHTOKEN_HELP}`);
  }

  if (!Number.isFinite(params.port)) {
    throw new Error("A local port is required to start an ngrok tunnel");
  }

  const child = spawnNgrok(
    ["http", "--log=stdout", "--log-format=json", `127.0.0.1:${params.port}`],
    ngrokCheck.path ?? undefined,
  );
  let publicUrl: string | null = null;
  const recentOutput: string[] = [];

  const captureOutput = (chunk: Buffer): string => {
    const text = chunk.toString("utf8");
    const parsedUrl = extractNgrokPublicUrlFromText(text);
    if (parsedUrl) {
      publicUrl = parsedUrl;
    }

    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      recentOutput.push(trimmed);
      if (recentOutput.length > 200) {
        recentOutput.shift();
      }
    }
    return text;
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    captureOutput(chunk);
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = captureOutput(chunk);
    process.stderr.write(text);
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (handler: (value: void) => void, value: void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(checkReady);
      child.off("error", onError);
      child.off("exit", onExit);
      handler(value);
    };

    const timeout = setTimeout(() => {
      try { child.kill("SIGINT"); } catch { /* ignore */ }
      finish(
        reject,
        new Error(
          appendNgrokOutputSummary(
            "Ngrok tunnel URL not received within 30 seconds",
            recentOutput,
          ),
        ) as unknown as void,
      );
    }, DEFAULT_STARTUP_TIMEOUT_MS);

    const checkReady = setInterval(async () => {
      publicUrl = publicUrl || (await fetchNgrokPublicUrl());
      if (publicUrl) {
        finish(resolve, undefined);
      }
    }, 250);

    const onError = (error: Error): void => {
      finish(reject, new Error(`Ngrok failed to start: ${error.message}`) as unknown as void);
    };

    const onExit = (code: number | null): void => {
      finish(
        reject,
        new Error(
          appendNgrokOutputSummary(
            `Ngrok exited while starting (code ${code ?? "unknown"})`,
            recentOutput,
          ),
        ) as unknown as void,
      );
    };

    child.once("error", onError);
    child.once("exit", onExit);
  });

  return {
    mode: TUNNEL_MODE_QUICK,
    provider: TUNNEL_PROVIDER_NGROK,
    process: child,
    stop: () => {
      try {
        child.kill("SIGINT");
      } catch {
        // Ignore.
      }
    },
    getPublicUrl: () => publicUrl,
  };
}

// ── Standalone diagnose (used by routes without creating a provider instance) ──

export async function diagnoseNgrok(): Promise<TunnelDiagnosis> {
  const dependency = await checkNgrokAvailable();
  const authtoken = await checkNgrokAuthtokenConfigured(dependency.path);
  const network = await checkNgrokApiReachability();
  const installInfo = getTunnelDependencyInstallInfo(TUNNEL_PROVIDER_NGROK);
  const startupReady = dependency.available && authtoken.configured && network.reachable;

  const providerChecks = [
    {
      id: "dependency",
      label: "ngrok installed",
      status: dependency.available ? ("pass" as const) : ("fail" as const),
      detail: dependency.available
        ? (dependency.version || dependency.path || "ngrok available")
        : installInfo.message,
    },
    {
      id: "authtoken",
      label: "ngrok authtoken configured",
      status: authtoken.configured ? ("pass" as const) : ("fail" as const),
      detail: authtoken.configured
        ? authtoken.detail
        : (authtoken.detail || "Run: ngrok config add-authtoken <your-ngrok-token>"),
    },
    {
      id: "network",
      label: "ngrok API reachable",
      status: network.reachable ? ("pass" as const) : ("fail" as const),
      detail: network.reachable
        ? (network.status ? `HTTP ${network.status}` : "Reachable")
        : (network.error || "Could not reach api.ngrok.com"),
    },
  ];

  return {
    providerChecks,
    modes: [
      {
        mode: TUNNEL_MODE_QUICK,
        checks: [
          {
            id: "startup_readiness",
            label: "Provider startup readiness",
            status: startupReady ? ("pass" as const) : ("fail" as const),
            detail: startupReady
              ? "Provider dependency, auth, and network checks passed."
              : "Resolve provider checks before starting tunnels.",
          },
        ],
        summary: {
          ready: startupReady,
          failures: startupReady ? 0 : 1,
          warnings: 0,
        },
        ready: startupReady,
        blockers: startupReady ? [] : ["Resolve provider checks before starting tunnels."],
      },
    ],
  };
}

// ── Provider factory ──────────────────────────────────────────────────────

export function createNgrokTunnelProvider(): TunnelProvider {
  return {
    id: TUNNEL_PROVIDER_NGROK,
    capabilities: ngrokTunnelProviderCapabilities,
    checkAvailability: async () => {
      const result = await checkNgrokAvailable();
      if (result.available) {
        return {
          ...result,
          ...getTunnelDependencyInstallInfo(TUNNEL_PROVIDER_NGROK),
        };
      }
      const installInfo = getTunnelDependencyInstallInfo(TUNNEL_PROVIDER_NGROK);
      return {
        ...result,
        ...installInfo,
      };
    },
    diagnose: async (_request?: DoctorRequest): Promise<TunnelDiagnosis> => {
      return diagnoseNgrok();
    },
    start: async (request: TunnelStartRequest, context: TunnelContext): Promise<TunnelController> => {
      if (request.mode !== TUNNEL_MODE_QUICK) {
        throw new TunnelServiceError(
          "mode_unsupported",
          `Ngrok only supports '${TUNNEL_MODE_QUICK}' mode right now`,
        );
      }
      return startNgrokQuickTunnel({ port: context.activePort ?? 0 });
    },
    stop: (controller: TunnelController): void => {
      controller?.stop?.();
    },
    resolvePublicUrl: (controller: TunnelController): string | null =>
      controller?.getPublicUrl?.() ?? null,
    getMetadata: (): Record<string, unknown> | null => null,
  };
}
