# Production Dockerfile for Enterprise AWS Deployment
FROM vllm/vllm-openai:v0.31.0

# Set operational environment variables
ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/model-cache \
    VLLM_LOGGING_LEVEL=INFO

# Ensure curl is available for container healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Default model directory target
WORKDIR /workspace

# Standard OpenAI-compatible API port
EXPOSE 8000

# Default entrypoint delegates to vLLM's production API launcher
ENTRYPOINT ["python3", "-m", "vllm.entrypoints.openai.api_server"]
