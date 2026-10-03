#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== OpenWeight Fabric: Containerized vLLM Server ==="

# Check if docker daemon is running
if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker daemon is not running."
  echo "Please start Docker Desktop and retry."
  exit 1
fi

# Ensure model cache exists
mkdir -p "$ROOT_DIR/model-cache"

echo "Building and starting container with mounted cache ($ROOT_DIR/model-cache)..."
cd "$ROOT_DIR/docker"
docker compose up --build
