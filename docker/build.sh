#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BUILD_BASE=false

for arg in "$@"; do
  if [[ "$arg" == "--base" ]] || [[ "$arg" == "-b" ]]; then
    BUILD_BASE=true
    break
  fi
done

# If --base requested or base image does not exist locally, build base image first
if [ "$BUILD_BASE" = true ] || ! docker image inspect pi-kot-base:latest >/dev/null 2>&1; then
  echo "==> Building pi-kot-base:latest (Node 22 + Python 3.12 + Playwright + hound-mcp)..."
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" --profile base build pi-kot-base
fi

# Build application child image
echo "==> Building pi-kot:latest..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" build pi-kot

echo "==> Done! Run with: (cd docker && docker compose up -d)"
