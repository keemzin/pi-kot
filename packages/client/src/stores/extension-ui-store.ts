/**
 * Extension UI Bridge Store — manages pending extension UI interactions
 * that are bridged from the extension runner to the browser GUI.
 *
 * When an extension command calls `ctx.ui.select("Rewind to checkpoint:", ...)`,
 * the server sends an `extension_ui_select` SSE event. This store captures
 * it and makes it available for React components to render.
 */

import { create } from "zustand";

// ── Types ───────────────────────────────────────────────────────────

export interface ExtensionUISelect {
  type: "select";
  requestId: string;
  title: string;
  options: string[];
}

export interface ExtensionUIConfirm {
  type: "confirm";
  requestId: string;
  title: string;
  message: string;
}

export interface ExtensionUIInput {
  type: "input";
  requestId: string;
  title: string;
  placeholder: string;
}

export interface ExtensionUINotify {
  type: "notify";
  message: string;
  notificationType: "info" | "warning" | "error";
}

export interface ExtensionUIDone {
  type: "done";
  command: string;
  status: "ok" | "error";
  message?: string;
}

export type ExtensionUIEvent =
  | ExtensionUISelect
  | ExtensionUIConfirm
  | ExtensionUIInput
  | ExtensionUINotify
  | ExtensionUIDone;

/**
 * A visible notification toast. Auto-dismissed after a timeout.
 */
export interface ExtensionUINotification {
  /** Unique id for this notification (for dismissal). */
  id: string;
  message: string;
  type: "info" | "warning" | "error";
  /** ISO timestamp when the notification was created. */
  createdAt: number;
}

// ── State ───────────────────────────────────────────────────────────

interface ExtensionUIState {
  /** The currently active interaction (if any). Only one at a time. */
  activeInteraction: ExtensionUIEvent | undefined;
  /** Whether a command is currently running. */
  commandRunning: boolean;
  /** The name of the running command. */
  activeCommand: string | undefined;
  /** Visible notification toasts. */
  notifications: ExtensionUINotification[];
}

interface ExtensionUIActions {
  /** Push an event from the SSE stream. */
  pushEvent: (event: ExtensionUIEvent) => void;
  /** Clear the current interaction (after responding). */
  clearInteraction: () => void;
  /** Cancel the running command. */
  cancelCommand: () => void;
  /** Dismiss a notification by id. */
  dismissNotification: (id: string) => void;
}

type ExtensionUIStore = ExtensionUIState & ExtensionUIActions;

let _notifCounter = 0;

export const useExtensionUIStore = create<ExtensionUIStore>((set) => ({
  activeInteraction: undefined,
  commandRunning: false,
  activeCommand: undefined,
  notifications: [],

  pushEvent: (event) => {
    // Strip the "extension_ui_" prefix to match the switch cases below.
    // Server sends prefixed types ("extension_ui_select", "extension_ui_done")
    // but the client uses short names ("select", "done") for readability.
    const eventType = event.type.replace(/^extension_ui_/, "");
    // Narrow the event type after stripping the prefix
    switch (eventType) {
      case "select":
      case "confirm":
      case "input":
        set({ activeInteraction: event as ExtensionUIEvent, commandRunning: true });
        break;
      case "notify": {
        const n = event as { type: string; notificationType: string; message: string };
        const id = `ext-notif-${++_notifCounter}`;
        const notif: ExtensionUINotification = {
          id,
          message: n.message,
          type: n.notificationType as "info" | "warning" | "error",
          createdAt: Date.now(),
        };
        set((state) => ({
          notifications: [...state.notifications, notif],
        }));
        // Auto-dismiss after 8 seconds
        setTimeout(() => {
          set((state) => ({
            notifications: state.notifications.filter((n) => n.id !== id),
          }));
        }, 8000);
        break;
      }
      case "done":
        set({
          activeInteraction: undefined,
          commandRunning: false,
          activeCommand: undefined,
        });
        break;
    }
  },

  clearInteraction: () => {
    set({ activeInteraction: undefined });
  },

  cancelCommand: () => {
    set({
      activeInteraction: undefined,
      commandRunning: false,
      activeCommand: undefined,
    });
  },

  dismissNotification: (id: string) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },
}));
