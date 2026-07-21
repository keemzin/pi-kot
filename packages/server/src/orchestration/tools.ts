/**
 * Agent-facing tool surface for supervisor sessions.
 *
 * Seven `orchestrate_*` tools, registered onto a session ONLY when
 * that session has supervisor mode enabled. Wired through
 * `createAgentSession({ customTools })` in session-store.
 *
 * Topology is hub-and-spoke by tool surface: workers don't get
 * these tools. Same-project enforcement: spawn_worker creates in
 * the supervisor's project.
 */
import { join } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  createSession,
  disposeSession,
  findSessionLocation,
  getSession,
  resumeSessionById,
} from "../session-store.js";
import { maxWorkersPerSupervisor } from "./config.js";
import {
  getWorkerIds,
  getWorkerRecord,
  OrchestrationError,
  readPendingInbox,
  registerWorker,
  unregisterWorker,
} from "./store.js";
import { killWorkerAndArchive } from "./worker-lifecycle.js";
import { readSettings } from "../config-store.js";

// ---- result shape helpers ----

function ok(payload: Record<string, unknown>, text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: payload,
  };
}

function err(code: string, message: string) {
  return {
    content: [{ type: "text" as const, text: `[error: ${code}] ${message}` }],
    details: { error: code, message },
  };
}

// ---- message serialization for the supervisor LLM ----

const PER_MESSAGE_CAP = 1_200;
const TOTAL_TRANSCRIPT_CAP = 24_000;

interface SerializedBlock {
  text?: string;
  toolCalls?: string[];
  toolResults?: string[];
  imageCount?: number;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function previewArgs(input: unknown): string {
  try {
    const j = JSON.stringify(input);
    return truncate(j, 200);
  } catch {
    return "(unserializable)";
  }
}

function extractFromContent(content: unknown): SerializedBlock {
  const out: SerializedBlock = {};
  if (typeof content === "string") {
    out.text = content;
    return out;
  }
  if (!Array.isArray(content)) return out;
  const textParts: string[] = [];
  const toolCalls: string[] = [];
  const toolResults: string[] = [];
  let imageCount = 0;
  for (const raw of content) {
    const b = raw as {
      type?: string;
      text?: string;
      name?: string;
      input?: unknown;
      content?: unknown;
      is_error?: boolean;
    };
    if (b.type === "text" && typeof b.text === "string") {
      textParts.push(b.text);
      continue;
    }
    if (b.type === "tool_use" && typeof b.name === "string") {
      toolCalls.push(`${b.name}(${previewArgs(b.input)})`);
      continue;
    }
    if (b.type === "tool_result") {
      let resultText = "";
      if (typeof b.content === "string") resultText = b.content;
      else if (Array.isArray(b.content)) {
        const inner: string[] = [];
        for (const c of b.content as { type?: string; text?: string }[]) {
          if (c.type === "text" && typeof c.text === "string") inner.push(c.text);
        }
        resultText = inner.join("\n");
      }
      const prefix = b.is_error === true ? "[error] " : "";
      toolResults.push(prefix + truncate(resultText.trim(), 400));
      continue;
    }
    if (b.type === "image") {
      imageCount += 1;
      continue;
    }
  }
  if (textParts.length > 0) out.text = textParts.join("\n");
  if (toolCalls.length > 0) out.toolCalls = toolCalls;
  if (toolResults.length > 0) out.toolResults = toolResults;
  if (imageCount > 0) out.imageCount = imageCount;
  return out;
}

function formatMessageForOrchestrator(
  msg: unknown,
  index: number,
  total: number,
): string {
  const m = msg as { role?: string; type?: string };
  const role = m.role ?? m.type ?? "unknown";
  const blocks = extractFromContent((m as { content?: unknown }).content);
  const lines: string[] = [`[${index + 1}/${total}] ${role}`];
  if (blocks.text !== undefined && blocks.text.trim().length > 0) {
    lines.push(truncate(blocks.text.trim(), PER_MESSAGE_CAP));
  }
  for (const tc of blocks.toolCalls ?? []) lines.push(`→ tool_use: ${tc}`);
  for (const tr of blocks.toolResults ?? []) lines.push(`← tool_result: ${tr}`);
  if ((blocks.imageCount ?? 0) > 0) lines.push(`(+${blocks.imageCount} image(s))`);
  if (lines.length === 1) lines.push("(no readable content)");
  return lines.join("\n");
}

function renderTranscript(messages: readonly unknown[], total: number): string {
  const rendered: string[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const block = formatMessageForOrchestrator(
      messages[i],
      total - (messages.length - i),
      total,
    );
    if (used + block.length + 2 > TOTAL_TRANSCRIPT_CAP) break;
    rendered.unshift(block);
    used += block.length + 2;
  }
  if (rendered.length < messages.length) {
    rendered.unshift(
      `[truncated — older ${messages.length - rendered.length} message(s) omitted to keep the transcript under ${TOTAL_TRANSCRIPT_CAP} chars]`,
    );
  }
  return rendered.join("\n\n");
}

// ---- ownership guard ----

async function assertOwns(
  supervisorId: string,
  workerId: string,
) {
  const rec = await getWorkerRecord(workerId);
  if (rec === undefined) {
    return err("worker_not_found", `No worker registered with id ${workerId}.`);
  }
  if (rec.supervisorId !== supervisorId) {
    return err(
      "not_owner",
      `Worker ${workerId} is linked to a different supervisor; refusing to act on it.`,
    );
  }
  return undefined;
}

// ---- spawn_worker ----

const spawnSchema = {
  type: "object",
  required: ["name", "initialPrompt"],
  additionalProperties: false,
  properties: {
    name: {
      type: "string",
      minLength: 1,
      maxLength: 200,
      description:
        "Required short, descriptive label shown in the session picker — " +
        "this is how the user (and you, on later turns) will recognise the " +
        "worker among others. Concrete task names work best: " +
        "'Implement /auth route', 'Add tests for orders module', " +
        "'Audit RLS policies'. AVOID generic placeholders ('helper', " +
        "'worker 1', 'task') — those defeat the whole point of having " +
        "named workers.",
    },
    initialPrompt: {
      type: "string",
      minLength: 1,
      description:
        "The TASK assigned to this worker. The worker is a fresh autonomous " +
        "agent — it does not see your transcript or memory. Write a self-" +
        "contained task brief: what to do, where (file paths), constraints, " +
        "and what 'done' looks like. Instruct, don't collaborate.",
    },
    contextSummary: {
      type: "string",
      maxLength: 8_000,
      description:
        "Optional handoff context summary. When present, prepended " +
        "to `initialPrompt` so the worker starts with relevant " +
        "background. Use this for the 'A finishes → B picks up' " +
        "pipeline pattern. Cap is 8k chars.",
    },
  },
} as const;

function createSpawnWorker(supervisorId: string): ToolDefinition {
  return {
    name: "orchestrate_spawn_worker",
    label: "Spawn worker session",
    description:
      "Create a new worker session in the same project as the supervisor and " +
      "assign it a task. Workers are autonomous task-running agents — NOT " +
      "conversational helpers. Same-project only in v1.",
    parameters: spawnSchema,
    async execute(_toolCallId: string, params: unknown) {
      const p = params as {
        name: string;
        initialPrompt: string;
        contextSummary?: string;
      };
      const supLive = getSession(supervisorId);
      if (supLive === undefined) {
        return err("supervisor_not_live", "Supervisor session is not currently live.");
      }
      const workerIds = await getWorkerIds(supervisorId);
      const liveWorkers = workerIds.filter((id) => getSession(id) !== undefined);
      const cap = maxWorkersPerSupervisor();
      if (liveWorkers.length >= cap) {
        return err(
          "fanout_limit_exceeded",
          `Supervisor already has ${liveWorkers.length} live workers (cap ${cap}). ` +
            `Kill or detach an existing worker before spawning another.`,
        );
      }
      let worker: Awaited<ReturnType<typeof createSession>>;
      try {
        worker = await createSession(supLive.projectId, supLive.workspacePath);
      } catch (e) {
        return err(
          "spawn_failed",
          `createSession threw: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      // Apply orchestrator model override if configured
      try {
        const settings = readSettings();
        const orchProvider = settings.orchProvider as string | undefined;
        const orchModel = settings.orchModel as string | undefined;
        if (orchProvider !== undefined && orchModel !== undefined && orchProvider.length > 0 && orchModel.length > 0) {
          const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
          const { config } = await import("../config.js");
          const modelRuntime = await ModelRuntime.create({
            authPath: join(config.piConfigDir, "auth.json"),
            modelsPath: join(config.piConfigDir, "models.json"),
          });
          const fullModel = modelRuntime.getModel(orchProvider, orchModel);
          if (fullModel !== undefined) {
            worker.session.setModel(fullModel);
          }
        }
      } catch {
        // Non-fatal — worker runs with default model
      }
      try {
        await registerWorker({
          supervisorId,
          workerId: worker.sessionId,
          spawnedFrom: {
            sessionId: supervisorId,
            mode: p.contextSummary !== undefined ? "summary" : "fresh",
          },
        });
      } catch (e) {
        await disposeSession(worker.sessionId).catch(() => undefined);
        if (e instanceof OrchestrationError) {
          return err(e.code, e.message);
        }
        return err("register_failed", e instanceof Error ? e.message : String(e));
      }
      try {
        worker.session.setSessionName(p.name);
      } catch (e) {
        process.stderr.write(
          JSON.stringify({
            level: "warn",
            time: new Date().toISOString(),
            msg: "orchestration-worker-rename-failed",
            workerId: worker.sessionId,
            requestedName: p.name,
            err: e instanceof Error ? e.message : String(e),
          }) + "\n",
        );
      }
      const initialPrompt =
        p.contextSummary !== undefined && p.contextSummary.length > 0
          ? `# Handoff context\n${p.contextSummary}\n\n# Task\n${p.initialPrompt}`
          : p.initialPrompt;
      worker.session.prompt(initialPrompt).catch((e: unknown) => {
        process.stderr.write(
          JSON.stringify({
            level: "warn",
            time: new Date().toISOString(),
            msg: "orchestration-worker-initial-prompt-failed",
            workerId: worker.sessionId,
            err: e instanceof Error ? e.message : String(e),
          }) + "\n",
        );
      });
      const sup = getSession(supervisorId);
      if (sup !== undefined) {
        for (const client of sup.clients) {
          try {
            client.send({
              type: "session_list_changed",
              reason: "spawn_worker",
              projectId: supLive.projectId,
              sessionId: worker.sessionId,
            });
          } catch {
            // SSE client dropped
          }
        }
      }
      return ok(
        {
          workerId: worker.sessionId,
          name: worker.session.sessionName ?? p.name,
          projectId: worker.projectId,
        },
        `Spawned worker "${p.name}" (${worker.sessionId}). Initial prompt delivered. ` +
          `Worker updates will be pushed to you automatically.`,
      )
    },
  } satisfies ToolDefinition;
}

// ---- list_workers ----

function createListWorkers(supervisorId: string): ToolDefinition {
  return {
    name: "orchestrate_list_workers",
    label: "List workers",
    description:
      "Survey worker state (live / idle / streaming / cold). " +
      "DO NOT poll — worker events are pushed to you automatically.",
    parameters: { type: "object", properties: {} },
    async execute() {
      interface WorkerRow {
        workerId: string;
        state: string;
        isLive: boolean;
        isStreaming: boolean;
        messageCount: number | null;
        lastActivityAt: string | null;
        name: string | null;
      }
      const ids = await getWorkerIds(supervisorId);
      const workers: WorkerRow[] = await Promise.all(
        ids.map(async (workerId) => {
          const rec = await getWorkerRecord(workerId);
          const live = getSession(workerId);
          if (live === undefined) {
            return {
              workerId,
              state: rec?.state ?? "cold",
              isLive: false,
              isStreaming: false,
              messageCount: null,
              lastActivityAt: rec?.lastStateAt ?? null,
              name: null,
            };
          }
          return {
            workerId,
            state:
              rec?.state === "running" ||
              rec?.state === "awaiting_question" ||
              rec?.state === "errored" ||
              rec?.state === "stopped" ||
              rec?.state === "deleted"
                ? rec.state
                : live.session.isStreaming
                  ? "streaming"
                  : (rec?.state ?? "idle"),
            isLive: true,
            isStreaming: live.session.isStreaming,
            messageCount: live.session.messages.length,
            lastActivityAt: live.lastActivityAt.toISOString(),
            name: live.session.sessionName ?? null,
          };
        }),
      );
      const summary =
        `${workers.length} worker(s) registered. ` +
        `${workers.filter((w) => w.state === "running" || w.state === "streaming").length} running, ` +
        `${workers.filter((w) => w.state === "idle" || w.state === "ended").length} idle/ended, ` +
        `${workers.filter((w) => w.state === "awaiting_question").length} awaiting question, ` +
        `${workers.filter((w) => w.state === "cold").length} cold.`;
      const rows = workers.map((w) => {
        const label = w.name ?? "(unnamed)";
        const msgs = w.messageCount !== null ? `${w.messageCount} msgs` : "no live state";
        const last = w.lastActivityAt !== null ? `last activity ${w.lastActivityAt}` : "";
        return `- ${w.state.padEnd(9)} "${label}" (${w.workerId}) — ${msgs}${last !== "" ? `, ${last}` : ""}`;
      });
      const body = rows.length === 0 ? "(no workers spawned yet)" : rows.join("\n");
      return ok({ workers }, `${summary}\n${body}`)
    },
  } satisfies ToolDefinition;
}

// ---- read_worker ----

const readWorkerSchema = {
  type: "object",
  required: ["workerId"],
  additionalProperties: false,
  properties: {
    workerId: { type: "string", minLength: 1 },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      description:
        "Most-recent messages to return. Default 1.",
    },
  },
} as const;

function createReadWorker(supervisorId: string): ToolDefinition {
  return {
    name: "orchestrate_read_worker",
    label: "Read worker transcript",
    description:
      "Fetch a worker's most recent messages (newest-last). Default `limit` " +
      "is 1. Auto-resumes cold workers.",
    parameters: readWorkerSchema,
    async execute(_toolCallId: string, params: unknown) {
      const p = params as { workerId: string; limit?: number };
      const guard = await assertOwns(supervisorId, p.workerId);
      if (guard !== undefined) return guard;
      let live = getSession(p.workerId);
      if (live === undefined) {
        try {
          live = await resumeSessionById(p.workerId);
        } catch (e) {
          return err(
            "worker_session_missing",
            e instanceof Error ? e.message : `Session ${p.workerId} not found.`,
          );
        }
      }
      const limit = Math.min(Math.max(p.limit ?? 1, 1), 100);
      const all = live.session.messages;
      const tail = all.slice(Math.max(0, all.length - limit));
      const name = live.session.sessionName ?? "(unnamed)";
      const header =
        `Worker "${name}" (${p.workerId}) — ` +
        `${live.session.isStreaming ? "streaming" : "idle"}. ` +
        `Showing the last ${tail.length} of ${all.length} message(s).`;
      const transcript =
        tail.length === 0
          ? "(no messages yet — worker hasn't started its first turn)"
          : renderTranscript(tail, all.length);
      return ok(
        {
          workerId: p.workerId,
          totalMessages: all.length,
          returned: tail.length,
          isStreaming: live.session.isStreaming,
          messages: tail,
        },
        `${header}\n\n${transcript}`,
      )
    },
  } satisfies ToolDefinition;
}

// ---- send_to_worker ----

const sendSchema = {
  type: "object",
  required: ["workerId", "message"],
  additionalProperties: false,
  properties: {
    workerId: { type: "string", minLength: 1 },
    message: {
      type: "string",
      minLength: 1,
      description:
        "The next task or directive — concrete instruction, not " +
        "conversational filler (every send spends a worker turn).",
    },
    mode: {
      type: "string",
      enum: ["prompt", "steer", "followUp"],
      description:
        "`prompt` (default): new turn, or queue if busy. " +
        "`steer`: interrupt the current turn. " +
        "`followUp`: wait for idle, then send.",
    },
  },
} as const;

function createSendToWorker(supervisorId: string): ToolDefinition {
  return {
    name: "orchestrate_send_to_worker",
    label: "Send message to worker",
    description:
      "Assign a follow-up task or directive to a running worker. The message " +
      "is tagged as supervisor-sourced.",
    parameters: sendSchema,
    async execute(_toolCallId: string, params: unknown) {
      const p = params as {
        workerId: string;
        message: string;
        mode?: "prompt" | "steer" | "followUp";
      };
      const guard = await assertOwns(supervisorId, p.workerId);
      if (guard !== undefined) return guard;
      const live = getSession(p.workerId);
      if (live === undefined) {
        return err(
          "worker_not_live",
          `Worker ${p.workerId} is not currently live. Resume it first.`,
        );
      }
      const tagged = `[supervisor:${supervisorId}] ${p.message}`;
      const mode = p.mode ?? "prompt";
      try {
        if (mode === "prompt") {
          live.session.prompt(tagged).catch(() => undefined);
        } else if (mode === "steer") {
          live.session.steer(tagged).catch(() => undefined);
        } else {
          live.session.followUp(tagged).catch(() => undefined);
        }
      } catch (e) {
        return err("send_failed", e instanceof Error ? e.message : String(e));
      }
      return ok(
        { workerId: p.workerId, mode, accepted: true },
        `Queued ${mode} message to worker ${p.workerId}.`,
      )
    },
  } satisfies ToolDefinition;
}

// ---- interrupt_worker ----

const interruptSchema = {
  type: "object",
  required: ["workerId"],
  additionalProperties: false,
  properties: { workerId: { type: "string", minLength: 1 } },
} as const;

function createInterruptWorker(supervisorId: string): ToolDefinition {
  return {
    name: "orchestrate_interrupt_worker",
    label: "Interrupt worker",
    description:
      "Abort the worker's current turn. Idempotent on idle workers. " +
      "The worker session itself stays live.",
    parameters: interruptSchema,
    async execute(_toolCallId: string, params: unknown) {
      const p = params as { workerId: string };
      const guard = await assertOwns(supervisorId, p.workerId);
      if (guard !== undefined) return guard;
      const live = getSession(p.workerId);
      if (live === undefined) {
        return err("worker_not_live", `Worker ${p.workerId} is not currently live.`);
      }
      try {
        await live.session.abort();
      } catch (e) {
        return err("abort_failed", e instanceof Error ? e.message : String(e));
      }
      return ok(
        { workerId: p.workerId, aborted: true },
        `Aborted worker ${p.workerId}'s current turn.`,
      )
    },
  } satisfies ToolDefinition;
}

// ---- kill_worker ----

const killSchema = {
  type: "object",
  required: ["workerId"],
  additionalProperties: false,
  properties: { workerId: { type: "string", minLength: 1 } },
} as const;

function createKillWorker(supervisorId: string): ToolDefinition {
  return {
    name: "orchestrate_kill_worker",
    label: "Kill worker",
    description:
      "Dispose the worker session (terminate any in-flight turn, close " +
      "SSE clients), archive its transcript, and unregister from this supervisor.",
    parameters: killSchema,
    async execute(_toolCallId: string, params: unknown) {
      const p = params as { workerId: string };
      const guard = await assertOwns(supervisorId, p.workerId);
      if (guard !== undefined) return guard;
      const result = await killWorkerAndArchive({ supervisorId, workerId: p.workerId });
      return ok(
        {
          workerId: p.workerId,
          wasLive: result.wasLive,
          archiveStatus: result.archiveStatus,
        },
        `Killed worker ${p.workerId}${result.archiveStatus === "archived" ? " (transcript archived)" : ""}.`,
      )
    },
  } satisfies ToolDefinition;
}

// ---- detach_worker ----

const detachSchema = {
  type: "object",
  required: ["workerId"],
  additionalProperties: false,
  properties: { workerId: { type: "string", minLength: 1 } },
} as const;

function createDetachWorker(supervisorId: string): ToolDefinition {
  return {
    name: "orchestrate_detach_worker",
    label: "Detach worker",
    description:
      "Drop the supervisor↔worker link. The worker session stays live " +
      "(transcript untouched) but its events no longer notify this " +
      "supervisor.",
    parameters: detachSchema,
    async execute(_toolCallId: string, params: unknown) {
      const p = params as { workerId: string };
      const guard = await assertOwns(supervisorId, p.workerId);
      if (guard !== undefined) return guard;
      await unregisterWorker(p.workerId);
      return ok(
        { workerId: p.workerId, detached: true },
        `Detached worker ${p.workerId}. It remains live as a standalone session.`,
      )
    },
  } satisfies ToolDefinition;
}

// ---- read_inbox ----

const readInboxSchema = {
  type: "object",
  required: [],
  additionalProperties: false,
  properties: {
    markDelivered: {
      type: "boolean",
      description:
        "Whether to mark returned items as delivered. Default true.",
    },
  },
} as const;

function createReadInbox(supervisorId: string): ToolDefinition {
  return {
    name: "orchestrate_read_inbox",
    label: "Read worker inbox",
    description:
      "Drain pending worker events (turn-ends, ask-user-question " +
      "requests, deletions). Items return oldest-first and get marked " +
      "delivered by default. Call this at the start of every turn to " +
      "see what your workers have been doing.",
    parameters: readInboxSchema,
    async execute(_toolCallId: string, params: unknown) {
      const p = params as { markDelivered?: boolean };
      const markDelivered = p.markDelivered !== false;
      const pending = await readPendingInbox(supervisorId, {
        markDelivered,
      });
      if (pending.length === 0) {
        return ok(
          { items: [], count: 0 },
          "(no pending worker events)",
        );
      }
      const summary = `${pending.length} pending worker event(s):`;
      const detail = pending
        .map((item, i) => {
          const kind =
            item.type === "worker.ended"
              ? "ended"
              : item.type === "worker.ask_user"
                ? "asked a question"
                : item.type === "worker.execution_stopped_without_agent_end"
                  ? "execution stopped"
                  : item.type === "worker.deleted"
                    ? "deleted"
                    : item.type.replace(/^worker\./, "");
          const stateText =
            item.type === "worker.ended"
              ? typeof item.data.stopReason === "string"
                ? ` stopReason: ${item.data.stopReason}`
                : ""
              : item.type === "worker.ask_user"
                ? ` questionCount: ${item.data.questionCount ?? 1}`
                : "";
          return `  [${i + 1}] Worker ${item.workerId} ${kind}${stateText} (${item.occurredAt})`;
        })
        .join("\n");
      return ok(
        { items: pending, count: pending.length },
        `${summary}\n${detail}`,
      );
    },
  } satisfies ToolDefinition;
}

// ---- public factory ----

export function createOrchestrationTools(supervisorId: string): ToolDefinition[] {
  return [
    createSpawnWorker(supervisorId),
    createListWorkers(supervisorId),
    createReadWorker(supervisorId),
    createSendToWorker(supervisorId),
    createInterruptWorker(supervisorId),
    createKillWorker(supervisorId),
    createDetachWorker(supervisorId),
    createReadInbox(supervisorId),
  ];
}

export const ORCHESTRATION_TOOL_NAMES = [
  "orchestrate_spawn_worker",
  "orchestrate_list_workers",
  "orchestrate_read_worker",
  "orchestrate_send_to_worker",
  "orchestrate_interrupt_worker",
  "orchestrate_kill_worker",
  "orchestrate_detach_worker",
  "orchestrate_read_inbox",
] as const;
