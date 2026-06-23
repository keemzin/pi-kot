# pi-kot — Starting & Configuration

## Quick start

```bash
# Dev mode (hot-reload — server + Vite proxy)
cd /home/hakeem/pi-kot
npm run dev

# Build then start (static client served by server)
npm run build
npm run start
```

With a password:

```bash
UI_PASSWORD=mypassword npm run dev
# or
UI_PASSWORD=mypassword npm run start
```

Open `http://localhost:3333` (dev: `http://localhost:5173`).

---

## All configuration parameters

Set as environment variables **or** CLI flags (when using `npx pi-kot` / `pi-kot`).

### Network

| Variable | Flag | Default | Description |
|---|---|---|---|
| `PORT` | `--port` | `3333` | HTTP listen port |
| `HOST` | `--host` | `0.0.0.0` | Bind address (`127.0.0.1` for loopback-only) |
| `TRUST_PROXY` | — | `false` | Trust `X-Forwarded-*` headers when behind a reverse proxy |
| `CORS_ORIGIN` | — | `true` | CORS origin. `true` = reflect request origin. Set a specific origin in production. |

### Authentication

| Variable | Flag | Default | Description |
|---|---|---|---|
| `UI_PASSWORD` | `--password` | — | Enable password auth. Browser shows a login form. |
| `API_KEY` | `--api-key` | — | Static API key for scripts/CI. Also accepted as password in the login form. |

If both are unset, auth is **disabled** and the UI opens freely.

### Storage paths

| Variable | Flag | Default | Description |
|---|---|---|---|
| `WORKSPACE_PATH` | `--workspace` | `~/.pi-kot/workspace/default` | Default project workspace directory |
| `SESSION_DIR` | — | `~/.pi-kot/sessions` | Session data directory |
| `FORGE_DATA_DIR` | — | `~/.pi-kot` | Base config/data directory (MCP config, tool overrides, skill overrides) |
| `PI_CONFIG_DIR` | — | `~/.pi/agent` | pi agent configuration directory (used by SDK) |

### Data files (stored under `FORGE_DATA_DIR` by default)

| Variable | Default | Description |
|---|---|---|
| `MCP_CONFIG_FILE` | `$FORGE_DATA_DIR/mcp.json` | MCP server configurations |
| `MCP_STDIO_TRUST_FILE` | `$FORGE_DATA_DIR/mcp-stdio-trust.json` | Trusted stdio MCP servers |
| `TOOL_OVERRIDES_FILE` | `$FORGE_DATA_DIR/tool-overrides.json` | Per-project tool enable/disable overrides |
| `SKILL_OVERRIDES_FILE` | `$FORGE_DATA_DIR/skill-overrides.json` | Per-project skill enable/disable overrides |

### Logging & Environment

| Variable | Flag | Default | Description |
|---|---|---|---|
| `LOG_LEVEL` | `--log-level` | `info` | Server log level: `info`, `debug`, `warn`, `error` |
| `PIKOT_MODE` | — | — | Set to `dev` to use `-dev`-suffixed data dirs (`~/.pi-kot-dev/`) so dev data doesn't mix with production |
| `NODE_ENV` | — | `production` | Server sets this automatically; `test` disables request logging |
| `MOUNT_CWD_PROJECT` | — | auto-set by CLI | When set, auto-creates a project for the given directory. The CLI shim sets this to the current working directory. |

### Static client serving

| Variable | Default | Description |
|---|---|---|
| `SERVE_CLIENT` | `true` | Serve the built Vite client from `CLIENT_DIST_PATH`. Set `false` to run API-only (e.g. behind a separate reverse proxy serving the client). |
| `CLIENT_DIST_PATH` | `packages/client/dist` (in-repo) or `dist/client` (npm install) | Path to the built client dist directory. Auto-detected. |

### Orchestration

| Variable | Default | Description |
|---|---|---|
| `ORCHESTRATION_ENABLED` | `true` | Enable supervisor/worker orchestration |
| `ORCHESTRATION_MAX_WORKERS_PER_SUPERVISOR` | `8` | Max parallel workers per supervisor session |
| `MINIMAL_UI` | `false` | Hide optional UI panels (terminal, git, changes). Useful for locked-down deployments. |

### Dev-mode only (Vite)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_PORT` | `3332` | Backend port that the Vite dev proxy forwards `/api` requests to. The `dev` script sets this to `3332`. |

---

## Running modes

### Production build

```bash
npm run build          # compiles server + client
npm run start          # serves everything on :3333
```

Behind a reverse proxy (nginx, Caddy):

```bash
CORS_ORIGIN=https://my-domain.com TRUST_PROXY=true npm run start
```

### Development (hot-reload)

```bash
npm run dev             # server :3332 + Vite :5173 concurrently
# or individually:
npm run dev:server      # server only on :3332
npm run dev:client      # Vite only, proxies /api → :3332
```

### CLI (via npx or global install)

```bash
npx pi-kot                        # defaults
npx pi-kot --port 4000            # custom port
npx pi-kot --password secret      # enable auth
npx pi-kot --host 127.0.0.1       # loopback only
npx pi-kot --workspace ~/Code     # custom workspace
npx pi-kot --help                 # all flags
```

---

## Testing the token-clear fix

```bash
# Terminal 1 — first run
UI_PASSWORD=testpass npm run dev

# Login in browser with testpass → works

# Kill server (Ctrl+C), then restart with new password
UI_PASSWORD=newpass npm run dev

# Refresh browser → old token is invalid →
# first API call gets 401 → token auto-cleared → login form shows
```

Or use the **Sign out** button (header bar, next to ⚙) or **Clear stored token** (login form) to manually clear.

---

## Examples

```bash
# Minimal: no auth, port 8080, loopback-only
PORT=8080 HOST=127.0.0.1 npm run start

# Password auth with dev mode, separate data dir
PIKOT_MODE=dev UI_PASSWORD=secret npm run dev

# API key for automation
API_KEY=sk-abc123 npm run start
# curl -H "Authorization: Bearer sk-abc123" http://localhost:3333/api/v1/projects

# Debug logging
LOG_LEVEL=debug npm run start

# Minimal UI (hide terminal, git, changes panels)
MINIMAL_UI=true npm run start
```
