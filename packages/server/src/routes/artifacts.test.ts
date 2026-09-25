import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { artifactRoutes, safeArtifactPath, walkArtifactDir } from "./artifacts.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("artifacts route", () => {
  let app: FastifyInstance;
  let testDir: string;
  let artifactDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `pi-kot-test-artifacts-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    artifactDir = join(testDir, ".pi", "artifacts");
    mkdirSync(artifactDir, { recursive: true });

    app = Fastify();
    await app.register(artifactRoutes);
  });

  afterEach(async () => {
    await app.close();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("safeArtifactPath", () => {
    it("allows standard filenames", () => {
      expect(safeArtifactPath("test.html")).toBe("test.html");
      expect(safeArtifactPath("report.json")).toBe("report.json");
    });

    it("allows nested subfolder paths", () => {
      expect(safeArtifactPath("folder/html.html")).toBe("folder/html.html");
      expect(safeArtifactPath("sub/dir/nested.png")).toBe("sub/dir/nested.png");
    });

    it("handles percent-encoded paths", () => {
      expect(safeArtifactPath("folder%2Fhtml.html")).toBe("folder/html.html");
      expect(safeArtifactPath("my%20folder%2Ffile.html")).toBe("my folder/file.html");
    });

    it("rejects path traversal attempts", () => {
      expect(safeArtifactPath("../secret.txt")).toBeUndefined();
      expect(safeArtifactPath("folder/../../secret.txt")).toBeUndefined();
      expect(safeArtifactPath("..\\secret.txt")).toBeUndefined();
      expect(safeArtifactPath("folder/..")).toBeUndefined();
      expect(safeArtifactPath("folder/.")).toBeUndefined();
    });

    it("rejects empty or null-byte paths", () => {
      expect(safeArtifactPath("")).toBeUndefined();
      expect(safeArtifactPath("test\0.html")).toBeUndefined();
    });
  });

  describe("walkArtifactDir", () => {
    it("recursively discovers files in subdirectories", () => {
      mkdirSync(join(artifactDir, "folder", "sub"), { recursive: true });
      writeFileSync(join(artifactDir, "root.html"), "<h1>Root</h1>");
      writeFileSync(join(artifactDir, "folder", "html.html"), "<h1>Nested</h1>");
      writeFileSync(join(artifactDir, "folder", "sub", "deep.json"), "{}");
      writeFileSync(join(artifactDir, ".hidden.txt"), "secret");

      const files = walkArtifactDir(artifactDir);
      const names = files.map((f) => f.name).sort();

      expect(names).toEqual(["folder/html.html", "folder/sub/deep.json", "root.html"].sort());
      expect(names).not.toContain(".hidden.txt");

      const nestedHtml = files.find((f) => f.name === "folder/html.html");
      expect(nestedHtml?.type).toBe("html");
    });
  });

  describe("GET /artifacts", () => {
    it("returns nested files with ?cwd query", async () => {
      mkdirSync(join(artifactDir, "folder"), { recursive: true });
      writeFileSync(join(artifactDir, "root.html"), "<h1>Root</h1>");
      writeFileSync(join(artifactDir, "folder", "html.html"), "<h1>Folder</h1>");

      const res = await app.inject({
        method: "GET",
        url: `/artifacts?cwd=${encodeURIComponent(testDir)}`,
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.files).toBeDefined();
      const names = json.files.map((f: { name: string }) => f.name);
      expect(names).toContain("root.html");
      expect(names).toContain("folder/html.html");
    });
  });

  describe("GET /artifacts/*", () => {
    it("serves root artifact file", async () => {
      writeFileSync(join(artifactDir, "index.html"), "<h1>Hello</h1>");

      const res = await app.inject({
        method: "GET",
        url: `/artifacts/index.html?cwd=${encodeURIComponent(testDir)}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(res.body).toBe("<h1>Hello</h1>");
    });

    it("serves nested artifact file inside folder", async () => {
      mkdirSync(join(artifactDir, "folder"), { recursive: true });
      writeFileSync(join(artifactDir, "folder", "html.html"), "<h1>Folder HTML</h1>");

      const res = await app.inject({
        method: "GET",
        url: `/artifacts/folder/html.html?cwd=${encodeURIComponent(testDir)}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(res.body).toBe("<h1>Folder HTML</h1>");
    });

    it("serves nested artifact file with encoded slash", async () => {
      mkdirSync(join(artifactDir, "folder"), { recursive: true });
      writeFileSync(join(artifactDir, "folder", "html.html"), "<h1>Folder HTML</h1>");

      const res = await app.inject({
        method: "GET",
        url: `/artifacts/folder%2Fhtml.html?cwd=${encodeURIComponent(testDir)}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(res.body).toBe("<h1>Folder HTML</h1>");
    });

    it("returns 404 for missing nested artifact", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/artifacts/folder/missing.html?cwd=${encodeURIComponent(testDir)}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Artifact not found" });
    });

    it("rejects path traversal with 400", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/artifacts/..%2F..%2Fetc%2Fpasswd?cwd=${encodeURIComponent(testDir)}`,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Invalid artifact name" });
    });

    it("returns 404 if path points to a directory", async () => {
      mkdirSync(join(artifactDir, "folder"), { recursive: true });

      const res = await app.inject({
        method: "GET",
        url: `/artifacts/folder?cwd=${encodeURIComponent(testDir)}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Artifact not found" });
    });
  });
});
