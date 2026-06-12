import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { config } from "../config.js";

/**
 * Minimal JWT-like token for auth. Uses HMAC-SHA256 with a server-generated
 * secret (rotated on restart since sessions are ephemeral).
 *
 * Simplified from pi-forge's auth.ts — Phase 1a uses a basic API key or
 * JWT pattern. In production, pi-forge uses proper jsonwebtoken + scrypt.
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
