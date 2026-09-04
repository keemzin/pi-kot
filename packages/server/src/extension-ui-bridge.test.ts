import { describe, it, expect } from "vitest";
import { createBridgeUIContext } from "./extension-ui-bridge.js";

describe("extension-ui-bridge", () => {
  it("provides a robust theme stub that handles fg, bg, and text formatting", () => {
    const clients = new Set<any>();
    const ui = createBridgeUIContext(clients, "test-session");

    expect(ui.theme).toBeDefined();
    expect(typeof ui.theme.fg).toBe("function");
    expect(typeof ui.theme.bg).toBe("function");

    // Test fg formatting
    expect(ui.theme.fg("warning", "Plan Mode")).toBe("Plan Mode");
    expect(ui.theme.fg("accent", "Active")).toBe("Active");
    expect(ui.theme.bg("toolPendingBg", "Pending")).toBe("Pending");

    // Test formatting helpers
    expect(ui.theme.strikethrough?.("done item")).toBe("done item");
    expect(ui.theme.bold?.("header")).toBe("header");
    expect((ui.theme as any).muted("secondary text")).toBe("secondary text");

    // Test proxy fallback for unknown theme properties/methods
    expect((ui.theme as any).customColor("custom")).toBe("custom");
    expect((ui.theme as any).unknownMethod?.("arg1", "arg2")).toBe("arg2");
  });

  it("records and retrieves session statuses across sessions", async () => {
    const { setSessionStatus, getSessionStatuses, clearSessionStatuses, createBridgeUIContext } = await import(
      "./extension-ui-bridge.js"
    );

    const sessionId = "multi-tab-test-session";
    const clients = new Set<any>();
    const ui = createBridgeUIContext(clients, sessionId);

    ui.setStatus("plannotator", "⏸ plan");
    expect(getSessionStatuses(sessionId)).toEqual([{ key: "plannotator", status: "⏸ plan" }]);

    ui.setStatus("custom", "info");
    expect(getSessionStatuses(sessionId)).toEqual([
      { key: "plannotator", status: "⏸ plan" },
      { key: "custom", status: "info" },
    ]);

    ui.setStatus("plannotator", undefined);
    expect(getSessionStatuses(sessionId)).toEqual([{ key: "custom", status: "info" }]);

    clearSessionStatuses(sessionId);
    expect(getSessionStatuses(sessionId)).toEqual([]);
  });
});
