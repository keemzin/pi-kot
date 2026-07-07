/**
 * Tunnel REST routes — all under GET/POST /api/v1/tunnel/*
 *
 * Wires the ngrok tunnel service into Fastify. The tunnel service is a
 * singleton (one active tunnel at a time) constructed lazily on first request.
 */

import type { FastifyPluginAsync } from "fastify";
import { createTunnelProviderRegistry } from "../tunnel/registry.js";
import { createTunnelService } from "../tunnel/service.js";
import { createNgrokTunnelProvider } from "../tunnel/providers/ngrok.js";
import {
  normalizeTunnelProvider,
  TunnelServiceError,
  TUNNEL_PROVIDER_NGROK,
  type TunnelController,
  type TunnelStartResult,
} from "../tunnel/types.js";
import { config } from "../config.js";

/**
 * Tunnel routes. The tunnel service is a server-wide singleton
 * created on first request to /api/v1/tunnel/*.
 */
export const tunnelRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Singleton state ─────────────────────────────────────────────────────

  let activeController: TunnelController | null = null;
  let serviceInitialized = false;
  let tunnelServiceInstance: ReturnType<typeof createTunnelService>;

  function getTunnelService() {
    if (!serviceInitialized) {
      const registry = createTunnelProviderRegistry([
        createNgrokTunnelProvider(),
      ]);
      registry.seal();

      tunnelServiceInstance = createTunnelService({
        registry,
        getController: () => activeController,
        setController: (c) => { activeController = c; },
        getActivePort: () => config.port,
        onQuickTunnelWarning: () => {
          fastify.log.warn("ngrok quick tunnel started — URL is ephemeral");
        },
      });
      serviceInitialized = true;
    }
    return tunnelServiceInstance;
  }

  // ── Routes ──────────────────────────────────────────────────────────────

  /**
   * GET /tunnel/check — Check if ngrok is installed.
   */
  fastify.get(
    "/tunnel/check",
    {
      schema: {
        description: "Check if ngrok is installed",
        tags: ["tunnel"],
        response: {
          200: {
            type: "object",
            properties: {
              available: { type: "boolean" },
              provider: { type: "string" },
              version: { type: "string", nullable: true },
              dependency: { type: "string", nullable: true },
              installCommand: { type: "string", nullable: true },
              installUrl: { type: "string", nullable: true },
              platform: { type: "string" },
              message: { type: "string", nullable: true },
            },
          },
        },
      },
    },
    async () => {
      try {
        const service = getTunnelService();
        const result = await service.checkAvailability(TUNNEL_PROVIDER_NGROK);
        return {
          available: result.available,
          provider: TUNNEL_PROVIDER_NGROK,
          version: result.version || null,
          dependency: result.dependency || null,
          installCommand: result.installCommand || null,
          installUrl: result.installUrl || null,
          platform: result.platform || process.platform,
          message: result.message || null,
        };
      } catch (error) {
        fastify.log.warn({ error }, "Tunnel dependency check failed");
        return {
          available: false,
          provider: TUNNEL_PROVIDER_NGROK,
          version: null,
          dependency: null,
          installCommand: null,
          installUrl: null,
          platform: process.platform,
          message: null,
        };
      }
    },
  );

  /**
   * GET /tunnel/doctor — Run ngrok diagnostics.
   */
  fastify.get(
    "/tunnel/doctor",
    {
      schema: {
        description: "Run ngrok diagnostics (binary, authtoken, network)",
        tags: ["tunnel"],
      },
    },
    async (req, reply) => {
      try {
        const providerId = TUNNEL_PROVIDER_NGROK;

        // Import and run ngrok's diagnose directly
        const { diagnoseNgrok } = await import("../tunnel/providers/ngrok.js");

        const result = await diagnoseNgrok();

        return { ok: true, provider: providerId, ...result };
      } catch (error) {
        if (error instanceof TunnelServiceError) {
          return reply.status(400).send({ ok: false, error: error.message, code: error.code });
        }
        fastify.log.warn({ error }, "Tunnel doctor failed");
        return reply.status(500).send({ ok: false, error: "Failed to run tunnel doctor" });
      }
    },
  );

  /**
   * GET /tunnel/status — Get the current tunnel state.
   */
  fastify.get(
    "/tunnel/status",
    {
      schema: {
        description: "Get current tunnel status",
        tags: ["tunnel"],
        response: {
          200: {
            type: "object",
            properties: {
              active: { type: "boolean" },
              url: { type: "string", nullable: true },
              mode: { type: "string", nullable: true },
              provider: { type: "string", nullable: true },
              providerMetadata: { type: "object", nullable: true },
              localPort: { type: "number", nullable: true },
            },
          },
        },
      },
    },
    async () => {
      const service = getTunnelService();
      const publicUrl = service.getPublicUrl();

      if (!publicUrl) {
        return {
          active: false,
          url: null,
          mode: null,
          provider: service.resolveActiveProvider(),
          providerMetadata: null,
          localPort: config.port,
        };
      }

      return {
        active: true,
        url: publicUrl,
        mode: service.resolveActiveMode(),
        provider: service.resolveActiveProvider(),
        providerMetadata: service.getProviderMetadata(),
        localPort: config.port,
      };
    },
  );

  /**
   * POST /tunnel/start — Start an ngrok tunnel.
   * Body: { mode?: "quick" } (only quick mode supported)
   */
  fastify.post(
    "/tunnel/start",
    {
      schema: {
        description: "Start an ngrok tunnel",
        tags: ["tunnel"],
        body: {
          type: "object",
          properties: {
            mode: { type: "string", default: "quick" },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const service = getTunnelService();

        const result: TunnelStartResult = await service.start({
          provider: TUNNEL_PROVIDER_NGROK,
          mode: "quick",
        });

        fastify.log.info(`ngrok tunnel active: ${result.publicUrl}`);

        return {
          ok: true,
          url: result.publicUrl,
          mode: result.activeMode,
          provider: result.provider,
          providerMetadata: result.providerMetadata,
          localPort: config.port,
        };
      } catch (error) {
        fastify.log.error({ error }, "Failed to start ngrok tunnel");
        activeController = null;

        if (error instanceof TunnelServiceError) {
          const status =
            error.code === "missing_dependency" ? 400
              : error.code === "validation_error" || error.code === "provider_unsupported" || error.code === "mode_unsupported" ? 422
              : 500;
          return reply.status(status).send({
            ok: false,
            error: error.message,
            code: error.code,
          });
        }

        return reply.status(500).send({
          ok: false,
          error: error instanceof Error ? error.message : "Failed to start tunnel",
          code: "startup_failed",
        });
      }
    },
  );

  /**
   * POST /tunnel/stop — Stop the active ngrok tunnel.
   */
  fastify.post(
    "/tunnel/stop",
    {
      schema: {
        description: "Stop the active ngrok tunnel",
        tags: ["tunnel"],
      },
    },
    async () => {
      const service = getTunnelService();
      const wasActive = service.getPublicUrl() !== null;

      if (wasActive) {
        fastify.log.info("Stopping active ngrok tunnel...");
        service.stop();
      }

      return { ok: true, wasActive };
    },
  );
};
