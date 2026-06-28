/**
 * Hook to detect installed pi extensions at runtime.
 * Used to conditionally activate UI features (detect → activate).
 *
 * Caches the result so it's not refetched on every render.
 */

import { useEffect, useState, useRef } from "react";
import { fetchExtensions } from "../lib/api-client";

interface ExtensionState {
  /** Whether pi-rewind is installed */
  rewind: boolean;
  /** Whether pi-subagents or similar is installed */
  subagents: boolean;
  /** Whether pi-orchestration is installed */
  orchestration: boolean;
  /** Loading state */
  loading: boolean;
}

const EMPTY: ExtensionState = {
  rewind: false,
  subagents: false,
  orchestration: false,
  loading: true,
};

let cached: ExtensionState | null = null;
let fetchPromise: Promise<void> | null = null;

export function useExtensions(): ExtensionState {
  const [state, setState] = useState<ExtensionState>(cached ?? EMPTY);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    if (cached !== null) {
      setState(cached);
      return;
    }

    if (fetchPromise === null) {
      fetchPromise = fetchExtensions()
        .then((res) => {
          // Check if pi-rewind is in detected packages
          const rewindInstalled = res.detected.some(
            (d) =>
              d.name.includes("rewind") ||
              d.name.includes("pi-rewind") ||
              d.name.includes("@ayulab/pi-rewind"),
          );

          // Check recommended list too — must be marked as installed
          const rewindRecommended = res.recommended.some(
            (r) => r.installed && (r.id === "pi-rewind" || r.name === "@ayulab/pi-rewind"),
          );

          const subagentsInstalled =
            res.detected.some(
              (d) =>
                d.agentTypes?.includes("scout") ||
                d.name.includes("subagents"),
            ) ||
            res.recommended.some(
              (r) =>
                r.installed && (r.id === "pi-subagents" || r.id === "@ifi/pi-extension-subagents"),
            );

          const orchInstalled =
            res.detected.some((d) => d.name.includes("orchestr")) ||
            res.recommended.some((r) => r.id === "pi-orchestration" && r.installed);

          cached = {
            rewind: rewindInstalled || rewindRecommended,
            subagents: subagentsInstalled,
            orchestration: orchInstalled,
            loading: false,
          };
          if (mounted.current) setState(cached!);
        })
        .catch(() => {
          cached = { rewind: false, subagents: false, orchestration: false, loading: false };
          if (mounted.current) setState(cached!);
        });
    }

    fetchPromise.then(() => {
      if (mounted.current && cached !== null) setState(cached);
    });

    return () => {
      mounted.current = false;
    };
  }, []);

  return state;
}
