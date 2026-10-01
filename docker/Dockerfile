# syntax=docker/dockerfile:1.6
#
# Multi-stage Dockerfile for pi-kot.
#
#   builder  → install deps, compile server TS, build Vite client
#   runtime  → node:22-bookworm-slim with Python 3.12 + pip, compiled
#              output, and hoisted node_modules. The server runs as root
#              so the opt-in identity sandbox can drop tool processes to
#              the restricted pi-tools UID/GID.
#
# Why bookworm-slim and not alpine: the Node native-module ecosystem
# (node-pty, bcrypt, sharp, better-sqlite3, …) ships prebuilt binaries
# against glibc. On musl/alpine, prebuild-install can't find a matching
# binary and falls back to a source build, which both slows the image
# build and breaks any package without source-build support. The image
# is ~80 MB larger than alpine; in exchange we get faster builds, fewer
# native-module footguns, and a friendlier interactive shell for the
# integrated terminal (bash + readline + a real coreutils).

# ---------- shared Node + Python base ----------
FROM python:3.12-slim-bookworm AS python-base

FROM node:22-bookworm-slim AS node-python-base

# Keep the final image lineage on the official Node image — pi-kot is a
# Node app, so preserving Node/npm/corepack exactly as shipped is more
# important than preserving the Python image as the final base. Copy the
# official Python 3.12 runtime into /usr/local (Docker COPY merges into
# the existing Node-owned tree without deleting Node/npm/corepack) and
# install the Debian runtime libraries CPython extension modules commonly
# link against.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      libbz2-1.0 \
      libexpat1 \
      libffi8 \
      libgdbm-compat4 \
      liblzma5 \
      libncursesw6 \
      libreadline8 \
      libsqlite3-0 \
      libssl3 \
      libuuid1 \
      zlib1g \
 && rm -rf /var/lib/apt/lists/*
COPY --from=python-base /usr/local/ /usr/local/
RUN ln -sf /usr/local/bin/python3 /usr/local/bin/python \
 && ln -sf /usr/local/bin/python3 /usr/local/bin/py \
 && ldconfig \
 && node --version \
 && npm --version \
 && python3 --version \
 && pip3 --version

# ---------- builder ----------
FROM node-python-base AS builder

# Native deps for node-pty (Phase 1 will use it; the dep is already in
# server/package.json, so install needs the toolchain regardless). On
# bookworm-slim, node-pty's prebuilds usually cover the linux-x64 and
# linux-arm64 paths — but we keep the toolchain so a source build still
# works on platforms without a prebuild, and so any other native module
# pulled in transitively still installs cleanly.
RUN apt-get update \
 && apt-get install -y --no-install-recommends make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy lockfiles + workspace manifests first so dependency installs are
# cached on source-only changes.
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY patch-branch-summary.mjs ./

# `npm ci --workspaces` honours the root lockfile across all packages.
RUN npm ci --workspaces --include-workspace-root

# Now bring in the source and build.
COPY . .

RUN npm run build

# ---------- runtime ----------
FROM node-python-base AS runtime

# `tini` for proper PID-1 signal handling (Ctrl-C → SIGTERM → graceful
# shutdown of pi-kot's onClose hook). Without it, dropped SIGTERMs leave
# SSE clients hanging on `docker compose down`.
#
# PUID/PGID build args let the legacy `pi` user match the host owner of
# mounted config/data directories. PTOOLS_UID/PTOOLS_GID create the
# restricted `pi-tools` identity used by AGENT_TOOL_SANDBOX_ENABLED.
# Override at build time when your host bind mounts require different
# ownership:
#   docker compose build --build-arg PUID=$(id -u) --build-arg PGID=$(id -g)
ARG PUID=1000
ARG PGID=1000
ARG PTOOLS_UID=1001
ARG PTOOLS_GID=1001
ARG EXTRA_APT_PACKAGES=""

# Some upstream base images have shipped a pre-baked `node` user/group
# at UID/GID 1000 — the same default we want for `pi`. Drop it before
# creating `pi` if present; `|| true` keeps the build green on bases
# without that user.
#
# Runtime tools the agent + integrated terminal need:
#   - tini: PID-1 signal handling (see above)
#   - git: status / diff / commit / push / etc. — the GitPanel routes
#     and the agent's `bash` tool both expect git on PATH. Also used by
#     pi-kot's "clone repository" project-setup flow.
#   - ripgrep: pi's `grep` tool delegates to ripgrep when present.
#     Without it, code search inside the agent silently degrades.
#   - bash: replaces dash as the integrated terminal's interactive
#     shell. node-pty defaults to /bin/sh; we set SHELL=/bin/bash
#     below so xterm sessions land in bash with readline + history +
#     the prompt expansions users expect.
#   - curl, ca-certificates, less, procps, vim: minimum interactive-terminal
#     hygiene. curl for fetching, ca-certificates so HTTPS works, less
#     so `git log` and similar pagers don't bomb, procps so `ps`/`top`
#     are present for users debugging long-running tool processes, and
#     vim provides a familiar in-terminal editor.
#   - python3/pip3: Python 3.12 package tooling from the official
#     Python image. `python` and `py` are aliases for `python3`.
#   - make, g++: native-module rebuild toolchain for people using the
#     container as a development environment. `npm install` can rebuild
#     node-pty when the mounted checkout's lockfile / Node ABI differs
#     from the baked image; without Python node-gyp fails before it can
#     compile the binding.
#   - sudo: privilege elevation for user pi when ENABLE_SUDO is active.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      tini gosu sudo git ripgrep bash curl ca-certificates less procps vim make g++ \
 && if [ -n "$EXTRA_APT_PACKAGES" ]; then \
      apt-get install -y --no-install-recommends $EXTRA_APT_PACKAGES; \
    fi \
 && echo "Set disable_coredump false" >> /etc/sudo.conf \
 && rm -rf /var/lib/apt/lists/* \
 && ldconfig \
 && (userdel node 2>/dev/null || true) \
 && (groupdel node 2>/dev/null || true) \
 && groupadd -g $PGID pi \
 && useradd -m -u $PUID -g $PGID -s /bin/bash pi \
 && groupadd -g $PTOOLS_GID pi-tools \
 && useradd -m -d /home/pi-tools -u $PTOOLS_UID -g $PTOOLS_GID -s /usr/sbin/nologin pi-tools \
 && usermod -aG pi-tools pi

WORKDIR /app

# Copy from the builder: hoisted node_modules + all built workspaces.
# npm workspaces hoist deps to the root /app/node_modules — there is
# no per-package node_modules directory to copy. Bringing the package
# manifests + built artifacts is enough; module resolution walks up
# from packages/server/dist into /app/node_modules.
COPY --from=builder --chown=pi:pi /app/node_modules ./node_modules
RUN if [ -d /app/node_modules/@earendil-works/pi-coding-agent ]; then \
      chmod -R a+rX,u+w,go-w /app/node_modules/@earendil-works/pi-coding-agent; \
    fi
COPY --from=builder --chown=pi:pi /app/package.json ./package.json
COPY --from=builder --chown=pi:pi /app/packages/server/package.json ./packages/server/package.json
COPY --from=builder --chown=pi:pi /app/packages/server/dist ./packages/server/dist
COPY --from=builder --chown=pi:pi /app/packages/client/package.json ./packages/client/package.json
COPY --from=builder --chown=pi:pi /app/packages/client/dist ./packages/client/dist

# Workspace + pi config + pi-kot data dirs are mounted at runtime.
# Image-layer defaults preserve the historical non-sandbox posture:
# the server runs as `pi`, and pi-owned config/data dirs are writable by it.
# Sandbox deployments must explicitly permission their mounts; see
# docs/containers.md.
RUN mkdir -p /workspace /home/pi/.pi/agent /home/pi/.pi-kot /home/pi/.local /home/pi/.npm /home/pi-tools/.config \
 && chown -R pi:pi /workspace /home/pi/.pi/agent /home/pi/.pi-kot /home/pi/.local /home/pi/.npm \
 && chown -R pi-tools:pi-tools /home/pi-tools \
 && chown pi:pi /home/pi \
 && chown pi:pi /home/pi/.pi \
 && chmod 0775 /workspace \
 && chmod 0755 /home/pi /home/pi/.pi \
 && chmod 0700 /home/pi/.pi/agent /home/pi/.pi-kot /home/pi/.local /home/pi/.npm /home/pi-tools

RUN cat >/usr/local/bin/pi-kot-entrypoint <<'EOF'
#!/bin/sh
set -eu
case "$(printf '%s' "${AGENT_TOOL_SANDBOX_ENABLED:-false}" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on)
    # Sandbox mode: keep the server as root so it can setuid/setgid
    # model/user tool children to AGENT_TOOL_UID:GID. Prepare the standard
    # writable mounts here, before Node imports config.ts and tries to create
    # server-private files such as /home/pi/.pi-kot/jwt-secret.
    if [ "$(id -u)" != "0" ]; then
      echo "AGENT_TOOL_SANDBOX_ENABLED=true requires the container to run as root" >&2
      exit 1
    fi
    tool_uid="${AGENT_TOOL_UID:?AGENT_TOOL_UID is required when sandbox is enabled}"
    tool_gid="${AGENT_TOOL_GID:?AGENT_TOOL_GID is required when sandbox is enabled}"
    workspace_path="${WORKSPACE_PATH:-/workspace}"
    kot_data_dir="${KOT_DATA_DIR:-${FORGE_DATA_DIR:-/home/pi/.pi-kot}}"
    pi_config_dir="${PI_CONFIG_DIR:-/home/pi/.pi/agent}"
    tool_home="${AGENT_TOOL_HOME:-/home/pi-tools}"

    mkdir -p "$workspace_path" "$kot_data_dir" "$pi_config_dir" "$tool_home"

    chown root:root "$kot_data_dir"
    chmod u+rwx "$kot_data_dir"
    chown -R root:root "$kot_data_dir"
    chmod -R u+rwX,go-rwx "$kot_data_dir"

    chown root:0 "$workspace_path"
    chmod u+rwx,g+rwx "$workspace_path"
    chown -R root:0 "$workspace_path"
    chmod -R u+rwX,g+rwX,o-rwx "$workspace_path"
    chown -R "$tool_uid:0" "$workspace_path"

    chown root:"$tool_gid" "$pi_config_dir"
    chmod 0750 "$pi_config_dir"

    chown root:"$tool_gid" "$tool_home"
    chmod u+rwx "$tool_home"
    chown -R root:"$tool_gid" "$tool_home"
    chmod -R u+rwX,go-rwx "$tool_home"
    chown -R "$tool_uid:$tool_gid" "$tool_home"

    exec "$@"
    ;;
  *)
    # Legacy/default mode: run as whichever non-root user the runtime
    # selected. When started as root, configure sudoers according to
    # ENABLE_SUDO before gosu drops privileges to pi.
    if [ "$(id -u)" = "0" ]; then
      case "$(printf '%s' "${ENABLE_SUDO:-false}" | tr '[:upper:]' '[:lower:]')" in
        1|true|yes|on|scoped)
          echo "pi ALL=(ALL) NOPASSWD: /usr/bin/apt, /usr/bin/apt-get, /usr/bin/dpkg" > /etc/sudoers.d/pi
          chmod 0440 /etc/sudoers.d/pi
          ;;
        all|full)
          echo "pi ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/pi
          chmod 0440 /etc/sudoers.d/pi
          ;;
        *)
          rm -f /etc/sudoers.d/pi
          ;;
      esac
      exec gosu pi "$@"
    fi
    exec "$@"
    ;;
esac
EOF
RUN chmod 0755 /usr/local/bin/pi-kot-entrypoint

USER root

# SHELL=/bin/bash so node-pty spawns bash for the integrated terminal
# (pty-manager.ts uses `process.env.SHELL || '/bin/sh'`). TERM hint
# helps line-editing programs pick a sane terminfo entry inside xterm.
#
# PATH prepends /home/pi/.local/bin for scripts installed by
# `python3 -m pip install --user ...`, then /app/node_modules/.bin so
# the `pi` CLI shipped by @earendil-works/pi-coding-agent (already a
# server dep) is on PATH for the running server and any process it
# spawns. The pi-subagents plugin shells out via
# `child_process.spawn("pi", ...)` with no fallback resolution on Linux
# — without this, the subagent tool fails with `spawn pi ENOENT` inside
# the container.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    HOME=/home/pi \
    USER=pi \
    LOGNAME=pi \
    PATH=/home/pi/.local/bin:/app/node_modules/.bin:$PATH \
    WORKSPACE_PATH=/workspace \
    PI_CONFIG_DIR=/home/pi/.pi/agent \
    FORGE_DATA_DIR=/home/pi/.pi-kot \
    PYTHONUSERBASE=/home/pi/.local \
    SHELL=/bin/bash \
    TERM=xterm-256color

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/pi-kot-entrypoint"]
CMD ["node", "packages/server/dist/index.js"]
