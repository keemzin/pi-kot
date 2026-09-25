import type { FastifyPluginAsync } from "fastify";
import { existsSync, statSync, readdirSync, createReadStream } from "node:fs";
import { join, extname, resolve, relative } from "node:path";
import { config } from "../config.js";

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
  ".mjs": "text/javascript; charset=utf-8",
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
  ".map": "application/json; charset=utf-8",
};

export function safeArtifactPath(raw: string): string | undefined {
  if (!raw) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;
  const normalized = decoded.replace(/\\/g, "/").replace(/\/+/g, "/");

  const segments = normalized.split("/");
  for (const seg of segments) {
    if (seg === ".." || seg === ".") {
      return undefined;
    }
  }

  const clean = normalized.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!clean) return undefined;

  return clean;
}

export interface ArtifactFileInfo {
  name: string;
  type: string;
  size: number;
  modified: string;
  source: string;
}

export function walkArtifactDir(baseDir: string, currentDir: string = baseDir, maxDepth = 10): ArtifactFileInfo[] {
  if (maxDepth <= 0) return [];
  const results: ArtifactFileInfo[] = [];
  try {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(currentDir, entry.name);
      if (entry.isFile()) {
        try {
          const stat = statSync(fullPath);
          const relPath = relative(baseDir, fullPath).replace(/\\/g, "/");
          results.push({
            name: relPath,
            type: extname(entry.name).toLowerCase().slice(1) || "unknown",
            size: stat.size,
            modified: stat.mtime.toISOString(),
            source: baseDir,
          });
        } catch {
          // ignore stat error
        }
      } else if (entry.isDirectory()) {
        results.push(...walkArtifactDir(baseDir, fullPath, maxDepth - 1));
      }
    }
  } catch {
    // ignore readdir error
  }
  return results;
}

export function getArtifactDirs(cwd?: string): string[] {
  const dirs: string[] = [];
  const seen = new Set<string>();

  const addDir = (dir: string) => {
    const resolved = resolve(dir);
    if (!seen.has(resolved) && existsSync(resolved)) {
      seen.add(resolved);
      dirs.push(resolved);
    }
  };

  if (cwd) {
    addDir(join(cwd, ".pi", "artifacts"));
    addDir(join(cwd, ".pi", "artifact"));
  }

  for (const known of knownCwds) {
    addDir(join(known, ".pi", "artifacts"));
    addDir(join(known, ".pi", "artifact"));
  }

  addDir(join(config.workspacePath, ".pi", "artifacts"));
  addDir(join(config.workspacePath, ".pi", "artifact"));

  try {
    const entries = readdirSync(config.workspacePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        addDir(join(config.workspacePath, entry.name, ".pi", "artifacts"));
        addDir(join(config.workspacePath, entry.name, ".pi", "artifact"));
      }
    }
  } catch {
    // ignore
  }

  return dirs;
}

/**
 * Serve agent-created artifacts from .pi/artifacts/.
 * These are files the agent writes for user-visible output
 * (screenshots, diagrams, HTML reports, etc.).
 */
export const artifactRoutes: FastifyPluginAsync = async (fastify) => {
  // List all artifacts. Optional ?cwd=<path> filters to that directory only.
  fastify.get<{ Querystring: { cwd?: string } }>(
    "/artifacts",
    { config: { public: true } },
    async (req, reply) => {
      const files: ArtifactFileInfo[] = [];
      const seenNames = new Set<string>();

      // If cwd is provided, only search that directory
      const dirs: string[] = [];
      if (req.query.cwd) {
        const specificDir = join(req.query.cwd, ".pi", "artifacts");
        const specificAltDir = join(req.query.cwd, ".pi", "artifact");
        if (existsSync(specificDir)) {
          dirs.push(specificDir);
        }
        if (existsSync(specificAltDir)) {
          dirs.push(specificAltDir);
        }
        if (dirs.length === 0) {
          return reply.send({ files: [] });
        }
      } else {
        dirs.push(...getArtifactDirs());
      }

      for (const dir of dirs) {
        const found = walkArtifactDir(dir);
        for (const file of found) {
          if (!seenNames.has(file.name)) {
            seenNames.add(file.name);
            files.push(file);
          }
        }
      }

      // Sort by modified time (newest first)
      files.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

      return reply.send({ files });
    },
  );

  // Serve artifact file (supports nested subpaths e.g. /artifacts/folder/html.html)
  fastify.get<{ Params: { "*": string }; Querystring: { cwd?: string } }>(
    "/artifacts/*",
    {
      config: { public: true },
    },
    async (req, reply) => {
      const raw = (req.params as Record<string, string>)["*"] || "";
      const name = safeArtifactPath(raw);
      if (!name) {
        return reply.code(400).send({ error: "Invalid artifact name" });
      }

      const artifactDirs = getArtifactDirs(req.query.cwd);

      let resolvedFile = "";
      for (const artifactDir of artifactDirs) {
        const resolvedDir = resolve(artifactDir);
        const candidate = resolve(resolvedDir, name);
        if ((candidate === resolvedDir || candidate.startsWith(resolvedDir + "/")) && existsSync(candidate)) {
          try {
            if (statSync(candidate).isFile()) {
              resolvedFile = candidate;
              break;
            }
          } catch {
            // ignore
          }
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
