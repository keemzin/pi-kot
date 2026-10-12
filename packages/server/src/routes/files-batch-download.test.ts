import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { fileRoutes } from "./files.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../workspace-store.js", () => ({
  getProject: vi.fn(),
}));

import { getProject } from "../workspace-store.js";

describe("POST /files/batch-download", () => {
  let app: FastifyInstance;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = join(tmpdir(), `pi-kot-batch-dl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testRoot, { recursive: true });

    vi.mocked(getProject).mockResolvedValue({
      id: "proj-123",
      name: "Test Project",
      path: testRoot,
      createdAt: new Date().toISOString(),
    });

    app = Fastify();
    await app.register(fileRoutes);
  });

  afterEach(async () => {
    await app.close();
    try {
      rmSync(testRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
    vi.clearAllMocks();
  });

  it("downloads multiple selected files and directories as a zip", async () => {
    writeFileSync(join(testRoot, "fileA.txt"), "hello A");
    writeFileSync(join(testRoot, "fileB.txt"), "hello B");
    const subDir = join(testRoot, "sub");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "nested.txt"), "nested content");

    const res = await app.inject({
      method: "POST",
      url: "/files/batch-download",
      payload: {
        projectId: "proj-123",
        paths: ["fileA.txt", "fileB.txt", "sub"],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toContain("attachment; filename=");
    expect(res.headers["content-disposition"]).toContain(".zip");
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it("returns 404 when no specified paths exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/files/batch-download",
      payload: {
        projectId: "proj-123",
        paths: ["non-existent-1.txt", "non-existent-2.txt"],
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 400 when paths array is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/files/batch-download",
      payload: {
        projectId: "proj-123",
        paths: [],
      },
    });

    expect(res.statusCode).toBe(400);
  });
});
