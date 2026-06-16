/**
 * Extension Command Routes — invoke registered extension commands
 * (`/rewind`, etc.) through the extension runner's command system, with
 * `ctx.ui` bridged to the browser GUI via SSE events + REST callbacks.
 *
 * This is the generic mechanism: any extension that registers a command
 * with `pi.registerCommand()` automatically becomes available through
 * the web GUI without pi-kot-specific integration code.
 *
 * Flow:
 *   1. GUI sends `POST /sessions/:id/command { command: "rewind" }`
 *   2. Server looks up the command in the extension runner
 *   3. Server installs a bridge `ExtensionUIContext` that sends
 *      `extension_ui_select` / `extension_ui_confirm` / etc. over SSE
 *   4. Extension calls `ctx.ui.select()` → bridge creates a pending
 *      promise, sends SSE event → GUI renders selector → user responds
 *      via `POST /extension-ui/respond` → promise resolves
 *   5. Extension completes → `extension_ui_done` SSE event sent
 */

import type { FastifyPluginAsync } from "fastify";
import { getSession } from "../session-registry.js";
import {
  createBridgeUIContext,
  resolveExtensionUIRequest,
  cancelAllPendingRequests,
} from "../extension-ui-bridge.js";
import { buildSnapshot } from "../sse-bridge.js";

export const extensionCommandRoutes: FastifyPluginAsync = async (fastify) => {
  // ── POST /sessions/:id/command — invoke an extension command ─────

  fastify.post<{
    Params: { id: string };
    Body: { command: string; args?: string };
  }>(
    "/sessions/:id/command",
    {
      schema: {
        description:
          "Invoke a registered extension command (e.g. /rewind). " +
          "Returns 202 immediately. The command's interactive steps " +
          "(select, confirm, input, notify) are bridged to the GUI " +
          "via SSE events. The command completes asynchronously and " +
          "a final `extension_ui_done` event is sent over SSE.",
        tags: ["extensions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["command"],
          properties: {
            command: { type: "string" },
            args: { type: "string" },
          },
        },
        response: {
          202: {
            type: "object",
            properties: { accepted: { type: "boolean" } },
          },
          400: {
            type: "object",
            properties: { error: { type: "string" } },
          },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const sessionId = req.params.id;
      const { command: commandName, args = "" } = req.body;

      const live = getSession(sessionId);
      if (live === undefined) {
        return reply.code(404).send({ error: "session_not_found" });
      }

      const runner = live.session.extensionRunner;
      const cmd = runner.getCommand(commandName);
      if (cmd === undefined) {
        return reply.code(404).send({ error: `command_not_found: ${commandName}` });
      }

      // Accept immediately — command runs async
      await reply.code(202).send({ accepted: true });

      // Install the UI bridge and run the command in the background
      const originalUI = runner.getUIContext();
      const bridge = createBridgeUIContext(live.clients, sessionId);
      runner.setUIContext(bridge);

      // Helper to send a done/fail event over SSE
      const sendDone = (result: { status: "ok" | "error"; message?: string }) => {
        for (const client of live.clients) {
          try {
            client.send({
              type: "extension_ui_done",
              sessionId,
              command: commandName,
              ...result,
            } as { type: string; [k: string]: unknown });
          } catch {
            live.clients.delete(client);
          }
        }
      };

      // Run the command in background, restore original UI context after
      (async () => {
        try {
          const ctx = runner.createCommandContext();
          req.log.info({ sessionId, commandName }, "Running extension command");
          await cmd.handler(args, ctx);
          sendDone({ status: "ok" });
          // Emit a snapshot so the UI refreshes messages after tree navigation
          try {
            const snapshot = buildSnapshot(live);
            for (const client of live.clients) {
              client.send(snapshot as unknown as { type: string; [k: string]: unknown });
            }
          } catch {
            // best-effort
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          // Notify the GUI about the failure
          for (const client of live.clients) {
            try {
              client.send({
                type: "extension_ui_notify",
                sessionId,
                message: `Command "${commandName}" failed: ${msg}`,
                notificationType: "error",
              } as { type: string; [k: string]: unknown });
            } catch {
              live.clients.delete(client);
            }
          }
          sendDone({ status: "error", message: msg });
        } finally {
          runner.setUIContext(originalUI);
          cancelAllPendingRequests();
        }
      })();
    },
  );

  // ── POST /sessions/:id/extension-ui/respond — respond to a bridge interaction ──

  fastify.post<{
    Params: { id: string };
    Body: { requestId: string; value: unknown };
  }>(
    "/sessions/:id/extension-ui/respond",
    {
      schema: {
        description:
          "Respond to a pending extension UI interaction (select, confirm, input). " +
          "The `requestId` comes from the `extension_ui_*` SSE event. " +
          "The `value` type depends on the interaction: string for select/input, " +
          "boolean for confirm.",
        tags: ["extensions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["requestId", "value"],
          properties: {
            requestId: { type: "string" },
            value: { type: ["string", "boolean", "number"] },
          },
        },
        response: {
          200: {
            type: "object",
            properties: { resolved: { type: "boolean" } },
          },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const { requestId, value } = req.body;
      const resolved = resolveExtensionUIRequest(requestId, value);
      if (!resolved) {
        return reply.code(404).send({ error: "request_not_found_or_expired" });
      }
      return { resolved: true };
    },
  );
};
