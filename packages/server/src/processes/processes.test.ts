import { describe, it, expect, afterEach } from "vitest";
import { processManager } from "./manager.js";
import { createProcessTool } from "./tool.js";

const TEST_SESSION = "test-session-" + Date.now();

describe("Background Process Manager", () => {
  afterEach(async () => {
    await processManager.disposeSession(TEST_SESSION);
  });

  it("starts, lists, and kills a process", async () => {
    const info = processManager.start(
      TEST_SESSION,
      "test-echo",
      "node -e 'setInterval(() => console.log(\"hello\"), 100)'",
      process.cwd(),
    );

    expect(info.id).toBeDefined();
    expect(info.status).toBe("running");
    expect(info.pid).toBeGreaterThan(0);

    const list = processManager.list(TEST_SESSION);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(info.id);

    // Wait a brief moment for output
    await new Promise((r) => setTimeout(r, 250));

    const out = processManager.getOutput(TEST_SESSION, info.id);
    expect(out).toBeDefined();
    expect(out?.stdout.some((line) => line.includes("hello"))).toBe(true);

    const killRes = await processManager.kill(TEST_SESSION, info.id);
    expect(killRes.ok).toBe(true);

    // After kill, status should update to killed or exited
    const updated = processManager.get(TEST_SESSION, info.id);
    expect(["killed", "exited"]).toContain(updated?.status);
  });

  it("writes to stdin and receives response", async () => {
    const info = processManager.start(
      TEST_SESSION,
      "test-stdin",
      "node -e 'process.stdin.on(\"data\", d => console.log(\"echo:\" + d.toString().trim()))'",
      process.cwd(),
    );

    await new Promise((r) => setTimeout(r, 100));

    const writeRes = processManager.write(TEST_SESSION, info.id, "pi-kot\n");
    expect(writeRes.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 200));

    const out = processManager.getOutput(TEST_SESSION, info.id);
    expect(out?.stdout.some((line) => line.includes("echo:pi-kot"))).toBe(true);

    await processManager.kill(TEST_SESSION, info.id);
  });

  it("triggers logWatches regex matches", async () => {
    const matchedLines: string[] = [];
    const unsubscribe = processManager.subscribe((ev) => {
      if (ev.type === "process_watch_matched") {
        matchedLines.push(ev.match.line);
      }
    });

    const info = processManager.start(
      TEST_SESSION,
      "test-watch",
      "node -e 'console.log(\"READY: server started\"); setInterval(() => {}, 100)'",
      process.cwd(),
      {
        logWatches: [{ pattern: "READY: .*" }],
      },
    );

    await new Promise((r) => setTimeout(r, 300));

    expect(matchedLines.length).toBeGreaterThanOrEqual(1);
    expect(matchedLines[0]).toContain("READY: server started");

    unsubscribe();
    await processManager.kill(TEST_SESSION, info.id);
  });

  it("clears finished processes", async () => {
    const info = processManager.start(
      TEST_SESSION,
      "quick-exit",
      "node -e 'process.exit(0)'",
      process.cwd(),
    );

    await new Promise((r) => setTimeout(r, 200));

    const cleared = processManager.clearFinished(TEST_SESSION);
    expect(cleared).toBe(1);

    const list = processManager.list(TEST_SESSION);
    expect(list.length).toBe(0);
  });

  it("executes through createProcessTool wrapper", async () => {
    const tool = createProcessTool(TEST_SESSION, process.cwd());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const execTool = tool.execute as (callId: string, params: unknown) => Promise<any>;

    const startRes = await execTool("call-1", {
      action: "start",
      name: "tool-test",
      command: "node -e 'console.log(\"from-tool\"); setInterval(() => {}, 100)'",
    });

    expect(startRes.details.success).toBe(true);
    const procId = (startRes.details.process as { id: string }).id;

    await new Promise((r) => setTimeout(r, 200));

    const listRes = await execTool("call-2", { action: "list" });
    expect(listRes.details.success).toBe(true);
    expect((listRes.details.processes as unknown[]).length).toBe(1);

    const outRes = await execTool("call-3", { action: "output", id: procId });
    expect(outRes.details.success).toBe(true);
    const firstContent = outRes.content[0] as { type: string; text?: string };
    expect(firstContent.text).toContain("from-tool");

    const killRes = await execTool("call-4", { action: "kill", id: procId });
    expect(killRes.details.success).toBe(true);
  });
});
