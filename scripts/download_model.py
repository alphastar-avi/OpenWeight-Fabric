#!/usr/bin/env python3
"""
Model Downloader for Local vLLM POC
Downloads the target model to a local directory (./model-cache)
so it can be mounted into Docker or used directly by local vLLM.
"""

import os
import sys
import argparse
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="Download model weights to local cache")
    parser.add_argument("--model", type=str, default="Qwen/Qwen3-0.6B", help="HuggingFace model ID")
    parser.add_argument("--cache-dir", type=str, default="./model-cache", help="Local directory to store weights")
    args = parser.parse_args()

    cache_path = Path(args.cache_dir).resolve()
    cache_path.mkdir(parents=True, exist_ok=True)

    print(f"==================================================")
    print(f"Downloading Model: {args.model}")
    print(f"Target Cache Directory: {cache_path}")
    print(f"==================================================")

    # Set Hugging Face environment variables to point to the local cache dir
    os.environ["HF_HOME"] = str(cache_path)

    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("Error: huggingface_hub not installed. Please run: pip install huggingface_hub", file=sys.stderr)
        sys.exit(1)

    print("Fetching repository snapshot (safetensors, tokenizer, config)...")
    model_path = snapshot_download(
        repo_id=args.model,
        local_dir=str(cache_path / "models" / args.model.replace("/", "--")),
        local_dir_use_symlinks=False,
        resume_download=True
    )

    print(f"\n[SUCCESS] Model successfully downloaded to:")
    print(f"  {model_path}")

    # Calculate total size
    total_bytes = sum(f.stat().st_size for f in Path(model_path).rglob("*") if f.is_file())
    print(f"  Total size on disk: {total_bytes / (1024 * 1024):.2f} MB")
    print(f"==================================================")

if __name__ == "__main__":
    main()
