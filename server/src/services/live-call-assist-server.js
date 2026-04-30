'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const { isAllowedOrigin } = require('../lib/origin-policy');

const LIVE_CALL_ASSIST_PATH = '/api/live-call-assist/stream';
const DEFAULT_ELEVENLABS_REALTIME_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
const DEFAULT_MODEL_ID = 'scribe_v2_realtime';
const DEFAULT_MAX_SESSION_MS = 2 * 60 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 25_000;
const MAX_SOURCES = 2;
const MAX_KEYTERMS = 100;
const MAX_AUDIO_BASE64_CHARS = 256 * 1024;
const MAX_QUEUED_CHUNKS_PER_SOURCE = 120;

let _websocketServer = null;
let _attachedServer = null;
let _upgradeHandler = null;
let _heartbeatTimer = null;
let _clientCounter = 0;
const _clients = new Map();

function safeText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function getConfiguredMaxSessionMs() {
  return clampNumber(
    process.env.LIVE_CALL_ASSIST_MAX_SESSION_MS,
    DEFAULT_MAX_SESSION_MS,
    30_000,
    8 * 60 * 60 * 1000,
  );
}

function getLiveCallAssistStatus() {
  return {
    ok: true,
    configured: Boolean(safeText(process.env.ELEVENLABS_API_KEY)),
    provider: 'elevenlabs',
    modelId: safeText(process.env.ELEVENLABS_STT_MODEL_ID, DEFAULT_MODEL_ID),
    path: LIVE_CALL_ASSIST_PATH,
    maxSources: MAX_SOURCES,
    maxSessionMs: getConfiguredMaxSessionMs(),
    activeClientCount: _clients.size,
  };
}

function createClientId() {
  _clientCounter += 1;
  return `live-call-${Date.now().toString(36)}-${_clientCounter.toString(36)}`;
}

function safeSend(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function sendClient(client, payload) {
  return safeSend(client?.ws, {
    ...payload,
    serverTime: new Date().toISOString(),
  });
}

function sendClientError(client, code, error, extra = {}) {
  return sendClient(client, {
    type: 'error',
    code,
    error,
    ...extra,
  });
}

function normalizeSource(raw, index) {
  const sourceId = safeText(raw?.sourceId, `source-${index + 1}`)
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 40) || `source-${index + 1}`;
  const label = safeText(raw?.label, sourceId).slice(0, 80);
  const languageCode = safeText(raw?.languageCode, 'en').slice(0, 16);
  const previousText = safeText(raw?.previousText, '').slice(0, 2_000);
  const keyterms = Array.isArray(raw?.keyterms)
    ? raw.keyterms
      .map((term) => safeText(term, '').slice(0, 80))
      .filter(Boolean)
      .slice(0, MAX_KEYTERMS)
    : [];

  return {
    sourceId,
    label,
    languageCode,
    previousText,
    keyterms,
  };
}

function buildElevenLabsRealtimeUrl(source, options = {}) {
  const baseUrl = safeText(process.env.ELEVENLABS_REALTIME_STT_URL, DEFAULT_ELEVENLABS_REALTIME_URL);
  const url = new URL(baseUrl);
  const modelId = safeText(options.modelId, safeText(process.env.ELEVENLABS_STT_MODEL_ID, DEFAULT_MODEL_ID));
  const includeTimestamps = options.includeTimestamps !== false;
  const includeLanguageDetection = options.includeLanguageDetection === true;
  const commitStrategy = options.commitStrategy === 'manual' ? 'manual' : 'vad';

  url.searchParams.set('model_id', modelId);
  url.searchParams.set('audio_format', 'pcm_16000');
  url.searchParams.set('include_timestamps', includeTimestamps ? 'true' : 'false');
  url.searchParams.set('include_language_detection', includeLanguageDetection ? 'true' : 'false');
  url.searchParams.set('commit_strategy', commitStrategy);
  url.searchParams.set('timestamps_granularity', 'word');
  url.searchParams.set('disable_logging', process.env.ELEVENLABS_DISABLE_LOGGING === '0' ? 'false' : 'true');

  if (source.languageCode) {
    url.searchParams.set('language_code', source.languageCode);
  }

  for (const term of source.keyterms) {
    url.searchParams.append('keyterms', term);
  }

  return url.toString();
}

function normalizeProviderEvent(raw) {
  let data = null;
  try {
    data = JSON.parse(String(raw || ''));
  } catch {
    return null;
  }
  return data && typeof data === 'object' ? data : null;
}

function normalizeWords(words) {
  if (!Array.isArray(words)) return [];
  return words
    .filter((word) => word && typeof word === 'object')
    .map((word) => ({
      text: safeText(word.text),
      start: Number.isFinite(Number(word.start)) ? Number(word.start) : null,
      end: Number.isFinite(Number(word.end)) ? Number(word.end) : null,
      type: safeText(word.type),
      speakerId: safeText(word.speaker_id || word.speakerId),
    }))
    .filter((word) => word.text || word.type);
}

function createUpstreamSession(client, source, options) {
  const session = {
    source,
    ws: null,
    open: false,
    closed: false,
    queuedMessages: [],
    chunkCount: 0,
    committedCount: 0,
  };

  const apiKey = safeText(process.env.ELEVENLABS_API_KEY);
  if (!apiKey) {
    sendClientError(client, 'ELEVENLABS_API_KEY_MISSING', 'ELEVENLABS_API_KEY is not configured on the server', {
      sourceId: source.sourceId,
    });
    return session;
  }

  const upstreamUrl = buildElevenLabsRealtimeUrl(source, options);
  const upstream = new WebSocket(upstreamUrl, {
    headers: {
      'xi-api-key': apiKey,
    },
    perMessageDeflate: false,
  });
  session.ws = upstream;

  upstream.on('open', () => {
    session.open = true;
    sendClient(client, {
      type: 'source_connected',
      sourceId: source.sourceId,
      label: source.label,
      provider: 'elevenlabs',
      modelId: safeText(options.modelId, safeText(process.env.ELEVENLABS_STT_MODEL_ID, DEFAULT_MODEL_ID)),
    });

    const queued = session.queuedMessages.splice(0);
    for (const message of queued) {
      sendUpstreamMessage(client, session, message);
    }
  });

  upstream.on('message', (raw) => {
    const event = normalizeProviderEvent(raw);
    if (!event) return;
    const messageType = safeText(event.message_type || event.type);

    if (messageType === 'session_started') {
      sendClient(client, {
        type: 'source_started',
        sourceId: source.sourceId,
        sessionId: safeText(event.session_id),
        config: event.config && typeof event.config === 'object' ? {
          sampleRate: event.config.sample_rate || null,
          audioFormat: event.config.audio_format || '',
          modelId: event.config.model_id || '',
          includeTimestamps: event.config.include_timestamps === true,
          includeLanguageDetection: event.config.include_language_detection === true,
        } : null,
      });
      return;
    }

    if (messageType === 'partial_transcript') {
      sendClient(client, {
        type: 'partial',
        sourceId: source.sourceId,
        text: safeText(event.text),
      });
      return;
    }

    if (messageType === 'committed_transcript' || messageType === 'committed_transcript_with_timestamps') {
      const text = safeText(event.text);
      if (!text) return;
      session.committedCount += 1;
      sendClient(client, {
        type: 'committed',
        sourceId: source.sourceId,
        text,
        languageCode: safeText(event.language_code),
        words: normalizeWords(event.words),
        committedIndex: session.committedCount,
      });
      return;
    }

    if (messageType === 'error' || event.error) {
      sendClientError(client, safeText(event.code, 'ELEVENLABS_ERROR'), safeText(event.error || event.message, 'ElevenLabs realtime transcription failed'), {
        sourceId: source.sourceId,
      });
    }
  });

  upstream.on('close', (code, reason) => {
    session.closed = true;
    session.open = false;
    sendClient(client, {
      type: 'source_closed',
      sourceId: source.sourceId,
      code,
      reason: String(reason || ''),
    });
  });

  upstream.on('error', (err) => {
    sendClientError(client, 'ELEVENLABS_SOCKET_ERROR', err?.message || 'ElevenLabs realtime socket failed', {
      sourceId: source.sourceId,
    });
  });

  return session;
}

function sendUpstreamMessage(client, session, payload) {
  if (!session || session.closed) return false;
  if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
    if (session.queuedMessages.length >= MAX_QUEUED_CHUNKS_PER_SOURCE) {
      sendClientError(client, 'SOURCE_BACKPRESSURE', 'Audio stream is backing up before the provider connection opened', {
        sourceId: session.source.sourceId,
      });
      return false;
    }
    session.queuedMessages.push(payload);
    return true;
  }

  try {
    session.ws.send(JSON.stringify(payload));
    return true;
  } catch (err) {
    sendClientError(client, 'SOURCE_SEND_FAILED', err?.message || 'Failed to send audio to transcription provider', {
      sourceId: session.source.sourceId,
    });
    return false;
  }
}

function commitSource(client, session) {
  if (!session) return false;
  return sendUpstreamMessage(client, session, {
    message_type: 'input_audio_chunk',
    audio_base_64: '',
    sample_rate: 16000,
    commit: true,
  });
}

function closeSource(session) {
  if (!session || session.closed) return;
  session.closed = true;
  session.open = false;
  session.queuedMessages.length = 0;
  try {
    if (session.ws && (session.ws.readyState === WebSocket.OPEN || session.ws.readyState === WebSocket.CONNECTING)) {
      session.ws.close(1000, 'client-ended-live-call');
    }
  } catch {
    // Ignore provider close failures.
  }
}

function cleanupClient(client) {
  if (!client) return;
  if (client.sessionTimer) {
    clearTimeout(client.sessionTimer);
    client.sessionTimer = null;
  }
  for (const session of client.sources.values()) {
    closeSource(session);
  }
  client.sources.clear();
  _clients.delete(client.id);
}

function handleStart(client, payload) {
  if (client.started) {
    sendClientError(client, 'SESSION_ALREADY_STARTED', 'Live Call Assist session already started');
    return;
  }

  const sourcesRaw = Array.isArray(payload?.sources) ? payload.sources : [];
  const normalizedSources = sourcesRaw
    .slice(0, MAX_SOURCES)
    .map(normalizeSource);

  if (normalizedSources.length === 0) {
    sendClientError(client, 'NO_SOURCES', 'At least one audio source is required');
    return;
  }

  const configured = Boolean(safeText(process.env.ELEVENLABS_API_KEY));
  if (!configured) {
    sendClientError(client, 'ELEVENLABS_API_KEY_MISSING', 'ELEVENLABS_API_KEY is not configured on the server');
    try {
      client.ws.close(1011, 'missing-elevenlabs-api-key');
    } catch {
      // Ignore close failures.
    }
    return;
  }

  const options = payload?.options && typeof payload.options === 'object' ? payload.options : {};
  client.started = true;
  client.sessionTimer = setTimeout(() => {
    sendClientError(client, 'SESSION_LIMIT_REACHED', 'Live Call Assist session time limit reached');
    try {
      client.ws.close(1000, 'session-time-limit');
    } catch {
      // Ignore close failures.
    }
  }, client.maxSessionMs);
  client.sessionTimer.unref?.();

  for (const source of normalizedSources) {
    client.sources.set(source.sourceId, createUpstreamSession(client, source, options));
  }

  sendClient(client, {
    type: 'ready',
    provider: 'elevenlabs',
    modelId: safeText(options.modelId, safeText(process.env.ELEVENLABS_STT_MODEL_ID, DEFAULT_MODEL_ID)),
    sourceCount: normalizedSources.length,
    maxSessionMs: client.maxSessionMs,
  });
}

function isValidBase64Audio(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_AUDIO_BASE64_CHARS
    && /^[A-Za-z0-9+/=]+$/.test(value);
}

function handleAudio(client, payload) {
  const sourceId = safeText(payload?.sourceId);
  const session = client.sources.get(sourceId);
  if (!session) {
    sendClientError(client, 'UNKNOWN_SOURCE', `Unknown live-call source "${sourceId || 'unknown'}"`, { sourceId });
    return;
  }

  const audioBase64 = payload?.audioBase64;
  if (!isValidBase64Audio(audioBase64)) {
    sendClientError(client, 'INVALID_AUDIO_CHUNK', 'Audio chunks must be non-empty base64 strings below the configured size limit', {
      sourceId,
    });
    return;
  }

  const sampleRate = clampNumber(payload?.sampleRate, 16000, 8000, 48000);
  session.chunkCount += 1;
  sendUpstreamMessage(client, session, {
    message_type: 'input_audio_chunk',
    audio_base_64: audioBase64,
    sample_rate: sampleRate,
    ...(payload?.commit === true ? { commit: true } : {}),
    ...(session.source.previousText && session.chunkCount === 1 ? { previous_text: session.source.previousText } : {}),
  });
}

function handleCommit(client, payload) {
  const sourceId = safeText(payload?.sourceId);
  const session = client.sources.get(sourceId);
  if (!session) {
    sendClientError(client, 'UNKNOWN_SOURCE', `Unknown live-call source "${sourceId || 'unknown'}"`, { sourceId });
    return;
  }
  commitSource(client, session);
}

function handleStop(client) {
  for (const session of client.sources.values()) {
    commitSource(client, session);
    closeSource(session);
  }
  sendClient(client, { type: 'stopped' });
  try {
    client.ws.close(1000, 'client-stopped-live-call');
  } catch {
    // Ignore close failures.
  }
}

function handleClientMessage(client, rawMessage) {
  let payload = null;
  try {
    payload = JSON.parse(String(rawMessage || ''));
  } catch {
    sendClientError(client, 'INVALID_JSON', 'Live Call Assist messages must be valid JSON');
    return;
  }

  const type = safeText(payload?.type);
  switch (type) {
    case 'start':
      handleStart(client, payload);
      return;
    case 'audio':
      handleAudio(client, payload);
      return;
    case 'commit':
      handleCommit(client, payload);
      return;
    case 'stop':
      handleStop(client);
      return;
    case 'ping':
      sendClient(client, { type: 'pong' });
      return;
    default:
      sendClientError(client, 'UNKNOWN_MESSAGE_TYPE', `Unknown Live Call Assist message type "${type || 'unknown'}"`);
  }
}

function startHeartbeat() {
  if (_heartbeatTimer) return;
  _heartbeatTimer = setInterval(() => {
    for (const client of _clients.values()) {
      if (!client.ws || client.ws.readyState !== WebSocket.OPEN) continue;
      if (client.alive === false) {
        try {
          client.ws.terminate();
        } catch {
          // Ignore terminate failures.
        }
        continue;
      }
      client.alive = false;
      try {
        client.ws.ping();
      } catch {
        // Close handling will clean up failed sockets.
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  _heartbeatTimer.unref?.();
}

function stopLiveCallAssistServer() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }

  if (_websocketServer) {
    for (const client of _clients.values()) {
      try {
        client.ws.close(1001, 'server-shutdown');
      } catch {
        // Ignore close failures.
      }
      cleanupClient(client);
    }
    _websocketServer.close();
    _websocketServer = null;
  }

  if (_attachedServer && _upgradeHandler) {
    _attachedServer.removeListener('upgrade', _upgradeHandler);
  }

  _upgradeHandler = null;
  _attachedServer = null;
  _clients.clear();
}

function attachLiveCallAssistServer(httpServer) {
  if (!httpServer) {
    throw new Error('attachLiveCallAssistServer requires an http server');
  }

  if (_attachedServer === httpServer && _websocketServer) {
    return _websocketServer;
  }

  if (_attachedServer && _attachedServer !== httpServer) {
    stopLiveCallAssistServer();
  }

  _websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_AUDIO_BASE64_CHARS + 8192,
    perMessageDeflate: false,
  });
  _attachedServer = httpServer;

  _websocketServer.on('connection', (ws, request) => {
    const client = {
      id: createClientId(),
      ws,
      request,
      alive: true,
      started: false,
      connectedAt: Date.now(),
      maxSessionMs: getConfiguredMaxSessionMs(),
      sources: new Map(),
      sessionTimer: null,
    };

    _clients.set(client.id, client);
    sendClient(client, {
      type: 'hello',
      connectionId: client.id,
      status: getLiveCallAssistStatus(),
    });

    ws.on('pong', () => {
      client.alive = true;
    });

    ws.on('message', (rawMessage) => {
      handleClientMessage(client, rawMessage);
    });

    ws.on('close', () => {
      cleanupClient(client);
    });

    ws.on('error', () => {
      cleanupClient(client);
    });
  });

  _upgradeHandler = (request, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }

    if (pathname !== LIVE_CALL_ASSIST_PATH) return;

    if (!isAllowedOrigin(request.headers.origin, undefined, { host: request.headers.host })) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    _websocketServer.handleUpgrade(request, socket, head, (ws) => {
      _websocketServer.emit('connection', ws, request);
    });
  };

  httpServer.on('upgrade', _upgradeHandler);
  startHeartbeat();

  return _websocketServer;
}

module.exports = {
  LIVE_CALL_ASSIST_PATH,
  attachLiveCallAssistServer,
  stopLiveCallAssistServer,
  getLiveCallAssistStatus,
  buildElevenLabsRealtimeUrl,
};
