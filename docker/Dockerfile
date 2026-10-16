# syntax=docker/dockerfile:1.6
#
# Multi-stage Dockerfile for pi-kot application.
# Inherits from pi-kot-base:latest (or custom BASE_IMAGE) to enable fast iterative builds.
#
#   builder  → installs workspace dependencies and compiles client/server
#   runtime  → copies compiled dist outputs and starts via tini + pi-kot-entrypoint

ARG BASE_IMAGE=pi-kot-base:latest

# ---------- builder ----------
FROM ${BASE_IMAGE} AS builder

WORKDIR /app

# Copy lockfiles and workspace manifests first for Docker layer caching
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY patch-branch-summary.mjs ./

# `npm ci --workspaces` honours root lockfile across all packages
RUN npm ci --workspaces --include-workspace-root

# Copy application source and compile
COPY . .
RUN npm run build

# ---------- runtime ----------
FROM ${BASE_IMAGE} AS runtime

WORKDIR /app

# Copy hoisted node_modules + compiled workspaces from builder
COPY --from=builder --chown=pi:pi /app/node_modules ./node_modules
RUN if [ -d /app/node_modules/@earendil-works/pi-coding-agent ]; then \
      chmod -R a+rX,u+w,go-w /app/node_modules/@earendil-works/pi-coding-agent; \
    fi
COPY --from=builder --chown=pi:pi /app/package.json ./package.json
COPY --from=builder --chown=pi:pi /app/packages/server/package.json ./packages/server/package.json
COPY --from=builder --chown=pi:pi /app/packages/server/dist ./packages/server/dist
COPY --from=builder --chown=pi:pi /app/packages/client/package.json ./packages/client/package.json
COPY --from=builder --chown=pi:pi /app/packages/client/dist ./packages/client/dist

# Install entrypoint script
COPY docker/pi-kot-entrypoint.sh /usr/local/bin/pi-kot-entrypoint
RUN chmod 0755 /usr/local/bin/pi-kot-entrypoint

USER root

# Port 3000 (pi-kot web UI) + popular dev server ports for projects built inside
EXPOSE 3000 5173 3001 8000 8080 5000

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/pi-kot-entrypoint"]
CMD ["node", "packages/server/dist/index.js"]
