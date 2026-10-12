#!/usr/bin/env bash
# Production vLLM Deployment Startup Script for AWS EC2 (g6e.2xlarge)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=================================================="
echo "OpenWeight Fabric: Starting Production vLLM Server"
echo "=================================================="

# 1. Pre-flight check: Verify NVIDIA GPU driver
if ! command -v nvidia-smi &> /dev/null; then
    echo "ERROR: nvidia-smi not found. Ensure NVIDIA drivers are installed on this EC2 instance."
    exit 1
fi

echo "[1/5] Verifying GPU status..."
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader

# 2. Pre-flight check: Verify Docker and NVIDIA Container Toolkit
echo "[2/5] Verifying Docker NVIDIA runtime..."
if ! docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi &> /dev/null; then
    echo "ERROR: NVIDIA Container Toolkit is not functional in Docker."
    echo "Run: sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker"
    exit 1
fi
echo "NVIDIA Docker runtime verified successfully."

# 3. Environment configuration
echo "[3/5] Configuring environment..."
if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
fi

# Source .env for local script variables
set -a
source .env
set +a

# 4. Storage preparation (EBS cache directory)
echo "[4/5] Preparing cache storage at ${CACHE_DIR}..."
sudo mkdir -p "${CACHE_DIR}"
sudo chown -R 1000:1000 "${CACHE_DIR}" 2>/dev/null || sudo chmod -R 777 "${CACHE_DIR}"

# 5. Launch container
echo "[5/5] Launching vLLM container..."
docker compose up -d

echo ""
echo "Container started. Waiting for model initialization and healthcheck..."
echo "Model: ${MODEL_ID}"
echo "Context Window: ${MAX_MODEL_LEN}"
echo "KV Cache Type: ${KV_CACHE_DTYPE}"
echo ""

# Poll health endpoint
HEALTH_URL="http://localhost:${HOST_PORT:-8000}/health"
MAX_ATTEMPTS=40
ATTEMPT=1

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    if curl -s -f "$HEALTH_URL" > /dev/null 2>&1; then
        echo "=================================================="
        echo "SUCCESS: vLLM Server is Healthy and Ready!"
        echo "Endpoint: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo 'localhost'):${HOST_PORT:-8000}/v1"
        echo "=================================================="
        exit 0
    fi
    echo "Waiting for vLLM to load weights and initialize KV cache (Attempt $ATTEMPT/$MAX_ATTEMPTS)..."
    sleep 10
    ATTEMPT=$((ATTEMPT + 1))
done

echo "WARNING: Healthcheck did not pass within 400 seconds."
echo "Check container logs with: docker compose logs -f"
exit 1
