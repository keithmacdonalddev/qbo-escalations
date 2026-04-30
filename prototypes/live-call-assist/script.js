const SOURCE_CONFIG = {
  customer: {
    key: 'customer',
    label: 'Customer',
    className: 'customer',
    meterId: 'customerMeter',
    levelId: 'customerLevel',
    selectId: 'customerDevice',
    playbackId: 'customerPlayback',
    playbackWrapId: 'customerPlaybackWrap',
    samples: [
      'I am getting error 103 when connecting my bank feed.',
      'It started yesterday after I re-entered the online banking credentials.',
      'The customer says the account is still not updating in QBO.',
      'Another person on the customer side says payroll is also affected.',
      'They need to know whether this is a bank issue or a QuickBooks issue.',
    ],
  },
  keith: {
    key: 'keith',
    label: 'Keith',
    className: 'keith',
    meterId: 'keithMeter',
    levelId: 'keithLevel',
    selectId: 'keithDevice',
    playbackId: 'keithPlayback',
    playbackWrapId: 'keithPlaybackWrap',
    samples: [
      'I am checking the bank connection status now.',
      'Can you confirm whether this happens on one account or all accounts?',
      'I am going to verify the exact error code before escalating.',
      'Do not disconnect the bank feed yet until we confirm the current state.',
      'I need the bank name, last successful update, and affected company file.',
    ],
  },
};

const els = {
  sessionState: document.getElementById('sessionState'),
  sessionClock: document.getElementById('sessionClock'),
  permissionBtn: document.getElementById('permissionBtn'),
  refreshDevicesBtn: document.getElementById('refreshDevicesBtn'),
  recordTestBtn: document.getElementById('recordTestBtn'),
  startCallBtn: document.getElementById('startCallBtn'),
  pauseCallBtn: document.getElementById('pauseCallBtn'),
  stopCallBtn: document.getElementById('stopCallBtn'),
  addSampleBtn: document.getElementById('addSampleBtn'),
  clearTranscriptBtn: document.getElementById('clearTranscriptBtn'),
  deleteSessionBtn: document.getElementById('deleteSessionBtn'),
  providerSelect: document.getElementById('providerSelect'),
  manualSegmentForm: document.getElementById('manualSegmentForm'),
  manualSource: document.getElementById('manualSource'),
  manualText: document.getElementById('manualText'),
  partialRow: document.getElementById('partialRow'),
  timeline: document.getElementById('timeline'),
  segmentCount: document.getElementById('segmentCount'),
  overlapCount: document.getElementById('overlapCount'),
  chatLog: document.getElementById('chatLog'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),
  chatSendBtn: document.getElementById('chatSendBtn'),
  agentContextState: document.getElementById('agentContextState'),
  rollingSummary: document.getElementById('rollingSummary'),
  partialTemplate: document.getElementById('partialTemplate'),
  segmentTemplate: document.getElementById('segmentTemplate'),
};

const dom = Object.fromEntries(Object.entries(SOURCE_CONFIG).map(([key, config]) => ([
  key,
  {
    select: document.getElementById(config.selectId),
    meter: document.getElementById(config.meterId),
    level: document.getElementById(config.levelId),
    playback: document.getElementById(config.playbackId),
    playbackWrap: document.getElementById(config.playbackWrapId),
    card: document.querySelector(`[data-source-card="${key}"]`),
  },
])));

const state = {
  hasPermission: false,
  status: 'idle',
  startedAt: 0,
  elapsedBeforePause: 0,
  pauseStartedAt: 0,
  seq: 0,
  selectedProvider: 'mock',
  streams: {
    customer: null,
    keith: null,
  },
  audioContext: null,
  analyzers: {
    customer: null,
    keith: null,
  },
  levels: {
    customer: 0,
    keith: 0,
  },
  partials: {},
  segments: [],
  chatBusy: false,
  deviceProfiles: {},
};

let meterFrame = 0;
let clockTimer = 0;
let mockTimer = 0;
let sampleCursor = {
  customer: 0,
  keith: 0,
};

function nowMs() {
  if (state.status === 'idle') return state.elapsedBeforePause;
  if (state.status === 'paused') return state.elapsedBeforePause;
  return state.elapsedBeforePause + Math.max(0, Date.now() - state.startedAt);
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function setStatus(status) {
  state.status = status;
  els.sessionState.className = `state-pill ${status === 'recording' ? 'live' : status}`;
  els.sessionState.textContent = status === 'recording'
    ? 'Transcribing'
    : status.charAt(0).toUpperCase() + status.slice(1);
  updateButtons();
}

function updateButtons() {
  const hasInputs = Boolean(state.hasPermission);
  const isRecording = state.status === 'recording';
  const isPaused = state.status === 'paused';
  els.startCallBtn.disabled = !hasInputs || isRecording;
  els.pauseCallBtn.disabled = !isRecording && !isPaused;
  els.pauseCallBtn.textContent = isPaused ? 'Resume' : 'Pause';
  els.stopCallBtn.disabled = !isRecording && !isPaused;
  els.recordTestBtn.disabled = !hasInputs || isRecording;
}

function updateClock() {
  els.sessionClock.textContent = formatTime(nowMs());
}

function startClock() {
  stopClock();
  clockTimer = window.setInterval(updateClock, 250);
  updateClock();
}

function stopClock() {
  if (!clockTimer) return;
  window.clearInterval(clockTimer);
  clockTimer = 0;
}

function stopStream(source) {
  const stream = state.streams[source];
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
  state.streams[source] = null;
  state.analyzers[source] = null;
  dom[source].card.classList.remove('active');
}

function stopAllStreams() {
  stopStream('customer');
  stopStream('keith');
}

function getSelectedDeviceId(source) {
  return dom[source].select.value || '';
}

async function requestPermission() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    window.alert('This browser does not expose microphone capture. Open this prototype on http://localhost or https.');
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  for (const track of stream.getTracks()) track.stop();
  state.hasPermission = true;
  await refreshDevices();
  updateButtons();
}

async function refreshDevices() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
    return;
  }

  const previous = {
    customer: dom.customer.select.value,
    keith: dom.keith.select.value,
  };

  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioInputs = devices.filter((device) => device.kind === 'audioinput');

  for (const source of Object.keys(SOURCE_CONFIG)) {
    const select = dom[source].select;
    select.innerHTML = '';
    if (audioInputs.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No audio inputs found';
      select.appendChild(option);
      continue;
    }

    audioInputs.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Audio input ${index + 1}`;
      select.appendChild(option);
    });

    const remembered = state.deviceProfiles[source];
    const target = previous[source] || remembered || '';
    if (target && audioInputs.some((device) => device.deviceId === target)) {
      select.value = target;
    } else if (source === 'keith' && audioInputs.length > 1) {
      select.selectedIndex = 1;
    }
  }
}

function createAudioContext() {
  if (!state.audioContext) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContextCtor();
  }
  return state.audioContext;
}

async function openStream(source) {
  stopStream(source);

  const deviceId = getSelectedDeviceId(source);
  const constraints = {
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const audioContext = createAudioContext();
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  const sourceNode = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.72;
  sourceNode.connect(analyser);

  state.streams[source] = stream;
  state.analyzers[source] = {
    node: analyser,
    data: new Uint8Array(analyser.fftSize),
  };
  state.deviceProfiles[source] = deviceId;
  dom[source].card.classList.add('active');
}

async function ensureStreams() {
  if (!state.hasPermission) {
    await requestPermission();
  }
  await openStream('customer');
  await openStream('keith');
}

function readLevel(source) {
  const analyser = state.analyzers[source];
  if (!analyser) return 0;
  analyser.node.getByteTimeDomainData(analyser.data);
  let sum = 0;
  for (let i = 0; i < analyser.data.length; i += 1) {
    const centered = (analyser.data[i] - 128) / 128;
    sum += centered * centered;
  }
  const rms = Math.sqrt(sum / analyser.data.length);
  return Math.min(100, Math.round(rms * 260));
}

function updateMeters() {
  for (const source of Object.keys(SOURCE_CONFIG)) {
    const level = readLevel(source);
    state.levels[source] = level;
    dom[source].meter.style.width = `${level}%`;
    dom[source].level.textContent = `${level}%`;
  }
  meterFrame = window.requestAnimationFrame(updateMeters);
}

function startMeters() {
  stopMeters();
  meterFrame = window.requestAnimationFrame(updateMeters);
}

function stopMeters() {
  if (!meterFrame) return;
  window.cancelAnimationFrame(meterFrame);
  meterFrame = 0;
}

function getNextSample(source) {
  const samples = SOURCE_CONFIG[source].samples;
  const index = sampleCursor[source] % samples.length;
  sampleCursor[source] += 1;
  return samples[index];
}

function createPartial(source) {
  const startedAt = nowMs();
  state.partials[source] = {
    id: `partial-${source}`,
    source,
    speakerLabel: SOURCE_CONFIG[source].label,
    startedAt,
    updatedAt: startedAt,
    silenceMs: 0,
    baseText: getNextSample(source),
    text: '',
  };
}

function updatePartial(source, active) {
  const partial = state.partials[source];
  if (!partial) return;

  const elapsed = Math.max(250, nowMs() - partial.startedAt);
  const revealRatio = Math.min(1, elapsed / 2500);
  const targetLength = Math.max(12, Math.ceil(partial.baseText.length * revealRatio));
  partial.text = partial.baseText.slice(0, targetLength);
  partial.updatedAt = nowMs();
  partial.silenceMs = active ? 0 : partial.silenceMs + 200;
}

function finalizePartial(source) {
  const partial = state.partials[source];
  if (!partial) return;
  const endMs = Math.max(partial.startedAt + 600, nowMs());
  addSegment({
    source,
    speakerLabel: partial.speakerLabel,
    text: partial.baseText,
    startMs: partial.startedAt,
    endMs,
    confidence: 0.82,
    generated: true,
  });
  delete state.partials[source];
  renderPartials();
}

function tickMockTranscriber() {
  if (state.status !== 'recording') return;

  for (const source of Object.keys(SOURCE_CONFIG)) {
    const active = state.levels[source] >= 5;
    if (active && !state.partials[source]) {
      createPartial(source);
    }

    if (state.partials[source]) {
      updatePartial(source, active);
      if (!active && state.partials[source].silenceMs >= 900) {
        finalizePartial(source);
      }
    }
  }

  renderPartials();
}

function startMockTranscriber() {
  stopMockTranscriber();
  mockTimer = window.setInterval(tickMockTranscriber, 200);
}

function stopMockTranscriber({ flush = false } = {}) {
  if (mockTimer) {
    window.clearInterval(mockTimer);
    mockTimer = 0;
  }
  if (flush) {
    for (const source of Object.keys(state.partials)) {
      finalizePartial(source);
    }
  }
}

function normalizeSource(source) {
  if (source === 'customer-2') return 'customer';
  if (source === 'keith') return 'keith';
  if (source === 'customer') return 'customer';
  return 'unknown';
}

function speakerForManualSource(source) {
  switch (source) {
    case 'customer-2':
      return 'Customer side - Speaker 2';
    case 'keith':
      return 'Keith';
    case 'unknown':
      return 'Unknown';
    case 'customer':
    default:
      return 'Customer';
  }
}

function addSegment(segment) {
  const next = {
    id: `seg-${Date.now().toString(36)}-${state.seq += 1}`,
    seq: state.seq,
    source: normalizeSource(segment.source),
    speakerLabel: segment.speakerLabel || speakerForManualSource(segment.source),
    text: String(segment.text || '').trim(),
    startMs: Math.max(0, Math.round(segment.startMs || nowMs())),
    endMs: Math.max(0, Math.round(segment.endMs || nowMs() + 1000)),
    confidence: Number.isFinite(segment.confidence) ? segment.confidence : null,
    generated: Boolean(segment.generated),
  };
  if (!next.text) return null;
  if (next.endMs <= next.startMs) next.endMs = next.startMs + 900;

  state.segments.push(next);
  state.segments.sort((a, b) => a.startMs - b.startMs || a.seq - b.seq);
  renderTimeline();
  updateAgentContext();
  return next;
}

function getOverlappedIds() {
  const overlapped = new Set();
  for (let i = 0; i < state.segments.length; i += 1) {
    for (let j = i + 1; j < state.segments.length; j += 1) {
      const a = state.segments[i];
      const b = state.segments[j];
      if (b.startMs >= a.endMs) break;
      if (a.startMs < b.endMs && b.startMs < a.endMs) {
        overlapped.add(a.id);
        overlapped.add(b.id);
      }
    }
  }
  return overlapped;
}

function renderPartials() {
  els.partialRow.innerHTML = '';
  for (const partial of Object.values(state.partials)) {
    const node = els.partialTemplate.content.firstElementChild.cloneNode(true);
    node.classList.add(partial.source);
    node.querySelector('.partial-speaker').textContent = `${partial.speakerLabel} live`;
    node.querySelector('p').textContent = partial.text || 'Listening...';
    els.partialRow.appendChild(node);
  }
}

function renderTimeline() {
  const overlapped = getOverlappedIds();
  els.segmentCount.textContent = `${state.segments.length} segment${state.segments.length === 1 ? '' : 's'}`;
  els.overlapCount.textContent = `${overlapped.size} overlap${overlapped.size === 1 ? '' : 's'}`;

  if (state.segments.length === 0) {
    els.timeline.innerHTML = [
      '<div class="empty-state">',
      '<h3>No transcript yet</h3>',
      '<p>Start a call, record a test, or add sample turns to test the merged conversation flow.</p>',
      '</div>',
    ].join('');
    return;
  }

  els.timeline.innerHTML = '';
  for (const segment of state.segments) {
    const node = els.segmentTemplate.content.firstElementChild.cloneNode(true);
    const isOverlap = overlapped.has(segment.id);
    node.dataset.segmentId = segment.id;
    node.classList.add(segment.source);
    if (isOverlap) node.classList.add('overlap');
    node.querySelector('.speaker').textContent = segment.speakerLabel;
    node.querySelector('.time-range').textContent = `${formatTime(segment.startMs)} - ${formatTime(segment.endMs)}`;
    node.querySelector('.segment-text').textContent = segment.text;
    node.querySelector('.overlap-flag').hidden = !isOverlap;
    els.timeline.appendChild(node);
  }
  els.timeline.scrollTop = els.timeline.scrollHeight;
}

function updateAgentContext() {
  const count = state.segments.length;
  els.agentContextState.textContent = `${count} line${count === 1 ? '' : 's'}`;
  els.rollingSummary.textContent = buildRollingSummary();
}

function getTranscriptText(limit = Infinity) {
  const source = Number.isFinite(limit) ? state.segments.slice(-limit) : state.segments;
  return source
    .map((segment) => `${formatTime(segment.startMs)} ${segment.speakerLabel}: ${segment.text}`)
    .join('\n');
}

function buildRollingSummary() {
  if (state.segments.length === 0) return 'No call context yet.';

  const allText = state.segments.map((segment) => segment.text).join(' ').toLowerCase();
  const recent = state.segments.slice(-6);
  const facts = [];
  const missing = [];

  if (allText.includes('error')) facts.push('An error code or error message has been mentioned.');
  if (allText.includes('bank')) facts.push('The issue appears to involve banking or bank feeds.');
  if (allText.includes('payroll')) facts.push('Payroll may be affected and should be verified carefully.');
  if (allText.includes('yesterday') || allText.includes('started')) facts.push('The timeline of when it started has begun to surface.');

  if (!allText.includes('company')) missing.push('company/account identifier');
  if (!allText.includes('bank name')) missing.push('bank name');
  if (!allText.includes('browser')) missing.push('browser/device details');
  if (!allText.includes('last successful')) missing.push('last successful update/time');

  return [
    `Recent flow:\n${recent.map((segment) => `- ${segment.speakerLabel}: ${segment.text}`).join('\n')}`,
    '',
    `Detected facts: ${facts.length ? facts.join(' ') : 'Not enough detail yet.'}`,
    `Details to capture: ${missing.length ? missing.join(', ') : 'No obvious missing basics from the current transcript.'}`,
  ].join('\n');
}

function appendChatMessage(role, text) {
  const node = document.createElement('article');
  node.className = `chat-message ${role}`;
  const label = document.createElement('span');
  label.className = 'chat-role';
  label.textContent = role === 'user' ? 'You' : 'Agent';
  const body = document.createElement('p');
  body.textContent = text;
  node.append(label, body);
  els.chatLog.appendChild(node);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function buildAgentResponse(prompt) {
  const transcript = getTranscriptText(20);
  const normalized = prompt.toLowerCase();
  const segmentCount = state.segments.length;
  const contextLine = segmentCount
    ? `I have ${segmentCount} transcript line${segmentCount === 1 ? '' : 's'} in this call session.`
    : 'I do not have transcript context yet.';

  if (normalized.includes('draft')) {
    return [
      contextLine,
      '',
      'Draft escalation:',
      '- Customer issue: Summarize the exact symptom from the transcript.',
      '- Product area: QBO banking/bank feed unless the call says otherwise.',
      '- Impact: Capture whether one account, all accounts, payroll, or multiple users are affected.',
      '- Evidence: Error code, bank name, last successful update, troubleshooting already attempted.',
      '- Next owner question: Confirm whether this is bank-side authentication, QBO connection status, or a broader service issue.',
    ].join('\n');
  }

  if (normalized.includes('next') || normalized.includes('verify')) {
    return [
      contextLine,
      '',
      'Next best checks:',
      '1. Confirm exact error text/code and when it first appeared.',
      '2. Ask whether one bank account or all bank accounts are affected.',
      '3. Capture bank name and last successful update time.',
      '4. Verify what the customer already tried without promising a fix.',
      '5. If payroll is mentioned, separate payroll impact from bank-feed symptoms before escalating.',
    ].join('\n');
  }

  if (normalized.includes('summary') || normalized.includes('summarize')) {
    return [
      contextLine,
      '',
      'Summary so far:',
      buildRollingSummary(),
    ].join('\n');
  }

  return [
    contextLine,
    '',
    'Private guidance:',
    'Use the current transcript as the source of truth. Verify exact customer facts in QBO before promising timing, entitlement, credits, refunds, or account-state conclusions.',
    '',
    transcript ? `Recent transcript:\n${transcript}` : 'No recent transcript lines are available yet.',
  ].join('\n');
}

function sendAgentPrompt(prompt) {
  const text = String(prompt || '').trim();
  if (!text || state.chatBusy) return;

  appendChatMessage('user', text);
  els.chatInput.value = '';
  state.chatBusy = true;

  window.setTimeout(() => {
    appendChatMessage('agent', buildAgentResponse(text));
    state.chatBusy = false;
  }, 450);
}

async function startCall() {
  try {
    await ensureStreams();
  } catch (err) {
    window.alert(`Could not open both audio inputs: ${err.message || err}`);
    return;
  }

  if (getSelectedDeviceId('customer') && getSelectedDeviceId('customer') === getSelectedDeviceId('keith')) {
    window.alert('Both sides are using the same input device. That is okay for a quick test, but real calls need separate inputs for clean labels.');
  }

  state.startedAt = Date.now();
  state.pauseStartedAt = 0;
  setStatus('recording');
  startMeters();
  startClock();
  startMockTranscriber();
}

function pauseOrResumeCall() {
  if (state.status === 'recording') {
    state.elapsedBeforePause = nowMs();
    state.pauseStartedAt = Date.now();
    setStatus('paused');
    stopMockTranscriber({ flush: true });
    updateClock();
    return;
  }

  if (state.status === 'paused') {
    state.startedAt = Date.now();
    state.pauseStartedAt = 0;
    setStatus('recording');
    startMockTranscriber();
  }
}

function stopCall() {
  state.elapsedBeforePause = nowMs();
  stopMockTranscriber({ flush: true });
  stopClock();
  stopAllStreams();
  setStatus('idle');
  startMeters();
  updateClock();
}

function clearTranscript() {
  state.segments = [];
  state.partials = {};
  renderPartials();
  renderTimeline();
  updateAgentContext();
}

function deleteSession() {
  stopCall();
  state.elapsedBeforePause = 0;
  clearTranscript();
  els.chatLog.innerHTML = '';
  appendChatMessage('agent', 'Session cleared. Ask for help any time after you start a new call.');
  updateClock();
}

function addSampleTurn() {
  const base = nowMs() || 1000;
  addSegment({
    source: 'customer',
    speakerLabel: 'Customer',
    text: getNextSample('customer'),
    startMs: base,
    endMs: base + 2800,
    generated: true,
  });
  addSegment({
    source: 'keith',
    speakerLabel: 'Keith',
    text: getNextSample('keith'),
    startMs: base + 2100,
    endMs: base + 4700,
    generated: true,
  });
}

function recordOneStream(source, durationMs) {
  return new Promise((resolve, reject) => {
    const stream = state.streams[source];
    if (!stream) {
      reject(new Error(`No ${SOURCE_CONFIG[source].label} stream is open`));
      return;
    }

    if (typeof MediaRecorder !== 'function') {
      reject(new Error('MediaRecorder is not available in this browser'));
      return;
    }

    const chunks = [];
    const recorder = new MediaRecorder(stream);
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => {
      resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
    });
    recorder.addEventListener('error', () => reject(new Error(`Recording failed for ${source}`)));
    recorder.start(250);
    window.setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, durationMs);
  });
}

async function recordTest() {
  els.recordTestBtn.disabled = true;
  els.recordTestBtn.textContent = 'Recording...';
  try {
    await ensureStreams();
    startMeters();
    const durationMs = 8000;
    const [customerBlob, keithBlob] = await Promise.all([
      recordOneStream('customer', durationMs),
      recordOneStream('keith', durationMs),
    ]);

    setPlayback('customer', customerBlob);
    setPlayback('keith', keithBlob);
    addSegment({
      source: 'unknown',
      speakerLabel: 'System',
      text: 'Local two-input test clips were recorded. Play them back in the setup panel before using real calls.',
      startMs: nowMs(),
      endMs: nowMs() + 1200,
      generated: true,
    });
  } catch (err) {
    window.alert(`Test recording failed: ${err.message || err}`);
  } finally {
    els.recordTestBtn.textContent = 'Record Test';
    updateButtons();
  }
}

function setPlayback(source, blob) {
  const url = URL.createObjectURL(blob);
  dom[source].playback.src = url;
  dom[source].playbackWrap.hidden = false;
}

function handleTimelineClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const segmentNode = event.target.closest('.segment');
  const segment = state.segments.find((item) => item.id === segmentNode?.dataset.segmentId);
  if (!segment) return;

  const action = button.dataset.action;
  if (action === 'delete') {
    state.segments = state.segments.filter((item) => item.id !== segment.id);
  } else if (action === 'edit') {
    const next = window.prompt('Edit transcript text', segment.text);
    if (next !== null && next.trim()) segment.text = next.trim();
  } else if (action === 'rename') {
    const next = window.prompt('Speaker label', segment.speakerLabel);
    if (next !== null && next.trim()) segment.speakerLabel = next.trim();
  }

  renderTimeline();
  updateAgentContext();
}

function wireEvents() {
  els.permissionBtn.addEventListener('click', () => requestPermission().catch((err) => {
    window.alert(`Microphone permission failed: ${err.message || err}`);
  }));

  els.refreshDevicesBtn.addEventListener('click', () => refreshDevices().catch((err) => {
    window.alert(`Device refresh failed: ${err.message || err}`);
  }));

  els.startCallBtn.addEventListener('click', startCall);
  els.pauseCallBtn.addEventListener('click', pauseOrResumeCall);
  els.stopCallBtn.addEventListener('click', stopCall);
  els.recordTestBtn.addEventListener('click', recordTest);
  els.addSampleBtn.addEventListener('click', addSampleTurn);
  els.clearTranscriptBtn.addEventListener('click', clearTranscript);
  els.deleteSessionBtn.addEventListener('click', deleteSession);

  els.manualSegmentForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = els.manualText.value.trim();
    if (!text) return;
    const startMs = nowMs();
    addSegment({
      source: els.manualSource.value,
      speakerLabel: speakerForManualSource(els.manualSource.value),
      text,
      startMs,
      endMs: startMs + Math.max(1200, Math.min(6000, text.length * 55)),
      generated: false,
    });
    els.manualText.value = '';
  });

  els.timeline.addEventListener('click', handleTimelineClick);

  els.chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    sendAgentPrompt(els.chatInput.value);
  });

  els.chatSendBtn.addEventListener('click', (event) => {
    event.preventDefault();
    sendAgentPrompt(els.chatInput.value);
  });

  document.querySelectorAll('[data-agent-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.agentAction;
      if (action === 'summary') sendAgentPrompt('Summarize the call so far.');
      if (action === 'next') sendAgentPrompt('What should I verify next?');
      if (action === 'draft') sendAgentPrompt('Draft an escalation from the current call history.');
    });
  });

  for (const source of Object.keys(SOURCE_CONFIG)) {
    dom[source].select.addEventListener('change', () => {
      state.deviceProfiles[source] = getSelectedDeviceId(source);
    });
  }
}

function init() {
  wireEvents();
  refreshDevices().catch(() => {});
  renderTimeline();
  updateAgentContext();
  updateButtons();
  updateClock();
}

init();
