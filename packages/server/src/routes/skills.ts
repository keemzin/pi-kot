/**
 * Skills endpoints — discover and manage pi agent skills.
 *
 * Mirrors the config/tools pattern:
 *   GET    /config/skills                 — list all skills (optionally scoped to a project)
 *   GET    /config/skills/:name           — get skill detail (content + frontmatter)
 *   PUT    /config/skills/:name           — update skill (description + instructions)
 *   GET    /config/skills/overrides        — per-project skill override cascade
 *   PUT    /config/skills/:name/enabled    — toggle global or per-project enable
 *   DELETE /config/skills/:name/enabled    — clear per-project override
 */
import { type FastifyPluginAsync } from "fastify";
import {
  loadSkills,
  type Skill,
  type ResourceDiagnostic,
  parseFrontmatter,
  stripFrontmatter,
} from "@earendil-works/pi-coding-agent";
import { config } from "../config.js";
import {
  readSkillOverrides,
  setSkillEnabled,
  setProjectSkillOverride,
  listSkillOverrides,
  isSkillEffective,
  getProjectOverride,
  type SkillOverrideState,
} from "../skill-policy.js";
import { errorSchema } from "./_schemas.js";
import { readFile, writeFile } from "node:fs/promises";

/**
 * Build a SkillSummary response shape from an SDK Skill + override state.
 */
function toSkillSummary(
  skill: Skill,
  overrides: Awaited<ReturnType<typeof readSkillOverrides>>,
  projectId: string | undefined,
) {
  return {
    name: skill.name,
    description: skill.description,
    source: mapSkillSource(skill.sourceInfo.source),
    filePath: skill.filePath,
    extensionPath:
      skill.sourceInfo.source === "extension"
        ? skill.sourceInfo.path
        : undefined,
    enabled: !overrides.global.includes(skill.name),
    projectOverride: getProjectOverride(overrides, projectId, skill.name),
    effective: isSkillEffective(overrides, projectId, skill.name),
    disableModelInvocation: skill.disableModelInvocation,
  };
}

/**
 * Map SDK source strings to the client enum.
 */
function mapSkillSource(source: string): "global" | "project" | "extension" {
  if (source === "extension") return "extension";
  if (source === "project") return "project";
  return "global";
}

/**
 * Map SDK ResourceDiagnostic to the client SkillDiagnostic shape.
 */
function toSkillDiagnostic(d: ResourceDiagnostic) {
  return {
    type: d.type as "warning" | "error" | "collision",
    message: d.message,
    path: d.path,
    collision: d.collision
      ? {
          resourceType: d.collision.resourceType,
          name: d.collision.name,
          winnerPath: d.collision.winnerPath,
          loserPath: d.collision.loserPath,
        }
      : undefined,
  };
}

export const skillRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /config/skills — list all skills ──────────────────────────

  fastify.get<{
    Querystring: { projectId?: string };
  }>(
    "/config/skills",
    {
      schema: {
        description:
          "List all discovered pi agent skills with their enable state. " +
          "Pass ?projectId to resolve per-project overrides in the response.",
        tags: ["config"],
        querystring: {
          type: "object",
          properties: {
            projectId: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["skills", "diagnostics"],
            properties: {
              skills: {
                type: "array",
                items: {
                  type: "object",
                  required: [
                    "name",
                    "description",
                    "source",
                    "filePath",
                    "enabled",
                    "effective",
                    "disableModelInvocation",
                  ],
                  properties: {
                    name: { type: "string" },
                    description: { type: "string" },
                    source: { type: "string", enum: ["global", "project", "extension"] },
                    filePath: { type: "string" },
                    extensionPath: { type: "string" },
                    enabled: { type: "boolean" },
                    projectOverride: {
                      type: "string",
                      enum: ["enabled", "disabled"],
                      nullable: true,
                    },
                    effective: { type: "boolean" },
                    disableModelInvocation: { type: "boolean" },
                  },
                },
              },
              diagnostics: {
                type: "array",
                items: {
                  type: "object",
                  required: ["type", "message"],
                  properties: {
                    type: { type: "string", enum: ["warning", "error", "collision"] },
                    message: { type: "string" },
                    path: { type: "string" },
                    collision: {
                      type: "object",
                      properties: {
                        resourceType: { type: "string" },
                        name: { type: "string" },
                        winnerPath: { type: "string" },
                        loserPath: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      try {
        const projectId = (req.query as { projectId?: string }).projectId;

        // Load skills via SDK — uses the same discovery as the pi agent.
        // Reads from ~/.pi/agent/skills/, project ./skills, and any paths
        // configured via settings.skills.
        const result = loadSkills({
          cwd: config.workspacePath,
          agentDir: config.piConfigDir,
          skillPaths: [],
          includeDefaults: true,
        });

        // Read overrides (global disabled list + per-project overrides)
        const overrides = await readSkillOverrides();

        const skills = result.skills.map((s) =>
          toSkillSummary(s, overrides, projectId),
        );

        const diagnostics = result.diagnostics.map(toSkillDiagnostic);

        return { skills, diagnostics };
      } catch (err) {
        fastify.log.error(err, "GET /config/skills failed");
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  // ── SKILL.md parsing helpers ──────────────────────────────────────

  /**
   * Parse a SKILL.md file into frontmatter description and instructions body.
   * Uses the SDK's parseFrontmatter utility.
   */
  function parseSkillMarkdown(content: string): {
    description: string | null;
    instructions: string;
  } {
    try {
      const { frontmatter, body } = parseFrontmatter(content);
      const description =
        typeof frontmatter.description === "string"
          ? frontmatter.description
          : null;
      return { description, instructions: body };
    } catch {
      return { description: null, instructions: content };
    }
  }

  /**
   * Build a SKILL.md string from description and instructions.
   * Uses the SDK's stripFrontmatter to preserve the body.
   */
  function buildSkillMarkdown(description: string, instructions: string): string {
    // Build frontmatter YAML manually to avoid yaml dependency
    const fmLines: string[] = [];
    fmLines.push(`description: "${description.replace(/"/g, '\\"')}"`);
    const fm = fmLines.join("\n");
    const body = instructions.trimStart();
    return `---\n${fm}\n---${body ? `\n\n${body}` : '\n'}`;
  }

  // ── GET /config/skills/:name — get skill detail ───────────────────

  fastify.get<{
    Params: { name: string };
  }>(
    "/config/skills/:name",
    {
      schema: {
        description:
          "Get the full content of a skill, including parsed frontmatter " +
          "(description, instructions) and the raw markdown.",
        tags: ["config"],
        params: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["name", "filePath", "md"],
            properties: {
              name: { type: "string" },
              filePath: { type: "string" },
              md: {
                type: "object",
                required: ["description", "instructions", "content"],
                properties: {
                  description: { type: "string", nullable: true },
                  instructions: { type: "string" },
                  content: { type: "string" },
                },
              },
            },
          },
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      try {
        const skillName = req.params.name;

        // Find the skill in the loaded list to get its filePath
        const result = loadSkills({
          cwd: config.workspacePath,
          agentDir: config.piConfigDir,
          skillPaths: [],
          includeDefaults: true,
        });

        const skill = result.skills.find((s) => s.name === skillName);
        if (!skill) {
          return reply.code(404).send({
            error: "skill_not_found",
            message: `Skill "${skillName}" not found.`,
          });
        }

        // Read the raw SKILL.md content
        let content: string;
        try {
          content = await readFile(skill.filePath, "utf8");
        } catch {
          return reply.code(500).send({
            error: "read_error",
            message: `Failed to read skill file: ${skill.filePath}`,
          });
        }

        const parsed = parseSkillMarkdown(content);

        return {
          name: skill.name,
          filePath: skill.filePath,
          md: {
            description: parsed.description,
            instructions: parsed.instructions,
            content,
          },
        };
      } catch (err) {
        fastify.log.error(err, `GET /config/skills/:name failed`);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  // ── PUT /config/skills/:name — update skill ───────────────────────

  fastify.put<{
    Params: { name: string };
    Body: { description: string; instructions: string };
  }>(
    "/config/skills/:name",
    {
      schema: {
        description:
          "Update a skill's description and instructions. " +
          "Writes the updated SKILL.md to disk. " +
          "Only works for global and project skills (not extension-built-in skills).",
        tags: ["config"],
        params: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["description", "instructions"],
          properties: {
            description: { type: "string" },
            instructions: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          400: errorSchema,
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (req, reply) => {
      try {
        const skillName = req.params.name;
        const { description, instructions } = req.body;

        // Find the skill
        const result = loadSkills({
          cwd: config.workspacePath,
          agentDir: config.piConfigDir,
          skillPaths: [],
          includeDefaults: true,
        });

        const skill = result.skills.find((s) => s.name === skillName);
        if (!skill) {
          return reply.code(404).send({
            error: "skill_not_found",
            message: `Skill "${skillName}" not found.`,
          });
        }

        // Prevent editing extension-built-in skills
        if (skill.sourceInfo.source === "extension") {
          return reply.code(400).send({
            error: "read_only",
            message: `Skill "${skillName}" is provided by an extension and cannot be edited.`,
          });
        }

        // Build and write the updated SKILL.md
        const newContent = buildSkillMarkdown(description, instructions);

        try {
          await writeFile(skill.filePath, newContent, { encoding: "utf8" });
        } catch (err: unknown) {
          fastify.log.error(
            err,
            `Failed to write skill file: ${skill.filePath}`,
          );
          return reply.code(500).send({
            error: "write_error",
            message: `Failed to write skill file.`,
          });
        }

        return { ok: true };
      } catch (err) {
        fastify.log.error(err, `PUT /config/skills/:name failed`);
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  // ── GET /config/skills/overrides — per-project cascade ────────────

  fastify.get(
    "/config/skills/overrides",
    {
      schema: {
        description:
          "All per-project skill overrides. Returns a map of projectId → " +
          "{ enable: string[], disable: string[] }.",
        tags: ["config"],
        response: {
          200: {
            type: "object",
            required: ["projects"],
            properties: {
              projects: {
                type: "object",
                additionalProperties: {
                  type: "object",
                  required: ["enable", "disable"],
                  properties: {
                    enable: { type: "array", items: { type: "string" } },
                    disable: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
          500: errorSchema,
        },
      },
    },
    async () => {
      const projects = await listSkillOverrides();
      return { projects };
    },
  );

  // ── PUT /config/skills/:name/enabled — toggle enable/disable ──────

  fastify.put<{
    Params: { name: string };
    Querystring: { projectId?: string };
    Body: { enabled: boolean; scope?: "global" | "project" };
  }>(
    "/config/skills/:name/enabled",
    {
      schema: {
        description:
          "Toggle global or per-project skill enable/disable. " +
          "When scope is 'project', a projectId query parameter is required.",
        tags: ["config"],
        params: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
        },
        querystring: {
          type: "object",
          properties: { projectId: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["enabled"],
          properties: {
            enabled: { type: "boolean" },
            scope: { type: "string", enum: ["global", "project"] },
          },
        },
        response: {
          200: {
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          400: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const { enabled, scope } = req.body;
      const projectId = (req.query as { projectId?: string }).projectId;

      if (scope === "project") {
        if (!projectId) {
          return reply.code(400).send({
            error: "project_id_required",
            message: "scope 'project' requires a projectId query parameter.",
          });
        }
        await setProjectSkillOverride(
          projectId,
          req.params.name,
          enabled ? "enabled" : "disabled",
        );
      } else {
        await setSkillEnabled(req.params.name, enabled);

        // When re-enabling globally, also clear any stale project override
        // so the global state takes full effect.
        if (enabled && projectId !== undefined) {
          await setProjectSkillOverride(projectId, req.params.name, undefined);
        }
      }

      return { ok: true };
    },
  );

  // ── DELETE /config/skills/:name/enabled — clear project override ──

  fastify.delete<{
    Params: { name: string };
    Querystring: { projectId?: string };
  }>(
    "/config/skills/:name/enabled",
    {
      schema: {
        description:
          "Clear a per-project skill override, reverting to the global default.",
        tags: ["config"],
        params: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
        },
        querystring: {
          type: "object",
          required: ["projectId"],
          properties: { projectId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: { ok: { type: "boolean" } },
          },
          400: errorSchema,
        },
      },
    },
    async (req, reply) => {
      const projectId = (req.query as { projectId?: string }).projectId;
      if (!projectId) {
        return reply.code(400).send({
          error: "project_id_required",
          message: "A projectId query parameter is required.",
        });
      }
      await setProjectSkillOverride(projectId, req.params.name, undefined);
      return { ok: true };
    },
  );
};
