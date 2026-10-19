/**
 * vLLM Telemetry Dashboard — Core Application Logic
 * Lightweight Prometheus text parser and real-time visualization
 */

// Application State
const state = {
  endpoint: localStorage.getItem('vllm_telemetry_endpoint') || 'http://localhost:8000/metrics',
  isPolling: true,
  pollIntervalMs: 2000,
  pollTimer: null,
  historyMax: 30,
  history: {
    running: [],
    waiting: [],
    kvCache: [],
    prefix: [],
    throughput: []
  },
  latestMetrics: new Map(),
  allRawRecords: []
};

// DOM References
const elements = {
  endpointInput: document.getElementById('endpointInput'),
  presetSelect: document.getElementById('presetSelect'),
  pollToggleBtn: document.getElementById('pollToggleBtn'),
  pollBtnText: document.getElementById('pollBtnText'),
  pollIcon: document.getElementById('pollIcon'),
  pollIntervalSelect: document.getElementById('pollIntervalSelect'),
  fetchNowBtn: document.getElementById('fetchNowBtn'),
  statusIndicator: document.getElementById('statusIndicator'),
  serverModelLabel: document.getElementById('serverModelLabel'),
  alertBanner: document.getElementById('alertBanner'),
  alertMessage: document.getElementById('alertMessage'),
  dismissAlertBtn: document.getElementById('dismissAlertBtn'),
  
  // KPI Elements
  metricRunning: document.getElementById('metricRunning'),
  metricWaiting: document.getElementById('metricWaiting'),
  metricSwapped: document.getElementById('metricSwapped'),
  concurrencyStatus: document.getElementById('concurrencyStatus'),
  metricKvCachePct: document.getElementById('metricKvCachePct'),
  kvCacheTag: document.getElementById('kvCacheTag'),
  kvProgressBar: document.getElementById('kvProgressBar'),
  metricKvState: document.getElementById('metricKvState'),
  metricTokensInFlight: document.getElementById('metricTokensInFlight'),
  metricPrefixHitRate: document.getElementById('metricPrefixHitRate'),
  prefixStatus: document.getElementById('prefixStatus'),
  prefixProgressBar: document.getElementById('prefixProgressBar'),
  metricGenThroughput: document.getElementById('metricGenThroughput'),
  throughputTag: document.getElementById('throughputTag'),
  metricPromptThroughput: document.getElementById('metricPromptThroughput'),
  metricTtft: document.getElementById('metricTtft'),
  
  // Totals & Latency
  metricPromptTotal: document.getElementById('metricPromptTotal'),
  metricGenTotal: document.getElementById('metricGenTotal'),
  metricCombinedTotal: document.getElementById('metricCombinedTotal'),
  scrapeLatency: document.getElementById('scrapeLatency'),
  
  // Table
  metricFilterInput: document.getElementById('metricFilterInput'),
  metricsTableBody: document.getElementById('metricsTableBody'),
  
  // Modal
  pasteModal: document.getElementById('pasteModal'),
  pasteTextarea: document.getElementById('pasteTextarea'),
  parsePasteBtn: document.getElementById('parsePasteBtn'),
  cancelPasteBtn: document.getElementById('cancelPasteBtn'),
  closeModalBtn: document.getElementById('closeModalBtn')
};

// Canvas references
const canvases = {
  concurrency: document.getElementById('chartConcurrency'),
  kvCache: document.getElementById('chartKvCache'),
  prefix: document.getElementById('chartPrefix'),
  throughput: document.getElementById('chartThroughput')
};

/**
 * Robust Prometheus Text Parser
 * Parses metrics, labels, and floating point values
 */
function parsePrometheusText(text) {
  const lines = text.split('\n');
  const metrics = new Map();
  const rawList = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    // Example match: vllm:num_requests_running{model_name="..."} 3.0
    // Or: vllm:gpu_cache_usage_factor 0.28
    const regex = /^([a-zA-Z0-9_:]+)(?:\{([^}]*)\})?\s+([+-]?[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)/;
    const match = line.match(regex);
    if (match) {
      const name = match[1];
      const rawLabels = match[2] || '';
      const value = parseFloat(match[3]);

      metrics.set(name, value);
      rawList.push({ name, labels: rawLabels, value });
    }
  }

  return { metrics, rawList };
}

/**
 * Fetch telemetry from endpoint
 */
async function fetchMetrics() {
  const endpoint = elements.endpointInput.value.trim();
  if (!endpoint) return;

  const startTime = performance.now();
  elements.statusIndicator.className = 'status-indicator polling';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { 'Accept': 'text/plain' }
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const duration = Math.round(performance.now() - startTime);

    elements.scrapeLatency.textContent = `${duration} ms`;
    elements.statusIndicator.className = 'status-indicator connected';
    hideAlert();

    const { metrics, rawList } = parsePrometheusText(text);
    processMetrics(metrics, rawList);

  } catch (err) {
    elements.statusIndicator.className = 'status-indicator error';
    elements.scrapeLatency.textContent = 'Err';
    showAlert(`Failed to fetch from ${endpoint}: ${err.message}. If querying a remote server, ensure CORS or security groups allow inbound HTTP.`);
  }
}

/**
 * Update UI and sparklines from parsed metrics
 */
function processMetrics(metrics, rawList) {
  state.latestMetrics = metrics;
  state.allRawRecords = rawList;

  // 1. Concurrency
  const running = metrics.get('vllm:num_requests_running') ?? 0;
  const waiting = metrics.get('vllm:num_requests_waiting') ?? 0;
  const swapped = metrics.get('vllm:num_requests_swapped') ?? 0;

  elements.metricRunning.textContent = running;
  elements.metricWaiting.textContent = waiting;
  elements.metricSwapped.textContent = swapped;

  if (waiting > 0) {
    elements.concurrencyStatus.textContent = 'QUEUED';
    elements.concurrencyStatus.style.color = 'var(--status-amber)';
  } else {
    elements.concurrencyStatus.textContent = 'HEALTHY';
    elements.concurrencyStatus.style.color = 'var(--status-emerald)';
  }

  // 2. GPU KV Cache Utilization
  const kvFactor = metrics.get('vllm:gpu_cache_usage_factor') ?? 0;
  const kvPct = (kvFactor * 100).toFixed(1);
  elements.metricKvCachePct.textContent = `${kvPct}%`;
  elements.kvCacheTag.textContent = `${kvPct}%`;
  elements.kvProgressBar.style.width = `${Math.min(kvFactor * 100, 100)}%`;

  if (kvFactor > 0.85) {
    elements.kvProgressBar.className = 'progress-bar critical';
    elements.metricKvState.textContent = 'High Pressure';
    elements.metricKvState.className = 'sub-kpi-val warning';
  } else if (kvFactor > 0.65) {
    elements.kvProgressBar.className = 'progress-bar warning';
    elements.metricKvState.textContent = 'Moderate';
    elements.metricKvState.className = 'sub-kpi-val';
  } else {
    elements.kvProgressBar.className = 'progress-bar';
    elements.metricKvState.textContent = 'Optimal';
    elements.metricKvState.className = 'sub-kpi-val success';
  }

  // Estimate tokens in flight based on running sequences and typical context
  const tokensEst = Math.round(kvFactor * 181000);
  elements.metricTokensInFlight.textContent = tokensEst > 0 ? tokensEst.toLocaleString() : running > 0 ? `${running * 2048}` : '0';

  // 3. Prefix Cache
  const prefixRate = metrics.get('vllm:prefix_cache_hit_rate') ?? 0;
  const prefixPct = (prefixRate * 100).toFixed(1);
  elements.metricPrefixHitRate.textContent = `${prefixPct}%`;
  elements.prefixProgressBar.style.width = `${Math.min(prefixRate * 100, 100)}%`;
  elements.prefixStatus.textContent = prefixRate > 0 ? 'ACTIVE' : 'STANDBY';
  elements.prefixStatus.style.color = prefixRate > 0 ? 'var(--status-emerald)' : 'var(--text-secondary)';

  // 4. Throughput
  const genThroughput = (metrics.get('vllm:avg_generation_throughput_tok_per_s') ?? 0).toFixed(1);
  const promptThroughput = (metrics.get('vllm:avg_prompt_throughput_tok_per_s') ?? 0).toFixed(0);
  elements.metricGenThroughput.textContent = genThroughput;
  elements.throughputTag.textContent = `${genThroughput} tok/s`;
  elements.metricPromptThroughput.textContent = `${promptThroughput} tok/s`;

  // 5. Total Tokens
  const promptTotal = metrics.get('vllm:prompt_tokens_total') ?? 0;
  const genTotal = metrics.get('vllm:generation_tokens_total') ?? 0;
  elements.metricPromptTotal.textContent = promptTotal.toLocaleString();
  elements.metricGenTotal.textContent = genTotal.toLocaleString();
  elements.metricCombinedTotal.textContent = (promptTotal + genTotal).toLocaleString();

  // 6. Detect Model Name from Labels
  const modelRecord = rawList.find(r => r.labels.includes('model_name='));
  if (modelRecord) {
    const match = modelRecord.labels.match(/model_name="([^"]+)"/);
    if (match && match[1]) {
      elements.serverModelLabel.textContent = `Model: ${match[1]}`;
    }
  }

  // 7. Update History & Draw Sparklines
  recordHistory({
    running,
    waiting,
    kvPct: parseFloat(kvPct),
    prefixPct: parseFloat(prefixPct),
    throughput: parseFloat(genThroughput)
  });
  renderAllCharts();

  // 8. Render Filtered Table
  renderTable();
}

/**
 * Record historical slices for charts
 */
function recordHistory(sample) {
  const h = state.history;
  const max = state.historyMax;

  h.running.push(sample.running);
  h.waiting.push(sample.waiting);
  h.kvCache.push(sample.kvPct);
  h.prefix.push(sample.prefixPct);
  h.throughput.push(sample.throughput);

  if (h.running.length > max) h.running.shift();
  if (h.waiting.length > max) h.waiting.shift();
  if (h.kvCache.length > max) h.kvCache.shift();
  if (h.prefix.length > max) h.prefix.shift();
  if (h.throughput.length > max) h.throughput.shift();
}

/**
 * Draw a clean monochromatic sparkline on HTML5 canvas
 */
function drawSparkline(canvas, data, options = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 300;
  const height = canvas.clientHeight || 48;

  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  if (data.length < 2) {
    ctx.restore();
    return;
  }

  const strokeColor = options.color || '#38bdf8';
  const fillColor = options.fillColor || 'rgba(56, 189, 248, 0.08)';
  const minVal = options.min ?? 0;
  const maxVal = options.max ?? Math.max(...data, 1);
  const range = maxVal - minVal || 1;

  const stepX = width / (data.length - 1);

  ctx.beginPath();
  data.forEach((val, i) => {
    const x = i * stepX;
    const normalizedY = (val - minVal) / range;
    const y = height - (normalizedY * (height - 8)) - 4;

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // Fill area under line
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();

  ctx.restore();
}

/**
 * Render all 4 live sparklines
 */
function renderAllCharts() {
  drawSparkline(canvases.concurrency, state.history.running, {
    color: '#38bdf8',
    fillColor: 'rgba(56, 189, 248, 0.06)'
  });
  drawSparkline(canvases.kvCache, state.history.kvCache, {
    color: '#10b981',
    fillColor: 'rgba(16, 185, 129, 0.06)',
    max: 100
  });
  drawSparkline(canvases.prefix, state.history.prefix, {
    color: '#818cf8',
    fillColor: 'rgba(129, 140, 248, 0.06)',
    max: 100
  });
  drawSparkline(canvases.throughput, state.history.throughput, {
    color: '#f59e0b',
    fillColor: 'rgba(245, 158, 11, 0.06)'
  });
}

/**
 * Render filtered Prometheus metric table
 */
function renderTable() {
  const query = elements.metricFilterInput.value.toLowerCase().trim();
  const tbody = elements.metricsTableBody;
  tbody.innerHTML = '';

  const filtered = state.allRawRecords.filter(r => 
    !query || r.name.toLowerCase().includes(query) || r.labels.toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="3" class="table-empty">${state.allRawRecords.length === 0 ? 'No metrics available.' : 'No matching metrics found.'}</td>`;
    tbody.appendChild(tr);
    return;
  }

  const fragment = document.createDocumentFragment();
  filtered.forEach(record => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="metric-key">${escapeHtml(record.name)}</td>
      <td class="metric-labels">${escapeHtml(record.labels || '--')}</td>
      <td class="metric-val">${record.value.toLocaleString()}</td>
    `;
    fragment.appendChild(tr);
  });

  tbody.appendChild(fragment);
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Polling Timer Management
 */
function startPolling() {
  stopPolling();
  state.isPolling = true;
  elements.pollBtnText.textContent = `Auto Poll (${state.pollIntervalMs / 1000}s)`;
  elements.pollToggleBtn.classList.add('active');
  elements.pollIcon.textContent = '■';
  fetchMetrics();
  state.pollTimer = setInterval(fetchMetrics, state.pollIntervalMs);
}

function stopPolling() {
  state.isPolling = false;
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  elements.pollBtnText.textContent = 'Resume Poll';
  elements.pollToggleBtn.classList.remove('active');
  elements.pollIcon.textContent = '▶';
  elements.statusIndicator.className = 'status-indicator';
}

function togglePolling() {
  if (state.isPolling) {
    stopPolling();
  } else {
    startPolling();
  }
}

/**
 * Alert Helpers
 */
function showAlert(message) {
  elements.alertMessage.textContent = message;
  elements.alertBanner.classList.remove('hidden');
}

function hideAlert() {
  elements.alertBanner.classList.add('hidden');
}

/**
 * Event Listeners Initialization
 */
function initEvents() {
  // Preset selector
  elements.presetSelect.addEventListener('change', (e) => {
    if (e.target.value !== 'custom') {
      elements.endpointInput.value = e.target.value;
      localStorage.setItem('vllm_telemetry_endpoint', e.target.value);
      fetchMetrics();
    }
  });

  // Endpoint input changes
  elements.endpointInput.addEventListener('change', () => {
    localStorage.setItem('vllm_telemetry_endpoint', elements.endpointInput.value);
    fetchMetrics();
  });

  // Polling controls
  elements.pollToggleBtn.addEventListener('click', togglePolling);
  elements.fetchNowBtn.addEventListener('click', fetchMetrics);
  elements.pollIntervalSelect.addEventListener('change', (e) => {
    state.pollIntervalMs = parseInt(e.target.value, 10);
    if (state.isPolling) {
      startPolling();
    }
  });

  // Metric table search filter
  elements.metricFilterInput.addEventListener('input', renderTable);
  elements.dismissAlertBtn.addEventListener('click', hideAlert);

  // Manual Ingest Modal (CORS Fallback)
  elements.alertBanner.addEventListener('dblclick', () => {
    elements.pasteModal.showModal();
  });
  elements.cancelPasteBtn.addEventListener('click', () => elements.pasteModal.close());
  elements.closeModalBtn.addEventListener('click', () => elements.pasteModal.close());

  elements.parsePasteBtn.addEventListener('click', () => {
    const text = elements.pasteTextarea.value.trim();
    if (text) {
      const { metrics, rawList } = parsePrometheusText(text);
      processMetrics(metrics, rawList);
      elements.pasteModal.close();
      elements.scrapeLatency.textContent = 'Manual';
      elements.statusIndicator.className = 'status-indicator connected';
      hideAlert();
    }
  });

  // Responsive canvas resizing
  window.addEventListener('resize', renderAllCharts);
}

// Boot application
document.addEventListener('DOMContentLoaded', () => {
  elements.endpointInput.value = state.endpoint;
  initEvents();
  startPolling();
});
