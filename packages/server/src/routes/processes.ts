import type { FastifyPluginAsync } from "fastify";
import { createReadStream, existsSync } from "node:fs";
import { processManager } from "../processes/manager.js";
import { readTailFromFile } from "../processes/log-store.js";

interface SessionParam {
  id: string;
}

interface ProcessParam extends SessionParam {
  processId: string;
}

interface LogStreamParam extends ProcessParam {
  stream: "stdout" | "stderr";
}

interface StdinBody {
  input: string;
  end?: boolean;
}

export const processRoutes: FastifyPluginAsync = async (fastify) => {
  // List processes for a session
  fastify.get<{ Params: SessionParam }>("/sessions/:id/processes", async (req, reply) => {
    const list = processManager.list(req.params.id);
    return reply.send({ processes: list });
  });

  // Kill a process
  fastify.post<{ Params: ProcessParam }>("/sessions/:id/processes/:processId/kill", async (req, reply) => {
    const result = await processManager.kill(req.params.id, req.params.processId);
    if (!result.ok) {
      const code = result.reason === "not_found" ? 404 : 500;
      return reply.code(code).send({ error: result.reason });
    }
    return reply.send({ ok: true, process: result.info });
  });

  // Clear finished processes
  fastify.delete<{ Params: SessionParam }>("/sessions/:id/processes/finished", async (req, reply) => {
    const cleared = processManager.clearFinished(req.params.id);
    return reply.send({ cleared });
  });

  // Get output tail
  fastify.get<{ Params: ProcessParam; Querystring: { lines?: string } }>(
    "/sessions/:id/processes/:processId/output",
    async (req, reply) => {
      const lineCount = req.query.lines ? Number.parseInt(req.query.lines, 10) : 200;
      const out = processManager.getOutput(req.params.id, req.params.processId, lineCount);
      if (!out) {
        return reply.code(404).send({ error: "process_not_found" });
      }
      return reply.send(out);
    },
  );

  // Send stdin
  fastify.post<{ Params: ProcessParam; Body: StdinBody }>(
    "/sessions/:id/processes/:processId/stdin",
    async (req, reply) => {
      const { input, end } = req.body ?? {};
      if (typeof input !== "string") {
        return reply.code(400).send({ error: "missing_input" });
      }
      const result = processManager.write(req.params.id, req.params.processId, input, end);
      if (!result.ok) {
        const code = result.reason === "not_found" ? 404 : 400;
        return reply.code(code).send({ error: result.reason });
      }
      return reply.send({ ok: true });
    },
  );

  // Download / stream log file
  fastify.get<{ Params: LogStreamParam }>("/sessions/:id/processes/:processId/logs/:stream", async (req, reply) => {
    const { id, processId, stream } = req.params;
    if (stream !== "stdout" && stream !== "stderr") {
      return reply.code(400).send({ error: "invalid_stream" });
    }

    const logFiles = processManager.getLogFiles(id, processId);
    if (!logFiles) {
      return reply.code(404).send({ error: "process_not_found" });
    }

    const filePath = stream === "stdout" ? logFiles.stdoutFile : logFiles.stderrFile;
    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: "log_file_not_found" });
    }

    reply.header("Content-Type", "text/plain; charset=utf-8");
    return reply.send(createReadStream(filePath));
  });
};
