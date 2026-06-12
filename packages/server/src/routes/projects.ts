import type { FastifyPluginAsync } from "fastify";
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  ProjectNotFoundError,
  InvalidNameError,
  DuplicatePathError,
} from "../project-manager.js";
import {
  validateCloneUrl,
  cloneRepository,
  assertTargetClonable,
  GitCloneError,
  parseProgressLine,
  type CloneEvent,
} from "../git-clone.js";
import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { config } from "../config.js";

export const projectRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/projects — list all projects
  fastify.get(
    "/projects",
    {
      schema: {
        description: "List all projects.",
        tags: ["projects"],
        response: {
          200: {
            type: "object",
            required: ["projects"],
            properties: {
              projects: {
                type: "array",
                items: {
                  type: "object",
                  required: ["id", "name", "path", "createdAt"],
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    path: { type: "string" },
                    createdAt: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      const projects = await listProjects();
      return { projects };
    },
  );

  // POST /api/v1/projects — create a new project
  fastify.post<{
    Body: { name: string; path: string };
  }>(
    "/projects",
    {
      schema: {
        description: "Create a new project.",
        tags: ["projects"],
        body: {
          type: "object",
          required: ["name", "path"],
          properties: {
            name: { type: "string", minLength: 1 },
            path: { type: "string", minLength: 1 },
          },
        },
        response: {
          201: {
            type: "object",
            required: ["id", "name", "path", "createdAt"],
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              path: { type: "string" },
              createdAt: { type: "string" },
            },
          },
          400: {
            type: "object",
            properties: { error: { type: "string" }, message: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const project = await createProject(req.body.name, req.body.path);
        return reply.code(201).send(project);
      } catch (err) {
        if (
          err instanceof InvalidNameError ||
          err instanceof DuplicatePathError
        ) {
          return reply.code(400).send({ error: err.name, message: err.message });
        }
        throw err;
      }
    },
  );

  // PATCH /api/v1/projects/:id — update a project
  fastify.patch<{
    Params: { id: string };
    Body: { name?: string; path?: string };
  }>(
    "/projects/:id",
    {
      schema: {
        description: "Update a project's name or path.",
        tags: ["projects"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            path: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["id", "name", "path", "createdAt"],
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              path: { type: "string" },
              createdAt: { type: "string" },
            },
          },
          400: {
            type: "object",
            properties: { error: { type: "string" }, message: { type: "string" } },
          },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const project = await updateProject(req.params.id, req.body);
        return project;
      } catch (err) {
        if (err instanceof ProjectNotFoundError) {
          return reply.code(404).send({ error: "project_not_found" });
        }
        if (
          err instanceof InvalidNameError ||
          err instanceof DuplicatePathError
        ) {
          return reply.code(400).send({ error: err.name, message: err.message });
        }
        throw err;
      }
    },
  );

  // DELETE /api/v1/projects/:id — delete a project
  fastify.delete<{
    Params: { id: string };
  }>(
    "/projects/:id",
    {
      schema: {
        description: "Delete a project.",
        tags: ["projects"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["deleted"],
            properties: { deleted: { type: "boolean" } },
          },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        await deleteProject(req.params.id);
        return { deleted: true };
      } catch (err) {
        if (err instanceof ProjectNotFoundError) {
          return reply.code(404).send({ error: "project_not_found" });
        }
        throw err;
      }
    },
  );

  // POST /api/v1/projects/clone — clone a git repo and create a project
  fastify.post<{
    Body: {
      url: string;
      folderName: string;
      projectName: string;
      branch?: string;
      token?: string;
      insecureTls?: boolean;
    };
  }>(
    "/projects/clone",
    {
      schema: {
        description:
          "Clone a git repository into the workspace, then create a project. " +
          "Streams progress as SSE events.\n\n" +
          "Events: started, progress, stderr, done (with project), error.",
        tags: ["projects"],
        body: {
          type: "object",
          required: ["url", "folderName", "projectName"],
          properties: {
            url: { type: "string" },
            folderName: { type: "string" },
            projectName: { type: "string" },
            branch: { type: "string" },
            token: { type: "string" },
            insecureTls: { type: "boolean" },
          },
        },
      },
    },
    async (req, reply) => {
      const { url, folderName, projectName, branch, token, insecureTls } = req.body;

      // ---- pre-stream validation ----
      try {
        validateCloneUrl(url);
      } catch (err) {
        if (err instanceof GitCloneError) {
          return reply.code(400).send({ error: err.code, message: err.message });
        }
        throw err;
      }

      if (
        folderName.includes("/") ||
        folderName.includes("\\") ||
        folderName === "." ||
        folderName === ".."
      ) {
        return reply.code(400).send({ error: "invalid_directory_name" });
      }

      const targetPath = resolve(config.workspacePath, folderName);
      try {
        await assertTargetClonable(targetPath);
      } catch (err) {
        if (err instanceof GitCloneError) {
          const status = err.code === "target_not_empty" ? 409 : 400;
          return reply.code(status).send({ error: err.code, message: err.message });
        }
        throw err;
      }

      // Ensure parent exists
      await mkdir(config.workspacePath, { recursive: true });

      // ---- start SSE stream ----
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        raw.write(": heartbeat\n\n");
      }, 15_000);

      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        raw.end();
      };

      req.raw.on("close", close);
      req.raw.on("error", close);

      const writeEvent = (event: Record<string, unknown>): void => {
        if (closed) return;
        try {
          raw.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch {
          close();
        }
      };

      try {
        const gen = cloneRepository({
          url,
          target: targetPath,
          branch,
          token,
          insecureTls,
        });

        for await (const event of gen) {
          writeEvent(event);

          if (event.type === "done") {
            // Create the project
            try {
              const project = await createProject(projectName, targetPath);
              writeEvent({ type: "done", target: targetPath });
              writeEvent({
                type: "project_created" as any,
                id: project.id,
                name: project.name,
                path: project.path,
              } as any);
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Failed to create project";
              writeEvent({ type: "error" as const, message: msg });
            }
            break;
          }

          if (event.type === "error") {
            break;
          }
        }
      } catch (err) {
        writeEvent({
          type: "error",
          message: err instanceof Error ? err.message : "Clone failed",
        });
      }

      close();
    },
  );
};
