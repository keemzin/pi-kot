/**
 * Terminal WebSocket Route
 *
 * Provides a WebSocket endpoint at /api/v1/terminal that
 * streams PTY output to the browser and accepts input.
 *
 * Protocol (JSON messages over WebSocket):
 *
 * Client → Server:
 *   {"type":"input","data":"ls -la\r"}     — write to PTY
 *   {"type":"resize","cols":120,"rows":40}  — resize PTY
 *
 * Server → Client:
 *   {"type":"output","data":"..."}          — PTY stdout/stderr
 *   {"type":"exit","code":0}                — PTY process exited
 *   {"type":"error","message":"..."}        — error message
 *
 * Auth: expects a `token` query parameter matching the server's HMAC auth token
 *       or API key. The route is marked public (skips the onRequest auth gate)
 *       because the native WebSocket API cannot set custom headers.
 */

import type { FastifyPluginAsync } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import {
  createPtySession,
  writeToPty,
  resizePty,
  killPty,
} from "../pty-manager.js";
import { config } from "../config.js";
import { verifyHmac, authEnabled } from "./auth.js";

interface TerminalMessage {
  type: "input" | "resize";
  data?: string;
  cols?: number;
  rows?: number;
}

export const terminalRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/terminal",
    {
      websocket: true,
      config: { public: true }, // Skip global auth hook — manual check below
    },
    async (socket: WebSocket, req) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      // Manual auth check via query token
      // Only enforced when the server has auth enabled
      if (authEnabled()) {
        const token = url.searchParams.get("token") ?? undefined;
        const apiKey = config.apiKey;
        const verified = token !== undefined && (
          verifyHmac(token) !== undefined ||
          (apiKey !== undefined && token === apiKey)
        );

        if (!verified) {
          socket.send(JSON.stringify({ type: "error", message: "Authentication required. Pass ?token=<auth-token> in the WebSocket URL." }));
          socket.close();
          return;
        }
      }

      // Extract cwd from query (optional). Falls back to config.workspacePath, then HOME.
      const cwdParam = url.searchParams.get("cwd") ?? undefined;
      const cwd = cwdParam || config.workspacePath || undefined;

      // Create a new PTY for this connection
      let session;
      try {
        session = createPtySession(cwd);
      } catch (err) {
        socket.send(
          JSON.stringify({ type: "error", message: `Failed to create PTY: ${String(err)}` }),
        );
        socket.close();
        return;
      }

      const ptyId = session.id;
      let closed = false;

      // Forward PTY output → WebSocket
      session.pty.onData((data: string) => {
        if (!closed) {
          try {
            socket.send(JSON.stringify({ type: "output", data }));
          } catch {
            // socket closed
          }
        }
      });

      // Forward PTY exit → WebSocket
      session.pty.onExit(({ exitCode }) => {
        if (!closed) {
          try {
            socket.send(JSON.stringify({ type: "exit", code: exitCode }));
          } catch {
            // socket closed
          }
          closed = true;
          socket.close();
        }
      });

      // Send the terminal ID to the client so it can display it
      socket.send(JSON.stringify({ type: "open", id: ptyId, cwd: session.cwd }));

      // Handle incoming WebSocket messages
      socket.on("message", (raw: string | Buffer) => {
        if (closed) return;

        let msg: TerminalMessage;
        try {
          msg = JSON.parse(raw.toString()) as TerminalMessage;
        } catch {
          socket.send(
            JSON.stringify({ type: "error", message: "Invalid JSON" }),
          );
          return;
        }

        switch (msg.type) {
          case "input":
            if (msg.data !== undefined) {
              writeToPty(ptyId, msg.data);
            }
            break;
          case "resize":
            if (msg.cols !== undefined && msg.rows !== undefined) {
              resizePty(ptyId, msg.cols, msg.rows);
            }
            break;
          default:
            socket.send(
              JSON.stringify({ type: "error", message: `Unknown message type: ${msg.type}` }),
            );
        }
      });

      // Clean up on disconnect
      socket.on("close", () => {
        closed = true;
        killPty(ptyId);
      });
    },
  );
};
