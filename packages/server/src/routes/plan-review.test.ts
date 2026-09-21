import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { planReviewRoutes } from "./plan-review.js";
import * as sessionStore from "../session-store.js";
import type { LiveSession } from "../session-store.js";

describe("planReviewRoutes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await app.register(planReviewRoutes);
  });

  it("returns 404 for unknown session on GET /sessions/:id/plan-mode", async () => {
    vi.spyOn(sessionStore, "getSession").mockReturnValue(undefined);

    const res = await app.inject({
      method: "GET",
      url: "/sessions/non-existent/plan-mode",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "session_not_found" });
  });

  it("returns planModeActive and phase on GET /sessions/:id/plan-mode", async () => {
    const mockLive = {
      sessionId: "session-1",
      planModeActive: true,
      clients: new Set(),
      sessionManager: { getEntries: () => [] },
    } as unknown as LiveSession;

    vi.spyOn(sessionStore, "getSession").mockReturnValue(mockLive);

    const res = await app.inject({
      method: "GET",
      url: "/sessions/session-1/plan-mode",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ phase: "planning", planModeActive: true });
  });

  it("toggles and sets planModeActive on POST /sessions/:id/plan-mode", async () => {
    const appendCustomEntry = vi.fn();
    const mockLive = {
      sessionId: "session-1",
      planModeActive: false,
      clients: new Set(),
      sessionManager: {
        getEntries: () => [],
        appendCustomEntry,
      },
    } as unknown as LiveSession;

    vi.spyOn(sessionStore, "getSession").mockReturnValue(mockLive);

    // Toggle on
    const resOn = await app.inject({
      method: "POST",
      url: "/sessions/session-1/plan-mode",
      payload: { active: true },
    });

    expect(resOn.statusCode).toBe(200);
    expect(resOn.json()).toEqual({ ok: true, planModeActive: true, phase: "planning" });
    expect(mockLive.planModeActive).toBe(true);
    expect(appendCustomEntry).toHaveBeenCalledWith("plan-mode", { active: true, phase: "planning" });

    // Toggle off
    const resOff = await app.inject({
      method: "POST",
      url: "/sessions/session-1/plan-mode",
      payload: { active: false },
    });

    expect(resOff.statusCode).toBe(200);
    expect(resOff.json()).toEqual({ ok: true, planModeActive: false, phase: "idle" });
    expect(mockLive.planModeActive).toBe(false);
  });
});
