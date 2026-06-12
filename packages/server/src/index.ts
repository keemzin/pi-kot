import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { config } from "./config.js";
import { authEnabled, extractBearer, verifyHmac } from "./routes/auth.js";
import { healthRoutes, authRoutes } from "./routes/auth.js";
import { sessionRoutes } from "./routes/sessions.js";
import { promptRoutes } from "./routes/prompt.js";
import { streamRoutes } from "./routes/stream.js";
import { configRoutes } from "./routes/config.js";
import { controlRoutes } from "./routes/control.js";
import { disposeAllSessions } from "./session-registry.js";

/**
 * Per-route auth metadata. Routes that should skip the auth preHandler
 * set `config.public: true` via Fastify route config.
 * Adapted from pi-forge's packages/server/src/index.ts.
 */
declare module "fastify" {
  interface FastifyContextConfig {
    public?: boolean;
  }
}

/**
 * Build the Fastify server with all routes registered.
 * Architecture adapted from pi-forge:
 *   - Fastify HTTP server with CORS
 *   - Auth gate via onRequest hook (public routes opt out)
 *   - All routes under /api/v1/
 *   - Clean teardown on close
 */
export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
      serializers: {
        req(req: FastifyRequest) {
          return {
            method: req.method,
            url: req.url,
            hostname: req.hostname,
            remoteAddress: req.ip,
          };
        },
      },
    },
    disableRequestLogging: config.isTest,
    trustProxy: config.trustProxy,
  });

  // CORS — default to true (reflect request origin) for dev convenience
  await fastify.register(cors, {
    origin: config.corsOrigin,
    credentials: false,
  });

  // OpenAPI / Swagger
  await fastify.register(swagger, {
    openapi: {
      info: { title: "pi-kot API", version: "0.1.0" },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: "/api/docs",
    uiConfig: { docExpansion: "list", persistAuthorization: true },
  });

  // Auth gate — applies to all /api/v1/* routes not marked public
  fastify.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0] ?? req.url;

    // /api/docs is open when auth is disabled (dev default)
    if (path === "/api/docs" || path.startsWith("/api/docs/")) {
      return;
    }

    if (!path.startsWith("/api/v1/")) return;

    const routeConfig = req.routeOptions?.config;
    if (routeConfig?.public === true) return;
    if (!authEnabled()) return;

    const presented = extractBearer(req.headers.authorization);
    if (presented === undefined) {
      return reply.code(401).send({ error: "missing_token" });
    }

    const payload = verifyHmac(presented);
    if (payload !== undefined) return;

    // Fallback: check API key
    if (config.apiKey !== undefined && presented === config.apiKey) return;

    return reply.code(401).send({ error: "invalid_token" });
  });

  // Register all API routes under /api/v1
  await fastify.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes);
      await api.register(sessionRoutes);
      await api.register(promptRoutes);
      await api.register(streamRoutes);
      await api.register(configRoutes);
      await api.register(controlRoutes);
    },
    { prefix: "/api/v1" },
  );

  // Clean teardown on close
  fastify.addHook("onClose", async () => {
    await disposeAllSessions();
  });

  return fastify;
}

export async function start(): Promise<void> {
  const fastify = await buildServer();
  try {
    await fastify.listen({ port: config.port, host: config.host });
    fastify.log.info(`pi-kot server listening on :${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Start when run directly
const isMainModule = process.argv[1] !== undefined;
if (isMainModule) {
  void start();
}
