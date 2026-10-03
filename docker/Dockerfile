# vLLM Container for Local / Staging Inference
# For CPU / Containerized verification
FROM python:3.12-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/model-cache

WORKDIR /app

# Install minimal system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install vLLM (standard Linux CPU wheel or GPU when migrating to CUDA)
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir vllm

# Expose standard OpenAI API port
EXPOSE 8000

# Default entrypoint runs vllm serve
ENTRYPOINT ["vllm", "serve"]
CMD ["/model-cache/models/Qwen--Qwen3-0.6B", "--served-model-name", "qwen3-0.6b", "--host", "0.0.0.0", "--port", "8000", "--max-model-len", "512", "--max-num-batched-tokens", "512", "--gpu-memory-utilization", "0.5", "--enforce-eager"]
