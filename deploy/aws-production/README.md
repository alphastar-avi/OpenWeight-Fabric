# Production AWS vLLM Deployment Guide

This directory contains the production Docker configuration, orchestration manifests, and operational documentation for running high-throughput open-weight coding models on an AWS `g6e.2xlarge` instance equipped with an NVIDIA L40S GPU (48 GB VRAM).

---

## Architecture and End-to-End Execution Flow

```text
Developer Tool (OpenCode / VS Code / Cursor)
           |
           | HTTP POST /v1/chat/completions (Stream: true, Tools: [...])
           v
Amazon EC2 (g6e.2xlarge) : Port 8000
           |
           v
Docker Container (vllm/vllm-openai)
           |
   [AsyncLLM Engine]
           |
           +---> 1. Tokenizer & Chat Template Validation
           |
           +---> 2. Prefix Cache Lookup (Checks if system prompt & tools are already cached)
           |        - Cache Hit: Bypasses prefill, reuses existing KV blocks in VRAM
           |        - Cache Miss: Executes parallel prefill on L40S Tensor Cores
           |
           +---> 3. PagedAttention Memory Allocation
           |        - Allocates 48 KB/token in FP8 KV Cache Pool (~8.7 GB pool)
           |
           +---> 4. Autoregressive Decode Execution
           |        - Generates tokens using Qwen3-Coder-30B-A3B MoE architecture
           |        - Evaluates 3.3B active parameters per token
           |
           +---> 5. Hermes Tool Call Parser
           |        - Detects <tool_call> tags in stream
           |        - Emits standard OpenAI JSON tool_calls payload
           |
           v
Server-Sent Events (SSE) Stream returned to OpenCode client
```

---

## Directory Contents

| File | Purpose |
| :--- | :--- |
| `docker-compose.yml` | Container specification with NVIDIA GPU reservation and IPC host sharing. |
| `Dockerfile` | Custom container definition extending official vLLM base image. |
| `.env.example` | Environment variable template defining model ID, context window, and memory parameters. |
| `start.sh` | Automated pre-flight check and container startup script. |
| `aws.md` | Complete AWS provisioning guide covering quotas, security groups, and storage. |
| `README.md` | Operational manual and configuration reference. |

---

## Configuration Reference (`.env`)

The production deployment is fully parameterized through `.env`. When `start.sh` runs for the first time, it automatically creates `.env` from `.env.example`.

| Parameter | Default Value | Description |
| :--- | :--- | :--- |
| `MODEL_ID` | `Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8` | Hugging Face model repository identifier or local path. |
| `SERVED_MODEL_NAME` | `qwen3-coder-30b` | Model alias registered on `/v1/models`. |
| `MAX_MODEL_LEN` | `32768` | Maximum sequence length (Input tokens + Output tokens). |
| `MAX_NUM_BATCHED_TOKENS` | `2048` | Maximum tokens processed concurrently across batched prefills. |
| `GPU_MEMORY_UTILIZATION` | `0.92` | Fraction of total VRAM reserved for weights and KV cache (44.16 GB of 48 GB). |
| `KV_CACHE_DTYPE` | `fp8` | Enables 8-bit KV caching, doubling token capacity to ~181,000 tokens. |
| `TENSOR_PARALLEL_SIZE` | `1` | Number of GPUs across which weights are partitioned. Set to 1 for `g6e.2xlarge`. |
| `HOST_PORT` | `8000` | Port bound on the EC2 host. |
| `CACHE_DIR` | `/data/model-cache` | Host path on the 200 GB persistent EBS volume mounted into the container. |

---

## How to Switch Models

The deployment is completely model-agnostic. To deploy a different model:

### Step 1: Update `.env`
Edit `deploy/aws-production/.env`:

```bash
# Example: Switching to Qwen 2.5 Coder 32B FP8
MODEL_ID=Qwen/Qwen2.5-Coder-32B-Instruct-FP8
SERVED_MODEL_NAME=qwen2.5-coder-32b
MAX_MODEL_LEN=32768
KV_CACHE_DTYPE=fp8
```

### Step 2: Restart the Service
```bash
cd deploy/aws-production
docker compose down
docker compose up -d
```
The new weights will download automatically into `/data/model-cache` (on the persistent 200 GB EBS drive) and boot up.

---

## Operational Commands

### 1. View Real-Time Inference Logs
```bash
docker compose logs -f vllm-production
```

### 2. Check Live GPU Memory and Utilization
```bash
nvidia-smi
# Or monitor continuously:
watch -n 1 nvidia-smi
```

### 3. Inspect Prometheus Production Metrics
```bash
curl http://localhost:8000/metrics
```
Key metrics to monitor:
- `vllm:num_requests_running`: Active concurrent streams currently executing.
- `vllm:num_requests_waiting`: Requests waiting in queue (scale instances if > 0).
- `vllm:gpu_cache_usage_factor`: Percentage of allocated KV cache pool in use.
- `vllm:time_to_first_token_seconds`: Prefill latency per request.

### 4. Stop and Start Service
```bash
# Graceful stop
docker compose down

# Start service
docker compose up -d
```

---

## Connecting Developer Clients

Once the container passes health checks, developers configure their tools:

### OpenCode Configuration (`~/.config/opencode/opencode.jsonc`)
```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "vllm-aws-prod": {
      "name": "AWS Production vLLM (Qwen3 Coder 30B)",
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "http://<EC2-HOST-IP>:8000/v1",
        "apiKey": "none"
      },
      "models": {
        "qwen3-coder-30b": {
          "name": "Qwen3 Coder 30B (AWS L40S)",
          "limit": {
            "context": 32768,
            "output": 4096
          }
        }
      }
    }
  }
}
```
Reload OpenCode:
```bash
opencode reload
```
Select the model via `/models` in the OpenCode interface.
