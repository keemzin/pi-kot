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

- **Filesystem** — only three host paths are bind-mounted:
  - `/workspace` ← the checked-out repo root
  - `/home/pi/.pi/agent` ← pi config (`~/.pi/agent`: `ui-settings.json`, session overrides, keys)
  - `/home/pi/.pi-kot` ← runtime data (`~/.pi-kot-docker`: container projects, session trees, overrides)
- Everything else the agent touches lives inside the image.
- **Network** — loopback only by default (`127.0.0.1:3333:3000`). Drop the
  `127.0.0.1:` prefix to expose to the LAN (only after setting auth).

## Build & run

```bash
cd docker

# Default: server runs as `pi`, all capabilities dropped.
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
- **Ports** — `HOST_PORT` (host side of `127.0.0.1:HOST_PORT:3000`)
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
