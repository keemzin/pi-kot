import { create } from "zustand";

export type ProcessStatus = "running" | "terminating" | "terminate_timeout" | "exited" | "killed";

export const LIVE_STATUSES: ReadonlySet<ProcessStatus> = new Set([
  "running",
  "terminating",
  "terminate_timeout",
]);

export interface ProcessInfo {
  id: string;
  name: string;
  pid: number;
  command: string;
  cwd: string;
  startTime: number;
  endTime: number | null;
  status: ProcessStatus;
  exitCode: number | null;
  success: boolean | null;
  stdoutFile: string;
  stderrFile: string;
}

export interface ProcessAlert {
  processId: string;
  name: string;
  reason: "success" | "failure" | "killed";
  exitCode?: number | null;
}

export const EMPTY_PROCESSES: ProcessInfo[] = [];
export const EMPTY_ALERTS: ProcessAlert[] = [];

interface ProcessesState {
  bySession: Record<string, ProcessInfo[]>;
  alertsBySession: Record<string, ProcessAlert[]>;

  setProcesses: (sessionId: string, processes: ProcessInfo[]) => void;
  addAlert: (sessionId: string, alert: ProcessAlert) => void;
  clearAlerts: (sessionId: string) => void;
}

export const useProcessesStore = create<ProcessesState>((set) => ({
  bySession: {},
  alertsBySession: {},

  setProcesses: (sessionId, processes) =>
    set((state) => {
      const existing = state.bySession[sessionId];
      if (existing && existing.length === processes.length) {
        let same = true;
        for (let i = 0; i < existing.length; i++) {
          if (
            existing[i].id !== processes[i].id ||
            existing[i].status !== processes[i].status ||
            existing[i].exitCode !== processes[i].exitCode
          ) {
            same = false;
            break;
          }
        }
        if (same) return state;
      }
      return {
        bySession: {
          ...state.bySession,
          [sessionId]: processes,
        },
      };
    }),

  addAlert: (sessionId, alert) =>
    set((state) => ({
      alertsBySession: {
        ...state.alertsBySession,
        [sessionId]: [alert, ...(state.alertsBySession[sessionId] ?? [])],
      },
    })),

  clearAlerts: (sessionId) =>
    set((state) => ({
      alertsBySession: {
        ...state.alertsBySession,
        [sessionId]: [],
      },
    })),
}));

export function selectProcesses(state: ProcessesState, sessionId: string): ProcessInfo[] {
  return state.bySession[sessionId] ?? EMPTY_PROCESSES;
}

export function selectAlerts(state: ProcessesState, sessionId: string): ProcessAlert[] {
  return state.alertsBySession[sessionId] ?? EMPTY_ALERTS;
}

export function countRunning(processes: ProcessInfo[]): number {
  return processes.filter((p) => LIVE_STATUSES.has(p.status)).length;
}

export function selectRunningCount(state: ProcessesState, sessionId?: string): number {
  if (!sessionId) return 0;
  const procs = state.bySession[sessionId];
  if (!procs) return 0;
  let count = 0;
  for (const p of procs) {
    if (LIVE_STATUSES.has(p.status)) count++;
  }
  return count;
}
