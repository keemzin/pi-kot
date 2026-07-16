import type { FastifyPluginAsync } from "fastify";
import { existsSync } from "node:fs";
import { createReadStream } from "node:fs";
import { join, extname, resolve } from "node:path";
import { config } from "../config.js";
import { readdirSync } from "node:fs";

// Track all CWDs where the agent has worked, so we can find artifacts anywhere
const knownCwds = new Set<string>([config.workspacePath]);

export function registerArtifactCwd(cwd: string): void {
  knownCwds.add(cwd);
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function safeName(raw: string): string | undefined {
  const name = decodeURIComponent(raw).replace(/^\/+/, "");
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    return undefined;
  }
  return name;
}

/**
 * Serve agent-created artifacts from .pi/artifacts/.
 * These are files the agent writes for user-visible output
 * (screenshots, diagrams, HTML reports, etc.).
 */
export const artifactRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { filename: string } }>(
    "/artifacts/:filename",
    {
      config: { public: true },
      schema: { params: { type: "object", properties: { filename: { type: "string" } }, required: ["filename"] } },
    },
    async (req, reply) => {
      const name = safeName(req.params.filename);
      if (!name) {
        return reply.code(400).send({ error: "Invalid artifact name" });
      }

      // Search for .pi/artifacts/ in:
      // 1. All known CWDs (registered via registerArtifactCwd)
      // 2. Workspace root
      // 3. All project subdirectories (scan for .pi/artifacts/)
      const artifactDirs: string[] = [];
      const seen = new Set<string>();

      const addDir = (dir: string) => {
        if (!seen.has(dir) && existsSync(dir)) {
          seen.add(dir);
          artifactDirs.push(dir);
        }
      };

      // Known CWDs
      for (const cwd of knownCwds) {
        addDir(join(cwd, ".pi", "artifacts"));
      }

      // Workspace root
      addDir(join(config.workspacePath, ".pi", "artifacts"));

      // Scan project subdirectories
      try {
        const entries = readdirSync(config.workspacePath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith(".")) {
            addDir(join(config.workspacePath, entry.name, ".pi", "artifacts"));
          }
        }
      } catch {
        // ignore
      }

      let resolvedFile = "";
      for (const artifactDir of artifactDirs) {
        const filePath = resolve(artifactDir, name);
        if (filePath.startsWith(artifactDir) && existsSync(filePath)) {
          resolvedFile = filePath;
          break;
        }
      }

      if (!resolvedFile) {
        return reply.code(404).send({ error: "Artifact not found" });
      }

      const ext = extname(resolvedFile).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      const stream = createReadStream(resolvedFile);
      return reply
        .header("content-type", contentType)
        .header("cache-control", "no-store")
        .send(stream);
    },
  );
};
