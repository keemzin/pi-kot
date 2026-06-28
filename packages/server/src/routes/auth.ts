import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";

/**
 * Minimal JWT-like token for auth. Uses HMAC-SHA256 with a server-generated
 * secret (rotated on restart since sessions are ephemeral).
 *
 * Simplified auth — Phase 1a uses a basic API key or
 * JWT pattern. In production, this uses proper jsonwebtoken + scrypt.
 */
const TOKEN_SECRET = randomBytes(32).toString("hex");

function signHmac(payload: string): string {
  const hmac = createHash("sha256")
    .update(payload + TOKEN_SECRET)
    .digest("hex");
  return `${Buffer.from(payload).toString("base64url")}.${hmac}`;
}

export function verifyHmac(token: string): string | undefined {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return undefined;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  const expected = createHash("sha256")
    .update(payload + TOKEN_SECRET)
    .digest("hex");
  if (sig.length !== expected.length) return undefined;
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return undefined;
  } catch {
    return undefined;
  }
  return payload;
}

export function extractBearer(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export function authEnabled(): boolean {
  return config.uiPassword !== undefined || config.apiKey !== undefined;
}

/**
 * Read the installed SDK version from its package.json at runtime.
 */
function readSdkVersion(): string {
  try {
    const pkgPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "..",
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "package.json",
    );
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Read the server package version.
 */
function readServerVersion(): string {
  try {
    const pkgPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "package.json",
    );
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const INSTALLED_SDK = readSdkVersion();
const SERVER_VERSION = readServerVersion();

export const versionRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/version — public
  fastify.get(
    "/version",
    {
      config: { public: true },
      schema: {
        description: "Version info — no auth required.",
        tags: ["version"],
        security: [],
        response: {
          200: {
            type: "object",
            required: ["serverVersion", "sdkVersion"],
            properties: {
              serverVersion: { type: "string" },
              sdkVersion: { type: "string" },
            },
          },
        },
      },
    },
    async () => ({
      serverVersion: SERVER_VERSION,
      sdkVersion: INSTALLED_SDK,
    }),
  );

  // GET /api/v1/version/check-update — public, checks npm for latest SDK
  fastify.get(
    "/version/check-update",
    {
      config: { public: true },
      schema: {
        description: "Check npm for the latest pi-coding-agent version.",
        tags: ["version"],
        security: [],
        response: {
          200: {
            type: "object",
            required: ["serverVersion", "sdkVersion", "latestSdkVersion", "updateAvailable"],
            properties: {
              serverVersion: { type: "string" },
              sdkVersion: { type: "string" },
              latestSdkVersion: { type: "string" },
              updateAvailable: { type: "boolean" },
            },
          },
        },
      },
    },
    async () => {
      let latest = INSTALLED_SDK;
      let updateAvailable = false;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(
          "https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest",
          { signal: controller.signal },
        );
        clearTimeout(timeout);
        if (res.ok) {
          const data = (await res.json()) as { version: string };
          latest = data.version ?? latest;
          updateAvailable = latest !== INSTALLED_SDK;
        }
      } catch {
        // npm check failed — just return current versions
      }
      return {
        serverVersion: SERVER_VERSION,
        sdkVersion: INSTALLED_SDK,
        latestSdkVersion: latest,
        updateAvailable,
      };
    },
  );
};

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/health — public, no auth
  fastify.get(
    "/health",
    {
      config: { public: true },
      schema: {
        description: "Health check — no auth required.",
        tags: ["health"],
        security: [],
        response: {
          200: {
            type: "object",
            required: ["status"],
            properties: {
              status: { type: "string", enum: ["ok"] },
              activeSessions: { type: "integer", minimum: 0 },
            },
          },
        },
      },
    },
    async () => {
      const { sessionCount } = await import("../session-registry.js");
      return { status: "ok" as const, activeSessions: sessionCount() };
    },
  );
};

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/auth/status — public
  fastify.get(
    "/auth/status",
    {
      config: { public: true },
      schema: {
        description: "Whether auth is enabled.",
        tags: ["auth"],
        security: [],
        response: {
          200: {
            type: "object",
            required: ["authEnabled"],
            properties: { authEnabled: { type: "boolean" } },
          },
        },
      },
    },
    async () => ({ authEnabled: authEnabled() }),
  );

  // POST /api/v1/auth/login — public (rate-limited)
  fastify.post(
    "/auth/login",
    {
      config: { public: true },
      schema: {
        description: "Login with password → JWT token.",
        tags: ["auth"],
        security: [],
        body: {
          type: "object",
          required: ["password"],
          properties: { password: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["token"],
            properties: { token: { type: "string" } },
          },
          401: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authEnabled()) {
        return reply.code(401).send({ error: "auth_not_configured" });
      }
      const { password } = req.body as { password: string };
      const valid =
        (config.uiPassword !== undefined && password === config.uiPassword) ||
        (config.apiKey !== undefined && password === config.apiKey);
      if (!valid) {
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      const token = signHmac(`user:${Date.now()}`);
      return { token };
    },
  );
};
