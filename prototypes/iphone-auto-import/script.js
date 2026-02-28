const STORAGE_KEY = 'qbo-auto-import-prototype-v2';
const DEFAULT_WATCH_DIR = 'C:\\Users\\NewAdmin\\Pictures\\Screenshots';
const MAX_EVENTS = 20;
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.heic', '.heif'];

const state = {
  config: {
    enabled: false,
    watchDir: DEFAULT_WATCH_DIR,
    mode: 'fallback',
    primaryProvider: 'claude',
    fallbackProvider: 'chatgpt-5.3-codex-high',
    scanIntervalMs: 15000,
    maxPerScan: 5,
  },
  runtime: {
    importedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    lastScanAt: null,
    lastImportedAt: null,
    lastImportedFile: '',
    lastError: '',
  },
  records: [],
  events: [],
  processedHashes: [],
  ui: {
    route: 'settings',
    search: '',
    statusFilter: '',
    sourceFilter: '',
  },
  chat: {
    drawerOpen: false,
    draftText: '',
    attachedIds: [],
    messages: [],
  },
  connectedFolderName: '',
};

const refs = {};
let directoryHandle = null;
let scanTimer = null;

function $(id) {
  return document.getElementById(id);
}

function nowIso() {
  return new Date().toISOString();
}

function formatDateTime(value) {
  if (!value) return 'Never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Never';
  return d.toLocaleString();
}

function formatTimeOnly(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    state.config = { ...state.config, ...(parsed.config || {}) };
    state.runtime = { ...state.runtime, ...(parsed.runtime || {}) };
    state.records = Array.isArray(parsed.records) ? parsed.records : [];
    state.events = Array.isArray(parsed.events) ? parsed.events.slice(0, MAX_EVENTS) : [];
    state.processedHashes = Array.isArray(parsed.processedHashes) ? parsed.processedHashes : [];
    state.ui = { ...state.ui, ...(parsed.ui || {}) };
    state.chat = { ...state.chat, ...(parsed.chat || {}) };
    state.connectedFolderName = typeof parsed.connectedFolderName === 'string' ? parsed.connectedFolderName : '';
  } catch {
    // ignore corrupted saved state
  }
}

function saveState() {
  const payload = {
    config: state.config,
    runtime: state.runtime,
    records: state.records,
    events: state.events.slice(0, MAX_EVENTS),
    processedHashes: state.processedHashes,
    ui: state.ui,
    chat: state.chat,
    connectedFolderName: state.connectedFolderName,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function pushEvent(kind, message, extra = {}) {
  state.events = [
    { at: nowIso(), kind, message, ...extra },
    ...state.events,
  ].slice(0, MAX_EVENTS);
}

function showNotice(message, isError = false) {
  refs.globalNotice.textContent = message;
  refs.globalNotice.classList.remove('hidden', 'error');
  if (isError) refs.globalNotice.classList.add('error');
  setTimeout(() => {
    refs.globalNotice.classList.add('hidden');
  }, 3500);
}

function getRouteFromHash() {
  const hash = window.location.hash || '#/settings';
  if (hash === '#/chat') return 'chat';
  if (hash === '#/dashboard') return 'dashboard';
  return 'settings';
}

function setRoute(route) {
  state.ui.route = route;
  const titleMap = {
    settings: ['Auto-Import Settings', 'Configure folder watch, parsing policy, and run scans.'],
    dashboard: ['Escalation Dashboard', 'Review imported records, filter, and take actions.'],
    chat: ['Chat Experience', 'Demonstration with right import drawer and add-to-chat workflow.'],
  };
  const selected = titleMap[route] || titleMap.settings;
  refs.pageTitle.textContent = selected[0];
  refs.pageSubtitle.textContent = selected[1];

  refs.settingsView.classList.toggle('hidden', route !== 'settings');
  refs.dashboardView.classList.toggle('hidden', route !== 'dashboard');
  refs.chatView.classList.toggle('hidden', route !== 'chat');

  document.querySelectorAll('.nav-link').forEach((link) => {
    link.classList.toggle('active', link.dataset.route === route);
  });
}

function syncFormFromState() {
  refs.cfgEnabled.checked = Boolean(state.config.enabled);
  refs.cfgWatchDir.value = state.config.watchDir || DEFAULT_WATCH_DIR;
  refs.cfgMode.value = state.config.mode;
  refs.cfgPrimary.value = state.config.primaryProvider;
  refs.cfgFallback.value = state.config.fallbackProvider;
  refs.cfgInterval.value = String(state.config.scanIntervalMs || 15000);
  refs.cfgMaxPerScan.value = String(state.config.maxPerScan || 5);
}

function updateRuntimeUI() {
  refs.watchStatusBadge.textContent = state.config.enabled ? 'Watching' : 'Paused';
  refs.watchStatusBadge.classList.toggle('on', state.config.enabled);

  refs.rtConnected.textContent = directoryHandle ? `Yes (${state.connectedFolderName || 'selected folder'})` : 'No';
  refs.rtLastScan.textContent = formatDateTime(state.runtime.lastScanAt);
  refs.rtLastImport.textContent = formatDateTime(state.runtime.lastImportedAt);
  refs.rtLastFile.textContent = state.runtime.lastImportedFile || 'None';

  refs.statImported.textContent = String(state.runtime.importedCount || 0);
  refs.statFailed.textContent = String(state.runtime.failedCount || 0);
  refs.statSkipped.textContent = String(state.runtime.skippedCount || 0);
  refs.statRecords.textContent = String(state.records.length);

  const pillText = state.config.enabled
    ? `Auto-import ON - ${state.config.watchDir || DEFAULT_WATCH_DIR}`
    : 'Auto-import OFF';
  refs.chatAutoImportPill.textContent = pillText;
  refs.chatAutoImportPill.classList.toggle('on', state.config.enabled);
}

function guessCategory(fileName) {
  const name = fileName.toLowerCase();
  if (name.includes('payroll')) return 'payroll';
  if (name.includes('bank')) return 'bank-feeds';
  if (name.includes('recon')) return 'reconciliation';
  if (name.includes('tax')) return 'tax';
  if (name.includes('invoice')) return 'invoicing';
  if (name.includes('perm')) return 'permissions';
  if (name.includes('report')) return 'reporting';
  if (name.includes('bill')) return 'billing';
  return 'unknown';
}

function parseFromFileName(fileName) {
  const normalized = fileName.replace(/\.[^/.]+$/, '');
  const lower = normalized.toLowerCase();
  const coidMatch = lower.match(/coid[_\s-]?(\d{3,})/i);
  const caseMatch = lower.match(/case[_\s-]?(\d{3,})/i);
  const midMatch = lower.match(/mid[_\s-]?(\d{3,})/i);
  const agentMatch = lower.match(/agent[_\s-]?([a-z0-9]+)/i);
  const issue = normalized.replace(/[_-]+/g, ' ').trim();

  return {
    coid: coidMatch ? coidMatch[1] : '',
    caseNumber: caseMatch ? caseMatch[1] : '',
    mid: midMatch ? midMatch[1] : '',
    agentName: agentMatch ? agentMatch[1] : '',
    issue: issue || 'Escalation imported from screenshot',
    category: guessCategory(fileName),
  };
}

function randomConfidence() {
  const roll = Math.random();
  if (roll > 0.7) return 'high';
  if (roll > 0.35) return 'medium';
  return 'low';
}

async function digestBuffer(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isSupportedImageName(name) {
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function objectUrlToDataUrl(url) {
  return fetch(url)
    .then((response) => response.blob())
    .then((blob) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    }));
}

async function toRecordFromFile(file) {
  const buffer = await file.arrayBuffer();
  const hash = await digestBuffer(buffer);
  if (state.processedHashes.includes(hash)) {
    return { skipped: true, hash, fileName: file.name };
  }

  const objectUrl = URL.createObjectURL(file);
  const dataUrl = await objectUrlToDataUrl(objectUrl);
  URL.revokeObjectURL(objectUrl);

  const parsed = parseFromFileName(file.name);
  const confidence = randomConfidence();
  const record = {
    id: `esc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source: 'auto-import',
    status: 'open',
    createdAt: nowIso(),
    parseConfidence: confidence,
    screenshotDataUrl: dataUrl,
    fileName: file.name,
    ...parsed,
  };

  return { skipped: false, hash, record, fileName: file.name };
}

async function listFilesFromConnectedFolder() {
  if (!directoryHandle) return [];
  const files = [];
  for await (const entry of directoryHandle.values()) {
    if (entry.kind !== 'file') continue;
    if (!isSupportedImageName(entry.name)) continue;
    const file = await entry.getFile();
    files.push(file);
  }
  files.sort((a, b) => a.lastModified - b.lastModified);
  return files;
}

function getRecordById(id) {
  return state.records.find((record) => record.id === id) || null;
}

function getAutoImportedRecords() {
  return state.records
    .filter((record) => record.source === 'auto-import')
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function buildDashboardRecords() {
  const search = (state.ui.search || '').toLowerCase().trim();
  const statusFilter = state.ui.statusFilter || '';
  const sourceFilter = state.ui.sourceFilter || '';

  return state.records.filter((record) => {
    if (statusFilter && record.status !== statusFilter) return false;
    if (sourceFilter && record.source !== sourceFilter) return false;
    if (!search) return true;
    const haystack = [
      record.coid,
      record.caseNumber,
      record.issue,
      record.agentName,
      record.category,
      record.fileName,
    ].join(' ').toLowerCase();
    return haystack.includes(search);
  });
}

function renderDashboard() {
  const filtered = buildDashboardRecords();
  refs.dashboardCountLabel.textContent = `${filtered.length} result${filtered.length === 1 ? '' : 's'}`;
  refs.dashboardGrid.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No imported records match your current filters.';
    refs.dashboardGrid.appendChild(empty);
    return;
  }

  const template = refs.cardTemplate;
  filtered.forEach((record) => {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector('.import-card');
    const img = fragment.querySelector('.import-thumb');
    const chip = fragment.querySelector('.status-chip');
    const time = fragment.querySelector('.time-label');
    const title = fragment.querySelector('.import-title');
    const issue = fragment.querySelector('.import-issue');
    const meta = fragment.querySelector('.import-meta');
    const markBtn = fragment.querySelector('.mark-review-btn');
    const retryBtn = fragment.querySelector('.retry-btn');

    img.src = record.screenshotDataUrl || '';
    chip.textContent = record.status || 'open';
    chip.classList.add(record.status || 'open');
    time.textContent = formatTimeOnly(record.createdAt);
    title.textContent = record.caseNumber
      ? `Case #${record.caseNumber}`
      : record.coid
        ? `COID ${record.coid}`
        : 'Imported escalation';
    issue.textContent = record.issue || 'No parsed issue text';
    meta.textContent = `Confidence: ${record.parseConfidence} | Category: ${record.category} | File: ${record.fileName}`;

    markBtn.addEventListener('click', () => {
      record.status = 'in-progress';
      pushEvent('status', `Marked ${title.textContent} as in-progress`);
      saveState();
      renderAll();
    });

    retryBtn.addEventListener('click', () => {
      record.parseConfidence = randomConfidence();
      pushEvent('retry', `Retried parse for ${record.fileName}`);
      saveState();
      renderAll();
    });

    card.dataset.id = record.id;
    refs.dashboardGrid.appendChild(fragment);
  });
}

function renderEvents() {
  refs.chatEvents.innerHTML = '';
  if (state.events.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'No events yet.';
    refs.chatEvents.appendChild(li);
    return;
  }

  state.events.forEach((event) => {
    const li = document.createElement('li');
    const title = document.createElement('div');
    const meta = document.createElement('div');
    meta.className = 'event-meta';

    title.textContent = event.message;
    meta.textContent = `${event.kind} | ${formatDateTime(event.at)}`;

    li.appendChild(title);
    li.appendChild(meta);
    refs.chatEvents.appendChild(li);
  });
}

function addChatToast(message, escalationId) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);

  if (escalationId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm btn-secondary';
    button.textContent = 'Highlight in Dashboard';
    button.addEventListener('click', () => {
      window.location.hash = '#/dashboard';
      const card = document.querySelector(`[data-id="${escalationId}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.outline = '2px solid var(--accent)';
        setTimeout(() => { card.style.outline = ''; }, 1800);
      }
    });
    toast.appendChild(button);
  }

  refs.chatToastHost.prepend(toast);
  setTimeout(() => {
    toast.remove();
  }, 6000);
}

function renderChatDrawerList() {
  refs.importDrawerList.innerHTML = '';
  const imports = getAutoImportedRecords();
  if (imports.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No imported screenshots yet. Use Settings -> Import Latest Now.';
    refs.importDrawerList.appendChild(empty);
    return;
  }

  imports.forEach((record) => {
    const item = document.createElement('article');
    item.className = 'drawer-item';

    const image = document.createElement('img');
    image.src = record.screenshotDataUrl || '';
    image.alt = record.fileName || 'Imported screenshot';

    const body = document.createElement('div');
    const title = document.createElement('h5');
    const details = document.createElement('p');
    const meta = document.createElement('p');
    const button = document.createElement('button');

    title.textContent = record.caseNumber ? `Case #${record.caseNumber}` : (record.coid ? `COID ${record.coid}` : 'Imported screenshot');
    details.textContent = record.issue || 'Imported escalation';
    meta.textContent = `${formatTimeOnly(record.createdAt)} | ${record.fileName}`;
    meta.className = 'muted';

    const alreadyAdded = state.chat.attachedIds.includes(record.id);
    button.type = 'button';
    button.className = alreadyAdded ? 'btn btn-ghost' : 'btn btn-primary';
    button.textContent = alreadyAdded ? 'Added' : 'Add To Chat';
    button.disabled = alreadyAdded;
    button.addEventListener('click', () => {
      if (state.chat.attachedIds.includes(record.id)) return;
      state.chat.attachedIds.push(record.id);
      pushEvent('chat', `Added ${record.fileName} to chat draft`);
      saveState();
      renderChat();
      renderEvents();
    });

    body.appendChild(title);
    body.appendChild(details);
    body.appendChild(meta);
    body.appendChild(button);

    item.appendChild(image);
    item.appendChild(body);
    refs.importDrawerList.appendChild(item);
  });
}

function renderChatAttachments() {
  refs.chatAttachmentTray.innerHTML = '';
  if (state.chat.attachedIds.length === 0) {
    const helper = document.createElement('span');
    helper.className = 'muted';
    helper.textContent = 'No screenshots attached.';
    refs.chatAttachmentTray.appendChild(helper);
    return;
  }

  state.chat.attachedIds.forEach((id) => {
    const record = getRecordById(id);
    if (!record) return;

    const chip = document.createElement('span');
    chip.className = 'attach-chip';
    chip.textContent = record.fileName;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'x';
    remove.title = `Remove ${record.fileName}`;
    remove.addEventListener('click', () => {
      state.chat.attachedIds = state.chat.attachedIds.filter((value) => value !== id);
      saveState();
      renderChat();
    });

    chip.appendChild(remove);
    refs.chatAttachmentTray.appendChild(chip);
  });
}

function renderChatMessages() {
  refs.chatMessageList.innerHTML = '';
  if (!Array.isArray(state.chat.messages) || state.chat.messages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = 'Start by adding imported screenshots from the right drawer, then send a message.';
    refs.chatMessageList.appendChild(empty);
    return;
  }

  state.chat.messages.forEach((msg) => {
    const bubble = document.createElement('article');
    bubble.className = `chat-msg ${msg.role}`;

    if (msg.text) {
      const text = document.createElement('div');
      text.textContent = msg.text;
      bubble.appendChild(text);
    }

    if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
      const group = document.createElement('div');
      group.className = 'chat-msg-attachments';
      msg.attachments.forEach((id) => {
        const record = getRecordById(id);
        if (!record) return;
        const box = document.createElement('div');
        box.className = 'chat-msg-attachment';

        const image = document.createElement('img');
        image.src = record.screenshotDataUrl || '';
        image.alt = record.fileName;

        const label = document.createElement('span');
        label.textContent = record.fileName;

        box.appendChild(image);
        box.appendChild(label);
        group.appendChild(box);
      });
      bubble.appendChild(group);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${msg.role === 'user' ? 'You' : 'Assistant'} • ${formatTimeOnly(msg.at)}`;
    bubble.appendChild(meta);

    refs.chatMessageList.appendChild(bubble);
  });

  refs.chatMessageList.scrollTop = refs.chatMessageList.scrollHeight;
}

function buildAssistantReply(userMessage) {
  const attachments = Array.isArray(userMessage.attachments) ? userMessage.attachments.map(getRecordById).filter(Boolean) : [];
  if (attachments.length === 0) {
    return 'No screenshots attached. Open the imports drawer on the right and add one or more screenshots before asking for parse help.';
  }

  const first = attachments[0];
  const category = first && first.category ? first.category : 'unknown';
  const caseOrCoid = first.caseNumber ? `Case ${first.caseNumber}` : (first.coid ? `COID ${first.coid}` : 'the attached escalation');
  const count = attachments.length;

  return `Prototype assistant summary: reviewed ${count} attached screenshot${count === 1 ? '' : 's'}. Primary issue appears in ${category}. Start with ${caseOrCoid}, confirm agent/context fields, then propose next troubleshooting steps before escalation handoff.`;
}

function sendChatMessage() {
  const draft = (state.chat.draftText || '').trim();
  const attachments = Array.isArray(state.chat.attachedIds) ? state.chat.attachedIds.slice() : [];
  if (!draft && attachments.length === 0) {
    showNotice('Type a message or add at least one screenshot.', true);
    return;
  }

  const userMessage = {
    id: `msg_u_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    role: 'user',
    text: draft || '(Screenshot-only message)',
    attachments,
    at: nowIso(),
  };
  state.chat.messages.push(userMessage);
  state.chat.draftText = '';
  state.chat.attachedIds = [];
  pushEvent('chat', 'Sent chat message with imported screenshots');
  saveState();
  renderChat();
  renderEvents();

  setTimeout(() => {
    const assistantMessage = {
      id: `msg_a_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      role: 'assistant',
      text: buildAssistantReply(userMessage),
      attachments: userMessage.attachments,
      at: nowIso(),
    };
    state.chat.messages.push(assistantMessage);
    saveState();
    renderChat();
  }, 500);
}

function renderChat() {
  refs.importDrawerBackdrop.classList.toggle('hidden', !state.chat.drawerOpen);
  refs.importDrawer.classList.toggle('hidden', !state.chat.drawerOpen);
  refs.openImportDrawerBtn.textContent = state.chat.drawerOpen ? 'Hide Imports' : 'Open Imports';
  refs.chatInput.value = state.chat.draftText || '';

  renderChatMessages();
  renderChatAttachments();
  renderChatDrawerList();
}

async function importFromConnectedFolder() {
  if (!directoryHandle) {
    showNotice('Connect a folder first (Settings -> Connect Folder).', true);
    return;
  }

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const files = await listFilesFromConnectedFolder();
  const selected = files.slice(0, Math.max(1, Number(state.config.maxPerScan) || 5));

  for (const file of selected) {
    try {
      const result = await toRecordFromFile(file);
      if (result.skipped) {
        skipped += 1;
        continue;
      }

      imported += 1;
      state.records.unshift(result.record);
      state.processedHashes.push(result.hash);
      state.runtime.lastImportedAt = nowIso();
      state.runtime.lastImportedFile = result.fileName;
      pushEvent('imported', `Imported ${result.fileName}`, { escalationId: result.record.id });
      addChatToast(`Imported new escalation from ${result.fileName}`, result.record.id);
    } catch (err) {
      failed += 1;
      pushEvent('failed', `Failed importing ${file.name}: ${err.message}`);
      state.runtime.lastError = err.message;
    }
  }

  state.runtime.importedCount += imported;
  state.runtime.skippedCount += skipped;
  state.runtime.failedCount += failed;
  state.runtime.lastScanAt = nowIso();

  saveState();
  renderAll();
  showNotice(`Scan complete: ${imported} imported, ${skipped} skipped, ${failed} failed.`);
}

function loadDemoImports() {
  const demos = [
    'COID_884122_CASE_741992_bank-feed-sync.png',
    'case_551923_payroll_tax_withholding_error.jpg',
    'agent_jordan_coid_119932_reconciliation_mismatch.png',
    'CASE_992121_permissions_role_access_fail.png',
  ];
  let added = 0;

  demos.forEach((name, idx) => {
    const parsed = parseFromFileName(name);
    const fakeHash = `demo_${name}`;
    if (state.processedHashes.includes(fakeHash)) return;

    const color = idx % 2 === 0 ? 'e5f3f0' : 'fdf0d5';
    const dataUrl = `data:image/svg+xml;base64,${btoa(
      `<svg xmlns='http://www.w3.org/2000/svg' width='960' height='540'>
        <rect width='100%' height='100%' fill='#${color}'/>
        <text x='50%' y='44%' font-size='32' text-anchor='middle' fill='#2c2620'>${name}</text>
        <text x='50%' y='54%' font-size='20' text-anchor='middle' fill='#6b5f53'>Prototype imported screenshot preview</text>
      </svg>`,
    )}`;

    const record = {
      id: `demo_${Date.now()}_${idx}`,
      source: 'auto-import',
      status: 'open',
      createdAt: nowIso(),
      parseConfidence: randomConfidence(),
      screenshotDataUrl: dataUrl,
      fileName: name,
      ...parsed,
    };

    state.records.unshift(record);
    state.processedHashes.push(fakeHash);
    state.runtime.importedCount += 1;
    state.runtime.lastImportedAt = nowIso();
    state.runtime.lastImportedFile = name;
    added += 1;
    pushEvent('imported', `Demo import added: ${name}`, { escalationId: record.id });
    addChatToast(`Imported new escalation from ${name}`, record.id);
  });

  state.runtime.lastScanAt = nowIso();
  saveState();
  renderAll();
  showNotice(`Loaded ${added} demo imports.`);
}

function startOrStopTimer() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  if (!state.config.enabled) return;
  scanTimer = setInterval(() => {
    importFromConnectedFolder().catch((err) => {
      state.runtime.failedCount += 1;
      state.runtime.lastError = err.message;
      pushEvent('failed', `Background scan failed: ${err.message}`);
      saveState();
      renderAll();
    });
  }, Math.max(3000, Number(state.config.scanIntervalMs) || 15000));
}

async function connectFolder() {
  if (!window.showDirectoryPicker) {
    showNotice('Directory picker is not supported in this browser. Use Chrome/Edge.', true);
    return;
  }
  try {
    directoryHandle = await window.showDirectoryPicker();
    state.connectedFolderName = directoryHandle.name || 'selected folder';
    if (!refs.cfgWatchDir.value || refs.cfgWatchDir.value === DEFAULT_WATCH_DIR) {
      refs.cfgWatchDir.value = `Connected: ${directoryHandle.name}`;
    }
    pushEvent('config', `Connected folder: ${state.connectedFolderName}`);
    showNotice(`Connected folder: ${state.connectedFolderName}`);
    saveState();
    renderAll();
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    showNotice(`Folder connection failed: ${err.message}`, true);
  }
}

function saveConfigFromForm() {
  state.config.enabled = refs.cfgEnabled.checked;
  state.config.watchDir = refs.cfgWatchDir.value.trim() || DEFAULT_WATCH_DIR;
  state.config.mode = refs.cfgMode.value;
  state.config.primaryProvider = refs.cfgPrimary.value;
  state.config.fallbackProvider = refs.cfgFallback.value;
  state.config.scanIntervalMs = Math.max(3000, Number(refs.cfgInterval.value) || 15000);
  state.config.maxPerScan = Math.min(25, Math.max(1, Number(refs.cfgMaxPerScan.value) || 5));
  state.runtime.lastError = '';
  pushEvent('config', 'Saved auto-import settings');
  saveState();
  startOrStopTimer();
  renderAll();
  showNotice('Settings saved.');
}

function clearAllData() {
  if (!window.confirm('Reset all prototype records/config/events/chat?')) return;
  localStorage.removeItem(STORAGE_KEY);
  window.location.reload();
}

function bindEvents() {
  refs.saveConfigBtn.addEventListener('click', saveConfigFromForm);
  refs.importNowBtn.addEventListener('click', () => {
    importFromConnectedFolder().catch((err) => {
      showNotice(`Import failed: ${err.message}`, true);
    });
  });
  refs.connectFolderBtn.addEventListener('click', () => {
    connectFolder().catch((err) => {
      showNotice(`Connect folder failed: ${err.message}`, true);
    });
  });
  refs.demoDataBtn.addEventListener('click', loadDemoImports);
  refs.clearDataBtn.addEventListener('click', clearAllData);

  refs.dashboardSearch.addEventListener('input', (e) => {
    state.ui.search = e.target.value;
    saveState();
    renderDashboard();
  });
  refs.dashboardStatusFilter.addEventListener('change', (e) => {
    state.ui.statusFilter = e.target.value;
    saveState();
    renderDashboard();
  });
  refs.dashboardSourceFilter.addEventListener('change', (e) => {
    state.ui.sourceFilter = e.target.value;
    saveState();
    renderDashboard();
  });
  refs.dashboardRefreshBtn.addEventListener('click', renderAll);

  refs.openImportDrawerBtn.addEventListener('click', () => {
    state.chat.drawerOpen = !state.chat.drawerOpen;
    saveState();
    renderChat();
  });
  refs.importDrawerBackdrop.addEventListener('click', () => {
    state.chat.drawerOpen = false;
    saveState();
    renderChat();
  });
  refs.closeImportDrawerBtn.addEventListener('click', () => {
    state.chat.drawerOpen = false;
    saveState();
    renderChat();
  });
  refs.chatInput.addEventListener('input', (e) => {
    state.chat.draftText = e.target.value;
    saveState();
  });
  refs.chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  refs.chatSendBtn.addEventListener('click', sendChatMessage);
  refs.clearChatBtn.addEventListener('click', () => {
    state.chat.messages = [];
    state.chat.attachedIds = [];
    state.chat.draftText = '';
    saveState();
    renderChat();
  });

  window.addEventListener('hashchange', () => {
    const route = getRouteFromHash();
    setRoute(route);
    saveState();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.chat.drawerOpen) {
      state.chat.drawerOpen = false;
      saveState();
      renderChat();
    }
  });
}

function renderAll() {
  syncFormFromState();
  updateRuntimeUI();
  renderDashboard();
  renderEvents();
  renderChat();

  refs.dashboardSearch.value = state.ui.search || '';
  refs.dashboardStatusFilter.value = state.ui.statusFilter || '';
  refs.dashboardSourceFilter.value = state.ui.sourceFilter || '';
}

function initRefs() {
  refs.pageTitle = $('pageTitle');
  refs.pageSubtitle = $('pageSubtitle');
  refs.globalNotice = $('globalNotice');

  refs.chatView = $('chatView');
  refs.dashboardView = $('dashboardView');
  refs.settingsView = $('settingsView');
  refs.chatAutoImportPill = $('chatAutoImportPill');
  refs.chatToastHost = $('chatToastHost');
  refs.chatEvents = $('chatEvents');
  refs.chatMessageList = $('chatMessageList');
  refs.chatAttachmentTray = $('chatAttachmentTray');
  refs.chatInput = $('chatInput');
  refs.chatSendBtn = $('chatSendBtn');
  refs.clearChatBtn = $('clearChatBtn');
  refs.openImportDrawerBtn = $('openImportDrawerBtn');
  refs.closeImportDrawerBtn = $('closeImportDrawerBtn');
  refs.importDrawerBackdrop = $('importDrawerBackdrop');
  refs.importDrawer = $('importDrawer');
  refs.importDrawerList = $('importDrawerList');

  refs.statImported = $('statImported');
  refs.statFailed = $('statFailed');
  refs.statSkipped = $('statSkipped');
  refs.statRecords = $('statRecords');
  refs.dashboardCountLabel = $('dashboardCountLabel');
  refs.dashboardGrid = $('dashboardGrid');
  refs.dashboardSearch = $('dashboardSearch');
  refs.dashboardStatusFilter = $('dashboardStatusFilter');
  refs.dashboardSourceFilter = $('dashboardSourceFilter');
  refs.dashboardRefreshBtn = $('dashboardRefreshBtn');

  refs.watchStatusBadge = $('watchStatusBadge');
  refs.cfgEnabled = $('cfgEnabled');
  refs.cfgWatchDir = $('cfgWatchDir');
  refs.cfgMode = $('cfgMode');
  refs.cfgPrimary = $('cfgPrimary');
  refs.cfgFallback = $('cfgFallback');
  refs.cfgInterval = $('cfgInterval');
  refs.cfgMaxPerScan = $('cfgMaxPerScan');
  refs.connectFolderBtn = $('connectFolderBtn');
  refs.saveConfigBtn = $('saveConfigBtn');
  refs.importNowBtn = $('importNowBtn');
  refs.demoDataBtn = $('demoDataBtn');
  refs.clearDataBtn = $('clearDataBtn');
  refs.rtConnected = $('rtConnected');
  refs.rtLastScan = $('rtLastScan');
  refs.rtLastImport = $('rtLastImport');
  refs.rtLastFile = $('rtLastFile');

  refs.cardTemplate = $('cardTemplate');
}

function init() {
  initRefs();
  loadState();
  bindEvents();
  setRoute(getRouteFromHash());
  renderAll();
  startOrStopTimer();
}

init();
