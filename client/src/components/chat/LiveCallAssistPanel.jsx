import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildLiveCallAssistWebSocketUrl, getLiveCallAssistStatus } from '../../api/liveCallAssistApi.js';

const SOURCE_CONFIG = Object.freeze([
  {
    id: 'customer',
    label: 'Customer',
    inputLabel: 'Customer input from call PC splitter',
    inputHelp: 'Select the QBO PC input receiving the split call audio feed.',
  },
  {
    id: 'agent',
    label: 'Agent',
    inputLabel: 'Agent microphone',
    inputHelp: 'Select the Amazon mic or headset mic used by the agent.',
  },
]);

const CAPTURE_MODES = Object.freeze([
  { value: 'agent', label: 'Agent only' },
  { value: 'both', label: 'Agent mic + Customer input' },
]);

const AUDIO_PRESETS = Object.freeze([
  { value: 'headset', label: 'Headset mic' },
  { value: 'enhanced', label: 'Room mic cleanup' },
]);

const LIVE_CALL_KEYTERMS = Object.freeze([
  'QuickBooks Online',
  'QBO',
  'Intuit',
  'COID',
  'INV',
  'payroll',
  'payroll tax forms',
  'W-2',
  'W-3',
  '1099',
  '1099-NEC',
  '1099-MISC',
  'tax form',
  'direct deposit',
  'bank feed',
  'reconciliation',
  'company file',
  'subscription',
  'merchant services',
  'QuickBooks Payments',
]);

const OUT_SAMPLE_RATE = 16000;
const CHUNK_SAMPLE_COUNT = 3200;
const LEVEL_DECAY_MS = 140;
const HEARD_LEVEL_THRESHOLD = 0.02;
const CLIPPING_PEAK_THRESHOLD = 0.98;

function safeText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function formatElapsed(ms) {
  const safeMs = Number.isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0;
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function buildTranscriptText(segments) {
  return segments
    .map((segment) => `[${formatElapsed(segment.elapsedMs)}] ${segment.label}: ${segment.text}`)
    .join('\n');
}

function buildMainChatPayload(segments) {
  const transcriptText = buildTranscriptText(segments);
  return [
    'Live call transcript captured from the integrated call assistant.',
    '',
    transcriptText,
    '',
    'Use this transcript as the source of truth for the current QBO support interaction. Identify the customer goal, blocker, attempted troubleshooting, likely escalation category/severity, and the next best response.',
  ].join('\n');
}

function floatTo16BitPcmSample(value) {
  const clamped = Math.max(-1, Math.min(1, value));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

function downsampleTo16Khz(input, inputSampleRate) {
  if (!input || input.length === 0) return [];
  if (inputSampleRate === OUT_SAMPLE_RATE) {
    return Array.from(input, floatTo16BitPcmSample);
  }

  const ratio = inputSampleRate / OUT_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += input[j];
      count += 1;
    }
    output[i] = floatTo16BitPcmSample(count > 0 ? sum / count : 0);
  }
  return output;
}

function encodePcm16Base64(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(i * 2, samples[i], true);
  }

  let binary = '';
  const stride = 0x8000;
  for (let i = 0; i < bytes.length; i += stride) {
    const chunk = bytes.subarray(i, i + stride);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
}

function getActiveSources(captureMode) {
  if (captureMode === 'both') return SOURCE_CONFIG;
  return SOURCE_CONFIG.filter((source) => source.id === 'agent');
}

function getAudioConstraints(deviceId, audioPreset = 'headset') {
  const enhanced = audioPreset === 'enhanced';
  return {
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1,
      echoCancellation: enhanced,
      noiseSuppression: enhanced,
      autoGainControl: enhanced,
    },
  };
}

function createDefaultSelections(devices) {
  const first = devices[0]?.deviceId || '';
  const second = devices[1]?.deviceId || first;
  return {
    customer: first,
    agent: second,
  };
}

function normalizeDevice(device, index) {
  return {
    deviceId: device.deviceId,
    label: device.label || `Audio input ${index + 1}`,
  };
}

function getDeviceLabel(devices, deviceId) {
  return devices.find((device) => device.deviceId === deviceId)?.label || '';
}

export default function LiveCallAssistPanel({
  open,
  disabled = false,
  onClose,
  onSendTranscript,
  onInsertTranscript,
}) {
  const [status, setStatus] = useState(null);
  const [devices, setDevices] = useState([]);
  const [selectedDevices, setSelectedDevices] = useState({});
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [socketState, setSocketState] = useState('closed');
  const [error, setError] = useState('');
  const [partials, setPartials] = useState({});
  const [levels, setLevels] = useState({});
  const [sourceStates, setSourceStates] = useState({});
  const [sourceDiagnostics, setSourceDiagnostics] = useState({});
  const [segments, setSegments] = useState([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [captureMode, setCaptureMode] = useState('agent');
  const [audioPreset, setAudioPreset] = useState('headset');

  const wsRef = useRef(null);
  const capturesRef = useRef(new Map());
  const pendingSamplesRef = useRef(new Map());
  const startedAtRef = useRef(0);
  const elapsedTimerRef = useRef(0);
  const levelTimersRef = useRef(new Map());
  const diagnosticsUpdateAtRef = useRef(new Map());

  const transcriptText = useMemo(() => buildTranscriptText(segments), [segments]);
  const activeSources = useMemo(() => getActiveSources(captureMode), [captureMode]);
  const hasTranscript = transcriptText.trim().length > 0;
  const configured = status?.configured !== false;
  const canStart = open && !disabled && !active && !starting && configured;
  const sourceSummaries = activeSources.map((source) => ({
    ...source,
    state: sourceStates[source.id] || 'idle',
    level: Math.round((levels[source.id] || 0) * 100),
    partial: safeText(partials[source.id]),
  }));
  const activePartials = sourceSummaries.filter((source) => source.partial);
  const latestPartial = sourceSummaries.find((source) => source.partial);
  const latestSegment = segments.length > 0 ? segments[segments.length - 1] : null;
  const hasLiveTranscript = hasTranscript || activePartials.length > 0;
  const latestLine = latestPartial
    ? {
      label: latestPartial.label,
      text: latestPartial.partial,
      mode: 'partial',
    }
    : latestSegment
      ? {
        label: latestSegment.label,
        text: latestSegment.text,
        mode: formatElapsed(latestSegment.elapsedMs),
      }
      : null;
  const statusLabel = active
    ? `Recording ${formatElapsed(elapsedMs)}`
    : starting
      ? 'Starting'
      : socketState === 'connecting'
        ? 'Connecting'
        : 'Ready';
  const captureModeLabel = CAPTURE_MODES.find((mode) => mode.value === captureMode)?.label || 'Agent only';
  const customerDiagnostics = sourceDiagnostics.customer || {};
  const agentDeviceId = selectedDevices.agent || '';
  const customerDeviceId = selectedDevices.customer || '';
  const agentDeviceLabel = getDeviceLabel(devices, agentDeviceId);
  const customerDeviceLabel = getDeviceLabel(devices, customerDeviceId);
  const sameInputSelected = captureMode === 'both'
    && Boolean(agentDeviceId)
    && Boolean(customerDeviceId)
    && agentDeviceId === customerDeviceId;
  const nowMs = Date.now();
  const customerHeardRecently = Boolean(customerDiagnostics.lastHeardAt)
    && nowMs - customerDiagnostics.lastHeardAt < 3_000;
  const customerClippingRecently = Boolean(customerDiagnostics.clippingAt)
    && nowMs - customerDiagnostics.clippingAt < 7_000;
  const customerSilent = captureMode === 'both'
    && active
    && elapsedMs > 4_000
    && !customerHeardRecently;
  const customerInputChecks = [
    {
      key: 'customer-selected',
      tone: customerDeviceId ? 'ok' : 'pending',
      label: 'Customer input',
      text: customerDeviceId
        ? customerDeviceLabel || 'Input selected'
        : 'Select the QBO PC input receiving the split call audio.',
    },
    {
      key: 'separate-inputs',
      tone: sameInputSelected ? 'bad' : agentDeviceId && customerDeviceId ? 'ok' : 'pending',
      label: 'Channel separation',
      text: sameInputSelected
        ? 'Customer and Agent are using the same input. Choose separate devices.'
        : 'Customer input and Agent mic should be different devices.',
    },
    {
      key: 'customer-signal',
      tone: customerSilent ? 'bad' : customerHeardRecently ? 'ok' : 'pending',
      label: 'Customer signal',
      text: active
        ? customerHeardRecently
          ? 'Customer audio detected on the splitter input.'
          : 'Play audio from the call PC; the Customer meter should move.'
        : 'After hardware arrives, start recording and play call PC audio.',
    },
    {
      key: 'customer-clipping',
      tone: customerClippingRecently ? 'bad' : active && customerHeardRecently ? 'ok' : 'pending',
      label: 'Clipping',
      text: customerClippingRecently
        ? 'Input is too hot. Lower the call PC volume or input gain.'
        : 'Keep the Customer meter moving without slamming full.',
    },
  ];

  const refreshDevices = useCallback(async ({ requestPermission = false } = {}) => {
    if (!navigator?.mediaDevices?.enumerateDevices) {
      setError('This browser does not expose audio input devices.');
      return [];
    }

    let permissionStream = null;
    try {
      if (requestPermission) {
        permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const inputs = allDevices
        .filter((device) => device.kind === 'audioinput')
        .map(normalizeDevice);
      setDevices(inputs);
      setSelectedDevices((prev) => ({
        ...createDefaultSelections(inputs),
        ...Object.fromEntries(Object.entries(prev).filter(([, value]) => inputs.some((device) => device.deviceId === value))),
      }));
      return inputs;
    } catch (err) {
      setError(err?.message || 'Microphone permission failed.');
      return [];
    } finally {
      if (permissionStream) {
        for (const track of permissionStream.getTracks()) {
          track.stop();
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getLiveCallAssistStatus()
      .then((nextStatus) => {
        if (!cancelled) setStatus(nextStatus);
      })
      .catch((err) => {
        if (!cancelled) {
          setStatus({ configured: false });
          setError(err?.message || 'Live Call Assist status check failed.');
        }
      });
    refreshDevices({ requestPermission: false });
    return () => {
      cancelled = true;
    };
  }, [open, refreshDevices]);

  useEffect(() => {
    if (!open && active) {
      stopSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const clearLevelTimer = useCallback((sourceId) => {
    const timer = levelTimersRef.current.get(sourceId);
    if (timer) {
      window.clearTimeout(timer);
      levelTimersRef.current.delete(sourceId);
    }
  }, []);

  const setSourceLevel = useCallback((sourceId, level) => {
    clearLevelTimer(sourceId);
    setLevels((prev) => ({ ...prev, [sourceId]: level }));
    const timer = window.setTimeout(() => {
      setLevels((prev) => ({ ...prev, [sourceId]: 0 }));
      levelTimersRef.current.delete(sourceId);
    }, LEVEL_DECAY_MS);
    levelTimersRef.current.set(sourceId, timer);
  }, [clearLevelTimer]);

  const updateSourceDiagnostics = useCallback((sourceId, level, peak) => {
    const now = Date.now();
    const isClipping = peak >= CLIPPING_PEAK_THRESHOLD;
    const lastUpdatedAt = diagnosticsUpdateAtRef.current.get(sourceId) || 0;
    if (!isClipping && now - lastUpdatedAt < 250) return;
    diagnosticsUpdateAtRef.current.set(sourceId, now);

    setSourceDiagnostics((prev) => {
      const current = prev[sourceId] || {};
      return {
        ...prev,
        [sourceId]: {
          ...current,
          level,
          peak,
          lastUpdatedAt: now,
          lastHeardAt: level >= HEARD_LEVEL_THRESHOLD ? now : current.lastHeardAt || 0,
          clippingAt: isClipping ? now : current.clippingAt || 0,
          clipCount: (current.clipCount || 0) + (isClipping ? 1 : 0),
        },
      };
    });
  }, []);

  const sendPcmChunk = useCallback((sourceId, samples) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || samples.length === 0) return;
    ws.send(JSON.stringify({
      type: 'audio',
      sourceId,
      sampleRate: OUT_SAMPLE_RATE,
      audioBase64: encodePcm16Base64(samples),
    }));
  }, []);

  const appendSamples = useCallback((sourceId, samples) => {
    if (!samples.length) return;
    const pending = pendingSamplesRef.current.get(sourceId) || [];
    pending.push(...samples);
    while (pending.length >= CHUNK_SAMPLE_COUNT) {
      const chunk = pending.splice(0, CHUNK_SAMPLE_COUNT);
      sendPcmChunk(sourceId, chunk);
    }
    pendingSamplesRef.current.set(sourceId, pending);
  }, [sendPcmChunk]);

  const flushPendingSamples = useCallback((sourceId, { commit = false } = {}) => {
    const ws = wsRef.current;
    const pending = pendingSamplesRef.current.get(sourceId) || [];
    if (pending.length > 0) {
      sendPcmChunk(sourceId, pending.splice(0));
    }
    pendingSamplesRef.current.set(sourceId, []);
    if (commit && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'commit', sourceId }));
    }
  }, [sendPcmChunk]);

  const stopCapture = useCallback((sourceId) => {
    const capture = capturesRef.current.get(sourceId);
    if (!capture) return;
    try { capture.processor?.disconnect(); } catch {}
    try { capture.source?.disconnect(); } catch {}
    try { capture.muteGain?.disconnect(); } catch {}
    try { capture.stream?.getTracks()?.forEach((track) => track.stop()); } catch {}
    try { capture.audioContext?.close(); } catch {}
    capturesRef.current.delete(sourceId);
    pendingSamplesRef.current.delete(sourceId);
    diagnosticsUpdateAtRef.current.delete(sourceId);
    clearLevelTimer(sourceId);
  }, [clearLevelTimer]);

  const stopAllCaptures = useCallback(() => {
    for (const sourceId of SOURCE_CONFIG.map((source) => source.id)) {
      flushPendingSamples(sourceId, { commit: true });
      stopCapture(sourceId);
    }
  }, [flushPendingSamples, stopCapture]);

  const handleSocketMessage = useCallback((message) => {
    const sourceId = safeText(message?.sourceId);
    switch (message?.type) {
      case 'hello':
        setSocketState('connected');
        break;
      case 'ready':
        setSocketState('streaming');
        break;
      case 'source_connected':
      case 'source_started':
        setSourceStates((prev) => ({
          ...prev,
          [sourceId]: message.type === 'source_started' ? 'ready' : 'connecting',
        }));
        break;
      case 'partial':
        setPartials((prev) => ({ ...prev, [sourceId]: safeText(message.text) }));
        break;
      case 'committed': {
        const text = safeText(message.text);
        if (!text) break;
        const source = SOURCE_CONFIG.find((item) => item.id === sourceId);
        setPartials((prev) => ({ ...prev, [sourceId]: '' }));
        const normalizedText = text.replace(/\s+/g, ' ').trim().toLowerCase();
        setSegments((prev) => {
          const lastSameSource = [...prev].reverse().find((segment) => segment.sourceId === sourceId);
          const lastAt = lastSameSource?.createdAt ? Date.parse(lastSameSource.createdAt) : 0;
          const isRecentDuplicate = lastSameSource
            && lastSameSource.text.replace(/\s+/g, ' ').trim().toLowerCase() === normalizedText
            && Date.now() - lastAt < 3_000;
          if (isRecentDuplicate) return prev;
          return [...prev, {
            id: `${sourceId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            sourceId,
            label: source?.label || sourceId,
            text,
            elapsedMs: Date.now() - startedAtRef.current,
            languageCode: safeText(message.languageCode),
            words: Array.isArray(message.words) ? message.words : [],
            createdAt: new Date().toISOString(),
          }];
        });
        break;
      }
      case 'source_closed':
        setSourceStates((prev) => ({ ...prev, [sourceId]: 'closed' }));
        break;
      case 'error':
        setError(message.error || 'Live Call Assist failed.');
        break;
      case 'stopped':
        setSocketState('closed');
        break;
      default:
        break;
    }
  }, []);

  const startCapture = useCallback(async (source) => {
    const selectedDeviceId = selectedDevices[source.id] || '';
    const stream = await navigator.mediaDevices.getUserMedia(getAudioConstraints(selectedDeviceId, audioPreset));
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContextCtor();
    await audioContext.resume();

    const sourceNode = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const muteGain = audioContext.createGain();
    muteGain.gain.value = 0;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      let sumSquares = 0;
      let peak = 0;
      for (let i = 0; i < input.length; i += 1) {
        sumSquares += input[i] * input[i];
        peak = Math.max(peak, Math.abs(input[i]));
      }
      const rms = Math.sqrt(sumSquares / Math.max(1, input.length));
      const level = Math.min(1, rms * 8);
      setSourceLevel(source.id, level);
      updateSourceDiagnostics(source.id, level, peak);
      appendSamples(source.id, downsampleTo16Khz(input, audioContext.sampleRate));
    };

    sourceNode.connect(processor);
    processor.connect(muteGain);
    muteGain.connect(audioContext.destination);

    capturesRef.current.set(source.id, {
      stream,
      audioContext,
      source: sourceNode,
      processor,
      muteGain,
    });
  }, [appendSamples, audioPreset, selectedDevices, setSourceLevel, updateSourceDiagnostics]);

  const startSession = useCallback(async () => {
    setError('');
    setStarting(true);
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('This browser does not support microphone capture.');
      }

      const inputs = await refreshDevices({ requestPermission: true });
      if (inputs.length === 0) {
        throw new Error('No audio input devices were found.');
      }

      const ws = new WebSocket(buildLiveCallAssistWebSocketUrl());
      wsRef.current = ws;
      setSocketState('connecting');

      await new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('Live Call Assist socket did not open in time.')), 8_000);
        ws.addEventListener('open', () => {
          window.clearTimeout(timer);
          resolve();
        }, { once: true });
        ws.addEventListener('error', () => {
          window.clearTimeout(timer);
          reject(new Error('Live Call Assist socket failed to open.'));
        }, { once: true });
      });

      ws.addEventListener('message', (event) => {
        try {
          handleSocketMessage(JSON.parse(String(event.data || '')));
        } catch {
          // Ignore malformed server messages.
        }
      });
      ws.addEventListener('close', () => {
        setSocketState('closed');
        setActive(false);
        stopAllCaptures();
        if (elapsedTimerRef.current) {
          window.clearInterval(elapsedTimerRef.current);
          elapsedTimerRef.current = 0;
        }
      });

      startedAtRef.current = Date.now();
      setElapsedMs(0);
      elapsedTimerRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 500);

      ws.send(JSON.stringify({
        type: 'start',
        sources: activeSources.map((source) => ({
          sourceId: source.id,
          label: source.label,
          languageCode: 'en',
          previousText: transcriptText.slice(-1800),
          keyterms: LIVE_CALL_KEYTERMS,
        })),
        options: {
          modelId: 'scribe_v2_realtime',
          includeTimestamps: true,
          includeLanguageDetection: false,
          commitStrategy: 'vad',
        },
      }));

      setSegments([]);
      setPartials({});
      setSourceDiagnostics({});
      diagnosticsUpdateAtRef.current.clear();
      setSourceStates(Object.fromEntries(activeSources.map((source) => [source.id, 'connecting'])));
      setSettingsExpanded(false);
      setActive(true);

      for (const source of activeSources) {
        await startCapture(source);
      }
    } catch (err) {
      stopAllCaptures();
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
      setActive(false);
      setSocketState('closed');
      setError(err?.message || 'Failed to start Live Call Assist.');
    } finally {
      setStarting(false);
    }
  }, [activeSources, handleSocketMessage, refreshDevices, startCapture, stopAllCaptures, transcriptText]);

  const stopSession = useCallback(() => {
    setError('');
    stopAllCaptures();
    if (elapsedTimerRef.current) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = 0;
    }
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'stop' })); } catch {}
    }
    try { ws?.close(); } catch {}
    wsRef.current = null;
    setActive(false);
    setStarting(false);
    setSocketState('closed');
  }, [stopAllCaptures]);

  useEffect(() => () => {
    stopSession();
    for (const timer of levelTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    levelTimersRef.current.clear();
  }, [stopSession]);

  const handleDeviceChange = (sourceId, value) => {
    setSelectedDevices((prev) => ({ ...prev, [sourceId]: value }));
    setSourceDiagnostics((prev) => ({ ...prev, [sourceId]: {} }));
  };

  const handleCaptureModeChange = (value) => {
    setCaptureMode(value);
    setPartials({});
    setLevels({});
    setSourceDiagnostics({});
    diagnosticsUpdateAtRef.current.clear();
    setSourceStates({});
  };

  const handleSendTranscript = () => {
    if (!hasTranscript) return;
    onSendTranscript?.({
      displayContent: transcriptText,
      payloadMessage: buildMainChatPayload(segments),
      transcriptText,
      segments,
      provider: 'elevenlabs',
      modelId: 'scribe_v2_realtime',
      elapsedMs,
    });
  };

  const handleInsertTranscript = () => {
    if (!hasTranscript) return;
    onInsertTranscript?.(transcriptText);
  };

  if (!open) return null;

  return (
    <div className="live-call-panel live-call-panel-compact" data-testid="live-call-assist-panel">
      <div className="live-call-compact-row">
        <div className="live-call-identity">
          <span className={`live-call-dot${active ? ' is-active' : ''}`} aria-hidden="true" />
          <div className="live-call-title-block">
            <div className="live-call-kicker">Live Call Assist</div>
            <div className="live-call-status">
              {statusLabel}
              {' · '}
              Scribe v2
              {' · '}
              {captureModeLabel}
              {' · '}
              {segments.length} line{segments.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>

        <div className="live-call-source-strip" aria-label="Call audio sources">
          {sourceSummaries.map((source) => (
            <div key={source.id} className="live-call-source-chip">
              <span className="live-call-chip-label">{source.label}</span>
              <span className={`live-call-source-state is-${source.state}`}>{source.state}</span>
              <span className="live-call-meter" aria-hidden="true">
                <span style={{ width: `${source.level}%` }} />
              </span>
            </div>
          ))}
        </div>

        <div className="live-call-controls live-call-controls-compact">
          {active ? (
            <button type="button" className="live-call-primary is-danger" onClick={stopSession}>
              Stop
            </button>
          ) : (
            <button type="button" className="live-call-primary" onClick={startSession} disabled={!canStart}>
              {starting ? 'Starting' : 'Start'}
            </button>
          )}
          <button
            type="button"
            className={`live-call-secondary${settingsExpanded ? ' is-active' : ''}`}
            onClick={() => setSettingsExpanded((prev) => !prev)}
            aria-pressed={settingsExpanded}
          >
            Inputs
          </button>
          <button
            type="button"
            className={`live-call-secondary${transcriptExpanded ? ' is-active' : ''}`}
            onClick={() => setTranscriptExpanded((prev) => !prev)}
            aria-pressed={transcriptExpanded}
            disabled={!active && !hasLiveTranscript}
          >
            Transcript
          </button>
          <button type="button" className="live-call-secondary" onClick={handleInsertTranscript} disabled={!hasTranscript}>
            Insert
          </button>
          <button type="button" className="live-call-secondary" onClick={handleSendTranscript} disabled={!hasTranscript || disabled}>
            Send
          </button>
          <button type="button" className="live-call-icon-btn" onClick={onClose} aria-label="Close Live Call Assist">
            <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className={`live-call-latest${latestLine ? '' : ' is-empty'}`} aria-live="polite">
        {latestLine ? (
          <>
            <span className="live-call-latest-meta">{latestLine.label} · {latestLine.mode}</span>
            <span className="live-call-latest-text">{latestLine.text}</span>
          </>
        ) : (
          <span>Transcript preview will appear here after start.</span>
        )}
      </div>

      {status && !configured && (
        <div className="live-call-alert is-warning" role="alert">
          ELEVENLABS_API_KEY is missing on the server.
        </div>
      )}
      {error && (
        <div className="live-call-alert is-error" role="alert">{error}</div>
      )}

      {settingsExpanded && (
        <div className="live-call-expanded live-call-settings">
          <div className="live-call-options">
            <label>
              <span>Mode</span>
              <select
                value={captureMode}
                onChange={(event) => handleCaptureModeChange(event.target.value)}
                disabled={active || starting}
              >
                {CAPTURE_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>{mode.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Mic preset</span>
              <select
                value={audioPreset}
                onChange={(event) => setAudioPreset(event.target.value)}
                disabled={active || starting}
              >
                {AUDIO_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>{preset.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="live-call-sources">
            {activeSources.map((source) => (
              <div key={source.id} className="live-call-source">
                <div className="live-call-source-row">
                  <label htmlFor={`live-call-device-${source.id}`}>{source.inputLabel || source.label}</label>
                  <span className={`live-call-source-state is-${sourceStates[source.id] || 'idle'}`}>
                    {sourceStates[source.id] || 'idle'}
                  </span>
                </div>
                <select
                  id={`live-call-device-${source.id}`}
                  value={selectedDevices[source.id] || ''}
                  onChange={(event) => handleDeviceChange(source.id, event.target.value)}
                  disabled={active || starting}
                >
                  {devices.length === 0 ? (
                    <option value="">No input devices loaded</option>
                  ) : devices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                  ))}
                </select>
                {source.inputHelp && (
                  <div className="live-call-source-help">{source.inputHelp}</div>
                )}
              </div>
            ))}
          </div>
          {captureMode === 'both' && (
            <div className="live-call-checks" role="status" aria-live="polite">
              <div className="live-call-checks-title">Customer input test</div>
              {customerInputChecks.map((item) => (
                <div key={item.key} className={`live-call-check is-${item.tone}`}>
                  <span className="live-call-check-dot" aria-hidden="true" />
                  <span className="live-call-check-label">{item.label}</span>
                  <span className="live-call-check-text">{item.text}</span>
                </div>
              ))}
            </div>
          )}
          <div className="live-call-settings-actions">
            <button type="button" className="live-call-secondary" onClick={() => refreshDevices({ requestPermission: true })} disabled={active || starting}>
              Refresh inputs
            </button>
          </div>
        </div>
      )}

      {transcriptExpanded && (
        <div className="live-call-transcript" aria-live="polite">
          {activePartials.map((partial) => (
            <div key={`partial-${partial.id}`} className={`live-call-segment live-call-partial-segment is-${partial.id}`}>
              <span className="live-call-time">live</span>
              <span className="live-call-speaker">{partial.label}</span>
              <span className="live-call-text">{partial.partial}</span>
            </div>
          ))}

          {segments.length === 0 && activePartials.length === 0 ? (
            <div className="live-call-empty">Transcript segments will appear here.</div>
          ) : segments.map((segment) => (
            <div key={segment.id} className={`live-call-segment is-${segment.sourceId}`}>
              <span className="live-call-time">{formatElapsed(segment.elapsedMs)}</span>
              <span className="live-call-speaker">{segment.label}</span>
              <span className="live-call-text">{segment.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
