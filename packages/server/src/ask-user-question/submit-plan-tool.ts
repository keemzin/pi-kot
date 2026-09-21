import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, normalize, relative, resolve } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerPendingPlanReview } from "./plannotator-registry.js";

export const PLANNOTATOR_SUBMIT_PLAN_TOOL_NAME = "plannotator_submit_plan";

function isPlanWritePathAllowed(filePath: string, cwd: string): boolean {
  if (!/\.(?:md|mdx)$/i.test(filePath)) return false;
  const target = isAbsolute(filePath) ? normalize(filePath) : resolve(cwd, filePath);
  const rel = relative(cwd, target);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

export function createPlannotatorSubmitPlanTool(sessionId: string): ToolDefinition {
  return {
    name: PLANNOTATOR_SUBMIT_PLAN_TOOL_NAME,
    label: "Submit Plan",
    description:
      "Submit your Plannotator plan for user review. " +
      "Call this after drafting your plan as a markdown file anywhere inside the working directory. " +
      "Pass the path to the plan file (e.g. PLAN.md or plans/auth.md). " +
      "The user will review the plan in a native side panel and can edit, approve, or request revisions. " +
      "If revisions are requested, edit the same file in place, then call this tool again.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["filePath"],
      properties: {
        filePath: {
          type: "string",
          description:
            "Path to the markdown plan file, relative to the working directory. Must end in .md or .mdx and resolve inside cwd.",
        },
      },
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const inputPath = (params as { filePath?: string })?.filePath?.trim();
      if (!inputPath) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${PLANNOTATOR_SUBMIT_PLAN_TOOL_NAME} requires a filePath argument pointing to your markdown plan file (e.g. "PLAN.md" or "plans/auth.md").`,
            },
          ],
          details: { approved: false },
        };
      }

      const cwd = ctx?.cwd ?? process.cwd();
      if (!isPlanWritePathAllowed(inputPath, cwd)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: plan file must be a markdown file (.md or .mdx) inside the working directory. Rejected: ${inputPath}`,
            },
          ],
          details: { approved: false },
        };
      }

      const fullPath = resolve(cwd, inputPath);

      try {
        if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${inputPath} does not exist or is not a regular file. Write your plan using the write tool first, then call ${PLANNOTATOR_SUBMIT_PLAN_TOOL_NAME} with its path.`,
              },
            ],
            details: { approved: false },
          };
        }
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error: cannot access ${inputPath}: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: { approved: false },
        };
      }

      let planContent: string;
      try {
        planContent = readFileSync(fullPath, "utf-8");
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error: failed to read ${inputPath}: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: { approved: false },
        };
      }

      if (planContent.trim().length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${inputPath} is empty. Write your plan first, then call ${PLANNOTATOR_SUBMIT_PLAN_TOOL_NAME} again.`,
            },
          ],
          details: { approved: false },
        };
      }

      // Register with the in-memory plan review registry and wait for the user to review
      const { result } = registerPendingPlanReview({
        sessionId,
        planFilePath: inputPath,
        planContent,
        cwd,
        signal,
      });

      return await result;
    },
  };
}
