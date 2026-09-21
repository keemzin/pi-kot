import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { getSession } from "./session-store.js";
import { isSessionInPlanMode } from "./event-stream.js";
import { setSessionStatus } from "./extension-ui-bridge.js";

export const PLAN_MODE_INSTRUCTIONS =
  "\n\n# Plan Mode Active\n" +
  "You are currently in Plan Mode. Your goal is to explore the codebase and formulate an implementation plan.\n" +
  "Rules:\n" +
  "1. Explore the codebase using read, grep, find, and ls.\n" +
  "2. Do NOT edit or write source code files. You may ONLY create or update your markdown plan file (such as `PLAN.md`).\n" +
  "3. Structure your plan with clear headings, context, and numbered implementation steps.\n" +
  "4. If `PLAN.md` already exists or once drafted, IMMEDIATELY call `submit_plan(filePath: \"PLAN.md\")`.\n" +
  "5. Keep your thinking concise. Do NOT write extensive code or justification in reasoning — call `submit_plan` directly so the user can review it.\n" +
  "6. Wait for user review and approval before implementing any changes.\n";

const ALLOWED_PLAN_EXTENSIONS = new Set([".md", ".mdx"]);

function isMarkdownPath(pathStr: unknown): boolean {
  if (typeof pathStr !== "string" || !pathStr.trim()) return false;
  const lower = pathStr.trim().toLowerCase();
  for (const ext of ALLOWED_PLAN_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

/**
 * In-process pi extension that:
 * 1. Injects Plan Mode instructions into the LLM system prompt on demand (0 tokens when inactive)
 * 2. Enforces read-only / markdown-only write guardrails during planning
 * 3. Registers the `/plan` command natively
 */
export const planModeExtension: ExtensionFactory = (pi) => {
  // Inject instructions into systemPrompt for turns where Plan Mode is active
  pi.on("before_agent_start", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const live = getSession(sessionId);
    if (live && isSessionInPlanMode(live)) {
      return {
        systemPrompt: event.systemPrompt + PLAN_MODE_INSTRUCTIONS,
      };
    }
    return undefined;
  });

  // Write gating: block modifications to non-markdown files during planning
  pi.on("tool_call", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const live = getSession(sessionId);
    if (!live || !isSessionInPlanMode(live)) {
      return undefined;
    }

    if (event.toolName === "write" || event.toolName === "edit") {
      const input = event.input as { path?: string; filePath?: string } | undefined;
      const targetPath = input?.path ?? input?.filePath;
      if (!isMarkdownPath(targetPath)) {
        return {
          block: true,
          reason:
            `Plan mode is ACTIVE. Modifying code or non-markdown files (${targetPath ?? "unknown"}) is not permitted during planning. ` +
            "Draft your plan in PLAN.md and call submit_plan(filePath: \"PLAN.md\") to request user review and approval before making code changes.",
        };
      }
    }
    return undefined;
  });

  // Slash command `/plan`
  pi.registerCommand("plan", {
    description: "Toggle Plan Mode on or off",
    handler: async (_args, ctx) => {
      const sessionId = ctx.sessionManager.getSessionId();
      const live = getSession(sessionId);
      if (live) {
        const nextActive = !isSessionInPlanMode(live);
        live.planModeActive = nextActive;
        live.sessionManager.appendCustomEntry("plan-mode", {
          active: nextActive,
          phase: nextActive ? "planning" : "idle",
        });
        setSessionStatus(sessionId, "plan-mode", nextActive ? "📋 Plan Mode" : undefined);
      }
    },
  });
};
