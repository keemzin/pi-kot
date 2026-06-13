import { homedir } from "node:os";
import { join, resolve } from "node:path";

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
  readEnv("WORKSPACE_PATH") ?? resolve(process.cwd(), "WORKING"),
);
const SESSION_DIR = resolve(
  readEnv("SESSION_DIR") ?? resolve(HOME, ".pi-kot", "sessions"),
);
const FORGE_DATA_DIR = resolve(readEnv("FORGE_DATA_DIR") ?? resolve(HOME, ".pi-kot"));

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

  // CORS
  corsOrigin: readEnv("CORS_ORIGIN") ?? true,
} as const);
