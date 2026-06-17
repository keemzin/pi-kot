import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import { authEnabled, extractBearer, verifyHmac } from "./routes/auth.js";
import { healthRoutes, authRoutes } from "./routes/auth.js";
import { askUserQuestionRoutes } from "./routes/ask-user-question.js";
import { sessionRoutes } from "./routes/sessions.js";
import { promptRoutes } from "./routes/prompt.js";
import { streamRoutes } from "./routes/stream.js";
import { configRoutes } from "./routes/config.js";
import { controlRoutes } from "./routes/control.js";
import { projectRoutes } from "./routes/projects.js";
import { fileRoutes } from "./routes/files.js";
import { disposeAllSessions, getSession } from "./session-registry.js";
import { subscribe as subscribeAskUserQuestion } from "./ask-user-question/registry.js";
import { initOrchestrationAskUserQuestionBridge } from "./orchestration/init.js";
import { orchestrationRoutes } from "./routes/orchestration.js";
import { extensionRoutes } from "./routes/extensions.js";
import { extensionCommandRoutes } from "./routes/extension-commands.js";

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
      await api.register(askUserQuestionRoutes);
      await api.register(promptRoutes);
      await api.register(streamRoutes);
      await api.register(configRoutes);
      await api.register(controlRoutes);
      await api.register(fileRoutes);
      await api.register(projectRoutes);
      await api.register(extensionRoutes);
      await api.register(extensionCommandRoutes);
      await api.register(orchestrationRoutes);
    },
    { prefix: "/api/v1" },
  );

  // Wire ask_user_question registry events into SSE fanout
  subscribeAskUserQuestion((event) => {
    const live = getSession(event.sessionId);
    if (live === undefined) return;
    for (const client of live.clients) {
      try {
        client.send(event as unknown as { type: string; [k: string]: unknown });
      } catch {
        live.clients.delete(client);
      }
    }
  });

  // Wire orchestration ask-user-question bridge
  initOrchestrationAskUserQuestionBridge();

  // ---- static client (production) ----
  // After `npm run build`, Fastify serves the Vite build directly.
  // In dev mode, Vite owns :5173 and proxies to us.
  if (config.serveClient && existsSync(config.clientDistPath)) {
    await fastify.register(fastifyStatic, {
      root: config.clientDistPath,
      wildcard: false,
    });
    // SPA fallback: non-/api/* GETs → index.html
    fastify.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) {
        return reply.status(404).send({ error: "not_found" });
      }
      return reply.sendFile("index.html");
    });
  }

  // Clean teardown on close
  fastify.addHook("onClose", async () => {
    await disposeAllSessions();
  });

  return fastify;
}

export async function start(): Promise<void> {
  const fastify = await buildServer();

  // Auto-create default project if none exist
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(config.workspacePath, { recursive: true });

    const { listProjects, createProject } = await import("./project-manager.js");
    const projects = await listProjects();
    if (projects.length === 0) {
      const project = await createProject("Default", config.workspacePath);
      fastify.log.info("auto-created default project");

      // Migrate old sessions from "default" literal dir to project UUID
      const { rename, stat } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const oldDir = join(config.sessionDir, "default");
      const newDir = join(config.sessionDir, project.id);
      try {
        await stat(oldDir);
        if (oldDir !== newDir) {
          await rename(oldDir, newDir).catch(() => {});
          fastify.log.info("migrated sessions from default/ to project UUID");
        }
      } catch {
        // oldDir doesn't exist, nothing to migrate
      }
    }
  } catch (err) {
    fastify.log.warn({ err }, "failed to auto-create default project");
  }

  try {
    await fastify.listen({ port: config.port, host: config.host });
    fastify.log.info(`pi-kot server listening on :${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Start when run directly (not when imported by the bin shim or tests)
import { fileURLToPath } from "node:url";
const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url).replace(/\\/g, "/").endsWith(
    process.argv[1].replace(/\\/g, "/"),
  );
if (isMainModule) {
  void start();
}
