/**
 * Runtime config for the orchestration feature.
 *
 * Enabled by default with an instance-level disable switch + tunable
 * limits. MINIMAL_UI is a HARD gate (checked separately in routes +
 * tool registration).
 */
import { config } from "../config.js";

export function isOrchestrationEnabled(): boolean {
  if (config.minimalUi) return false;
  return config.orchestrationEnabled;
}

export function maxWorkersPerSupervisor(): number {
  return Math.max(1, Math.min(config.orchestrationMaxWorkersPerSupervisor, 100));
}

export function isOrchestrationAvailable(): boolean {
  return config.orchestrationEnabled && !config.minimalUi;
}

let _disabledReason: string | undefined;
export function availableReason(): string {
  if (_disabledReason !== undefined) return _disabledReason;
  if (config.minimalUi) {
    _disabledReason = "Orchestration is disabled under MINIMAL_UI mode.";
  } else if (!config.orchestrationEnabled) {
    _disabledReason = "Orchestration is disabled by operator config.";
  } else {
    _disabledReason = "available";
  }
  return _disabledReason;
}
