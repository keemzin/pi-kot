#!/usr/bin/env node
/**
 * Assembles `publish/` — the staging directory uploaded to npm as `pi-kot`.
 *
 * Steps:
 *   1. Verify both server and client builds exist (run `npm run build` first)
 *   2. Wipe any prior `publish/` dir
 *   3. Copy server + client build artifacts into `publish/dist/`
 *   4. Copy the bin shim into `publish/bin/`
 *   5. Synthesize `publish/package.json` (reads server deps automatically —
 *      no manual duplication needed)
 *   6. Copy LICENSE + write a consumer-focused README
 *
 * Run via: `npm run build:publish`
 * Then publish: `npm publish ./publish`
 *
 * Why a staging dir instead of making root non-private:
 *   - Keeps source tree clean; published artifact is a flat single-package
 *   - Server deps are hoisted fresh from packages/server/package.json
 *     on every build — no drift risk
 */

import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISH_DIR = resolve(ROOT, "publish");

const SERVER_DIST = resolve(ROOT, "packages/server/dist");
const CLIENT_DIST = resolve(ROOT, "packages/client/dist");
const BIN_SRC = resolve(ROOT, "bin/pi-kot.mjs");
const LICENSE_SRC = resolve(ROOT, "LICENSE");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  console.log("[build-publish-dir] starting…");

  // 1. Sanity-check inputs
  const required = [
    ["server dist", SERVER_DIST],
    ["client dist", CLIENT_DIST],
    ["bin shim",    BIN_SRC],
  ];
  for (const [label, path] of required) {
    if (!existsSync(path)) {
      console.error(`\n[build-publish-dir] ✖ missing ${label} at:\n  ${path}`);
      console.error(`  Run 'npm run build' first.\n`);
      process.exit(1);
    }
  }

  const rootPkg   = await readJson(resolve(ROOT, "package.json"));
  const serverPkg = await readJson(resolve(ROOT, "packages/server/package.json"));

  if (!serverPkg.dependencies) {
    console.error("[build-publish-dir] ✖ packages/server/package.json has no dependencies");
    process.exit(1);
  }

  // 2. Reset staging dir
  await rm(PUBLISH_DIR, { recursive: true, force: true });
  await mkdir(PUBLISH_DIR, { recursive: true });
  console.log("[build-publish-dir] cleaned publish/");

  // 3. Copy artifacts
  await cp(SERVER_DIST, resolve(PUBLISH_DIR, "dist/server"), { recursive: true });
  await cp(CLIENT_DIST, resolve(PUBLISH_DIR, "dist/client"), { recursive: true });
  console.log("[build-publish-dir] copied dist/server + dist/client");

  // 4. Bin shim
  await mkdir(resolve(PUBLISH_DIR, "bin"), { recursive: true });
  await copyFile(BIN_SRC, resolve(PUBLISH_DIR, "bin/pi-kot.mjs"));
  console.log("[build-publish-dir] copied bin/pi-kot.mjs");

  // 5. Synthesize package.json
  // Server deps are hoisted verbatim — the server is what the bin loads.
  // Adding a dep to packages/server/package.json is enough; nothing to
  // update here manually.
  const publishPkg = {
    name: "pi-kot",
    version: rootPkg.version,
    description: "Browser UI for the pi coding agent — self-hosted React workbench with chat, file browser, terminal, git panel, and session tree.",
    keywords: ["pi", "coding-agent", "ai", "llm", "agent", "webui", "fastify", "react"],
    homepage: "https://github.com/YOUR_USERNAME/pi-kot#readme",
    bugs: { url: "https://github.com/YOUR_USERNAME/pi-kot/issues" },
    repository: {
      type: "git",
      url: "git+https://github.com/YOUR_USERNAME/pi-kot.git",
    },
    license: "MIT",
    type: "module",
    bin: { "pi-kot": "bin/pi-kot.mjs" },
    files: ["bin/", "dist/", "README.md", "LICENSE"],
    engines: { node: ">=18" },
    dependencies: serverPkg.dependencies,
    publishConfig: { access: "public" },
  };

  await writeFile(
    resolve(PUBLISH_DIR, "package.json"),
    JSON.stringify(publishPkg, null, 2) + "\n",
  );
  console.log("[build-publish-dir] wrote publish/package.json");

  // 6. LICENSE + README
  if (existsSync(LICENSE_SRC)) {
    await copyFile(LICENSE_SRC, resolve(PUBLISH_DIR, "LICENSE"));
  }
  await writeFile(resolve(PUBLISH_DIR, "README.md"), buildReadme(rootPkg.version));
  console.log("[build-publish-dir] wrote README + LICENSE");

  // Summary
  console.log(`
[build-publish-dir] ✔ publish/ is ready (v${rootPkg.version})

Next steps:
  cd publish && npm pack --dry-run   # inspect what will be uploaded
  npm publish ./publish              # publish to npm (needs npm login)
  `);
}

function buildReadme(version) {
  return `# pi-kot v${version}

Browser UI for the [pi coding agent](https://pi.dev).  
Self-hosted React workbench: streaming chat, session tree, file browser, terminal, git panel.

## Quick start

\`\`\`bash
npx pi-kot                          # one-shot, no install
npm install -g pi-kot               # or install globally
pi-kot                              # then run anywhere
\`\`\`

Opens at **http://localhost:3333** by default.

## Options

\`\`\`
pi-kot --port 4000
pi-kot --host 127.0.0.1
pi-kot --password mysecret
pi-kot --workspace ~/Code
pi-kot --help
\`\`\`

All options have matching env vars: \`PORT\`, \`HOST\`, \`UI_PASSWORD\`, \`API_KEY\`, \`WORKSPACE_PATH\`, \`LOG_LEVEL\`.

## Source

[github.com/YOUR_USERNAME/pi-kot](https://github.com/YOUR_USERNAME/pi-kot)
`;
}

main().catch((err) => {
  console.error("[build-publish-dir] fatal:", err);
  process.exit(1);
});
