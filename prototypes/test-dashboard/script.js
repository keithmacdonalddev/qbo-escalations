// ---------------------------------------------------------------------------
// Test Runner Dashboard — Client Script
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'test-runner-history';
const CIRCUMFERENCE = 326.73; // 2 * PI * 52
const STREAM_IDLE_WARNING_MS = 45_000;
const STREAM_IDLE_FAIL_MS = 210_000;

// DOM refs
const btnRun = document.getElementById('btnRun');
const statusChip = document.getElementById('statusChip');
const ringFill = document.getElementById('ringFill');
const progressPct = document.getElementById('progressPct');
const progressLabel = document.getElementById('progressLabel');
const progressDetail = document.getElementById('progressDetail');
const countPassed = document.getElementById('countPassed');
const countFailed = document.getElementById('countFailed');
const countSkipped = document.getElementById('countSkipped');
const totalTime = document.getElementById('totalTime');
const resultsStream = document.getElementById('resultsStream');
const resultsEmpty = document.getElementById('resultsEmpty');
const historyList = document.getElementById('historyList');
const btnClearHistory = document.getElementById('btnClearHistory');
const overlay = document.getElementById('historyOverlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlayBody = document.getElementById('overlayBody');
const btnCloseOverlay = document.getElementById('btnCloseOverlay');
const filterBtns = document.querySelectorAll('.filter-btn');
const groupBar = document.getElementById('groupBar');
const groupBarInner = groupBar.querySelector('.group-bar-inner');
const testPreview = document.getElementById('testPreview');

let running = false;
let currentResults = [];
let activeFilter = 'all';
let runStartTime = null;
let durationTimer = null;
let streamHealthTimer = null;
let selectedGroup = 'all';
let featureGroups = [];

function extractEventMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return error.message || String(error);
}

function parseSSEBlock(block) {
  const lines = block.split(/\r?\n/);
  let event = 'message';
  const dataLines = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim() || 'message';
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return null;

  try {
    return {
      event,
      data: JSON.parse(dataLines.join('\n')),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Feature groups — load from server and render selector
// ---------------------------------------------------------------------------
const GROUP_ICONS = {
  'image-parser': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  'chat': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>',
  'usage': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  'escalation': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  'provider': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17h16M4 12h16M4 7h16"/></svg>',
  'integration': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  'infra': '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
};

function loadGroups() {
  fetch('/api/test-runner/groups')
    .then(r => r.json())
    .then(data => {
      if (!data.ok) return;
      featureGroups = data.groups || [];
      renderGroupBar(data.totalTestCount);
    })
    .catch(err => {
      console.warn('Failed to load test groups:', err);
    });
}

function renderGroupBar(totalTestCount) {
  // Build the "All" chip first
  let html = '<button class="group-chip' + (selectedGroup === 'all' ? ' active' : '') + '" data-group="all" type="button">' +
    '<span class="group-chip-icon">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
    '</span>' +
    '<span class="group-chip-label">All Tests</span>' +
    '<span class="group-chip-count">' + (totalTestCount || '--') + '</span>' +
  '</button>';

  // Add each feature group
  for (const group of featureGroups) {
    if (group.fileCount === 0) continue;
    const icon = GROUP_ICONS[group.id] || GROUP_ICONS['integration'];
    const isActive = selectedGroup === group.id;
    html += '<button class="group-chip' + (isActive ? ' active' : '') + '" data-group="' + group.id + '" type="button" title="' + escapeHtml(group.description) + '">' +
      '<span class="group-chip-icon">' + icon + '</span>' +
      '<span class="group-chip-label">' + escapeHtml(group.label) + '</span>' +
      '<span class="group-chip-count">' + group.testCount + '</span>' +
    '</button>';
  }

  groupBarInner.innerHTML = html;

  // Attach click handlers — fetch test names on chip click
  groupBarInner.querySelectorAll('.group-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (running) return;
      const clickedGroup = chip.dataset.group;

      // Toggle: clicking the same chip again collapses the preview
      if (selectedGroup === clickedGroup && testPreview.classList.contains('open')) {
        closeTestPreview();
        return;
      }

      selectedGroup = clickedGroup;
      groupBarInner.querySelectorAll('.group-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.group === selectedGroup);
      });
      updateRunButton();
      fetchTestPreview(clickedGroup);
    });
  });
}

function updateRunButton() {
  if (selectedGroup === 'all') {
    btnRun.querySelector('svg').nextSibling.textContent = ' Run All';
  } else {
    const group = featureGroups.find(g => g.id === selectedGroup);
    btnRun.querySelector('svg').nextSibling.textContent = ' Run ' + (group ? group.label : 'Tests');
  }
}

// ---------------------------------------------------------------------------
// Test preview panel — show test case names for a group before running
// ---------------------------------------------------------------------------
function fetchTestPreview(groupId) {
  testPreview.classList.add('open');
  testPreview.innerHTML = '<div class="test-preview-inner"><div class="test-preview-loading"><div class="spinner"></div>Loading test cases...</div></div>';

  fetch('/api/test-runner/groups/' + encodeURIComponent(groupId) + '/tests')
    .then(r => r.json())
    .then(data => {
      if (!data.ok || !data.files) {
        testPreview.innerHTML = '<div class="test-preview-inner"><div class="test-preview-empty">Could not load test cases</div></div>';
        return;
      }
      renderTestPreview(groupId, data.files);
    })
    .catch(() => {
      testPreview.innerHTML = '<div class="test-preview-inner"><div class="test-preview-empty">Failed to fetch test cases</div></div>';
    });
}

function renderTestPreview(groupId, files) {
  const groupLabel = groupId === 'all'
    ? 'All Tests'
    : (featureGroups.find(g => g.id === groupId) || {}).label || groupId;

  let totalTests = 0;
  for (const f of files) totalTests += f.tests.length;

  let html = '<div class="test-preview-inner">';
  html += '<div class="test-preview-header">';
  html += '<div>';
  html += '<span class="test-preview-title">' + escapeHtml(groupLabel) + '</span>';
  html += '<span class="test-preview-subtitle">' + files.length + ' file' + (files.length !== 1 ? 's' : '') + ' / ' + totalTests + ' test' + (totalTests !== 1 ? 's' : '') + '</span>';
  html += '</div>';
  html += '<div class="test-preview-actions">';
  html += '<button class="btn-preview-run" id="btnPreviewRun" type="button">' +
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
    'Run This Group' +
  '</button>';
  html += '<button class="btn-preview-close" id="btnPreviewClose" type="button" title="Close preview">' +
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
    '</svg>' +
  '</button>';
  html += '</div>';
  html += '</div>';

  if (files.length === 0) {
    html += '<div class="test-preview-empty">No test files found for this group</div>';
  } else {
    html += '<div class="test-preview-grid">';
    for (const file of files) {
      html += '<div class="test-preview-file" data-file="' + escapeHtml(file.name) + '">';
      html += '<div class="test-preview-file-header">';
      html += '<span class="test-preview-file-arrow">&#9660;</span>';
      html += '<span class="test-preview-file-name">' + escapeHtml(file.name) + '</span>';
      html += '<span class="test-preview-file-badge">' + file.tests.length + '</span>';
      html += '</div>';
      html += '<ul class="test-preview-list">';
      for (const testName of file.tests) {
        html += '<li class="test-preview-item">' + escapeHtml(testName) + '</li>';
      }
      if (file.tests.length === 0) {
        html += '<li class="test-preview-item" style="color: var(--text-dim); font-style: italic;">No test cases parsed</li>';
      }
      html += '</ul>';
      html += '</div>';
    }
    html += '</div>';
  }
  html += '</div>';

  testPreview.innerHTML = html;

  // Wire up close button
  const btnClose = document.getElementById('btnPreviewClose');
  if (btnClose) btnClose.addEventListener('click', closeTestPreview);

  // Wire up run button
  const btnPreviewRun = document.getElementById('btnPreviewRun');
  if (btnPreviewRun) btnPreviewRun.addEventListener('click', () => {
    closeTestPreview();
    runTests();
  });

  // Wire up file header collapse toggles
  testPreview.querySelectorAll('.test-preview-file-header').forEach(header => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('collapsed');
    });
  });
}

function closeTestPreview() {
  testPreview.classList.remove('open');
  testPreview.innerHTML = '';
}

// ---------------------------------------------------------------------------
// History (localStorage)
// ---------------------------------------------------------------------------
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

function saveHistory(runs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(runs.slice(0, 50)));
}

function addHistoryEntry(entry) {
  const runs = loadHistory();
  runs.unshift(entry);
  saveHistory(runs);
  renderHistory();
}

function clearHistory() {
  localStorage.removeItem(STORAGE_KEY);
  renderHistory();
}

function formatDuration(ms) {
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(iso) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderHistory() {
  const runs = loadHistory();
  if (runs.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No previous runs</div>';
    return;
  }

  historyList.innerHTML = runs.map((run, i) => {
    const success = run.failed === 0 && !run.hadError && (run.exitCode == null || run.exitCode === 0);
    const label = run.groupLabel || 'All Tests';
    return '<div class="history-entry" data-index="' + i + '">' +
      '<div class="history-dot ' + (success ? 'pass' : 'fail') + '"></div>' +
      '<div class="history-info">' +
        '<div class="history-group-label">' + escapeHtml(label) + '</div>' +
        '<div class="history-time">' + formatDate(run.timestamp) + ' ' + formatTime(run.timestamp) + '</div>' +
        '<div class="history-counts">' +
          '<span class="h-pass">' + run.passed + ' passed</span> / ' +
          '<span class="h-fail">' + run.failed + ' failed</span>' +
        '</div>' +
      '</div>' +
      '<div class="history-dur">' + formatDuration(run.durationMs) + '</div>' +
    '</div>';
  }).join('');

  // Click handlers
  historyList.querySelectorAll('.history-entry').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.index, 10);
      showHistoryDetail(runs[idx]);
    });
  });
}

function showHistoryDetail(run) {
  overlayTitle.textContent = formatDate(run.timestamp) + ' ' + formatTime(run.timestamp);

  let html = '<div class="overlay-summary">' +
    '<span class="o-pass">' + run.passed + ' passed</span>' +
    '<span class="o-fail">' + run.failed + ' failed</span>' +
    '<span class="o-dur">' + formatDuration(run.durationMs) + '</span>' +
  '</div>';

  if (run.results && run.results.length > 0) {
    html += run.results.map(r => {
      const cls = r.skip ? 'skip' : (r.passed ? 'pass' : 'fail');
      const icon = r.skip ? '~' : (r.passed ? '\u2713' : '\u2717');
      const dur = r.durationMs != null ? ' (' + formatDuration(r.durationMs) + ')' : '';
      return '<div class="overlay-test ' + cls + '">' +
        '<span>' + icon + '</span>' +
        '<span>' + escapeHtml(r.name) + dur + '</span>' +
      '</div>';
    }).join('');
  } else {
    html += '<div class="history-empty">No individual results saved</div>';
  }

  overlayBody.innerHTML = html;
  overlay.classList.add('visible');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Progress ring
// ---------------------------------------------------------------------------
function setProgress(pct, state) {
  const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
  ringFill.style.strokeDashoffset = offset;

  ringFill.classList.remove('done-pass', 'done-fail', 'in-progress');
  if (state === 'running') ringFill.classList.add('in-progress');
  else if (state === 'pass') ringFill.classList.add('done-pass');
  else if (state === 'fail') ringFill.classList.add('done-fail');

  progressPct.textContent = Math.round(pct) + '%';
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------
function applyFilter(filter) {
  activeFilter = filter;
  filterBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });

  resultsStream.querySelectorAll('.test-card').forEach(card => {
    if (filter === 'all') {
      card.classList.remove('filter-hidden');
    } else {
      const status = card.dataset.status;
      card.classList.toggle('filter-hidden', status !== filter);
    }
  });
}

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => applyFilter(btn.dataset.filter));
});

// ---------------------------------------------------------------------------
// Create test card element
// ---------------------------------------------------------------------------
function createTestCard(result) {
  const card = document.createElement('div');
  const status = result.skip ? 'skipped' : (result.passed ? 'passed' : 'failed');
  const badgeCls = result.skip ? 'skip' : (result.passed ? 'pass' : 'fail');
  const icon = result.skip ? '~' : (result.passed ? '\u2713' : '\u2717');

  card.className = 'test-card' + (result.subtest ? ' subtest' : '');
  card.dataset.status = status;

  let metaHtml = '';
  if (result.durationMs != null) {
    metaHtml += '<span class="test-duration">' + formatDuration(result.durationMs) + '</span>';
  }

  // Build inline error detail when present on failed results
  let hasError = !result.passed && !result.skip && result.errorDetail;
  if (hasError) {
    metaHtml += '<button class="test-error-toggle" data-action="toggle-error">Show error</button>';
  }

  card.innerHTML =
    '<div class="test-badge ' + badgeCls + '">' + icon + '</div>' +
    '<div class="test-body">' +
      '<div class="test-name">' + escapeHtml(result.name) + '</div>' +
      (metaHtml ? '<div class="test-meta">' + metaHtml + '</div>' : '') +
    '</div>';

  // Attach error detail element
  if (hasError) {
    const ed = result.errorDetail;
    const errorDiv = document.createElement('div');
    errorDiv.className = 'test-error';

    let errorText = '';
    if (ed.operator) errorText += 'Operator: ' + ed.operator + '\n';
    if (ed.expected) errorText += 'Expected: ' + ed.expected + '\n';
    if (ed.actual) errorText += 'Actual: ' + ed.actual + '\n';
    if (ed.message) errorText += ed.message + '\n';
    if (ed.stack) errorText += '\n' + ed.stack;
    if (ed.error) errorText += ed.error + '\n';
    if (ed.code) errorText += 'Code: ' + ed.code + '\n';
    if (!errorText.trim()) errorText = JSON.stringify(ed, null, 2);

    errorDiv.textContent = errorText.trim();
    card.querySelector('.test-body').appendChild(errorDiv);

    const toggleBtn = card.querySelector('[data-action="toggle-error"]');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const expanded = errorDiv.classList.toggle('expanded');
        toggleBtn.textContent = expanded ? 'Hide error' : 'Show error';
      });
    }
  }

  // Apply current filter
  if (activeFilter !== 'all' && status !== activeFilter) {
    card.classList.add('filter-hidden');
  }

  return card;
}

function createCommentCard(note) {
  const card = document.createElement('div');
  const metaParts = [];
  if (note.file) metaParts.push(note.file);
  if (note.kind) metaParts.push(String(note.kind).replace(/-/g, ' '));

  card.className = 'test-card comment';
  card.dataset.status = 'comment';
  card.innerHTML =
    '<div class="test-badge info">i</div>' +
    '<div class="test-body">' +
      '<div class="test-name comment-name">' + escapeHtml(note.message) + '</div>' +
      (metaParts.length > 0 ? '<div class="test-meta"><span class="test-duration">' + escapeHtml(metaParts.join(' • ')) + '</span></div>' : '') +
    '</div>';

  if (activeFilter !== 'all') {
    card.classList.add('filter-hidden');
  }

  return card;
}

// Add error detail to a test card
function attachError(testName, errorData) {
  const cards = resultsStream.querySelectorAll('.test-card');
  for (let i = cards.length - 1; i >= 0; i--) {
    const nameEl = cards[i].querySelector('.test-name');
    if (nameEl && nameEl.textContent === testName) {
      const body = cards[i].querySelector('.test-body');
      const meta = body.querySelector('.test-meta');

      // Add toggle button
      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'test-error-toggle';
      toggleBtn.textContent = 'Show error';

      const errorDiv = document.createElement('div');
      errorDiv.className = 'test-error';

      let errorText = '';
      if (errorData.operator) errorText += 'Operator: ' + errorData.operator + '\n';
      if (errorData.expected) errorText += 'Expected: ' + errorData.expected + '\n';
      if (errorData.actual) errorText += 'Actual: ' + errorData.actual + '\n';
      if (errorData.message) errorText += errorData.message + '\n';
      if (errorData.stack) errorText += '\n' + errorData.stack;
      if (!errorText && errorData.error) errorText = errorData.error;
      if (!errorText) errorText = JSON.stringify(errorData, null, 2);

      errorDiv.textContent = errorText.trim();

      toggleBtn.addEventListener('click', () => {
        const expanded = errorDiv.classList.toggle('expanded');
        toggleBtn.textContent = expanded ? 'Hide error' : 'Show error';
      });

      if (meta) {
        meta.appendChild(toggleBtn);
      } else {
        const metaDiv = document.createElement('div');
        metaDiv.className = 'test-meta';
        metaDiv.appendChild(toggleBtn);
        body.appendChild(metaDiv);
      }

      body.appendChild(errorDiv);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Run tests via SSE
// ---------------------------------------------------------------------------
function runTests() {
  if (running) return;
  running = true;
  closeTestPreview();
  currentResults = [];
  runStartTime = Date.now();
  let runFinalized = false;
  let runHadError = false;
  let runExitCode = null;
  let runErrorMessage = '';
  let lastEventAt = Date.now();
  let idleWarningShown = false;

  // Determine which group label to show
  const groupLabel = selectedGroup === 'all'
    ? 'All Tests'
    : (featureGroups.find(g => g.id === selectedGroup) || {}).label || selectedGroup;

  // Reset UI
  btnRun.disabled = true;
  btnRun.classList.add('running');
  btnRun.querySelector('svg').style.display = 'none';
  btnRun.childNodes[btnRun.childNodes.length - 1].textContent = ' Running...';

  // Disable group chips during run
  groupBarInner.querySelectorAll('.group-chip').forEach(c => { c.disabled = true; c.classList.add('disabled'); });

  statusChip.className = 'stat-chip running';
  statusChip.innerHTML = '<span class="stat-dot"></span>Running';

  resultsStream.innerHTML = '';
  if (resultsEmpty) resultsEmpty.remove();

  setProgress(0, 'running');
  progressLabel.textContent = groupLabel;
  progressDetail.textContent = '0 / ?';

  countPassed.textContent = '0';
  countFailed.textContent = '0';
  countSkipped.textContent = '0';
  totalTime.textContent = '0s';

  // Live duration counter
  durationTimer = setInterval(() => {
    totalTime.textContent = formatDuration(Date.now() - runStartTime);
  }, 100);

  streamHealthTimer = setInterval(() => {
    if (runFinalized) return;

    const idleMs = Date.now() - lastEventAt;
    if (!idleWarningShown && idleMs >= STREAM_IDLE_WARNING_MS) {
      idleWarningShown = true;
      const noteCard = createCommentCard({
        kind: 'warning',
        message: 'No test runner activity for 45s. This run may be stalled.',
      });
      resultsStream.appendChild(noteCard);
      noteCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      progressLabel.textContent = 'Waiting for output...';
      progressDetail.textContent = 'No events from server';
    }

    if (idleMs >= STREAM_IDLE_FAIL_MS) {
      runHadError = true;
      runExitCode = runExitCode || 1;
      runErrorMessage = 'No test runner activity for 210s. The stream appears stale.';
      finalizeRun(Date.now() - runStartTime);
    }
  }, 1000);

  let passed = 0, failed = 0, skipped = 0, total = 0, planTotal = null;

  function finalizeRun(durationMs) {
    if (runFinalized) return;
    runFinalized = true;
    finishRun({
      passed,
      failed,
      skipped,
      total,
      durationMs,
      exitCode: runExitCode,
      hadError: runHadError,
      errorMessage: runErrorMessage,
      groupLabel,
    });
  }

  // Build request body — send group id or empty for all
  const reqBody = selectedGroup === 'all' ? {} : { group: selectedGroup };

  // Use fetch + ReadableStream for SSE via POST
  fetch('/api/test-runner/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody),
  }).then(response => {
    if (!response.ok) {
      return response.text().then(text => {
        let message = 'Test run request failed';
        try {
          const parsed = JSON.parse(text);
          message = parsed.error || parsed.message || message;
        } catch {
          if (text.trim()) message = text.trim();
        }
        throw new Error(message);
      });
    }
    if (!response.body) {
      throw new Error('Streaming is not available in this browser');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    function processChunk({ done, value }) {
      if (runFinalized) return;

      if (done) {
        const trailingEvent = parseSSEBlock(buffer);
        if (trailingEvent) {
          handleSSEEvent(trailingEvent.event, trailingEvent.data);
        }
        finalizeRun();
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop();

      for (const block of blocks) {
        const parsed = parseSSEBlock(block);
        if (parsed) {
          handleSSEEvent(parsed.event, parsed.data);
        }
      }

      reader.read().then(processChunk).catch(err => {
        runHadError = true;
        runExitCode = runExitCode || 1;
        runErrorMessage = extractEventMessage(err) || 'The test runner stream was interrupted';
        finalizeRun(Date.now() - runStartTime);
      });
    }

    function handleSSEEvent(event, data) {
      if (runFinalized) return;
      lastEventAt = Date.now();
      idleWarningShown = false;

      if (event === 'run-start') {
        progressLabel.textContent = 'Starting...';
        progressDetail.textContent = data.pattern || 'test suite';
        setProgress(0, 'running');
        return;
      }
      if (event === 'test-result') {
        total++;
        if (data.skip) { skipped++; }
        else if (data.passed) { passed++; }
        else { failed++; }

        currentResults.push(data);
        const card = createTestCard(data);
        resultsStream.appendChild(card);
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        countPassed.textContent = passed;
        countFailed.textContent = failed;
        countSkipped.textContent = skipped;

        if (planTotal) {
          const pct = (total / planTotal) * 100;
          setProgress(pct, 'running');
          progressDetail.textContent = total + ' / ' + planTotal;
        } else {
          progressDetail.textContent = total + ' completed';
        }
      } else if (event === 'test-plan') {
        planTotal = data.total;
      } else if (event === 'test-error') {
        attachError(data.test, data);
      } else if (event === 'error') {
        runHadError = true;
        runErrorMessage = data.message || runErrorMessage;
        statusChip.className = 'stat-chip failed';
        statusChip.innerHTML = '<span class="stat-dot"></span>Error';
        progressLabel.textContent = 'Run error';
        progressDetail.textContent = runErrorMessage || 'The server reported an error';
      } else if (event === 'suite-complete') {
        passed = data.passed;
        failed = data.failed;
        skipped = data.skipped;
        total = data.total;
        runExitCode = data.exitCode;
        if (data.exitCode !== 0) {
          runHadError = true;
        }
        if (data.stderr) {
          runErrorMessage = data.stderr;
        }
        finalizeRun(data.durationMs);
      } else if (event === 'comment') {
        if (!data || !data.message) return;
        const noteCard = createCommentCard(data);
        resultsStream.appendChild(noteCard);
        noteCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        progressDetail.textContent = data.file || data.message;
      }
    }

    reader.read().then(processChunk).catch(err => {
      runHadError = true;
      runExitCode = runExitCode || 1;
      runErrorMessage = extractEventMessage(err) || 'The test runner stream was interrupted';
      finalizeRun(Date.now() - runStartTime);
    });
  }).catch(err => {
    console.error('Test run fetch error:', err);
    runHadError = true;
    runErrorMessage = extractEventMessage(err);
    finalizeRun();
  });
}

function finishRun({ passed, failed, skipped, total, durationMs, exitCode, hadError, errorMessage, groupLabel }) {
  running = false;
  clearInterval(durationTimer);
  durationTimer = null;
  clearInterval(streamHealthTimer);
  streamHealthTimer = null;

  const dur = durationMs || (Date.now() - runStartTime);
  const success = !hadError && failed === 0 && (exitCode == null || exitCode === 0);

  btnRun.disabled = false;
  btnRun.classList.remove('running');
  btnRun.querySelector('svg').style.display = '';
  updateRunButton();

  // Re-enable group chips
  groupBarInner.querySelectorAll('.group-chip').forEach(c => { c.disabled = false; c.classList.remove('disabled'); });

  statusChip.className = 'stat-chip ' + (success ? 'passed' : 'failed');
  statusChip.innerHTML = '<span class="stat-dot"></span>' + (success ? 'Passed' : 'Failed');

  setProgress(100, success ? 'pass' : 'fail');
  progressLabel.textContent = success ? 'All passed' : (failed > 0 ? failed + ' failed' : 'Run failed');
  progressDetail.textContent = errorMessage ? errorMessage : (total + ' tests');

  countPassed.textContent = passed;
  countFailed.textContent = failed;
  countSkipped.textContent = skipped;
  totalTime.textContent = formatDuration(dur);

  // Save to history
  addHistoryEntry({
    timestamp: new Date().toISOString(),
    groupLabel: groupLabel || 'All Tests',
    passed,
    failed,
    skipped,
    total,
    durationMs: dur,
    exitCode,
    hadError,
    results: currentResults.map(r => ({
      name: r.name,
      passed: r.passed,
      skip: r.skip || false,
      durationMs: r.durationMs,
    })),
  });
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------
btnRun.addEventListener('click', runTests);
btnClearHistory.addEventListener('click', () => {
  clearHistory();
});
btnCloseOverlay.addEventListener('click', () => {
  overlay.classList.remove('visible');
});
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) overlay.classList.remove('visible');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (overlay.classList.contains('visible')) {
      overlay.classList.remove('visible');
    } else if (testPreview.classList.contains('open')) {
      closeTestPreview();
    }
  }
});

// Init
renderHistory();
loadGroups();
