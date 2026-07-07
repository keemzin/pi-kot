/**
 * Platform-specific install command metadata for missing tunnel dependencies.
 *
 * Simplified for pi-kot: ngrok only.
 */

import { TUNNEL_PROVIDER_NGROK } from "./types.js";

interface ProviderInstallInfo {
  dependency: string;
  installUrl: string;
  commands: Record<string, string>;
}

const PROVIDER_INSTALL_INFO: Record<string, ProviderInstallInfo> = {
  [TUNNEL_PROVIDER_NGROK]: {
    dependency: "ngrok",
    installUrl: "https://ngrok.com/download",
    commands: {
      darwin: "brew install ngrok",
      win32: "winget install ngrok -s msstore",
      linux: "Download ngrok from https://ngrok.com/download",
    },
  },
};

export interface TunnelDependencyInstallInfo {
  dependency: string;
  installCommand: string;
  installUrl: string;
  platform: string;
  message: string;
}

function normalizeInstallPlatform(platform: string): string {
  if (platform === "darwin" || platform === "win32" || platform === "linux") {
    return platform;
  }
  return "linux";
}

function createMissingDependencyMessage(
  dependency: string,
  installCommand: string,
): string {
  if (installCommand.startsWith("Download ")) {
    return `${dependency} is not installed. ${installCommand}`;
  }
  return `${dependency} is not installed. Install it with: ${installCommand}`;
}

/**
 * Get install information for a tunnel provider's dependency.
 * Returns the dependency name, platform-specific install command, and
 * a human-readable message.
 */
export function getTunnelDependencyInstallInfo(
  provider: string,
  platform: string = process.platform,
): TunnelDependencyInstallInfo {
  const providerInfo = PROVIDER_INSTALL_INFO[provider] ?? PROVIDER_INSTALL_INFO[TUNNEL_PROVIDER_NGROK];
  const normalizedPlatform = normalizeInstallPlatform(platform);
  const installCommand = providerInfo.commands[normalizedPlatform] || providerInfo.commands.linux || "";

  return {
    dependency: providerInfo.dependency,
    installCommand,
    installUrl: providerInfo.installUrl,
    platform: normalizedPlatform,
    message: createMissingDependencyMessage(providerInfo.dependency, installCommand),
  };
}
