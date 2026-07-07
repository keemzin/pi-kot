/**
 * Extension UI Bridge — adapts extension `ctx.ui` interactions (select, confirm,
 * notify) to the WebSocket/SSE + REST model of pi-kot's web GUI.
 *
 * When the extension calls `ctx.ui.select("Rewind to checkpoint:", items)`, this
 * bridge sends an `extension_ui_select` SSE event to the browser, creating a
 * pending request. The browser renders the selector and responds via
 * `POST /api/v1/sessions/:id/extension-ui/respond`, which resolves the promise
 * and lets the extension continue.
 *
 * Unused TUI-specific methods (setWidget, setFooter, setHeader, custom, …) are
 * no-ops so that any extension command works unmodified through the bridge.
 */

import { randomUUID } from "node:crypto";
import type {
  ExtensionUIContext,
  TerminalInputHandler,
  WorkingIndicatorOptions,
  ExtensionWidgetOptions,
} from "@earendil-works/pi-coding-agent";
import type { SSEClient } from "./session-store.js";

// ── Pending request tracking ────────────────────────────────────────

interface PendingRequest<T> {
  requestId: string;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingSelects = new Map<string, PendingRequest<string | undefined>>();
const pendingConfirms = new Map<string, PendingRequest<boolean>>();
const pendingInputs = new Map<string, PendingRequest<string | undefined>>();

const REQUEST_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Resolve a pending select/confirm/input request.
 * Called from `POST /api/v1/sessions/:id/extension-ui/respond`.
 */
export function resolveExtensionUIRequest(
  requestId: string,
  value: unknown,
): boolean {
  // Try select
  const sel = pendingSelects.get(requestId);
  if (sel !== undefined) {
    clearTimeout(sel.timer);
    sel.resolve(typeof value === "string" ? value : undefined);
    pendingSelects.delete(requestId);
    return true;
  }
  // Try confirm
  const con = pendingConfirms.get(requestId);
  if (con !== undefined) {
    clearTimeout(con.timer);
    con.resolve(value === true || value === "true" || value === "yes");
    pendingConfirms.delete(requestId);
    return true;
  }
  // Try input
  const inp = pendingInputs.get(requestId);
  if (inp !== undefined) {
    clearTimeout(inp.timer);
    inp.resolve(typeof value === "string" ? value : undefined);
    pendingInputs.delete(requestId);
    return true;
  }
  return false;
}

/**
 * Cancel all pending requests (e.g., when the command is aborted or session
 * is disposed). Each pending promise rejects so the extension handler sees
 * a cancelled/interrupted state.
 */
export function cancelAllPendingRequests(): void {
  const err = new Error("Extension UI request cancelled");
  for (const [id, req] of pendingSelects) {
    clearTimeout(req.timer);
    req.reject(err);
    pendingSelects.delete(id);
  }
  for (const [id, req] of pendingConfirms) {
    clearTimeout(req.timer);
    req.reject(err);
    pendingConfirms.delete(id);
  }
  for (const [id, req] of pendingInputs) {
    clearTimeout(req.timer);
    req.reject(err);
    pendingInputs.delete(id);
  }
}

// ── Bridge factory ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTUI = any;

/**
 * Create an `ExtensionUIContext` that bridges extension UI interactions
 * to the browser GUI via SSE events + REST callbacks.
 *
 * @param clients - The live session's connected SSE clients.
 * @param sessionId - The session ID, included in SSE events for routing.
 */
export function createBridgeUIContext(
  clients: Set<SSEClient>,
  sessionId: string,
): ExtensionUIContext {
  /** Send a typed SSE event to all connected clients. */
  function send(type: string, extra: Record<string, unknown> = {}): void {
    const payload: { type: string; [k: string]: unknown } = {
      type,
      sessionId,
      ...extra,
    };
    for (const client of clients) {
      try {
        client.send(payload);
      } catch {
        clients.delete(client);
      }
    }
  }

  return {
    // ── Interactive methods (bridge to GUI) ──

    select: async (title, options, _opts) => {
      return new Promise<string | undefined>((resolve, reject) => {
        const requestId = randomUUID();
        send("extension_ui_select", { requestId, title, options });
        const timer = setTimeout(() => {
          pendingSelects.delete(requestId);
          reject(new Error(`Extension UI select timed out: ${title}`));
        }, REQUEST_TIMEOUT_MS);
        pendingSelects.set(requestId, { requestId, resolve, reject, timer });
      });
    },

    confirm: async (title, message, _opts) => {
      return new Promise<boolean>((resolve, reject) => {
        const requestId = randomUUID();
        send("extension_ui_confirm", { requestId, title, message });
        const timer = setTimeout(() => {
          pendingConfirms.delete(requestId);
          reject(new Error(`Extension UI confirm timed out: ${title}`));
        }, REQUEST_TIMEOUT_MS);
        pendingConfirms.set(requestId, { requestId, resolve, reject, timer });
      });
    },

    input: async (title, placeholder, _opts) => {
      return new Promise<string | undefined>((resolve, reject) => {
        const requestId = randomUUID();
        send("extension_ui_input", {
          requestId,
          title,
          placeholder: placeholder ?? "",
        });
        const timer = setTimeout(() => {
          pendingInputs.delete(requestId);
          reject(new Error(`Extension UI input timed out: ${title}`));
        }, REQUEST_TIMEOUT_MS);
        pendingInputs.set(requestId, { requestId, resolve, reject, timer });
      });
    },

    notify: (message, notificationType) => {
      send("extension_ui_notify", {
        message,
        notificationType: notificationType ?? "info",
      });
    },

    // ── No-ops (TUI-specific, not applicable in web GUI) ──

    onTerminalInput: (_handler: TerminalInputHandler) => {
      return () => {};
    },

    setStatus: (_key: string, _text: string | undefined) => {
      // Status bar is managed by the GUI.
    },

    setWorkingMessage: (_message?: string) => {
      // Working message is managed by the GUI.
    },

    setWorkingVisible: (_visible: boolean) => {
      // Working indicator visibility is managed by the GUI.
    },

    setWorkingIndicator: (_options?: WorkingIndicatorOptions) => {
      // Working indicator animation is managed by the GUI.
    },

    setHiddenThinkingLabel: (_label?: string) => {
      // Hidden thinking label is managed by the GUI.
    },

    setWidget: (
      _key: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _content: string[] | undefined | ((tui: AnyTUI, theme: any) => any),
      _options?: ExtensionWidgetOptions,
    ) => {
      // Widgets are TUI-specific.
    },

    setFooter: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _factory: ((tui: AnyTUI, theme: any, _footerData: any) => any) | undefined,
    ) => {
      // Footer is TUI-specific.
    },

    setHeader: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _factory: ((tui: AnyTUI, theme: any) => any) | undefined,
    ) => {
      // Header is TUI-specific.
    },

    setTitle: (_title: string) => {
      // Title is managed by the browser tab.
    },

    // custom is intentionally undefined so that extensions which check
    // `if (!ctx.ui.custom)` fall back to `ctx.ui.select()` / `ctx.ui.confirm()`
    // instead of calling the TUI custom component factory and getting nothing.
    // This fixes pi-rewind's `/rewind` command which would exit silently
    // when `custom` returned `Promise.resolve(undefined)` immediately.
    custom: undefined as unknown as <T>(..._args: unknown[]) => Promise<T>,

    pasteToEditor: (_text: string) => {
      // Editor paste is not supported in bridge mode.
    },

    setEditorText: (_text: string) => {
      // Editor text is managed by the GUI.
    },

    getEditorText: () => {
      return "";
    },

    editor: async (_title: string, _prefill?: string) => {
      // Multi-line editor is not supported in bridge mode.
      return undefined;
    },

    addAutocompleteProvider: (_factory: (...args: any[]) => any) => {
      // Autocomplete is managed by the GUI.
    },

    setEditorComponent: (_factory: any) => {
      // Editor component is managed by the GUI.
    },

    getEditorComponent: () => {
      return undefined;
    },

    get theme() {
      // Return a minimal theme stub — the server doesn't have a TUI theme.
      return {} as any;
    },

    getAllThemes: () => {
      return [];
    },

    getTheme: () => {
      return undefined;
    },

    setTheme: () => {
      return { success: false, error: "Theme switching not supported via bridge" };
    },

    getToolsExpanded: () => {
      return true;
    },

    setToolsExpanded: () => {
      // Tool expansion is managed by the GUI.
    },
  };
}
