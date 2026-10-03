# OpenWeight-Fabric: Local Inference POC

Local Proof of Concept (POC) for self-hosting open-weight LLMs using vLLM on Apple Silicon, exposing an OpenAI-compatible API, and integrating with developer tools such as OpenCode.

## Architecture

```text
OpenCode / Developer Tool
          | (HTTP / SSE)
          v
OpenAI-Compatible Endpoint (http://localhost:8000/v1)
          |
     vLLM Server (vllm-metal acceleration)
          |
   Qwen/Qwen3-0.6B (Model weights in ./model-cache)
```

Target Environment:
- Machine: Apple Silicon Mac (M-series), macOS
- Memory: 8 GB Unified Memory
- Purpose: Functional API testing and client compatibility, not performance benchmarking

## Repository Structure

```text
OpenWeight-Fabric/
├── .gitignore               # Excludes .venv, model-cache, and temporary files
├── README.md                # Documentation and operation guide
├── requirements.txt         # Test suite and helper dependencies
├── config/
│   └── vllm_config.yaml     # Server and testing configuration
├── scripts/
│   ├── download_model.py    # Downloads model snapshot to ./model-cache
│   ├── run_local.sh         # Launch script with 8 GB RAM memory guardrails
│   ├── test_api.py          # API validation suite
│   └── opencode_config.json # OpenCode provider configuration template
└── docker/
    ├── Dockerfile           # Containerized vLLM image
    ├── docker-compose.yml   # Docker compose with memory limits
    └── run_docker.sh        # Container startup script
```

## Hardware Safety & Memory Constraints

On an 8 GB unified memory Mac, default vLLM settings can exhaust physical memory and freeze macOS. This repository enforces the following safeguards in `scripts/run_local.sh`:

- Wired Memory Limit: `export VLLM_METAL_WIRED_LIMIT_MB=2048` caps wired memory to 2.0 GB.
- Memory Utilization: `--gpu-memory-utilization 0.5` allocates a controlled slice of memory for weights and KV cache.
- Context Ceiling: `--max-model-len 5120` and `--max-num-batched-tokens 1024` restrict KV cache consumption (~570 MB for Qwen3-0.6B).
- Eager Execution: `--enforce-eager` avoids JIT compilation memory overhead.
- Model Cache Isolation: Weights are stored inside `./model-cache` for easy deletion and Docker volume mounting.

## Setup

### 1. Initialize Virtual Environment

```bash
uv venv .venv --python 3.12
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Download Model Weights

Download the Qwen3-0.6B model snapshot to the local repository cache:

```bash
python scripts/download_model.py --model Qwen/Qwen3-0.6B --cache-dir ./model-cache
```

## Running the Server

### Foreground

```bash
./scripts/run_local.sh
```

### Background

```bash
nohup ./scripts/run_local.sh > vllm.log 2>&1 &
```

The server listens on:
- Base API: `http://localhost:8000/v1`
- Models List: `http://localhost:8000/v1/models`
- Health Check: `http://localhost:8000/health`
- Prometheus Metrics: `http://localhost:8000/metrics`

Check health via curl:

```bash
curl -i http://localhost:8000/health
```

## Stopping the Server

### 1. Check if the server is running

```bash
# By port
lsof -i :8000

# By process name
ps aux | grep vllm
```

### 2. Terminate the process

```bash
# Graceful stop by port
kill $(lsof -t -i :8000)

# Or terminate by process name
pkill -f "vllm serve"
```

### 3. Force kill (if unresponsive)

```bash
kill -9 $(lsof -t -i :8000)
```

## Testing & Validation

With the server running, execute the validation test suite in a separate terminal:

```bash
python scripts/test_api.py --url http://localhost:8000 --concurrency 2
```

The suite validates:
1. Server health and `/v1/models` response (verifies `qwen3-0.6b` is registered)
2. Non-streaming chat completion
3. Streaming chat completion (Server-Sent Events deltas and time-to-first-token)
4. Parallel concurrency handling (2 simultaneous requests)
5. Prometheus metrics endpoint at `/metrics`

## OpenCode Integration

The local vLLM server is compatible with OpenCode via its OpenAI-compatible provider specification.

### 1. Add Provider to OpenCode Config (`~/.config/opencode/opencode.jsonc`)

Add the local provider to your `providers` block. Do not set `"model"` at the root if you want to keep your existing default model.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "vllm-local": {
      "name": "Local vLLM (OpenWeight Fabric)",
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "http://localhost:8000/v1",
        "apiKey": "local-poc-no-key-required"
      },
      "models": {
        "qwen3-0.6b": {
          "name": "Qwen 3 0.6B (Local)",
          "limit": {
            "output": 128
          }
        }
      }
    }
  }
}
```

Reload OpenCode configuration:

```bash
opencode reload
```

### 2. Using the Local Model

Since the local model is not set as default, choose it on demand:

- In interactive mode: type `/models` and select `Local vLLM (OpenWeight Fabric) / Qwen 3 0.6B (Local)`.
- In CLI mode: pass the model flag explicitly:

```bash
opencode run -m vllm-local/qwen3-0.6b "Write a 1-line Python greeting function"
```

## Docker Execution (Optional)

To run the inference server in a container with local weight mounting:

```bash
docker compose -f docker/docker-compose.yml up --build
```

The Docker setup mounts `./model-cache` into `/model-cache` so weights are not re-downloaded.

## Future Considerations (Production Scope)

For transitioning to organization-wide production deployment:
- NVIDIA GPU Infrastructure: Migration from Metal acceleration to CUDA clusters with Tensor Parallelism.
- Routing & Gateway: Implementing an API gateway (e.g., LiteLLM or Envoy) for rate limiting, failover, and request logging.
- Authentication: Integration with enterprise SSO / OIDC.
- Cluster Orchestration: Deploying vLLM replicas on Kubernetes with auto-scaling based on queue depth and concurrency metrics.
