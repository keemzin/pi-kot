import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function readEnv(key: string): string | undefined {
  const v = process.env[key];
  return v === undefined || v === "" ? undefined : v;
}

function readInt(key: string, fallback: number): number {
  const v = readEnv(key);
  if (v === undefined) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0 || String(n) !== v.trim()) {
    throw new Error(`config: ${key} must be a non-negative integer (got ${v})`);
  }
  return n;
}

function readBool(key: string, fallback: boolean): boolean {
  const v = readEnv(key)?.toLowerCase();
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v);
}

const HOME = homedir();
if (HOME === "/" || HOME === "") {
  throw new Error(
    "config: os.homedir() returned empty path. " +
      "Set HOME / USERPROFILE to a real user account.",
  );
}

const WORKSPACE_PATH = resolve(
  readEnv("WORKSPACE_PATH") ?? resolve(HOME, ".pi-kot", "workspace", "default"),
);
const SESSION_DIR = resolve(
  readEnv("SESSION_DIR") ?? resolve(HOME, ".pi-kot", "sessions"),
);
const FORGE_DATA_DIR = resolve(readEnv("FORGE_DATA_DIR") ?? resolve(HOME, ".pi-kot"));

/** Path to built client dist (Vite output). Resolved relative to server dist/ */
const CLIENT_DIST_PATH = resolve(
  readEnv("CLIENT_DIST_PATH") ??
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "client", "dist"),
);

export const config = Object.freeze({
  port: readInt("PORT", 3333),
  host: readEnv("HOST") ?? "0.0.0.0",
  logLevel: readEnv("LOG_LEVEL") ?? "info",
  isTest: (readEnv("NODE_ENV") ?? "") === "test",
  trustProxy: readBool("TRUST_PROXY", false),
  workspacePath: WORKSPACE_PATH,
  piConfigDir: resolve(readEnv("PI_CONFIG_DIR") ?? resolve(HOME, ".pi", "agent")),
  forgeDataDir: FORGE_DATA_DIR,
  sessionDir: SESSION_DIR,

  // Auth
  uiPassword: readEnv("UI_PASSWORD"),
  apiKey: readEnv("API_KEY"),

  // Static client (production)
  clientDistPath: CLIENT_DIST_PATH,
  serveClient: readBool("SERVE_CLIENT", true),

  // CORS
  corsOrigin: readEnv("CORS_ORIGIN") ?? true,

  // Orchestration
  orchestrationEnabled: readBool("ORCHESTRATION_ENABLED", true),
  orchestrationMaxWorkersPerSupervisor: readInt("ORCHESTRATION_MAX_WORKERS", 8),
  minimalUi: readBool("MINIMAL_UI", false),
} as const);
