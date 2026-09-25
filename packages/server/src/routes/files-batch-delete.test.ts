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

describe("POST /files/batch-delete", () => {
  let app: FastifyInstance;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = join(tmpdir(), `pi-kot-batch-delete-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  it("deletes multiple existing files and directories", async () => {
    // Setup files
    writeFileSync(join(testRoot, "file1.txt"), "hello");
    writeFileSync(join(testRoot, "file2.txt"), "world");
    const subDir = join(testRoot, "subfolder");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, "nested.txt"), "inside");

    expect(existsSync(join(testRoot, "file1.txt"))).toBe(true);
    expect(existsSync(join(testRoot, "file2.txt"))).toBe(true);
    expect(existsSync(subDir)).toBe(true);

    const res = await app.inject({
      method: "POST",
      url: "/files/batch-delete",
      payload: {
        projectId: "proj-123",
        paths: ["file1.txt", "file2.txt", "subfolder"],
        recursive: true,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.deleted).toEqual(["file1.txt", "file2.txt", "subfolder"]);
    expect(body.errors).toBeUndefined();

    expect(existsSync(join(testRoot, "file1.txt"))).toBe(false);
    expect(existsSync(join(testRoot, "file2.txt"))).toBe(false);
    expect(existsSync(subDir)).toBe(false);
  });

  it("records error when an entry fails safety guard (path traversal) but deletes others", async () => {
    writeFileSync(join(testRoot, "safe.txt"), "ok");

    const res = await app.inject({
      method: "POST",
      url: "/files/batch-delete",
      payload: {
        projectId: "proj-123",
        paths: ["safe.txt", "../outside.txt"],
        recursive: true,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.deleted).toEqual(["safe.txt"]);
    expect(body.errors).toBeDefined();
    expect(body.errors["../outside.txt"]).toBeDefined();
    expect(existsSync(join(testRoot, "safe.txt"))).toBe(false);
  });

  it("returns 400 if paths array is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/files/batch-delete",
      payload: {
        projectId: "proj-123",
        paths: [],
      },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("POST /files/batch-move", () => {
  let app: FastifyInstance;
  let testRoot: string;

  beforeEach(async () => {
    testRoot = join(tmpdir(), `pi-kot-batch-move-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  it("moves multiple files to destination directory", async () => {
    writeFileSync(join(testRoot, "a.txt"), "A");
    writeFileSync(join(testRoot, "b.txt"), "B");
    const targetDir = join(testRoot, "target");
    mkdirSync(targetDir, { recursive: true });

    const res = await app.inject({
      method: "POST",
      url: "/files/batch-move",
      payload: {
        projectId: "proj-123",
        moves: [
          { src: "a.txt", dest: "target/a.txt" },
          { src: "b.txt", dest: "target/b.txt" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.moved).toEqual(["a.txt", "b.txt"]);
    expect(body.errors).toBeUndefined();

    expect(existsSync(join(testRoot, "a.txt"))).toBe(false);
    expect(existsSync(join(testRoot, "b.txt"))).toBe(false);
    expect(existsSync(join(targetDir, "a.txt"))).toBe(true);
    expect(existsSync(join(targetDir, "b.txt"))).toBe(true);
  });

  it("records error if destination already exists or file is missing", async () => {
    writeFileSync(join(testRoot, "existing.txt"), "original");
    writeFileSync(join(testRoot, "target.txt"), "already-there");

    const res = await app.inject({
      method: "POST",
      url: "/files/batch-move",
      payload: {
        projectId: "proj-123",
        moves: [
          { src: "existing.txt", dest: "target.txt" },
          { src: "missing.txt", dest: "missing-target.txt" },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.moved).toEqual([]);
    expect(body.errors).toBeDefined();
    expect(body.errors["existing.txt"]).toBeDefined();
    expect(body.errors["missing.txt"]).toBeDefined();
  });
});
