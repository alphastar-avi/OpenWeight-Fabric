#!/usr/bin/env bash
# OpenWeight Fabric: Local vLLM Inference Server Runner
# Uses the project-isolated virtual environment (.venv) and local model cache (model-cache)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

VENV_BIN="$ROOT_DIR/.venv/bin"
MODEL_CACHE="$ROOT_DIR/model-cache"
DEFAULT_MODEL_DIR="$MODEL_CACHE/models/Qwen--Qwen3-0.6B"
MODEL_ID="Qwen/Qwen3-0.6B"
SERVED_NAME="qwen3-0.6b"
HOST="0.0.0.0"
PORT="8000"
MAX_MODEL_LEN="8192"
MAX_BATCHED_TOKENS="1024"
GPU_MEMORY_UTILIZATION="0.5"

# 1. Verify virtual environment exists
if [ ! -f "$VENV_BIN/vllm" ]; then
    echo "Error: vLLM executable not found in $VENV_BIN."
    echo "Please ensure the project .venv has been initialized and dependencies installed."
    exit 1
fi

# 2. Configure isolated cache & safe hardware limits for 8GB Mac
export HF_HOME="$MODEL_CACHE"
export VLLM_PLUGINS="metal"
export VLLM_METAL_WIRED_LIMIT_MB="2048" # Never wire more than 2GB to prevent freezing macOS

# 3. Determine model path
if [ -d "$DEFAULT_MODEL_DIR" ]; then
    MODEL_TARGET="$DEFAULT_MODEL_DIR"
    echo "Using cached local model directory: $MODEL_TARGET"
else
    MODEL_TARGET="$MODEL_ID"
    echo "Local snapshot not found at $DEFAULT_MODEL_DIR, using repo ID: $MODEL_ID (cache dir: $MODEL_CACHE)"
fi

echo "=================================================="
echo "Starting vLLM Local OpenAI-compatible Server"
echo "  Model:           $MODEL_TARGET"
echo "  Served Name:     $SERVED_NAME"
echo "  Endpoint:        http://$HOST:$PORT/v1"
echo "  Metrics:         http://$HOST:$PORT/metrics"
echo "  Max Context:     $MAX_MODEL_LEN"
echo "  Memory Fraction: $GPU_MEMORY_UTILIZATION"
echo "  Safety:          Wired RAM capped at 2.0GB, eager mode enabled"
echo "=================================================="

# 4. Launch vLLM server with memory safety flags
exec "$VENV_BIN/vllm" serve "$MODEL_TARGET" \
    --served-model-name "$SERVED_NAME" \
    --host "$HOST" \
    --port "$PORT" \
    --max-model-len "$MAX_MODEL_LEN" \
    --max-num-batched-tokens "$MAX_BATCHED_TOKENS" \
    --gpu-memory-utilization "$GPU_MEMORY_UTILIZATION" \
    --enforce-eager \
    --enable-auto-tool-choice \
    --tool-call-parser hermes \
    "$@"
