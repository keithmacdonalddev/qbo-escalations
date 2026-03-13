/* ========================================
   Memory Decay Timeline — Script
   ======================================== */

// ---- Mock Data ----
const MOCK_ENTRIES = [
  { _id: '1', type: 'error-fix', summary: 'Fixed TDZ crash in DevMiniWidget HMR', category: 'runtime-error', filesAffected: ['client/src/components/DevMiniWidget.jsx'], resolution: 'Renamed shadowed variable', pinned: true, expiresAt: null, createdAt: new Date(Date.now() - 2*24*60*60*1000).toISOString() },
  { _id: '2', type: 'pattern-learned', summary: 'HMR module name collisions cause TDZ errors', category: 'quality', filesAffected: [], resolution: '', pinned: false, expiresAt: new Date(Date.now() + 5*24*60*60*1000).toISOString(), createdAt: new Date(Date.now() - 2*24*60*60*1000).toISOString() },
  { _id: '3', type: 'config-change', summary: 'Vite proxy updated for /api/dev/* routes', category: 'infra', filesAffected: ['client/vite.config.js'], resolution: 'Added dev route prefix to proxy config', pinned: false, expiresAt: new Date(Date.now() + 2*60*60*1000).toISOString(), createdAt: new Date(Date.now() - 6.9*24*60*60*1000).toISOString() },
  { _id: '4', type: 'error-fix', summary: 'MongoDB connection pool exhaustion during bulk saves', category: 'database', filesAffected: ['server/src/index.js', 'server/src/lib/agent-memory.js'], resolution: 'Added connection pooling limit and retry logic', pinned: true, expiresAt: null, createdAt: new Date(Date.now() - 5*24*60*60*1000).toISOString() },
  { _id: '5', type: 'pattern-learned', summary: 'Express 5 async error handling eliminates try/catch', category: 'quality', filesAffected: [], resolution: '', pinned: false, expiresAt: new Date(Date.now() + 3*24*60*60*1000).toISOString(), createdAt: new Date(Date.now() - 4*24*60*60*1000).toISOString() },
  { _id: '6', type: 'user-preference', summary: 'User prefers dark theme with amber accent', category: 'preference', filesAffected: [], resolution: '', pinned: false, expiresAt: new Date(Date.now() + 15*60*1000).toISOString(), createdAt: new Date(Date.now() - 6.9*24*60*60*1000).toISOString() },
  { _id: '7', type: 'error-fix', summary: 'SSE stream closes prematurely on large payloads', category: 'runtime-error', filesAffected: ['server/src/routes/chat.js'], resolution: 'Increased timeout and added chunked transfer', pinned: false, expiresAt: new Date(Date.now() + 1*24*60*60*1000).toISOString(), createdAt: new Date(Date.now() - 6*24*60*60*1000).toISOString() },
  { _id: '8', type: 'deployment-note', summary: 'MongoDB Atlas M10 cluster upgrade completed', category: 'infra', filesAffected: [], resolution: '', pinned: false, expiresAt: new Date(Date.now() + 4*60*1000).toISOString(), createdAt: new Date(Date.now() - 6.95*24*60*60*1000).toISOString() },
  { _id: '9', type: 'pattern-learned', summary: 'Framer Motion AnimatePresence needs unique keys per entry', category: 'quality', filesAffected: ['client/src/components/AgentActivityLog.jsx'], resolution: '', pinned: true, expiresAt: null, createdAt: new Date(Date.now() - 10*24*60*60*1000).toISOString() },
  { _id: '10', type: 'config-change', summary: 'Added CORS headers for cross-tab agent communication', category: 'infra', filesAffected: ['server/src/app.js'], resolution: 'Whitelist localhost origins', pinned: false, expiresAt: new Date(Date.now() + 6*24*60*60*1000).toISOString(), createdAt: new Date(Date.now() - 1*24*60*60*1000).toISOString() },
];

// ---- State ----
let entries = JSON.parse(JSON.stringify(MOCK_ENTRIES));
let timeOffsetMs = 0;

// ---- Time Helpers ----
function now() {
  return Date.now() + timeOffsetMs;
}

function getDecayOpacity(entry) {
  if (entry.pinned) return 1.0;
  if (!entry.expiresAt) return 1.0;
  const n = now();
  const created = new Date(entry.createdAt).getTime();
  const expires = new Date(entry.expiresAt).getTime();
  const total = expires - created;
  const remaining = expires - n;
  if (remaining <= 0) return 0.15;
  const ratio = remaining / total;
  return 0.3 + (ratio * 0.7);
}

function getDecayPercent(entry) {
  if (entry.pinned) return 100;
  if (!entry.expiresAt) return 100;
  const n = now();
  const created = new Date(entry.createdAt).getTime();
  const expires = new Date(entry.expiresAt).getTime();
  const total = expires - created;
  const remaining = expires - n;
  if (remaining <= 0) return 0;
  return Math.max(0, Math.min(100, (remaining / total) * 100));
}

function getDecayState(percent) {
  if (percent > 25) return 'healthy';
  if (percent > 10) return 'warning';
  return 'critical';
}

function getRemainingMs(entry) {
  if (entry.pinned || !entry.expiresAt) return Infinity;
  return new Date(entry.expiresAt).getTime() - now();
}

function formatCountdown(ms) {
  if (ms <= 0) return { text: 'Expired', className: 'expired-label' };

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const isCritical = ms < 5 * 60 * 1000;

  let text;
  if (days >= 1) {
    text = `${days}d ${hours % 24}h`;
  } else if (hours >= 1) {
    text = `${hours}h ${minutes % 60}m`;
  } else {
    text = `${minutes}m ${seconds % 60}s`;
  }

  return {
    text,
    className: isCritical ? 'critical-countdown' : ''
  };
}

function formatRelativeAge(isoDate) {
  const ms = now() - new Date(isoDate).getTime();
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  const mins = Math.floor(ms / (1000 * 60));
  return `${mins}m ago`;
}

function formatTimeOffset(ms) {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) return `+${days}d ${hours % 24}h`;
  return `+${hours}h`;
}

// ---- Type Labels ----
const TYPE_LABELS = {
  'error-fix': 'Error Fix',
  'pattern-learned': 'Pattern',
  'config-change': 'Config',
  'user-preference': 'Preference',
  'deployment-note': 'Deploy',
};

// ---- Rendering ----
const timelineEl = document.getElementById('timeline');
const statsEl = document.getElementById('stats');
const btnSimulate = document.getElementById('btn-simulate');
const btnReset = document.getElementById('btn-reset');
const timeBanner = document.getElementById('time-banner');
const timeOffsetLabel = document.getElementById('time-offset-label');

function renderStats() {
  const pinned = entries.filter(e => e.pinned).length;
  const decaying = entries.filter(e => !e.pinned && e.expiresAt && getRemainingMs(e) > 5 * 60 * 1000).length;
  const critical = entries.filter(e => !e.pinned && e.expiresAt && getRemainingMs(e) > 0 && getRemainingMs(e) <= 5 * 60 * 1000).length;
  const expired = entries.filter(e => !e.pinned && e.expiresAt && getRemainingMs(e) <= 0).length;

  statsEl.innerHTML = `
    <span class="stat"><span class="stat-dot pinned"></span><span class="stat-count">${pinned}</span><span class="stat-label">pinned</span></span>
    <span class="stat"><span class="stat-dot decaying"></span><span class="stat-count">${decaying}</span><span class="stat-label">decaying</span></span>
    <span class="stat"><span class="stat-dot critical"></span><span class="stat-count">${critical}</span><span class="stat-label">critical</span></span>
    ${expired > 0 ? `<span class="stat"><span class="stat-dot" style="background:var(--text-tertiary);opacity:0.5"></span><span class="stat-count">${expired}</span><span class="stat-label">expired</span></span>` : ''}
  `;
}

function sortEntries() {
  // Pinned first, then by remaining TTL ascending (most urgent at top), expired last
  entries.sort((a, b) => {
    // Pinned entries come first
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;

    // Both pinned: sort by createdAt descending (newest first)
    if (a.pinned && b.pinned) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }

    const remA = getRemainingMs(a);
    const remB = getRemainingMs(b);

    // Expired entries go to the bottom
    if (remA <= 0 && remB > 0) return 1;
    if (remB <= 0 && remA > 0) return -1;
    if (remA <= 0 && remB <= 0) return 0;

    // Sort by remaining time ascending (most urgent first)
    return remA - remB;
  });
}

function buildEntryHTML(entry) {
  const opacity = getDecayOpacity(entry);
  const decayPct = getDecayPercent(entry);
  const remaining = getRemainingMs(entry);
  const isExpired = !entry.pinned && entry.expiresAt && remaining <= 0;
  const isCritical = !entry.pinned && entry.expiresAt && remaining > 0 && remaining <= 5 * 60 * 1000;

  let stateClass = '';
  if (entry.pinned) stateClass = 'pinned';
  else if (isExpired) stateClass = 'expired';
  else if (isCritical) stateClass = 'critical';

  // Decay bar class
  let barClass = 'healthy';
  if (entry.pinned) barClass = 'pinned';
  else barClass = getDecayState(decayPct);

  // Countdown
  let countdownHTML;
  if (entry.pinned) {
    countdownHTML = `<span class="card-countdown pinned-label">&#128274; Pinned</span>`;
  } else if (isExpired) {
    countdownHTML = `<span class="card-countdown expired-label">Expired</span>`;
  } else {
    const cd = formatCountdown(remaining);
    countdownHTML = `<span class="card-countdown ${cd.className}">${cd.text}</span>`;
  }

  // Files
  let filesHTML = '';
  if (entry.filesAffected && entry.filesAffected.length > 0) {
    filesHTML = `<div class="card-files">${entry.filesAffected.map(f => `<span class="file-chip">${f}</span>`).join('')}</div>`;
  }

  // Resolution
  let resolutionHTML = '';
  if (entry.resolution) {
    resolutionHTML = `<div class="card-resolution">${entry.resolution}</div>`;
  }

  return `
    <div class="timeline-entry ${stateClass}" data-id="${entry._id}" style="opacity: ${opacity}">
      <div class="timeline-dot"></div>
      <div class="entry-card">
        <button class="pin-btn ${entry.pinned ? 'is-pinned' : ''}" data-id="${entry._id}" title="${entry.pinned ? 'Unpin' : 'Pin'} this memory">
          ${entry.pinned ? '&#128274;' : '&#128275;'}
        </button>
        <div class="card-header">
          <div class="card-meta">
            <div class="card-badges">
              <span class="type-badge ${entry.type}">${TYPE_LABELS[entry.type] || entry.type}</span>
              <span class="category-tag">${entry.category}</span>
            </div>
            <div class="card-summary">${entry.summary}</div>
          </div>
        </div>
        ${resolutionHTML}
        ${filesHTML}
        <div class="decay-bar-container">
          <div class="decay-bar-track">
            <div class="decay-bar-fill ${barClass}" style="width: ${decayPct}%"></div>
          </div>
        </div>
        <div class="card-footer">
          <span class="card-created">Created ${formatRelativeAge(entry.createdAt)}</span>
          ${countdownHTML}
        </div>
        ${isExpired ? '<div class="expired-overlay"></div>' : ''}
      </div>
    </div>
  `;
}

function render() {
  sortEntries();
  renderStats();
  timelineEl.innerHTML = entries.map(buildEntryHTML).join('');
}

// ---- Update loop (countdowns + opacity only, no full re-render) ----
function updateTimers() {
  entries.forEach(entry => {
    const el = document.querySelector(`.timeline-entry[data-id="${entry._id}"]`);
    if (!el) return;

    const opacity = getDecayOpacity(entry);
    el.style.opacity = opacity;

    const decayPct = getDecayPercent(entry);
    const remaining = getRemainingMs(entry);
    const isExpired = !entry.pinned && entry.expiresAt && remaining <= 0;
    const isCritical = !entry.pinned && entry.expiresAt && remaining > 0 && remaining <= 5 * 60 * 1000;

    // Update decay bar
    const barFill = el.querySelector('.decay-bar-fill');
    if (barFill) {
      barFill.style.width = `${decayPct}%`;
      barFill.className = 'decay-bar-fill';
      if (entry.pinned) barFill.classList.add('pinned');
      else barFill.classList.add(getDecayState(decayPct));
    }

    // Update countdown
    const cdEl = el.querySelector('.card-countdown');
    if (cdEl) {
      if (entry.pinned) {
        cdEl.innerHTML = '&#128274; Pinned';
        cdEl.className = 'card-countdown pinned-label';
      } else if (isExpired) {
        cdEl.textContent = 'Expired';
        cdEl.className = 'card-countdown expired-label';
      } else {
        const cd = formatCountdown(remaining);
        cdEl.textContent = cd.text;
        cdEl.className = `card-countdown ${cd.className}`;
      }
    }

    // Update dot + card state classes
    const stateClasses = ['pinned', 'critical', 'expired'];
    stateClasses.forEach(c => el.classList.remove(c));
    if (entry.pinned) el.classList.add('pinned');
    else if (isExpired) el.classList.add('expired');
    else if (isCritical) el.classList.add('critical');

    // Add/remove expired overlay
    const existingOverlay = el.querySelector('.expired-overlay');
    if (isExpired && !existingOverlay) {
      el.querySelector('.entry-card').insertAdjacentHTML('beforeend', '<div class="expired-overlay"></div>');
    } else if (!isExpired && existingOverlay) {
      existingOverlay.remove();
    }
  });

  renderStats();
}

// ---- Pin Toggle ----
timelineEl.addEventListener('click', (e) => {
  const pinBtn = e.target.closest('.pin-btn');
  if (!pinBtn) return;

  const id = pinBtn.dataset.id;
  const entry = entries.find(en => en._id === id);
  if (!entry) return;

  if (entry.pinned) {
    // Unpin: set expiresAt to 7 days from now
    entry.pinned = false;
    entry.expiresAt = new Date(now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  } else {
    // Pin: remove expiry
    entry.pinned = true;
    entry.expiresAt = null;
  }

  // Pop animation on button
  pinBtn.classList.add('pop');
  setTimeout(() => pinBtn.classList.remove('pop'), 300);

  // Full re-render for sort order change
  render();
});

// ---- Simulate Decay ----
btnSimulate.addEventListener('click', () => {
  timeOffsetMs += 1 * 60 * 60 * 1000; // +1 hour
  timeBanner.style.display = 'flex';
  timeOffsetLabel.textContent = `Simulated: ${formatTimeOffset(timeOffsetMs)}`;

  // Re-sort since entries may cross thresholds
  render();
});

// ---- Reset ----
btnReset.addEventListener('click', () => {
  timeOffsetMs = 0;
  timeBanner.style.display = 'none';

  // Restore original data
  entries = JSON.parse(JSON.stringify(MOCK_ENTRIES));
  render();
});

// ---- Init ----
render();
setInterval(updateTimers, 1000);
