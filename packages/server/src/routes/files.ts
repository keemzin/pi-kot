import { basename, dirname, join } from "node:path";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import {
  ChecksumMismatchError,
  DirectoryNotEmptyError,
  FileTooLargeError,
  InvalidNameError,
  NotAFileError,
  NotFoundError,
  PathOutsideRootError,
  TargetExistsError,
  deleteEntry,
  downloadStream,
  getTree,
  listAllFiles,
  makeDirectory,
  moveEntry,
  readFile,
  renameEntry,
  writeFile,
  writeFileBytes,
} from "../file-manager.js";
import { config } from "../config.js";
import { getProject } from "../workspace-store.js";
import { searchFiles, SearchEngineUnavailableError } from "../file-searcher.js";
import { errorSchema } from "./_schemas.js";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB per file
const MAX_UPLOAD_FILES = 50;
const MAX_TOTAL_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB aggregate

const treeNodeSchema = {
  type: "object",
  required: ["name", "path", "type"],
  additionalProperties: true,
  properties: {
    name: { type: "string" },
    path: { type: "string" },
    type: { type: "string", enum: ["file", "directory"] },
    children: { type: "array", items: { type: "object", additionalProperties: true } },
    truncated: { type: "boolean" },
  },
} as const;

const readResponseSchema = {
  type: "object",
  required: ["path", "content", "size", "language", "binary"],
  properties: {
    path: { type: "string" },
    content: { type: "string" },
    size: { type: "integer", minimum: 0 },
    language: { type: "string" },
    binary: { type: "boolean" },
  },
} as const;

function clampLimit(raw: string | undefined): number {
  if (raw === undefined) return 50;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(n, 200);
}

function mapError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof PathOutsideRootError) {
    return reply.code(403).send({ error: "path_not_allowed", message: "path is outside the project root" });
  }
  if (err instanceof InvalidNameError) {
    return reply.code(400).send({ error: "invalid_name", message: err.message });
  }
  if (err instanceof NotFoundError) {
    return reply.code(404).send({ error: "not_found", message: "file or directory not found" });
  }
  if (err instanceof NotAFileError) {
    return reply.code(400).send({ error: "not_a_file", message: "target is not a regular file" });
  }
  if (err instanceof FileTooLargeError) {
    return reply.code(413).send({ error: "file_too_large", message: `${err.size} > ${err.limit}` });
  }
  if (err instanceof DirectoryNotEmptyError) {
    return reply.code(409).send({
      error: "directory_not_empty",
      message: "delete the contents first; recursive delete is not supported",
    });
  }
  if (err instanceof TargetExistsError) {
    return reply.code(409).send({ error: "target_exists", message: "destination already exists" });
  }
  if (err instanceof ChecksumMismatchError) {
    return reply.code(422).send({
      error: "checksum_mismatch",
      message: `expected sha256 ${err.expected}, computed ${err.actual}`,
    });
  }
  if (err instanceof SearchEngineUnavailableError) {
    return reply.code(503).send({ error: "engine_unavailable", message: err.message });
  }
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") {
    return reply.code(404).send({ error: "not_found", message: "file or directory not found" });
  }
  if (code === "EACCES" || code === "EPERM") {
    return reply.code(403).send({ error: "permission_denied", message: "filesystem permission denied" });
  }
  if (code === "EISDIR") {
    return reply.code(400).send({ error: "not_a_file", message: "target is a directory, not a file" });
  }
  if (code === "ENOTDIR") {
    return reply.code(400).send({ error: "not_a_directory", message: "target is a file, not a directory" });
  }
  reply.log.error({ err }, "unmapped file-manager error");
  return reply.code(500).send({ error: "internal_error" });
}

async function resolveProject(
  projectId: string,
  reply: FastifyReply,
): Promise<{ id: string; path: string } | undefined> {
  const project = await getProject(projectId);
  if (project === undefined) {
    await reply.code(404).send({ error: "project_not_found", message: "no project with that id" });
    return undefined;
  }
  return { id: project.id, path: project.path };
}

export const fileRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { projectId: string; query?: string; limit?: string } }>(
    "/files/complete",
    {
      logLevel: "warn",
      schema: {
        description:
          "Flat list of project files matching `query` (path-substring, " +
          "case-insensitive). Used by the chat input's `@` autocomplete. " +
          "Skips the same noisy directories as /files/tree. Returns up to " +
          "`limit` (default 50) POSIX-style paths relative to the project " +
          "root, ranked so a basename match beats a deep-path match and " +
          "shorter paths beat longer ones.",
        tags: ["files"],
        querystring: {
          type: "object",
          required: ["projectId"],
          properties: {
            projectId: { type: "string", minLength: 1 },
            query: { type: "string", maxLength: 256 },
            limit: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["paths"],
            properties: { paths: { type: "array", items: { type: "string" } } },
          },
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const project = await getProject(req.query.projectId);
      if (project === undefined) {
        return reply.code(404).send({ error: "project_not_found" });
      }
      const query = (req.query.query ?? "").toLowerCase();
      const limit = clampLimit(req.query.limit);
      try {
        const all = await listAllFiles(project.path);
        if (query.length === 0) {
          return { paths: all.sort().slice(0, limit) };
        }
        interface Scored {
          path: string;
          score: number;
        }
        const scored: Scored[] = [];
        for (const p of all) {
          const lower = p.toLowerCase();
          const slash = lower.lastIndexOf("/");
          const base = slash === -1 ? lower : lower.slice(slash + 1);
          let score: number;
          if (base === query) score = 0;
          else if (base.startsWith(query)) score = 1;
          else if (base.includes(query)) score = 2;
          else if (lower.includes(query)) score = 3;
          else continue;
          scored.push({ path: p, score });
        }
        scored.sort((a, b) =>
          a.score !== b.score ? a.score - b.score : a.path.length - b.path.length,
        );
        return { paths: scored.slice(0, limit).map((s) => s.path) };
      } catch (err) {
        return mapError(reply, err);
      }
    },
  );

  fastify.get<{ Querystring: { projectId: string; maxDepth?: string } }>(
    "/files/tree",
    {
      schema: {
        description:
          "Recursive directory tree for the project. Skips noisy folders " +
          "(node_modules, .git, dist, build, __pycache__, .next, .nuxt, " +
          "coverage, .vite, .turbo, .cache). Recursion is capped at " +
          "max depth 32 to avoid unbounded filesystem walks.",
        tags: ["files"],
        querystring: {
          type: "object",
          required: ["projectId"],
          properties: {
            projectId: { type: "string", minLength: 1 },
            maxDepth: { type: "string", pattern: "^[0-9]+$" },
          },
        },
        response: { 200: treeNodeSchema, 404: errorSchema, 500: errorSchema },
      },
    },
    async (req, reply) => {
      const project = await resolveProject(req.query.projectId, reply);
      if (project === undefined) return reply;
      try {
        let maxDepth: number | undefined;
        if (req.query.maxDepth !== undefined) {
          const n = Number.parseInt(req.query.maxDepth, 10);
          maxDepth = Math.min(Math.max(n, 1), 32);
        }
        const tree = await getTree(project.path, maxDepth !== undefined ? { maxDepth } : {});
        return tree;
      } catch (err) {
        return mapError(reply, err);
      }
    },
  );

  fastify.get<{ Querystring: { projectId: string; path?: string } }>(
    "/files/download",
    {
      schema: {
        description:
          "Download a file or directory from the project. Files stream " +
          "verbatim with `Content-Disposition: attachment`; directories " +
          "stream as a zip archive (`<dir>.zip`) with the same exclusions " +
          "as the file tree (node_modules, .git, dist, build, etc.). Omitting " +
          "`path` downloads the whole project as a zip.",
        tags: ["files"],
        querystring: {
          type: "object",
          required: ["projectId"],
          properties: {
            projectId: { type: "string", minLength: 1 },
            path: { type: "string", minLength: 1 },
          },
        },
        response: {
          200: { type: "string", format: "binary" },
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const project = await resolveProject(req.query.projectId, reply);
      if (project === undefined) return reply;
      const target = req.query.path !== undefined ? join(project.path, req.query.path) : project.path;
      try {
        const result = await downloadStream(target, project.path);
        const asciiName = result.filename.replace(/[^\x20-\x7e]/g, "_");
        const utfName = encodeURIComponent(result.filename);
        reply.header(
          "Content-Disposition",
          `attachment; filename="${asciiName}"; filename*=UTF-8''${utfName}`,
        );
        if (result.kind === "file") {
          reply.header("Content-Type", "application/octet-stream");
          reply.header("Content-Length", String(result.size));
        } else {
          reply.header("Content-Type", "application/zip");
        }
        return reply.send(result.stream);
      } catch (err) {
        return mapError(reply, err);
      }
    },
  );

  fastify.get<{ Querystring: { projectId: string; path: string } }>(
    "/files/read",
    {
      schema: {
        description:
          "Read a UTF-8 file from the project. 5 MB cap (returns 413). " +
          "Binary files return `{ binary: true, content: '' }` rather than a " +
          "garbled UTF-8 decode — clients should not pass binary content " +
          "to the editor.",
        tags: ["files"],
        querystring: {
          type: "object",
          required: ["projectId", "path"],
          properties: {
            projectId: { type: "string", minLength: 1 },
            path: { type: "string", minLength: 1 },
          },
        },
        response: {
          200: readResponseSchema,
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          413: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const project = await resolveProject(req.query.projectId, reply);
      if (project === undefined) return reply;
      try {
        const result = await readFile(join(project.path, req.query.path), project.path);
        return result;
      } catch (err) {
        return mapError(reply, err);
      }
    },
  );

  fastify.put<{ Body: { projectId: string; path: string; content: string } }>(
    "/files/write",
    {
      schema: {
        description:
          "Atomic write (tmp + rename). Creates parent directories as " +
          "needed. The body's `path` is required to be inside the project " +
          "root — 403 otherwise.",
        tags: ["files"],
        body: {
          type: "object",
          required: ["projectId", "path", "content"],
          additionalProperties: false,
          properties: {
            projectId: { type: "string", minLength: 1 },
            path: { type: "string", minLength: 1 },
            content: { type: "string" },
          },
        },
        response: {
          200: { type: "object", required: ["path"], properties: { path: { type: "string" } } },
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const project = await resolveProject(req.body.projectId, reply);
      if (project === undefined) return reply;
      try {
        await writeFile(join(project.path, req.body.path), project.path, req.body.content);
        return { path: req.body.path };
      } catch (err) {
        return mapError(reply, err);
      }
    },
  );

  fastify.post<{ Body: { projectId: string; parentPath: string; name: string } }>(
    "/files/mkdir",
    {
      schema: {
        description: "Create a single directory under `parentPath`.",
        tags: ["files"],
        body: {
          type: "object",
          required: ["projectId", "parentPath", "name"],
          additionalProperties: false,
          properties: {
            projectId: { type: "string", minLength: 1 },
            parentPath: { type: "string", minLength: 1 },
            name: { type: "string", minLength: 1 },
          },
        },
        response: {
          200: { type: "object", required: ["path"], properties: { path: { type: "string" } } },
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const project = await resolveProject(req.body.projectId, reply);
      if (project === undefined) return reply;
      try {
        const created = await makeDirectory(join(project.path, req.body.parentPath), project.path, req.body.name);
        return { path: created };
      } catch (err) {
        return mapError(reply, err);
      }
    },
  );

  fastify.post<{ Body: { projectId: string; path: string; name: string } }>(
    "/files/rename",
    {
      schema: {
        description:
          "Rename a file or directory in place — `name` is the new basename. " +
          "Use /files/move to relocate across directories.",
        tags: ["files"],
        body: {
          type: "object",
          required: ["projectId", "path", "name"],
          additionalProperties: false,
          properties: {
            projectId: { type: "string", minLength: 1 },
            path: { type: "string", minLength: 1 },
            name: { type: "string", minLength: 1 },
          },
        },
        response: {
          200: { type: "object", required: ["path"], properties: { path: { type: "string" } } },
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const project = await resolveProject(req.body.projectId, reply);
      if (project === undefined) return reply;
      try {
        const renamed = await renameEntry(join(project.path, req.body.path), project.path, req.body.name);
        return { path: renamed };
      } catch (err) {
        return mapError(reply, err);
      }
    },
  );

  fastify.post<{ Body: { projectId: string; src: string; dest: string } }>(
    "/files/move",
    {
      schema: {
        description:
          "Move a file or directory to `dest` (a full destination path). " +
          "Refuses to move a directory under itself; refuses if `dest` " +
          "already exists.",
        tags: ["files"],
        body: {
          type: "object",
          required: ["projectId", "src", "dest"],
          additionalProperties: false,
          properties: {
            projectId: { type: "string", minLength: 1 },
            src: { type: "string", minLength: 1 },
            dest: { type: "string", minLength: 1 },
          },
        },
        response: {
          200: { type: "object", required: ["path"], properties: { path: { type: "string" } } },
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const project = await resolveProject(req.body.projectId, reply);
      if (project === undefined) return reply;
      try {
        const moved = await moveEntry(join(project.path, req.body.src), join(project.path, req.body.dest), project.path);
        return { path: moved };
      } catch (err) {
        return mapError(reply, err);
      }
    },
  );

  fastify.delete<{ Querystring: { projectId: string; path: string; recursive?: string } }>(
    "/files/delete",
    {
      schema: {
        description:
          "Delete a file or directory. Empty directories delete unconditionally. " +
          "Non-empty directories return 409 unless `?recursive=true` is set, in " +
          "which case the entire subtree is removed. The UI prompts the user with " +
          "a second confirmation before retrying with the recursive flag — single- " +
          "user single-tenant, but `rm -rf` should still be an explicit choice.",
        tags: ["files"],
        querystring: {
          type: "object",
          required: ["projectId", "path"],
          properties: {
            projectId: { type: "string", minLength: 1 },
            path: { type: "string", minLength: 1 },
            recursive: { type: "string", enum: ["true", "false"] },
          },
        },
        response: {
          204: { type: "null" },
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const project = await resolveProject(req.query.projectId, reply);
      if (project === undefined) return reply;
      try {
        const recursive = req.query.recursive === "true";
        await deleteEntry(join(project.path, req.query.path), project.path, { recursive });
        return reply.code(204).send();
      } catch (err) {
        return mapError(reply, err);
      }
    },
  );

  fastify.get<{
    Querystring: {
      projectId: string;
      q: string;
      regex?: string;
      caseSensitive?: string;
      includeGitignored?: string;
      include?: string;
      exclude?: string;
      limit?: string;
    };
  }>(
    "/files/search",
    {
      schema: {
        description:
          "Cross-project text + regex search. Uses ripgrep when available " +
          "(fast + gitignore-aware) and falls back to a Node walk on hosts " +
          "without rg. Response includes `engine: 'ripgrep' | 'node'` so the " +
          "UI can render a fallback-mode badge. Hard caps: 1000 matches max " +
          "per request, 30s wall clock, 5 MB per file. Binary files are " +
          "skipped via NUL-byte heuristic on the fallback path; ripgrep " +
          "uses its own (better) binary detection.",
        tags: ["files"],
        querystring: {
          type: "object",
          required: ["projectId", "q"],
          properties: {
            projectId: { type: "string", minLength: 1 },
            q: { type: "string", minLength: 1, maxLength: 1024 },
            regex: { type: "string", enum: ["0", "1", "true", "false"] },
            caseSensitive: { type: "string", enum: ["0", "1", "true", "false"] },
            includeGitignored: { type: "string", enum: ["0", "1", "true", "false"] },
            include: { type: "string", maxLength: 256 },
            exclude: { type: "string", maxLength: 256 },
            limit: { type: "string", pattern: "^[0-9]+$" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["engine", "matches", "truncated"],
            properties: {
              engine: { type: "string", enum: ["ripgrep", "node"] },
              truncated: { type: "boolean" },
              matches: {
                type: "array",
                items: {
                  type: "object",
                  required: ["path", "line", "column", "length", "lineSnippet"],
                  properties: {
                    path: { type: "string" },
                    line: { type: "integer", minimum: 1 },
                    column: { type: "integer", minimum: 1 },
                    length: { type: "integer", minimum: 0 },
                    lineSnippet: { type: "string" },
                  },
                },
              },
            },
          },
          400: errorSchema,
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const project = await resolveProject(req.query.projectId, reply);
      if (project === undefined) return reply;
      const { q } = req.query;
      const regex = req.query.regex === "1" || req.query.regex === "true";
      const caseSensitive = req.query.caseSensitive === "1" || req.query.caseSensitive === "true";
      const includeGitignored =
        req.query.includeGitignored === "1" || req.query.includeGitignored === "true";
      const limit =
        req.query.limit !== undefined
          ? Math.min(1000, Math.max(1, Number.parseInt(req.query.limit, 10)))
          : 200;
      try {
        const opts: Parameters<typeof searchFiles>[1] = {
          query: q,
          regex,
          caseSensitive,
          includeGitignored,
          limit,
          timeoutMs: 30_000,
        };
        if (req.query.include !== undefined && req.query.include.length > 0) {
          opts.include = req.query.include;
        }
        if (req.query.exclude !== undefined && req.query.exclude.length > 0) {
          opts.exclude = req.query.exclude;
        }
        const result = await searchFiles(project.path, opts);
        return result;
      } catch (err) {
        return mapError(reply, err);
      }
    },
  );

  // GET /api/v1/filesystem/home — filesystem home directory (public, no auth)
  fastify.get<{}>(
    "/filesystem/home",
    {
      config: { public: true },
      schema: {
        description:
          "Returns the user's home directory path. Used by the Add Project " +
          "dialog to initialise the path input to ~/.",
        tags: ["filesystem"],
        response: {
          200: {
            type: "object",
            required: ["home"],
            properties: { home: { type: "string" } },
          },
        },
      },
    },
    async () => {
      const { homedir } = await import("node:os");
      return { home: homedir() };
    },
  );

  // GET /api/v1/filesystem/list — list directory entries (public, no auth)
  fastify.get<{ Querystring: { path?: string } }>(
    "/filesystem/list",
    {
      config: { public: true },
      schema: {
        description:
          "Lists directory entries (name, path, isDirectory) for a given " +
          "filesystem path. Used by the Add Project dialog for live directory " +
          "browsing. Hidden entries (dotfiles) are returned — filtering is " +
          "the client's choice.",
        tags: ["filesystem"],
        querystring: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute filesystem path to list" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["entries"],
            properties: {
              entries: {
                type: "array",
                items: {
                  type: "object",
                  required: ["name", "path", "isDirectory"],
                  properties: {
                    name: { type: "string" },
                    path: { type: "string" },
                    isDirectory: { type: "boolean" },
                  },
                },
              },
            },
          },
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const { readdir, stat } = await import("node:fs/promises");
      const targetPath = (req.query.path ?? "").trim();
      if (!targetPath) {
        return reply.code(400).send({ error: "path_required", message: "path query parameter is required" });
      }

      try {
        const st = await stat(targetPath);
        if (!st.isDirectory()) {
          return reply.code(400).send({ error: "not_a_directory", message: "path is not a directory" });
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          return reply.code(404).send({ error: "not_found", message: "directory not found" });
        }
        if (code === "EACCES" || code === "EPERM") {
          return reply.code(403).send({ error: "permission_denied", message: "permission denied" });
        }
        throw err;
      }

      const entries: Array<{ name: string; path: string; isDirectory: boolean }> = [];
      try {
        const dirEntries = await readdir(targetPath, { withFileTypes: true });
        for (const entry of dirEntries) {
          entries.push({
            name: entry.name,
            path: join(targetPath, entry.name),
            isDirectory: entry.isDirectory(),
          });
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EACCES" || code === "EPERM") {
          return reply.code(403).send({ error: "permission_denied", message: "permission denied" });
        }
        throw err;
      }

      // Sort: directories first, then by name
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return { entries };
    },
  );

  // ----------------------------- upload -----------------------------
  // Multipart upload of one or more files into a project folder.
  // Each file is streamed to a tmp path, hashed with SHA-256 as bytes
  // flow, and atomically renamed into place. Per-file and aggregate
  // caps are enforced.
  fastify.post<{
    Body: unknown;
  }>(
    "/files/upload",
    {
      schema: {
        description:
          `Upload one or more files into a project folder via multipart/form-data. ` +
          `Each file is streamed to disk, its SHA-256 is computed on the fly, and ` +
          `the rename to the final name is performed atomically (tmp + rename). ` +
          `Per-file cap: ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB. Aggregate cap: ` +
          `${MAX_TOTAL_UPLOAD_BYTES / (1024 * 1024)} MB across all parts. Max ` +
          `${MAX_UPLOAD_FILES} files per request. Existing targets return 409 unless ` +
          `\`overwrite=1\` is sent.`,
        tags: ["files"],
        consumes: ["multipart/form-data"],
        response: {
          200: {
            type: "object",
            required: ["files"],
            properties: {
              files: {
                type: "array",
                items: {
                  type: "object",
                  required: ["path", "size", "sha256"],
                  properties: {
                    path: { type: "string" },
                    size: { type: "integer", minimum: 0 },
                    sha256: { type: "string" },
                  },
                },
              },
            },
          },
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
          413: errorSchema,
          415: errorSchema,
          422: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      if (!req.isMultipart()) {
        return reply.code(415).send({ error: "expected_multipart" });
      }
      let projectId: string | undefined;
      let parentPath: string | undefined;
      let overwrite = false;
      let aggregateBytes = 0;
      const relativePaths = new Map<string, string>();
      const written: { path: string; size: number; sha256: string }[] = [];
      try {
        const parts = req.parts({
          limits: {
            fileSize: MAX_UPLOAD_BYTES,
            files: MAX_UPLOAD_FILES,
            fields: MAX_UPLOAD_FILES * 2 + 8,
          },
        });
        for await (const part of parts) {
          if (part.type === "field") {
            if (part.fieldname === "projectId" && typeof part.value === "string") {
              projectId = part.value;
            } else if (part.fieldname === "parentPath" && typeof part.value === "string") {
              parentPath = part.value;
            } else if (part.fieldname === "overwrite" && typeof part.value === "string") {
              overwrite = part.value === "1" || part.value === "true";
            } else if (part.fieldname.startsWith("path:") && typeof part.value === "string") {
              const key = part.fieldname.slice("path:".length);
              if (key.length > 0) relativePaths.set(key, part.value);
            }
            continue;
          }
          // File part
          if (projectId === undefined) {
            return reply.code(400).send({
              error: "missing_field",
              message: "projectId must precede file parts in the multipart body",
            });
          }
          if (parentPath === undefined) {
            return reply.code(400).send({
              error: "missing_field",
              message: "parentPath must precede file parts in the multipart body",
            });
          }
          const project = await getProject(projectId);
          if (project === undefined) {
            return reply.code(404).send({ error: "project_not_found" });
          }
          const filename = part.filename;
          if (filename === undefined || filename.length === 0) {
            return reply.code(400).send({ error: "missing_filename" });
          }

          // Determine upload path: if a path:<index> field was sent, use it;
          // otherwise use the filename as-is (flat upload into parentPath).
          const indexedKey = part.fieldname.startsWith("file:")
            ? part.fieldname.slice("file:".length)
            : undefined;
          const uploadPath =
            indexedKey !== undefined ? (relativePaths.get(indexedKey) ?? filename) : filename;
          const isNested = uploadPath.includes("/") || uploadPath.includes("\\");

          // Enforce aggregate cap before starting the next file
          if (aggregateBytes >= MAX_TOTAL_UPLOAD_BYTES) {
            return reply.code(413).send({
              error: "aggregate_too_large",
              message: `Total upload size exceeds the ${MAX_TOTAL_UPLOAD_BYTES / (1024 * 1024)} MB aggregate limit.`,
            });
          }

          // Track aggregate as the stream flows
          const absParent = join(project.path, parentPath);
          req.log.info({ absParent, uploadPath, isNested, filename }, "upload: about to write");
          const trackedSource = (async function* () {
            for await (const chunk of part.file) {
              const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              aggregateBytes += buf.byteLength;
              if (aggregateBytes > MAX_TOTAL_UPLOAD_BYTES) {
                // Roll back already-written files
                for (const prior of written) {
                  await deleteEntry(prior.path, project.path).catch(() => undefined);
                }
                throw Object.assign(
                  new Error(`Aggregate upload exceeds ${MAX_TOTAL_UPLOAD_BYTES} bytes`),
                  { aggregateLimit: true },
                );
              }
              yield buf;
            }
          })();

          let result;
          try {
            if (isNested) {
              // For nested uploads (folder uploads with path:<index>),
              // write to parentPath/uploadPath directly
              const targetAbs = join(absParent, uploadPath);
              result = await writeFileBytes(dirname(targetAbs), basename(uploadPath), project.path, trackedSource, {
                overwrite,
              });
            } else {
              result = await writeFileBytes(absParent, uploadPath, project.path, trackedSource, {
                overwrite,
              });
            }
          } catch (err) {
            if ((err as Record<string, unknown>).aggregateLimit) {
              return reply.code(413).send({
                error: "aggregate_too_large",
                message: `Total upload size exceeds the ${MAX_TOTAL_UPLOAD_BYTES / (1024 * 1024)} MB aggregate limit.`,
              });
            }
            // Roll back everything written so far on any error
            for (const prior of written) {
              await deleteEntry(prior.path, project.path).catch(() => undefined);
            }
            throw err;
          }

          if (part.file.truncated) {
            await deleteEntry(result.path, project.path).catch(() => undefined);
            return reply.code(413).send({
              error: "file_too_large",
              message: `Upload "${filename}" exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB per-file limit.`,
            });
          }

          written.push(result);
        }
      } catch (err) {
        return mapError(reply, err);
      }

      return { files: written };
    },
  );

};
