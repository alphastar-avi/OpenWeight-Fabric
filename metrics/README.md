# vLLM Live Telemetry Dashboard

Minimalist, vibe-coded, monochromatic real-time telemetry dashboard for monitoring vLLM production inference engines via standard `/metrics` (Prometheus) endpoints.

---

## Features

- Zero-Dependency Core: Built with pure Vanilla HTML5, CSS3, and JavaScript. Zero external frameworks, zero bundle size overhead.
- Live Metrics Ingestion: Parses raw Prometheus text format streaming from `/metrics`.
- Concurrency & Queue Tracker: Real-time visual tracking of running streams, queued requests, and swapped memory blocks.
- GPU KV Cache Gauge: Live KV cache percentage, tokens in flight, and pressure classification.
- Prefix Caching Efficiency: Tracks prompt token reuse rate from vLLM's Radix tree.
- Decode & Prompt Throughput: Measures decode tokens/second and prompt prefill speed.
- Native Monochromatic Sparklines: 30-slice canvas sparkline charts without third-party chart bloat.
- Full Telemetry Registry: Searchable and filterable table of all 40+ raw Prometheus metrics exposed by vLLM.
- Configurable Polling: Dynamic interval selector (1s, 2s, 5s, 10s, Pause) with local storage endpoint persistence.

---

## Quick Start

### Option 1: Using Python (Installed on almost every machine)
```bash
cd metrics
python3 -m http.server 3000
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### Option 2: Using Node / npx
```bash
npx serve metrics
```

### Option 3: Direct File Opening
Double-click `metrics/index.html` to open directly in Chrome, Brave, or Safari.

---

## Connecting to Endpoints

Enter your target vLLM metrics URL in the top endpoint input bar:
- Local Server: `http://localhost:8000/metrics`
- AWS EC2 Instance / VPN URL: `http://<EC2-IP>:8000/metrics` or `http://<DNS-NAME>/metrics`

If your browser blocks direct connection due to strict corporate VPN CORS headers, double-click the alert banner to open the Manual Ingest modal, where you can paste raw output from `curl http://<host>:8000/metrics`.
