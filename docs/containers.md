# Containing pi-kot

The `docker/` files run pi-kot inside a container so the agent's tools can
operate freely **inside** the image without touching your host machine.

## Two postures, one image

The build produces one image with two run modes, selected by the compose file:

| Mode | Compose file | Runs as | Capabilities |
|------|--------------|---------|--------------|
| Default | `docker-compose.yml` | `pi` (a normal user) | all dropped, `no-new-privileges` |
| Sandbox | `+docker-compose.sandbox.yml` | root + `setuid`/`setgid` | `CHOWN/SETUID/SETGID` added back |

Default mode is the safe default — no Linux capabilities are needed because
the container starts as `pi` directly. Sandbox mode is opt-in: it keeps the
server as root so it can spawn model/user tool children as a restricted
`pi-tools` identity, and it explicitly re-adds the capability trio.

## What gets isolated

- **Filesystem** — standard host paths are bind-mounted:
  - `/workspace` ← the checked-out repo root (projects created here persist to the host)
  - `/home/pi/.pi/agent` ← pi config (`~/.pi/agent`: `ui-settings.json`, session overrides, keys)
  - `/home/pi/.pi-kot` ← runtime data (`~/.pi-kot-docker`: container projects, session trees, overrides)
  - `/opt` ← owned by `pi:pi` inside the image; optionally mountable to persist third-party tool installations
- Everything else the agent touches lives inside the image.
- **Network** — loopback only by default (`127.0.0.1:3333:3000`). Drop the
  `127.0.0.1:` prefix to expose to the LAN (only after setting auth).

## Quick run (prebuilt image)

If you don't want to clone or build, pull and run the official image directly:

```bash
docker run -d \
  --name pi-kot \
  --restart unless-stopped \
  -p 3399:3000 \
  -p 5173:5173 \
  -p 3001:3001 \
  -p 8001:8000 \
  -p 5000:5000 \
  -v $(pwd)/workspace:/workspace \
  -v ~/.pi-kot-docker:/home/pi/.pi-kot \
  -v ~/.pi/agent:/home/pi/.pi/agent \
  -e UI_PASSWORD=vbn \
  -e ENABLE_SUDO=all \
  -e PUID=$(id -u) \
  -e PGID=$(id -g) \
  johnsdoes/pi-kot:1.1.0

# Open http://localhost:3399 (password: vbn)
```

## Dev server port forwarding

When the agent runs development servers or tests web applications inside the container, popular ports are pre-forwarded to your host:

| Container Port | Host Port (default) | Typical Use Case |
|---|---|---|
| `3000` | `3333` (or `3399` in `docker run`) | **pi-kot Web UI** (reserved) |
| `5173` | `5173` | Vite / SvelteKit / Astro dev servers |
| `3001` | `3001` | Next.js / Express (since 3000 is pi-kot) |
| `8000` | `8001` | Python FastAPI / Uvicorn (mapped to 8001 to avoid host 8000 clash) |
| `8080` | `8081` | Web / Vue CLI / Spring Boot (mapped to 8081 to avoid host 8080 clash) |
| `5000` | `5000` | Flask / Python API servers |

## Baked-in tools & Agent awareness
 
- **`hound-mcp[all]` & Playwright Chromium**: The prebuilt image includes [hound-mcp](https://github.com/dondai1234/master-fetch) for web scraping, deep crawling, keyless search, PDF parsing, OCR, and neural rerank, alongside Chromium in `/ms-playwright`.
- **User & Permissions**: The container runs as user `pi`. `/opt` is owned by `pi:pi` (0775). With `ENABLE_SUDO=all` (or `scoped`), passwordless `sudo` is enabled for system packages.
- **Auto `/workspace` Navigation**: In Docker, the "Add / Open Project" dialog automatically defaults to `/workspace/` so created projects always persist to the host. A **Workspace** toolbar shortcut allows instant 1-click switching.
- **Container Awareness**: The container sets `PI_KOT_CONTAINER=true`. pi-kot automatically detects container execution and injects runtime context into the agent's system prompt:
  - Reminding the agent that dev servers must bind to `0.0.0.0` (not `127.0.0.1` or `localhost`).
  - Instructing it that port `3000` is reserved for pi-kot itself.
  - Informing it of the available forwarded ports, pre-installed tools, and `sudo` availability.
  - Directing it to always create projects and files inside `/workspace/`.
- **Want a lean custom image?** If you don't need `hound-mcp` and Playwright Chromium (which add ~1.8GB to the layer), comment out the Playwright and hound-mcp section in `docker/Dockerfile.base` and rebuild with `./build.sh --base` for a ~1.3GB image.

## Build & run with Compose

The setup uses a two-tier image strategy:
- `pi-kot-base:latest`: Heavy platform layer (Python 3.12, Node 22, Playwright Chromium, hound-mcp). Built once or when base system deps change.
- `pi-kot:latest`: Application child layer. Rebuilds in ~15–20 seconds on TypeScript code changes.

```bash
cd docker

# First time (or when rebuilding base image):
./build.sh --base

# Day-to-day iterative development:
docker compose up -d --build

# Sandbox: server runs as root, tool children drop to `pi-tools`.
docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d --build
```

`--build` is required the first time (and whenever source changes, since
`dist/` is gitignored and rebuilt inside the container).

## Environment variables

Every variable in the compose files has a safe default, so a running setup
works with **no `.env` file at all**. Create one only to override:

- **Secrets** — `UI_PASSWORD`, `API_KEY` (both empty = auth disabled)
- **Identity** — `PUID`/`PGID` to match the host owner of a mounted dir, or
  `AGENT_TOOL_UID`/`AGENT_TOOL_GID`/`AGENT_TOOL_HOME` for the sandbox
- **Ports** — `HOST_PORT` (host side of `127.0.0.1:HOST_PORT:3000`), plus `DEV_PORT_VITE`, `DEV_PORT_NODE`, `DEV_PORT_API`, `DEV_PORT_WEB`, `DEV_PORT_FLASK`
- **Mounts** — `WORKSPACE_HOST_PATH`, `PI_CONFIG_HOST_PATH`, `KOT_DATA_HOST_PATH`
  to point at different host locations
- **Sudo permissions** — `ENABLE_SUDO`: `false` (no sudo), `true` (scoped sudo for `apt`/`apt-get`/`dpkg`), or `all` (full sudo)
- **Extra packages** — `EXTRA_APT_PACKAGES` to bake additional Debian packages (e.g. `ffmpeg`, `libnss3`) into the image at build time

If you want to share these across environments, put them in `docker/.env`
and Compose loads them automatically.

## Configuration

| File | Covers |
|------|--------|
| `docs/containers.md` | this overview |
| `docs/agent-tool-sandbox.md` | the `pi-tools` identity sandbox |
| `docs/configuration.md` | the full server env-var reference |
