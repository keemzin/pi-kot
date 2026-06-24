/**
 * Session Extension Routes — expose runtime extension state from the
 * ExtensionRunner to the web UI.
 *
 * These routes give the GUI visibility into what extensions are active
 * in a session, what commands and tools they registered, so the
 * Extensions page shows "Active in Session" instead of just "Installed".
 */

import type { FastifyPluginAsync } from "fastify";
import { getSession } from "../session-registry.js";

export const sessionExtensionRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /sessions/:id/extensions — runtime extension state ──────────

  fastify.get<{
    Params: { id: string };
  }>(
    "/sessions/:id/extensions",
    {
      schema: {
        description:
          "List extensions currently active in a live session, " +
          "including their registered commands, tools, and event handlers.",
        tags: ["extensions"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["activeExtensions", "commands", "registeredTools"],
            properties: {
              activeExtensions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    path: { type: "string" },
                    displayPath: { type: "string" },
                  },
                },
              },
              commands: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    invocationName: { type: "string" },
                    description: { type: "string" },
                  },
                },
              },
              registeredTools: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                  },
                },
              },
              eventHandlers: {
                type: "array",
                items: { type: "string" },
              },
            },
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
      const live = getSession(sessionId);
      if (live === undefined) {
        return reply.code(404).send({ error: "session_not_found" });
      }

      const runner = live.session.extensionRunner;

      // Active extension paths
      const activeExtensions = runner.getExtensionPaths().map((p) => ({
        path: p,
        // Derive a user-friendly display name from the path
        displayPath: friendlyExtensionName(p),
      }));

      // Registered commands
      const commands = runner.getRegisteredCommands().map((cmd) => ({
        name: cmd.name,
        invocationName: cmd.invocationName,
        description: cmd.description ?? "",
      }));

      // Registered tools
      const registeredTools = runner.getAllRegisteredTools().map((t) => ({
        name: t.definition.name,
        description:
          typeof t.definition.description === "string"
            ? t.definition.description
            : "",
      }));

      // Event handlers — enumerate all event types this runner handles
      const allEventTypes = [
        "project_trust",
        "resources_discover",
        "session_start",
        "session_before_switch",
        "session_before_fork",
        "session_before_compact",
        "session_compact",
        "session_shutdown",
        "session_before_tree",
        "session_tree",
        "context",
        "before_provider_request",
        "after_provider_response",
        "before_agent_start",
        "agent_start",
        "agent_end",
        "turn_start",
        "turn_end",
        "message_start",
        "message_update",
        "message_end",
        "tool_execution_start",
        "tool_execution_update",
        "tool_execution_end",
        "model_select",
        "thinking_level_select",
        "tool_call",
        "tool_result",
        "user_bash",
        "input",
      ];
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: simple filter
      const eventHandlers = allEventTypes.filter((et) => runner.hasHandlers(et));

      return reply.send({
        activeExtensions,
        commands,
        registeredTools,
        eventHandlers,
      });
    },
  );
};

/**
 * Derive a user-friendly display name from an extension path.
 * e.g. "/home/user/.pi/agent/npm/node_modules/@ayulab/pi-rewind/dist/index.js"
 *   → "@ayulab/pi-rewind"
 */
function friendlyExtensionPath(absolutePath: string): string {
  // Try to extract npm package name from node_modules path
  const nmIndex = absolutePath.lastIndexOf("node_modules/");
  if (nmIndex !== -1) {
    const afterNm = absolutePath.slice(nmIndex + "node_modules/".length);
    // The package name is the first path segment (which may contain @scope/)
    const parts = afterNm.split("/");
    if (parts[0]?.startsWith("@")) {
      // Scoped package: @scope/name
      return `${parts[0]}/${parts[1] ?? ""}`;
    }
    return parts[0] ?? absolutePath;
  }
  // Fallback: return the last two path segments
  const segments = absolutePath.split("/");
  return segments.slice(-2).join("/");
}

/**
 * Derive a user-friendly display name from an extension path.
 * Includes a fallback if the path is inline or temporary.
 */
function friendlyExtensionName(absolutePath: string): string {
  if (absolutePath.startsWith("<inline:")) {
    return `inline-extension${absolutePath.replace("<inline:", "").replace(">", "")}`;
  }
  return friendlyExtensionPath(absolutePath);
}
