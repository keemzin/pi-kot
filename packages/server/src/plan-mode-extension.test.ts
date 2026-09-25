import { describe, it, expect, vi } from "vitest";
import { planModeExtension, PLAN_MODE_INSTRUCTIONS } from "./plan-mode-extension.js";
import * as sessionStore from "./session-store.js";
import * as eventStream from "./event-stream.js";
import type { LiveSession } from "./session-store.js";

describe("planModeExtension", () => {
  it("should append plan mode instructions to systemPrompt when session is in plan mode", async () => {
    let beforeAgentStartHandler: any;
    const fakePi = {
      on: (event: string, handler: any) => {
        if (event === "before_agent_start") {
          beforeAgentStartHandler = handler;
        }
      },
      registerCommand: vi.fn(),
    };

    planModeExtension(fakePi as any);
    expect(beforeAgentStartHandler).toBeDefined();

    const sessionId = "plan-session-1";
    const fakeLive = { sessionId, planModeActive: true } as unknown as LiveSession;
    vi.spyOn(sessionStore, "getSession").mockReturnValue(fakeLive);
    vi.spyOn(eventStream, "isSessionInPlanMode").mockReturnValue(true);

    const ctx = {
      sessionManager: {
        getSessionId: () => sessionId,
      },
    };

    const result = await beforeAgentStartHandler(
      {
        type: "before_agent_start",
        prompt: "Fix the bug",
        systemPrompt: "You are a helpful coding assistant.",
      },
      ctx,
    );

    expect(result).toBeDefined();
    expect(result.systemPrompt).toBe("You are a helpful coding assistant." + PLAN_MODE_INSTRUCTIONS);
  });

  it("should return undefined when session is not in plan mode", async () => {
    let beforeAgentStartHandler: any;
    const fakePi = {
      on: (event: string, handler: any) => {
        if (event === "before_agent_start") {
          beforeAgentStartHandler = handler;
        }
      },
      registerCommand: vi.fn(),
    };

    planModeExtension(fakePi as any);

    const sessionId = "plan-session-2";
    const fakeLive = { sessionId, planModeActive: false } as unknown as LiveSession;
    vi.spyOn(sessionStore, "getSession").mockReturnValue(fakeLive);
    vi.spyOn(eventStream, "isSessionInPlanMode").mockReturnValue(false);

    const ctx = {
      sessionManager: {
        getSessionId: () => sessionId,
      },
    };

    const result = await beforeAgentStartHandler(
      {
        type: "before_agent_start",
        prompt: "Fix the bug",
        systemPrompt: "You are a helpful coding assistant.",
      },
      ctx,
    );

    expect(result).toBeUndefined();
  });

  it("should block non-markdown write/edit tool calls when in plan mode", async () => {
    let toolCallHandler: any;
    const fakePi = {
      on: (event: string, handler: any) => {
        if (event === "tool_call") {
          toolCallHandler = handler;
        }
      },
      registerCommand: vi.fn(),
    };

    planModeExtension(fakePi as any);
    expect(toolCallHandler).toBeDefined();

    const sessionId = "plan-session-3";
    const fakeLive = { sessionId, planModeActive: true } as unknown as LiveSession;
    vi.spyOn(sessionStore, "getSession").mockReturnValue(fakeLive);
    vi.spyOn(eventStream, "isSessionInPlanMode").mockReturnValue(true);

    const ctx = {
      sessionManager: {
        getSessionId: () => sessionId,
      },
    };

    // Block typescript write
    const blockResult = await toolCallHandler(
      {
        type: "tool_call",
        toolName: "write",
        input: { path: "src/index.ts", content: "console.log('hi')" },
      },
      ctx,
    );
    expect(blockResult?.block).toBe(true);

    // Allow markdown write
    const allowResult = await toolCallHandler(
      {
        type: "tool_call",
        toolName: "write",
        input: { path: "PLAN.md", content: "# My Plan" },
      },
      ctx,
    );
    expect(allowResult).toBeUndefined();
  });
});
