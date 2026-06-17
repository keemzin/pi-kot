#!/usr/bin/env node
/**
 * pi-kot CLI launcher.
 *
 * Published npm package layout:
 *
 *   pi-kot/
 *   ├── bin/pi-kot.mjs       ← this file (npm links as the binary)
 *   ├── dist/server/         ← compiled Fastify server
 *   └── dist/client/         ← compiled Vite SPA
 *
 * The server's default CLIENT_DIST_PATH resolves relative to its own
 * compiled file, which works for the in-repo dev flow but NOT for the
 * flat published package. We override it here so the same server entry
 * point works in all deployment shapes without touching server code.
 *
 * Supported env vars (all optional):
 *   PORT            default 3333
 *   HOST            default 0.0.0.0  (use 127.0.0.1 for loopback-only)
 *   UI_PASSWORD     enable password auth
 *   API_KEY         static API key for scripts/CI
 *   WORKSPACE_PATH  default ~/.pi-kot/workspace/default
 *   LOG_LEVEL       default info
 *
 * Supported flags:
 *   --port <n>
 *   --host <h>
 *   --password <pw>       sets UI_PASSWORD
 *   --api-key <key>       sets API_KEY
 *   --workspace <path>    sets WORKSPACE_PATH
 *   --log-level <level>
 *   --help / -h
 *   --version / -v
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const pkg = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));

// ── Flag parser ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(`
pi-kot v${pkg.version} — Browser UI for the pi coding agent

Usage:
  npx pi-kot [options]
  pi-kot [options]

Options:
  --port <n>           Port to listen on          (default: 3333)
  --host <h>           Host/interface to bind to  (default: 0.0.0.0)
  --password <pw>      Enable UI password auth
  --api-key <key>      Static API key for scripts/CI
  --workspace <path>   Workspace root directory   (default: ~/.pi-kot/workspace/default)
  --log-level <level>  Logging level              (default: info)
  --help, -h           Show this help
  --version, -v        Show version

All options can also be set via environment variables:
  PORT, HOST, UI_PASSWORD, API_KEY, WORKSPACE_PATH, LOG_LEVEL

Examples:
  npx pi-kot
  npx pi-kot --port 4000 --workspace ~/Code
  npx pi-kot --password secret --host 127.0.0.1
  PORT=8080 npx pi-kot
`.trimStart());
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(`pi-kot ${pkg.version}\n`);
  process.exit(0);
}

// Parse --flag value pairs and apply to process.env before config.ts loads
const flagMap = {
  "--port": "PORT",
  "--host": "HOST",
  "--password": "UI_PASSWORD",
  "--api-key": "API_KEY",
  "--workspace": "WORKSPACE_PATH",
  "--log-level": "LOG_LEVEL",
};

for (let i = 0; i < args.length; i++) {
  const envKey = flagMap[args[i]];
  if (envKey !== undefined) {
    const val = args[i + 1];
    if (val === undefined || val.startsWith("--")) {
      process.stderr.write(`pi-kot: ${args[i]} requires a value\n`);
      process.exit(2);
    }
    process.env[envKey] = val;
    i++; // skip value
  } else {
    process.stderr.write(`pi-kot: unknown option: ${args[i]}\n`);
    process.stderr.write(`pi-kot: run with --help for usage\n`);
    process.exit(2);
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

// Override CLIENT_DIST_PATH so the server finds the client in the flat
// published layout (dist/client/) rather than the in-repo relative path.
process.env.CLIENT_DIST_PATH ??= resolve(packageRoot, "dist", "client");
process.env.NODE_ENV ??= "production";

// Log startup info
const port = process.env.PORT ?? "3333";
const host = process.env.HOST ?? "0.0.0.0";
const displayHost = host === "0.0.0.0" ? "localhost" : host;
process.stdout.write(`pi-kot v${pkg.version} starting on http://${displayHost}:${port}\n`);

// Import and start the server
const serverEntry = resolve(packageRoot, "dist", "server", "index.js");
const { start } = await import(pathToFileURL(serverEntry).href);
await start();
