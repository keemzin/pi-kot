/**
 * Terminal WebSocket Route
 *
 * WebSocket endpoint at /api/v1/terminal that spawns a PTY in the
 * project's cwd and streams output to the browser.
 *
 * **Reattach support:** client passes a stable `tabId` on connect.
 * If the server still has a PTY for that tabId (from a previous
 * WS drop within the idle timeout), it reattaches instead of
 * spawning a new shell. The rolling output buffer is replayed so
 * xterm shows recent output.
 *
 * **Kill vs detach:** When the client closes the socket with reason
 * `tab_closed` (explicit tab close), the PTY is killed. On any
 * other close (panel toggle, network blip), the PTY is detached
 * but kept alive for reattach.
 *
 * Protocol:
 *   Client → Server: {"type":"input","data":"..."} | {"type":"resize","cols":N,"rows":N}
 *   Server → Client: raw PTY bytes as binary frames (xterm consumes directly)
 *
 * Auth: `?token=` query param for browsers (no custom headers on WebSocket upgrade).
 *
 * Terminal WebSocket handler for PTY sessions.
 */

import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { authEnabled, verifyHmac } from "./auth.js";
import { config } from "../config.js";
import {
  attachSink,
  findPtyByTabId,
  killPty,
  spawnPty,
} from "../terminal-provider.js";
import { getProject } from "../workspace-store.js";

const CLOSE_AUTH_REQUIRED = 4401;
const CLOSE_PROJECT_NOT_FOUND = 4404;
const CLOSE_INTERNAL_ERROR = 4500;

interface InputMessage {
  type: "input";
  data: string;
}
interface ResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}
type ClientMessage = InputMessage | ResizeMessage;

function parseClientMessage(raw: unknown): ClientMessage | undefined {
  if (typeof raw !== "string" && !(raw instanceof Buffer)) return undefined;
  const MAX_INPUT_BYTES = 1 * 1024 * 1024;
  if (typeof raw === "string" ? raw.length > MAX_INPUT_BYTES : raw.byteLength > MAX_INPUT_BYTES) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const obj = parsed as Record<string, unknown>;
  if (obj.type === "input" && typeof obj.data === "string") {
    return { type: "input", data: obj.data };
  }
  if (
    obj.type === "resize" &&
    typeof obj.cols === "number" &&
    typeof obj.rows === "number" &&
    Number.isInteger(obj.cols) &&
    Number.isInteger(obj.rows) &&
    obj.cols > 0 &&
    obj.rows > 0 &&
    obj.cols <= 1000 &&
    obj.rows <= 1000
  ) {
    return { type: "resize", cols: obj.cols, rows: obj.rows };
  }
  return undefined;
}

export const terminalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: { projectId: string; tabId?: string; token?: string; cwd?: string };
  }>(
    "/terminal",
    {
      websocket: true,
      config: { public: true },
    },
    async (socket: WebSocket, req) => {
      const log = req.log;
      const query = req.query as {
        projectId?: string;
        tabId?: string;
        token?: string;
        cwd?: string;
      };

      // Auth check
      if (authEnabled()) {
        const apiKey = config.apiKey;
        const token = query.token;
        const verified =
          token !== undefined &&
          (verifyHmac(token) !== undefined ||
            (apiKey !== undefined && token === apiKey));
        if (!verified) {
          socket.send(JSON.stringify({ type: "error", message: "Authentication required" }));
          socket.close(CLOSE_AUTH_REQUIRED, "auth_required");
          return;
        }
      }

      // Resolve project for cwd
      const projectId = query.projectId;
      let projectCwd: string | undefined;
      if (projectId) {
        const project = await getProject(projectId);
        if (project) {
          projectCwd = project.path;
        }
      }
      const cwd = projectCwd || query.cwd || config.workspacePath || process.env.HOME || "/tmp";

      // Reattach path: if tabId is provided and a PTY exists, reuse it
      const requestedTabId = query.tabId;
      let managed: ReturnType<typeof spawnPty> | undefined;
      let reattached = false;

      if (requestedTabId !== undefined && projectId !== undefined) {
        const existing = findPtyByTabId(requestedTabId, projectId);
        if (existing !== undefined) {
          managed = existing;
          reattached = true;
        }
      }

      if (managed === undefined) {
        try {
          managed = spawnPty({
            cwd,
            tabId: requestedTabId ?? `srv-${Date.now().toString(36)}`,
            projectId: projectId ?? "_default",
          });
        } catch (err) {
          log.error({ err }, "pty spawn failed");
          socket.send(JSON.stringify({ type: "error", message: "Failed to spawn PTY" }));
          socket.close(CLOSE_INTERNAL_ERROR, "spawn_failed");
          return;
        }
      }

      log.info(
        { ptyId: managed.ptyId, tabId: managed.tabId, cwd, reattached },
        reattached ? "terminal reattached" : "terminal opened",
      );

      // Send open confirmation
      socket.send(JSON.stringify({ type: "open", id: managed.ptyId, cwd, reattached }));

      // Attach sink: PTY output → binary WebSocket frames
      const closeOnDisplace = (): void => {
        if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) {
          socket.close(4409, "replaced_by_new_attach");
        }
      };

      const detach = attachSink(
        managed.ptyId,
        (chunk) => {
          if (socket.readyState === socket.OPEN) {
            socket.send(chunk);
          }
        },
        undefined,
        closeOnDisplace,
      );

      if (detach === undefined) {
        log.error({ ptyId: managed.ptyId }, "attachSink failed");
        socket.close(CLOSE_INTERNAL_ERROR, "attach_failed");
        return;
      }

      // WebSocket keepalive ping
      const keepAliveTimer = setInterval(() => {
        if (socket.readyState === socket.OPEN) {
          try {
            socket.ping();
          } catch {
            // socket closing
          }
        }
      }, 30_000).unref();

      // PTY exit → close socket
      const exitDisposable = managed.process.onExit(({ exitCode, signal }) => {
        log.info({ ptyId: managed.ptyId, exitCode, signal }, "terminal exited");
        if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) {
          socket.send(JSON.stringify({ type: "exit", code: exitCode }));
          socket.close(1000, "pty_exited");
        }
      });

      let disposed = false;
      const cleanup = (reason: string, killOnClose = false): void => {
        if (disposed) return;
        disposed = true;
        clearInterval(keepAliveTimer);
        detach();
        exitDisposable.dispose();
        if (killOnClose) {
          killPty(managed.ptyId);
          log.info({ ptyId: managed.ptyId, tabId: managed.tabId, reason }, "terminal closed");
          return;
        }
        log.info({ ptyId: managed.ptyId, tabId: managed.tabId, reason }, "terminal detached");
      };

      socket.on("message", (raw: string | Buffer) => {
        const msg = parseClientMessage(raw);
        if (msg === undefined) return;
        if (msg.type === "input") {
          try {
            managed.process.write(msg.data);
          } catch (err) {
            log.warn({ err, ptyId: managed.ptyId }, "pty write failed");
            if (socket.readyState === socket.OPEN) {
              socket.close(CLOSE_INTERNAL_ERROR, "pty_dead");
            }
          }
        } else {
          try {
            managed.process.resize(msg.cols, msg.rows);
          } catch (err) {
            log.warn({ err }, "pty resize failed");
            if (socket.readyState === socket.OPEN) {
              socket.close(CLOSE_INTERNAL_ERROR, "pty_dead");
            }
          }
        }
      });

      socket.on("close", (_code: number, reason: Buffer) => {
        cleanup("ws_close", reason.toString("utf8") === "tab_closed");
      });
      socket.on("error", (err: unknown) => {
        log.warn({ err, ptyId: managed.ptyId }, "terminal websocket error");
        cleanup("ws_error");
      });
    },
  );
};
