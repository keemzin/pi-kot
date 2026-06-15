/**
 * Checkpoint routes — baked-in rewind support for pi-rewind extension data.
 *
 * Reads checkpoint entries from session JSONL files (written by pi-rewind extension),
 * and provides code+conversation restore via git + session navigation.
 *
 * Architecture: detect → activate — if pi-rewind is detected, the UI shows a ↩️ button.
 * The restore logic is baked into pi-kot's server (not dependent on extension's ctx.ui).
 */

import { type FastifyPluginAsync } from "fastify";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { config } from "../config.js";
import { getSession } from "../session-registry.js";

// ── Types ────────────────────────────────────────────────────────────

interface CheckpointFileChange {
  path: string;
  added: number;
  removed: number;
}

interface CheckpointEntry {
  id: string;
  kind: string;
  userEntryId: string;
  beforeCommit: string;
  afterCommit: string;
  prompt: string;
  fileCount: number;
  fileChanges: CheckpointFileChange[];
  createdAt: string;
}

interface RewindBody {
  checkpointId: string;
  mode: "code" | "conversation" | "both";
}

// ── Schemas ──────────────────────────────────────────────────────────

const autoError = {
  "4xx": {
    type: "object",
    required: ["error"],
    properties: { error: { type: "string" } },
  },
  "5xx": {
    type: "object",
    required: ["error"],
    properties: { error: { type: "string" } },
  },
} as const;

// ── Helpers ──────────────────────────────────────────────────────────

/** Build the expected JSONL path for a session. Searches both pi-kot and pi agent dirs. */
function sessionJsonlPath(sessionId: string): string | undefined {
  // Check live session first (in pi-kot's session dir)
  const live = getSession(sessionId);
  if (live !== undefined) {
    const file = live.sessionManager.getSessionFile();
    if (file !== undefined && existsSync(file)) return file;
  }

  return undefined;
}

/** Search all session dirs for a JSONL matching sessionId. */
async function findSessionFile(sessionId: string): Promise<string | undefined> {
  // Check live session
  const live = getSession(sessionId);
  if (live !== undefined) {
    const file = live.sessionManager.getSessionFile();
    if (file !== undefined && existsSync(file)) return file;
  }

  // Search pi-kot session dir: ~/.pi-kot/sessions/<project>/<sessionId>.jsonl
  const dirs = new Set<string>([config.sessionDir]);

  // Also search pi agent session dir: ~/.pi/agent/sessions/
  // Files here are named timestamp_UUID.jsonl
  const piAgentDir = join(homedir(), ".pi", "agent", "sessions");
  dirs.add(piAgentDir);

  for (const parentDir of dirs) {
    try {
      if (!existsSync(parentDir)) continue;
      const { readdir } = await import("node:fs/promises");
      const projectDirs = await readdir(parentDir, { withFileTypes: true });

      for (const dir of projectDirs) {
        if (!dir.isDirectory()) continue;

        // pi-kot format: <project>/<sessionId>.jsonl
        const candidate = join(parentDir, dir.name, `${sessionId}.jsonl`);
        if (existsSync(candidate)) return candidate;

        // pi agent format: <project>/<timestamp>_<sessionId>.jsonl or <project>/<sessionId>.jsonl
        const candidateExact = join(parentDir, dir.name, sessionId);
        if (existsSync(candidateExact)) return candidateExact;

        // Also try matching filenames that contain the sessionId
        // (pi agent uses: "2026-06-15T10-18-42-943Z_019edc7a-21c3-7fd5-8e02-59ae8251cdee.jsonl")
        try {
          const files = await readdir(join(parentDir, dir.name));
          for (const f of files) {
            if (f.endsWith(".jsonl") && f.includes(sessionId)) {
              return join(parentDir, dir.name, f);
            }
          }
        } catch {
          // couldn't list dir
        }
      }
    } catch {
      // Skip inaccessible dirs
    }
  }

  return undefined;
}

/** Read checkpoint entries from a session JSONL file. */
async function readCheckpoints(
  sessionId: string,
): Promise<CheckpointEntry[]> {
  const file = await findSessionFile(sessionId);
  if (file === undefined) return [];
  return readCheckpointsFromFile(file);
}

async function readCheckpointsFromFile(
  filePath: string,
): Promise<CheckpointEntry[]> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const entries: CheckpointEntry[] = [];

    for (const line of raw.split("\n").filter(Boolean)) {
      try {
        const parsed = JSON.parse(line);

        // Checkpoint entries have: type=custom, customType=pi-checkpoint
        if (
          parsed.type === "custom" &&
          parsed.customType === "pi-checkpoint" &&
          parsed.data?.kind === "checkpoint"
        ) {
          entries.push({
            id: parsed.id,
            kind: parsed.data.kind,
            userEntryId: parsed.data.userEntryId,
            beforeCommit: parsed.data.beforeCommit,
            afterCommit: parsed.data.afterCommit,
            prompt: parsed.data.prompt,
            fileCount: parsed.data.fileCount ?? 0,
            fileChanges: parsed.data.fileChanges ?? [],
            createdAt: parsed.data.createdAt ?? parsed.timestamp,
          });
        }
      } catch {
        // Skip malformed lines
      }
    }

    // Sort by creation time descending (newest first)
    entries.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return entries;
  } catch {
    return [];
  }
}

/** Restore code by resetting to a checkpoint commit in pi-rewind's bare repo.
 *
 * pi-rewind stores checkpoints in a bare git repo at
 * ~/.pi/agent/ayu/checkpoints/sessions/{sessionFileBasename}/.git
 * with --work-tree pointing at the user's project directory.
 * We do the same here — git --git-dir + --work-tree reset --hard.
 */
function restoreCode(
  workspacePath: string,
  commit: string,
  sessionFile?: string,
): { success: boolean; error?: string } {
  try {
    // Derive the checkpoint bare repo dir from the session file path
    let gitDir: string;
    if (sessionFile !== undefined) {
      const base = basename(sessionFile, ".jsonl");
      const repoDir = join(homedir(), ".pi", "agent", "ayu", "checkpoints", "sessions", base, ".git");
      gitDir = repoDir;
    } else {
      // Fallback: try the project's own git repo
      gitDir = join(workspacePath, ".git");
    }

    execSync(
      `git -c core.autocrlf=false -c core.safecrlf=false --git-dir=${gitDir} --work-tree=${workspacePath} reset --hard ${commit}`,
      { stdio: "pipe", timeout: 30_000 },
    );
    // Also clean untracked files that were staged by pi-rewind
    execSync(
      `git -c core.autocrlf=false -c core.safecrlf=false --git-dir=${gitDir} --work-tree=${workspacePath} clean -fd`,
      { stdio: "pipe", timeout: 30_000 },
    );
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Restore conversation by navigating the session tree. */
async function restoreConversation(
  sessionId: string,
  userEntryId: string,
): Promise<{ success: boolean; error?: string }> {
  const live = getSession(sessionId);
  if (live === undefined) {
    return { success: false, error: "Session not live" };
  }

  try {
    // Navigate to the checkpoint's user entry
    await live.session.navigateTree(userEntryId);

    // Persist the new leaf position to the JSONL file by appending a custom
    // marker entry. Without this, branch() only sets leafId in memory — on
    // server restart, _buildIndex sets leafId to the LAST entry in the file,
    // which is the pre-rewind state, losing the navigation.
    live.sessionManager.appendCustomEntry("pi-kot:rewind", {
      userEntryId,
      timestamp: Date.now(),
    });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Plugin ───────────────────────────────────────────────────────────

export const checkpointRoutes: FastifyPluginAsync = async (fastify) => {
  // ── GET /sessions/:id/checkpoints ─────────────────────────────────

  fastify.get(
    "/sessions/:id/checkpoints",
    {
      config: { public: true },
      schema: {
        description: "List checkpoint entries for a session",
        tags: ["checkpoints"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["checkpoints"],
            properties: {
              checkpoints: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    kind: { type: "string" },
                    userEntryId: { type: "string" },
                    beforeCommit: { type: "string" },
                    afterCommit: { type: "string" },
                    prompt: { type: "string" },
                    fileCount: { type: "number" },
                    fileChanges: { type: "array" },
                    createdAt: { type: "string" },
                  },
                },
              },
            },
          },
          ...autoError,
        },
      },
    },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const checkpoints = await readCheckpoints(id);
        return reply.send({ checkpoints });
      } catch (err) {
        req.log.error(err, "Failed to read checkpoints");
        return reply.status(500).send({ error: "Failed to read checkpoints" });
      }
    },
  );

  // ── POST /sessions/:id/rewind ─────────────────────────────────────

  fastify.post(
    "/sessions/:id/rewind",
    {
      schema: {
        description: "Rewind to a checkpoint — restore code, conversation, or both",
        tags: ["checkpoints"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["checkpointId", "mode"],
          properties: {
            checkpointId: { type: "string" },
            mode: {
              type: "string",
              enum: ["code", "conversation", "both"],
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              error: { type: "string" },
            },
          },
          ...autoError,
        },
      },
    },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const body = req.body as RewindBody;

        // Find the checkpoint
        const checkpoints = await readCheckpoints(id);
        const cp = checkpoints.find((c) => c.id === body.checkpointId);
        if (cp === undefined) {
          return reply.status(404).send({ error: "Checkpoint not found" });
        }

        // Get the live session to find workspace path
        const live = getSession(id);
        if (live === undefined) {
          return reply.status(400).send({ error: "Session not found or not active" });
        }

        // Execute restore based on mode
        // Get the session file path for checkpoint repo resolution
        const sessionFile = live.sessionManager.getSessionFile();

        if (body.mode === "code" || body.mode === "both") {
          // Only restore code if there were file changes
          if (cp.fileCount > 0 && cp.beforeCommit) {
            const result = restoreCode(live.workspacePath, cp.beforeCommit, sessionFile);
            if (!result.success) {
              return reply.send({ success: false, error: `Code restore failed: ${result.error}` });
            }
          }
        }

        if (body.mode === "conversation" || body.mode === "both") {
          const result = await restoreConversation(id, cp.userEntryId);
          if (!result.success) {
            return reply.send({ success: false, error: `Conversation restore failed: ${result.error}` });
          }
        }

        return reply.send({ success: true });
      } catch (err) {
        req.log.error(err, "Failed to rewind");
        return reply.status(500).send({ error: "Failed to rewind" });
      }
    },
  );
};
