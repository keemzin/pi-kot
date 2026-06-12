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
};
