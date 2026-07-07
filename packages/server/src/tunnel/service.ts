/**
 * Tunnel service — orchestrates tunnel provider lifecycle with a start mutex
 * to prevent concurrent starts from orphaning child processes.
 */

import {
  TUNNEL_MODE_QUICK,
  TunnelServiceError,
  normalizeTunnelStartRequest,
  validateTunnelStartRequest,
  type NormalizedTunnelStartRequest,
  type TunnelProviderRegistry,
  type TunnelService,
  type TunnelServiceDeps,
  type TunnelStartResult,
  type TunnelController,
  type TunnelAvailability,
} from "./types.js";
import { getTunnelDependencyInstallInfo } from "./install-help.js";

/**
 * Create the tunnel service.
 *
 * @param deps - Service dependencies (registry, controller accessors, port, warning callback).
 * @returns A TunnelService with start, stop, checkAvailability, getPublicUrl, etc.
 */
export function createTunnelService(deps: TunnelServiceDeps): TunnelService {
  const {
    registry,
    getController,
    setController,
    getActivePort,
    onQuickTunnelWarning,
  } = deps;

  if (!registry) {
    throw new Error("Tunnel service requires a provider registry");
  }

  const resolveActiveMode = (): string | null => {
    const controller = getController();
    if (!controller || typeof controller.mode !== "string") {
      return null;
    }
    return controller.mode;
  };

  const resolveActiveProvider = (): string | null => {
    const controller = getController();
    if (!controller || typeof controller.provider !== "string") {
      return null;
    }
    return controller.provider;
  };

  const stop = (): boolean => {
    const controller = getController();
    if (!controller) {
      return false;
    }

    const providerId = typeof controller.provider === "string" ? controller.provider : "";
    const provider = providerId ? registry.get(providerId) : null;
    if (provider?.stop) {
      provider.stop(controller);
    } else {
      controller.stop?.();
    }
    setController(null);
    return true;
  };

  const checkAvailability = async (providerId: string): Promise<TunnelAvailability> => {
    const provider = registry.get(providerId);
    if (!provider) {
      throw new TunnelServiceError(
        "provider_unsupported",
        `Unsupported tunnel provider: ${providerId}`,
      );
    }
    const result = await provider.checkAvailability();
    return result;
  };

  // Mutex to prevent concurrent tunnel starts from orphaning child processes.
  let startLock: Promise<void> = Promise.resolve();

  const start = async (
    rawRequest: Partial<NormalizedTunnelStartRequest>,
    options: Record<string, unknown> = {},
  ): Promise<TunnelStartResult> => {
    let releaseLock: (() => void) | undefined;
    const lockPromise = new Promise<void>((resolve) => { releaseLock = resolve; });
    const previousLock = startLock;
    startLock = lockPromise;

    await previousLock;

    try {
      const request = normalizeTunnelStartRequest(
        rawRequest as Record<string, unknown>,
      );
      const provider = registry.get(request.provider);

      if (!provider) {
        throw new TunnelServiceError(
          "provider_unsupported",
          `Unsupported tunnel provider: ${request.provider}`,
        );
      }

      validateTunnelStartRequest(request, provider.capabilities);

      let publicUrl = getController() ? provider.resolvePublicUrl(getController()!) : null;
      const activeMode = resolveActiveMode();
      const activeProvider = resolveActiveProvider();

      if (publicUrl && (activeMode !== request.mode || activeProvider !== request.provider)) {
        stop();
        publicUrl = null;
      }

      if (!publicUrl) {
        const availability = await provider.checkAvailability();
        if (!availability?.available) {
          const missingDependencyMessage =
            typeof availability?.message === "string" && availability.message.trim().length > 0
              ? availability.message
              : `Required dependency for provider '${request.provider}' is missing`;
          throw new TunnelServiceError("missing_dependency", missingDependencyMessage);
        }

        const activePort = Number.isFinite(getActivePort?.()) ? getActivePort() : null;
        const originUrl = activePort !== null ? `http://127.0.0.1:${activePort}` : undefined;

        let controller: TunnelController;
        try {
          controller = await provider.start(request, {
            activePort,
            originUrl,
            ...options,
          });
        } catch (error: unknown) {
          if (error instanceof TunnelServiceError) {
            throw error;
          }
          const message =
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : "Failed to start tunnel";
          throw new TunnelServiceError("startup_failed", message);
        }
        controller.provider = request.provider;
        setController(controller);

        publicUrl = provider.resolvePublicUrl(controller);
        if (!publicUrl) {
          stop();
          throw new TunnelServiceError(
            "startup_failed",
            "Tunnel started but no public URL was assigned",
          );
        }

        if (request.mode === TUNNEL_MODE_QUICK) {
          onQuickTunnelWarning();
        }
      }

      return {
        publicUrl,
        request,
        activeMode: request.mode,
        provider: request.provider,
        providerMetadata: provider.getMetadata?.(getController()!) ?? null,
      };
    } finally {
      releaseLock?.();
    }
  };

  const getPublicUrl = (): string | null => {
    const controller = getController();
    if (!controller) {
      return null;
    }
    const provider = registry.get(controller.provider);
    if (!provider) {
      return controller.getPublicUrl?.() ?? null;
    }
    return provider.resolvePublicUrl(controller);
  };

  const getProviderMetadata = (): Record<string, unknown> | null => {
    const controller = getController();
    if (!controller) {
      return null;
    }
    const provider = registry.get(controller.provider);
    return provider?.getMetadata?.(controller) ?? null;
  };

  return {
    start,
    stop,
    checkAvailability,
    getPublicUrl,
    getProviderMetadata,
    resolveActiveMode,
    resolveActiveProvider,
  };
}
