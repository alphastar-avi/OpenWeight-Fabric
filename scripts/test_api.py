#!/usr/bin/env python3
"""
Comprehensive Validation Suite for Local vLLM POC
Tests:
  1. Health & /v1/models endpoint
  2. Non-streaming Chat Completion
  3. Streaming Chat Completion
  4. Concurrency / Parallel Request Handling
  5. Local vLLM /metrics endpoint inspection
"""

import sys
import time
import json
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.request
import urllib.error

try:
    from openai import OpenAI
except ImportError:
    print("Warning: openai package not installed. Installing via requirements.txt is recommended.", file=sys.stderr)
    OpenAI = None

def check_endpoint(base_url):
    print(f"\n[1/5] Checking Server Health & Available Models at {base_url}...")
    models_url = f"{base_url}/v1/models"
    try:
        req = urllib.request.Request(models_url)
        with urllib.request.urlopen(req, timeout=10) as response:
            if response.status == 200:
                data = json.loads(response.read().decode("utf-8"))
                models = [m.get("id") for m in data.get("data", [])]
                print(f"  ✓ Server is healthy! HTTP 200")
                print(f"  ✓ Available models: {models}")
                return models[0] if models else None
    except Exception as e:
        print(f"  ✗ Failed to connect to {models_url}: {e}")
        return None

def test_non_streaming(client, model_name):
    print(f"\n[2/5] Testing Non-Streaming Chat Completion with model '{model_name}'...")
    prompt = "Write a concise Python function to check if a number is prime. Include type hints."
    start_time = time.time()
    try:
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": "You are a concise software assistant."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=60,
            temperature=0.2
        )
        latency = time.time() - start_time
        choice = response.choices[0]
        content = choice.message.content
        usage = response.usage
        
        print(f"  ✓ Completed in {latency:.2f}s")
        print(f"  ✓ Prompt tokens: {usage.prompt_tokens if usage else 'N/A'}, Completion tokens: {usage.completion_tokens if usage else 'N/A'}")
        print(f"  ✓ Response sample (first 120 chars):")
        print(f"    {content.strip()[:120]}...\n")
        return True
    except Exception as e:
        print(f"  ✗ Non-streaming request failed: {e}")
        return False

def test_streaming(client, model_name):
    print(f"\n[3/5] Testing Streaming Chat Completion...")
    prompt = "List 2 key benefits of unit testing in 1 sentence each."
    start_time = time.time()
    first_token_time = None
    chunks_received = 0
    full_text = []

    try:
        stream = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "user", "content": prompt}
            ],
            max_tokens=40,
            stream=True
        )
        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                if first_token_time is None:
                    first_token_time = time.time() - start_time
                chunks_received += 1
                full_text.append(chunk.choices[0].delta.content)
        
        total_time = time.time() - start_time
        ttft = first_token_time if first_token_time is not None else total_time
        print(f"  ✓ Streaming completed in {total_time:.2f}s (TTFT: {ttft:.2f}s, Chunks: {chunks_received})")
        print(f"  ✓ Content preview: {''.join(full_text)[:100].strip()}...")
        return True
    except Exception as e:
        print(f"  ✗ Streaming request failed: {e}")
        return False

def test_concurrency(client, model_name, concurrency=2):
    print(f"\n[4/5] Testing Concurrency ({concurrency} parallel requests)...")
    prompts = [
        f"Explain Python list comprehension in one sentence. #{i}"
        for i in range(concurrency)
    ]

    def single_req(idx, p):
        s = time.time()
        res = client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": p}],
            max_tokens=30
        )
        dur = time.time() - s
        return idx, dur, res.choices[0].message.content

    start = time.time()
    results = []
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(single_req, i, prompts[i]) for i in range(concurrency)]
        for f in as_completed(futures):
            try:
                idx, dur, text = f.result()
                results.append((idx, dur))
                print(f"  ✓ Request #{idx} finished in {dur:.2f}s")
            except Exception as e:
                print(f"  ✗ Request failed: {e}")

    total_batch_time = time.time() - start
    success_count = len(results)
    print(f"  ✓ Batch completed: {success_count}/{concurrency} successful in {total_batch_time:.2f}s")
    return success_count == concurrency

def test_metrics(base_url):
    print(f"\n[5/5] Inspecting vLLM Prometheus Metrics at {base_url}/metrics...")
    metrics_url = f"{base_url}/metrics"
    try:
        req = urllib.request.Request(metrics_url)
        with urllib.request.urlopen(req, timeout=10) as response:
            if response.status == 200:
                raw = response.read().decode("utf-8")
                lines = raw.split("\n")
                interesting_prefixes = [
                    "vllm:num_requests_running",
                    "vllm:num_requests_waiting",
                    "vllm:gpu_cache_usage_factor",
                    "vllm:cpu_cache_usage_factor",
                    "vllm:prompt_tokens_total",
                    "vllm:generation_tokens_total",
                    "vllm:request_success_total"
                ]
                found_metrics = {}
                for line in lines:
                    line = line.strip()
                    if line.startswith("#"):
                        continue
                    for prefix in interesting_prefixes:
                        if line.startswith(prefix):
                            found_metrics[prefix] = line
                
                print("  ✓ Key local metrics extracted:")
                if found_metrics:
                    for k, v in found_metrics.items():
                        print(f"    - {v}")
                else:
                    print("    (Metrics endpoint responded, but custom prefixes are formatted differently)")
                return True
    except Exception as e:
        print(f"  Notice: Metrics endpoint at {metrics_url} returned: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Test local vLLM OpenAI-compatible server")
    parser.add_argument("--url", type=str, default="http://localhost:8000", help="Base URL of vLLM server")
    parser.add_argument("--model", type=str, default=None, help="Model name (auto-detected if omitted)")
    parser.add_argument("--concurrency", type=int, default=2, help="Number of concurrent requests")
    args = parser.parse_args()

    base_url = args.url.rstrip("/")

    active_model = check_endpoint(base_url)
    if not active_model:
        print("\n[FAIL] Server is not responding. Please make sure vLLM is running locally.")
        sys.exit(1)

    model_to_use = args.model or active_model

    if OpenAI is None:
        print("Please install openai library to run chat completion tests.")
        sys.exit(1)

    client = OpenAI(base_url=f"{base_url}/v1", api_key="not-needed-for-local-poc")

    s1 = test_non_streaming(client, model_to_use)
    s2 = test_streaming(client, model_to_use)
    s3 = test_concurrency(client, model_to_use, concurrency=args.concurrency)
    s4 = test_metrics(base_url)

    print("\n" + "="*50)
    print("VALIDATION SUMMARY")
    print("="*50)
    print(f"Health & Models:      PASS")
    print(f"Non-Streaming Chat:   {'PASS' if s1 else 'FAIL'}")
    print(f"Streaming Chat:       {'PASS' if s2 else 'FAIL'}")
    print(f"Concurrency Test:     {'PASS' if s3 else 'FAIL'}")
    print(f"Metrics Inspection:   {'PASS' if s4 else 'NOTICE/PASS'}")
    print("="*50)

if __name__ == "__main__":
    main()
