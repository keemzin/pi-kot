# The `pi-tools` identity sandbox

In default mode the server runs as the `pi` user, so every process the agent
spawns (bash tool, subagents, model tool children) runs as `pi` too. The
sandbox mode adds a second, restricted identity for those child processes.

## The two identities

| Identity | UID/GID (default) | Purpose |
|----------|-------------------|---------|
| `pi` | `1000:1000` | the server itself (can be overridden via `PUID`/`PGID`) |
| `pi-tools` | `1001:1001` | child tool/model processes (override via `AGENT_TOOL_UID`/`AGENT_TOOL_GID`) |

`pi-tools` is created with a `nologin` shell and no home write, so it can only
do what you let it.

## How it works

1. The server starts **as root** (the sandbox compose adds `SETUID`/`SETGID`).
2. Startup (`pi-kot-entrypoint`) chowns the standard writable mounts so the
   server can prepare them before Node imports config.
3. When the agent spawns a tool child, pi-kot re-execs it as
   `AGENT_TOOL_UID:AGENT_TOOL_GID` instead of as `pi` or root.

This lets you give model or user tool processes a narrower permission set
than the main server while keeping the server fully functional.

## Enabling it

```bash
cd docker
docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d --build
```

`AGENT_TOOL_SANDBOX_ENABLED=true` must be set (it defaults to `true` in the
sandbox compose file). If you run the base compose alone, the container
starts as `pi` and the sandbox path is skipped.

## Changing the default IDs

```bash
docker compose build \
  --build-arg PUID=$(id -u) \
  --build-arg PGID=$(id -g) \
  --build-arg AGENT_TOOL_UID=1002 \
  --build-arg AGENT_TOOL_GID=1002 \
  ..
```

Override the IDs at build time when your host bind mounts require different
ownership.
