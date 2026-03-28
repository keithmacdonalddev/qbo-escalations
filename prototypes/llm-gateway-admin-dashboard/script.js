const viewMeta = {
  overview: {
    title: "Gateway Overview",
    description:
      "Watch live health, queue pressure, tunnel stability, and request behavior from one calm command deck."
  },
  traffic: {
    title: "Traffic Observatory",
    description:
      "Inspect live load shape, latency heat, queue overlap, and where heavy vision requests are clustering."
  },
  keys: {
    title: "Access Fleet",
    description:
      "Review key health, quota pressure, app ownership, and which callers are taking the biggest share of throughput."
  },
  logs: {
    title: "Log Explorer",
    description:
      "Filter request history, spot errors quickly, and follow recent operator actions without leaving the dashboard."
  },
  settings: {
    title: "Runtime Settings",
    description:
      "See the major knobs that shape the gateway: host bind, body limits, timeout, concurrency, and operator safeguards."
  }
};

const state = {
  currentView: "overview",
  currentRange: "1h",
  logFilter: "all",
  metrics: {
    load: 68,
    activeRequests: 2,
    queueDepth: 1,
    latency: 1870,
    tokensPerMin: 14820,
    successRate: 99.2,
    tunnelLatency: 38,
    visionShare: 31
  },
  requestMix: [
    { label: "Text triage", value: 52, tone: "mint" },
    { label: "Vision parse", value: 31, tone: "amber" },
    { label: "Admin checks", value: 17, tone: "sky" }
  ],
  traffic: {
    "1h": [18, 20, 22, 17, 25, 28, 26, 24, 31, 36, 34, 30],
    "24h": [14, 16, 12, 13, 19, 18, 23, 26, 24, 28, 31, 38, 42, 46, 51, 45, 39, 34, 28, 24, 20, 18, 16, 14],
    "7d": [12, 18, 22, 19, 26, 31, 24, 28, 33, 36, 29, 25]
  },
  trafficLanes: [
    { label: "Text completions", value: 72, latency: "1.6s", color: "var(--mint)" },
    { label: "Vision uploads", value: 44, latency: "3.4s", color: "var(--amber)" },
    { label: "Health + model checks", value: 18, latency: "180ms", color: "var(--sky)" }
  ],
  edges: [
    { name: "Halifax workstation", latency: "24ms", traffic: "Primary ingress", status: "healthy" },
    { name: "Cloudflare edge YYZ", latency: "33ms", traffic: "North America", status: "healthy" },
    { name: "Cloudflare edge DUB", latency: "81ms", traffic: "Europe overflow", status: "watch" },
    { name: "Mobile fallback path", latency: "47ms", traffic: "Admin preview", status: "healthy" }
  ],
  queue: [
    { title: "Invoice image parse", key: "qbo-prod", wait: "4s", model: "qwen3.5-9b" },
    { title: "Ticket summarizer", key: "personal", wait: "9s", model: "qwen3.5-9b" },
    { title: "Regression snapshot check", key: "dev-sandbox", wait: "14s", model: "qwen3.5-9b" }
  ],
  incidents: [
    { title: "Vision burst nearing concurrency cap", time: "2 min ago", tone: "warn" },
    { title: "One retry recovered after upstream timeout", time: "11 min ago", tone: "healthy" },
    { title: "DUB edge latency spike normalized", time: "22 min ago", tone: "healthy" }
  ],
  bands: [
    { label: "VRAM pressure", value: 63, detail: "10.2 / 16 GB" },
    { label: "Queue drain speed", value: 78, detail: "2.8 req/min" },
    { label: "Token velocity", value: 57, detail: "14.8k tok/min" }
  ],
  keys: [
    {
      name: "qbo-prod",
      owner: "Escalation pipeline",
      rpm: 21,
      daily: 620,
      errors: 1,
      status: "healthy"
    },
    {
      name: "personal",
      owner: "Manual desktop use",
      rpm: 7,
      daily: 142,
      errors: 0,
      status: "healthy"
    },
    {
      name: "mobile-test",
      owner: "Remote preview build",
      rpm: 11,
      daily: 490,
      errors: 4,
      status: "watch"
    },
    {
      name: "dev-sandbox",
      owner: "Ad hoc experiments",
      rpm: 15,
      daily: 913,
      errors: 6,
      status: "risk"
    }
  ],
  logs: [
    { time: "18:42:19", key: "qbo-prod", mode: "stream", model: "qwen3.5-9b", status: 200, latency: "1.7s", tokens: 724 },
    { time: "18:41:54", key: "mobile-test", mode: "vision", model: "qwen3.5-9b", status: 200, latency: "3.9s", tokens: 1168 },
    { time: "18:41:13", key: "dev-sandbox", mode: "vision", model: "qwen3.5-9b", status: 503, latency: "5.0s", tokens: 0 },
    { time: "18:40:27", key: "personal", mode: "chat", model: "qwen3.5-9b", status: 200, latency: "1.2s", tokens: 388 },
    { time: "18:39:44", key: "qbo-prod", mode: "chat", model: "qwen3.5-9b", status: 200, latency: "1.5s", tokens: 462 },
    { time: "18:39:05", key: "mobile-test", mode: "stream", model: "qwen3.5-9b", status: 200, latency: "2.1s", tokens: 540 },
    { time: "18:38:22", key: "dev-sandbox", mode: "vision", model: "qwen3.5-9b", status: 429, latency: "220ms", tokens: 0 }
  ],
  audit: [
    { title: "Paused noisy dev key for 5 min", time: "18:31" },
    { title: "Reviewed queue after image surge", time: "18:17" },
    { title: "Cloudflare tunnel health inspected", time: "17:54" }
  ]
};

const metricDefinitions = [
  {
    label: "Active Requests",
    format: () => String(state.metrics.activeRequests).padStart(2, "0"),
    trend: "inside concurrency envelope"
  },
  {
    label: "Queue Depth",
    format: () => `${state.metrics.queueDepth} waiting`,
    trend: "watching for burst buildup"
  },
  {
    label: "P95 Latency",
    format: () => `${state.metrics.latency} ms`,
    trend: "down 7.4% from the last hour"
  },
  {
    label: "Token Burn",
    format: () => `${(state.metrics.tokensPerMin / 1000).toFixed(1)}k / min`,
    trend: "healthy blend of chat and vision"
  }
];

const metricGrid = document.getElementById("metric-grid");
const riverChart = document.getElementById("river-chart");
const trafficChart = document.getElementById("traffic-chart");
const requestMix = document.getElementById("request-mix");
const edgeGrid = document.getElementById("edge-grid");
const queueList = document.getElementById("queue-list");
const incidentList = document.getElementById("incident-list");
const bandGrid = document.getElementById("band-grid");
const laneList = document.getElementById("lane-list");
const keyGrid = document.getElementById("key-grid");
const logTableBody = document.getElementById("log-table-body");
const auditList = document.getElementById("audit-list");
const heatGrid = document.getElementById("heat-grid");
const toast = document.getElementById("toast");

const navButtons = Array.from(document.querySelectorAll(".nav-item[data-view]"));
const rangeButtons = Array.from(document.querySelectorAll("[data-range]"));
const filterButtons = Array.from(document.querySelectorAll("[data-filter]"));

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getTone(tone) {
  if (tone === "amber") {
    return "var(--amber)";
  }
  if (tone === "sky") {
    return "var(--sky)";
  }
  return "var(--mint)";
}

function renderMetrics() {
  metricGrid.innerHTML = metricDefinitions
    .map(
      (metric) => `
        <article class="metric-card">
          <p class="metric-label">${metric.label}</p>
          <div class="metric-value">${metric.format()}</div>
          <div class="metric-trend">${metric.trend}</div>
        </article>
      `
    )
    .join("");
}

function renderBarChart(target, values) {
  const highest = Math.max(...values, 1);
  target.innerHTML = values
    .map((value, index) => {
      const height = `${Math.max(12, (value / highest) * 100)}%`;
      const hue = index % 4 === 0 ? "var(--amber)" : index % 3 === 0 ? "var(--sky)" : "var(--mint)";
      return `
        <div class="bar-group">
          <div class="bar-segment" style="height:${height}; background:${hue}; animation-delay:${index * 22}ms"></div>
        </div>
      `;
    })
    .join("");
}

function renderRequestMix() {
  requestMix.innerHTML = state.requestMix
    .map(
      (item) => `
        <div class="mix-item">
          <div>
            <span>${item.label}</span>
            <strong>${item.value}%</strong>
          </div>
          <div class="mix-track">
            <div class="mix-fill" style="width:${item.value}%; background:linear-gradient(90deg, ${getTone(item.tone)}, rgba(255,255,255,0.9))"></div>
          </div>
        </div>
      `
    )
    .join("");
}

function renderEdges() {
  edgeGrid.innerHTML = state.edges
    .map(
      (edge) => `
        <article class="edge-card">
          <div class="edge-top">
            <div class="edge-title">${edge.name}</div>
            <span class="status-badge ${edge.status === "watch" ? "warn" : ""}">
              ${edge.status === "watch" ? "Watch" : "Healthy"}
            </span>
          </div>
          <p class="edge-meta">${edge.traffic}</p>
          <div class="metric-value">${edge.latency}</div>
          <div class="metric-trend">Tunnel route holding within target</div>
        </article>
      `
    )
    .join("");
}

function renderQueue() {
  queueList.innerHTML = state.queue
    .map(
      (item, index) => `
        <article class="queue-item">
          <div class="queue-top">
            <span class="queue-title">${item.title}</span>
            <span class="status-badge ${index === 0 ? "warn" : ""}">${item.wait}</span>
          </div>
          <div class="queue-meta">${item.key} · ${item.model}</div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${78 - index * 18}%; background:${index === 0 ? "linear-gradient(90deg, var(--coral), var(--amber))" : "linear-gradient(90deg, var(--mint), var(--sky))"}"></div>
          </div>
        </article>
      `
    )
    .join("");
}

function renderIncidents() {
  incidentList.innerHTML = state.incidents
    .map(
      (incident) => `
        <article class="incident-item">
          <div class="incident-top">
            <span class="incident-title">${incident.title}</span>
            <span class="status-badge ${incident.tone === "warn" ? "warn" : ""}">
              ${incident.tone === "warn" ? "Heads up" : "Recovered"}
            </span>
          </div>
          <div class="incident-time">${incident.time}</div>
        </article>
      `
    )
    .join("");
}

function renderBands() {
  bandGrid.innerHTML = state.bands
    .map(
      (band) => `
        <article class="band-card">
          <div class="band-stat">
            <span>${band.label}</span>
            <strong>${band.detail}</strong>
          </div>
          <div class="band-track">
            <div class="band-fill" style="width:${band.value}%"></div>
          </div>
        </article>
      `
    )
    .join("");
}

function renderLanes() {
  laneList.innerHTML = state.trafficLanes
    .map(
      (lane) => `
        <article class="lane-card">
          <div class="lane-row">
            <strong>${lane.label}</strong>
            <span class="lane-value">${lane.latency}</span>
          </div>
          <div class="lane-track">
            <div class="lane-fill" style="width:${lane.value}%; background:${lane.color}"></div>
          </div>
        </article>
      `
    )
    .join("");
}

function renderHeatGrid() {
  const values = [22, 28, 31, 34, 39, 45, 52, 58, 62, 54, 41, 29];
  heatGrid.innerHTML = values
    .map((value, index) => {
      const lightness = 22 + index * 2;
      return `
        <div class="heat-cell" style="background: hsl(${154 - index * 2}, 58%, ${lightness}%);">
          ${value}
        </div>
      `;
    })
    .join("");
}

function renderKeys() {
  keyGrid.innerHTML = state.keys
    .map((key) => {
      const statusClass = key.status === "risk" ? "error" : key.status === "watch" ? "warn" : "";
      const dailyPercent = clamp(Math.round((key.daily / 1000) * 100), 10, 100);
      return `
        <article class="key-card">
          <div class="key-head">
            <div>
              <div class="key-name">${key.name}</div>
              <div class="queue-meta">${key.owner}</div>
            </div>
            <span class="status-badge ${statusClass}">
              ${key.status === "risk" ? "Near cap" : key.status === "watch" ? "Watch" : "Healthy"}
            </span>
          </div>
          <div class="key-metrics">
            <div class="key-metric">
              <span>RPM</span>
              <strong>${key.rpm}</strong>
            </div>
            <div class="key-metric">
              <span>Daily</span>
              <strong>${key.daily}</strong>
            </div>
            <div class="key-metric">
              <span>Errors</span>
              <strong>${key.errors}</strong>
            </div>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${dailyPercent}%; background:${key.status === "risk" ? "linear-gradient(90deg, var(--coral), var(--amber))" : "linear-gradient(90deg, var(--mint), var(--sky))"}"></div>
          </div>
        </article>
      `;
    })
    .join("");
}

function filteredLogs() {
  if (state.logFilter === "all") {
    return state.logs;
  }
  if (state.logFilter === "vision") {
    return state.logs.filter((entry) => entry.mode === "vision");
  }
  if (state.logFilter === "error") {
    return state.logs.filter((entry) => entry.status >= 400);
  }
  if (state.logFilter === "stream") {
    return state.logs.filter((entry) => entry.mode === "stream");
  }
  return state.logs;
}

function renderLogs() {
  logTableBody.innerHTML = filteredLogs()
    .map(
      (entry) => `
        <tr>
          <td>${entry.time}</td>
          <td>${entry.key}</td>
          <td>${entry.mode}</td>
          <td>${entry.model}</td>
          <td>
            <span class="log-status ${entry.status >= 400 ? "error" : ""}">
              ${entry.status}
            </span>
          </td>
          <td>${entry.latency}</td>
          <td>${entry.tokens}</td>
        </tr>
      `
    )
    .join("");
}

function renderAudit() {
  auditList.innerHTML = state.audit
    .map(
      (item) => `
        <article class="audit-item">
          <div class="audit-top">
            <span class="audit-title">${item.title}</span>
            <span class="incident-time">${item.time}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function updateHero() {
  const load = state.metrics.load;
  document.getElementById("load-value").textContent = `${load}%`;
  document.getElementById("load-ring").style.background = `conic-gradient(var(--mint) ${load * 3.6}deg, rgba(255,255,255,0.08) 0deg)`;
  document.getElementById("primary-model").textContent = "qwen/qwen3.5-9b";
}

function updateClock() {
  const formatter = new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  document.getElementById("clock-chip").textContent = formatter.format(new Date());
}

function setView(view) {
  state.currentView = view;
  navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.view === view);
  });

  const meta = viewMeta[view];
  document.getElementById("focus-title").textContent = meta.title;
  document.getElementById("focus-description").textContent = meta.description;
}

function expandTraffic(values) {
  if (values.length >= 24) {
    return values;
  }

  const expanded = [];
  values.forEach((value) => {
    expanded.push(value, Math.max(10, value - 4));
  });
  return expanded.slice(0, 24);
}

function setRange(range) {
  state.currentRange = range;
  rangeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.range === range);
  });

  const values = state.traffic[range];
  renderBarChart(riverChart, values.slice(-12));
  renderBarChart(trafficChart, range === "24h" ? values : expandTraffic(values));
}

function setLogFilter(filter) {
  state.logFilter = filter;
  filterButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === filter);
  });
  renderLogs();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2200);
}

function tick() {
  state.metrics.load = clamp(state.metrics.load + (Math.random() > 0.5 ? 2 : -2), 52, 86);
  state.metrics.activeRequests = clamp(state.metrics.activeRequests + (Math.random() > 0.55 ? 1 : -1), 1, 3);
  state.metrics.queueDepth = clamp(state.metrics.queueDepth + (Math.random() > 0.68 ? 1 : -1), 0, 4);
  state.metrics.latency = clamp(state.metrics.latency + Math.round((Math.random() - 0.5) * 220), 1280, 2950);
  state.metrics.tokensPerMin = clamp(state.metrics.tokensPerMin + Math.round((Math.random() - 0.5) * 640), 11600, 19200);

  const activeTraffic = state.traffic[state.currentRange];
  const shifted = activeTraffic.slice(1);
  shifted.push(clamp(activeTraffic[activeTraffic.length - 1] + Math.round((Math.random() - 0.45) * 8), 12, 54));
  state.traffic[state.currentRange] = shifted;

  state.queue[0].wait = `${clamp(parseInt(state.queue[0].wait, 10) + (Math.random() > 0.55 ? 1 : -1), 2, 11)}s`;
  state.incidents[0].time = `${Math.max(1, parseInt(state.incidents[0].time, 10) + 1)} min ago`;

  updateHero();
  updateClock();
  renderMetrics();
  renderQueue();
  renderIncidents();
  renderBands();
  setRange(state.currentRange);
}

function bindEvents() {
  navButtons.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  rangeButtons.forEach((button) => {
    button.addEventListener("click", () => setRange(button.dataset.range));
  });

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => setLogFilter(button.dataset.filter));
  });

  document.querySelectorAll("[data-toast]").forEach((button) => {
    button.addEventListener("click", () => showToast(button.dataset.toast));
  });
}

function render() {
  updateHero();
  updateClock();
  renderMetrics();
  renderRequestMix();
  renderEdges();
  renderQueue();
  renderIncidents();
  renderBands();
  renderLanes();
  renderHeatGrid();
  renderKeys();
  renderLogs();
  renderAudit();
  setView(state.currentView);
  setRange(state.currentRange);
}

bindEvents();
render();
setInterval(tick, 2800);
