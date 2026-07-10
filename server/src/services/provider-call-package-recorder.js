'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');

const ProviderCallPackage = require('../models/ProviderCallPackage');
const { redactProviderCallPackage } = require('./provider-call-package-redaction');
const { externalizeProviderCallPackagePayloads, sha256 } = require('./provider-call-package-payload-store');

const CAPTURE_VERSION = 'provider-harness-http-v0.1';
const CLI_CAPTURE_VERSION = 'provider-harness-cli-v0.2';
const LM_STUDIO_CAPTURE_VERSION = 'provider-harness-lm-studio-v0.1';
const LLM_GATEWAY_CAPTURE_VERSION = 'provider-harness-llm-gateway-v0.1';
const GEMINI_API_CAPTURE_VERSION = 'provider-harness-gemini-api-v0.1';
const SCHEMA_VERSION = '0.1';
const inFlightBackgroundRecords = new Set();

// Evidence capture is ON by default: every provider call records its full
// request/response as a ProviderCallPackage. Set
// ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE=false to explicitly disable; any other
// value (including unset) leaves capture enabled, so a lost env line can no
// longer silently kill the evidence layer.
function isProviderCallPackageCaptureEnabled() {
  return String(process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE || '').toLowerCase() !== 'false';
}

// Probe packages — the background provider health monitor and per-request
// preflight reachability checks (operation 'provider-status', stamped by
// buildProviderStatusCaptureContext in image-parser.js) — are ~98% of capture
// volume but carry almost no forensic value once the moment passes. They are
// still captured (the evidence layer stays complete), but with a short
// retention instead of the model's default PROVIDER_CALL_PACKAGE_TTL_DAYS.
// Parsed per call so env changes (and tests) take effect without a restart.
const PROBE_OPERATION = 'provider-status';
const DEFAULT_PROBE_TTL_HOURS = 24;

function resolveProbeTtlHours() {
  const env = Number.parseFloat(process.env.PROVIDER_PACKAGE_PROBE_TTL_HOURS);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_PROBE_TTL_HOURS;
}

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { parsed: null, parseError: null, parseable: false };
  }
  try {
    return { parsed: JSON.parse(text), parseError: null, parseable: true };
  } catch (err) {
    return { parsed: null, parseError: err, parseable: false };
  }
}

function normalizePort(url) {
  if (url.port) return Number.parseInt(url.port, 10);
  return url.protocol === 'https:' ? 443 : 80;
}

function serializeBody(body) {
  if (body === null || body === undefined) {
    return { bodyText: null, bodyJson: null, bodyKind: 'none', bodyByteLength: 0, bodySha256: null };
  }
  if (typeof body === 'string') {
    return {
      bodyText: body,
      bodyJson: null,
      bodyKind: 'text',
      bodyByteLength: Buffer.byteLength(body, 'utf8'),
      bodySha256: sha256(body),
    };
  }
  const bodyText = JSON.stringify(body);
  return {
    bodyText,
    bodyJson: body,
    bodyKind: 'json',
    bodyByteLength: Buffer.byteLength(bodyText, 'utf8'),
    bodySha256: sha256(bodyText),
  };
}

function classifyHttpOutcome(input, responseBodyParseable) {
  if (input.outcome) return input.outcome;
  if (input.error) {
    const code = String(input.error.code || '').toUpperCase();
    if (code === 'TIMEOUT' || /timed out/i.test(input.error.message || '')) return 'timeout';
    if (code === 'ABORT_ERR' || /aborted|abort/i.test(input.error.message || '')) return 'aborted';
    return 'network_error';
  }
  const statusCode = Number(input.response?.statusCode || input.statusCode || 0);
  if (statusCode >= 400) return 'http_error';
  if (input.expectsJson !== false && typeof input.response?.bodyText === 'string' && input.response.bodyText.trim() && !responseBodyParseable) {
    return 'invalid_json';
  }
  return 'success';
}

function compactError(err) {
  if (!err) return null;
  return {
    name: err.name || 'Error',
    message: err.message || String(err),
    code: err.code || '',
    stack: err.stack || '',
  };
}

function cloneJsonSafe(value) {
  if (value === null || value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
}

function textStats(value) {
  const text = normalizeString(value);
  return {
    text,
    byteLength: Buffer.byteLength(text, 'utf8'),
    sha256: text ? sha256(text) : null,
  };
}

// Caller-supplied capture metadata (origin/context of the call — sourceAgent,
// prompt identity, triggering escalation, ...). Harness-level captureInput
// metadata (input.metadata, already merged with the capture context by the
// HTTP harnesses) wins over the raw context metadata; absent both, null.
function resolveCaptureMetadata(input = {}, context = {}) {
  const metadata = input.metadata || context.metadata || null;
  if (!metadata || typeof metadata !== 'object') return null;
  return cloneJsonSafe(metadata);
}

function normalizeCliLines(stdoutText, lines) {
  if (Array.isArray(lines)) return lines.map((line) => String(line));
  if (!stdoutText) return [];
  return stdoutText.endsWith('\n')
    ? stdoutText.slice(0, -1).split('\n')
    : stdoutText.split('\n').slice(0, -1);
}

function normalizeCliTextChunks(chunks = []) {
  if (!Array.isArray(chunks)) return [];
  return chunks.map((chunk, index) => {
    const text = normalizeString(chunk?.text ?? chunk);
    return {
      seq: Number.isInteger(chunk?.seq) ? chunk.seq : index,
      receivedAt: chunk?.receivedAt || nowIso(),
      byteLength: Number.isFinite(chunk?.byteLength) ? chunk.byteLength : Buffer.byteLength(text, 'utf8'),
      sha256: chunk?.sha256 || (text ? sha256(text) : null),
      text,
      textPayloadRef: chunk?.textPayloadRef || null,
    };
  });
}

function classifyCliOutcome(input = {}) {
  if (input.outcome) return input.outcome;
  const error = input.error;
  const code = String(error?.code || '').toUpperCase();
  if (input.spawned === false || input.spawnError || code === 'ENOENT' || code === 'SPAWN_ERROR') {
    return 'spawn_error';
  }
  if (input.abort?.fired || input.aborted) return 'aborted';
  if (input.timeout?.fired || code === 'TIMEOUT' || /timed out/i.test(error?.message || '')) return 'timeout';
  if (error) return 'process_error';
  if (Number.isFinite(input.exitCode) && input.exitCode !== 0) return 'process_error';
  if (input.expectsJsonl && !Array.isArray(input.stdoutJsonlEvents) && !Array.isArray(input.jsonlEvents)) {
    return 'invalid_jsonl';
  }
  const events = input.stdoutJsonlEvents || input.jsonlEvents;
  if (input.expectsJsonl && Array.isArray(events) && events.length === 0) return 'invalid_jsonl';
  return 'success';
}

function buildCliProviderCallPackage(input = {}) {
  const context = input.captureContext || input.context || {};
  const requestStartedAt = input.requestStartedAt || input.startedAt || nowIso();
  const responseCompletedAt = input.responseCompletedAt || input.completedAt || nowIso();
  const stdout = textStats(input.stdoutText);
  const stderr = textStats(input.stderrText);
  const stdin = textStats(input.stdinText);
  const stdoutLines = normalizeCliLines(stdout.text, input.stdoutLines);
  const stdoutJsonlEvents = Array.isArray(input.stdoutJsonlEvents)
    ? cloneJsonSafe(input.stdoutJsonlEvents)
    : (Array.isArray(input.jsonlEvents) ? cloneJsonSafe(input.jsonlEvents) : []);
  const malformedLines = Array.isArray(input.malformedStdoutLines)
    ? input.malformedStdoutLines.map((line) => String(line))
    : [];
  const stdoutChunks = normalizeCliTextChunks(input.stdoutChunks);
  const stderrChunks = normalizeCliTextChunks(input.stderrChunks);
  const timeoutMs = input.timeoutMs || context.timeoutMs || input.timeout?.timeoutMs || null;
  const outcome = classifyCliOutcome({
    ...input,
    stdoutJsonlEvents,
    timeout: {
      ...(input.timeout || {}),
      timeoutMs,
    },
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    captureVersion: input.captureVersion || context.captureVersion || CLI_CAPTURE_VERSION,
    providerId: context.providerId || input.providerId || '',
    providerResearchId: context.providerResearchId || input.providerResearchId || '',
    providerPathType: context.providerPathType || input.providerPathType || 'cli',
    callSite: context.callSite || input.callSite || '',
    operation: context.operation || input.operation || '',
    source: context.source || input.source || null,
    metadata: resolveCaptureMetadata(input, context),
    request: null,
    response: null,
    cli: {
      command: input.command || context.command || '',
      args: Array.isArray(input.args) ? input.args.map((arg) => String(arg)) : [],
      modelRequested: context.modelRequested || input.modelRequested || '',
      reasoningEffort: context.reasoningEffort || input.reasoningEffort || '',
      cwd: input.cwd || null,
      spawnOptions: cloneJsonSafe(input.spawnOptions || null),
      env: cloneJsonSafe(input.env || {
        capturedKeys: [],
        notes: [],
      }),
      stdin: {
        ...stdin,
        textPayloadRef: null,
      },
      stdout: {
        ...stdout,
        lines: stdoutLines,
        linesPayloadRef: null,
        jsonlEvents: stdoutJsonlEvents,
        jsonlEventsPayloadRef: null,
        malformedLines,
        malformedLinesPayloadRef: null,
        finalBuffer: normalizeString(input.stdoutFinalBuffer || input.finalBuffer || ''),
        finalBufferPayloadRef: null,
        chunks: stdoutChunks,
      },
      stderr: {
        ...stderr,
        textPayloadRef: null,
        chunks: stderrChunks,
      },
      process: {
        pid: input.pid || null,
        exitCode: Number.isFinite(input.exitCode) ? input.exitCode : null,
        signal: input.signal || null,
        spawned: input.spawned !== false,
        closed: Boolean(input.closed),
        killed: Boolean(input.killed),
        killSignal: input.killSignal || null,
      },
      timeout: {
        timeoutMs,
        fired: Boolean(input.timeout?.fired || input.timeoutFired),
      },
    },
    timing: {
      requestStartedAt,
      stdinWrittenAt: input.stdinWrittenAt || null,
      firstStdoutAt: input.firstStdoutAt || null,
      firstStderrAt: input.firstStderrAt || null,
      processClosedAt: input.processClosedAt || null,
      responseCompletedAt,
      durationMs: Number.isFinite(input.durationMs)
        ? input.durationMs
        : Math.max(new Date(responseCompletedAt).getTime() - new Date(requestStartedAt).getTime(), 0),
    },
    outcome,
    error: input.error ? compactError(input.error) : null,
    redaction: {
      applied: false,
      redactedHeaderNames: [],
      redactedBodyPaths: [],
      notes: [],
    },
    storage: {
      inline: true,
      externalPayloads: [],
      truncated: false,
      truncationReason: null,
    },
  };
}

function buildNoResponsePackage() {
  return {
    received: false,
    statusCode: 0,
    statusMessage: '',
    httpVersion: '',
    headers: {},
    rawHeaders: [],
    trailers: {},
    rawTrailers: [],
    bodyChunks: [],
    bodyText: '',
    bodyByteLength: 0,
    bodySha256: null,
    bodyPayloadRef: null,
    parsedJson: null,
    jsonParseError: null,
  };
}

function buildResponsePackage(input, responseBodyText, parsedResult) {
  if (!input.response && !input.statusCode) {
    return buildNoResponsePackage();
  }

  return {
    received: Boolean(input.response || input.statusCode),
    statusCode: Number(input.response?.statusCode || input.statusCode || 0),
    statusMessage: input.response?.statusMessage || '',
    httpVersion: input.response?.httpVersion || '',
    headers: input.response?.headers || {},
    rawHeaders: input.response?.rawHeaders || [],
    trailers: input.response?.trailers || {},
    rawTrailers: input.response?.rawTrailers || [],
    bodyChunks: Array.isArray(input.response?.bodyChunks) ? input.response.bodyChunks : [],
    bodyText: responseBodyText,
    bodyByteLength: Buffer.byteLength(responseBodyText, 'utf8'),
    bodySha256: responseBodyText ? sha256(responseBodyText) : null,
    bodyPayloadRef: null,
    parsedJson: parsedResult.parsed,
    jsonParseError: parsedResult.parseError
      ? { name: parsedResult.parseError.name, message: parsedResult.parseError.message }
      : null,
  };
}

function buildLmStudioNoResponsePackage() {
  return {
    received: false,
    statusCode: 0,
    statusMessage: '',
    httpVersion: '',
    headers: {},
    redactedHeaderNames: [],
    rawHeaders: [],
    trailers: {},
    rawTrailers: [],
    bodyChunks: [],
    bodyText: '',
    bodyTextPayloadRef: null,
    bodyByteLength: 0,
    bodySha256: null,
    parsedJson: null,
    parsedJsonPayloadRef: null,
    jsonParseError: null,
  };
}

function normalizeLmStudioParseError(err) {
  if (!err) return null;
  return {
    name: err.name || 'SyntaxError',
    message: err.message || String(err),
  };
}

function normalizeLmStudioTextChunks(chunks = []) {
  return normalizeCliTextChunks(chunks);
}

function normalizeLmStudioFrames(frames = []) {
  if (!Array.isArray(frames)) return [];
  return frames.map((frame, index) => ({
    seq: Number.isInteger(frame?.seq) ? frame.seq : index,
    receivedAt: frame?.receivedAt || nowIso(),
    rawLine: normalizeString(frame?.rawLine ?? frame?.line ?? ''),
    rawLinePayloadRef: frame?.rawLinePayloadRef || null,
    data: frame?.data === null || frame?.data === undefined ? null : normalizeString(frame.data),
    dataPayloadRef: frame?.dataPayloadRef || null,
    eventType: frame?.eventType || 'unknown',
    parsedJson: frame?.parsedJson === undefined ? null : cloneJsonSafe(frame.parsedJson),
    parseError: normalizeLmStudioParseError(frame?.parseError),
  }));
}

function inferLmStudioMode(input, context) {
  if (input.mode === 'stream' || input.mode === 'non-stream') return input.mode;
  if (context.mode === 'stream' || context.mode === 'non-stream') return context.mode;
  const streamFlag = input.body?.stream ?? context.stream;
  return streamFlag ? 'stream' : 'non-stream';
}

function normalizeLmStudioRequest(input, context, mode) {
  const baseUrl = input.baseUrl || context.baseUrl || 'http://localhost';
  const urlPath = input.urlPath || input.path || '/v1/chat/completions';
  const url = new URL(urlPath, baseUrl);
  const serializedBody = serializeBody(input.body);
  return {
    method: input.method || context.method || 'POST',
    baseUrl,
    url: url.toString(),
    protocol: url.protocol,
    hostname: url.hostname,
    port: normalizePort(url),
    path: `${url.pathname}${url.search}`,
    urlPath,
    headers: input.headers || {},
    redactedHeaderNames: [],
    ...serializedBody,
    bodyTextPayloadRef: null,
    bodyJsonPayloadRef: null,
    modelRequested: context.modelRequested || input.modelRequested || serializedBody.bodyJson?.model || '',
    stream: mode === 'stream',
    timeoutMs: input.timeoutMs || context.timeoutMs || null,
  };
}

function normalizeLmStudioResponse(input, mode) {
  if (!input.response && !input.statusCode) {
    return buildLmStudioNoResponsePackage();
  }

  const bodyText = typeof input.response?.bodyText === 'string'
    ? input.response.bodyText
    : (typeof input.response?.body === 'string' ? input.response.body : '');
  const parsedResult = mode === 'stream'
    ? {
        parsed: input.response?.parsedJson === undefined ? null : cloneJsonSafe(input.response.parsedJson),
        parseError: null,
        parseable: true,
      }
    : (input.response?.parsedJson !== undefined
        ? { parsed: cloneJsonSafe(input.response.parsedJson), parseError: null, parseable: true }
        : safeJsonParse(bodyText));

  return {
    received: Boolean(input.response || input.statusCode),
    statusCode: Number(input.response?.statusCode || input.statusCode || 0),
    statusMessage: input.response?.statusMessage || '',
    httpVersion: input.response?.httpVersion || '',
    headers: input.response?.headers || {},
    redactedHeaderNames: [],
    rawHeaders: input.response?.rawHeaders || [],
    trailers: input.response?.trailers || {},
    rawTrailers: input.response?.rawTrailers || [],
    bodyChunks: normalizeLmStudioTextChunks(input.response?.bodyChunks),
    bodyText,
    bodyTextPayloadRef: null,
    bodyByteLength: Buffer.byteLength(bodyText, 'utf8'),
    bodySha256: bodyText ? sha256(bodyText) : null,
    parsedJson: parsedResult.parsed,
    parsedJsonPayloadRef: null,
    jsonParseError: normalizeLmStudioParseError(parsedResult.parseError),
  };
}

function normalizeLmStudioStream(input = {}) {
  const stream = input.stream || input.streaming || null;
  if (!stream) return null;
  const fullResponse = normalizeString(stream.fullResponse);
  return {
    rawChunks: normalizeLmStudioTextChunks(stream.rawChunks || stream.chunks),
    frames: normalizeLmStudioFrames(stream.frames),
    parsedChunks: Array.isArray(stream.parsedChunks) ? cloneJsonSafe(stream.parsedChunks) : [],
    parsedChunksPayloadRef: null,
    doneSeen: Boolean(stream.doneSeen),
    terminator: stream.terminator || '',
    finalBuffer: normalizeString(stream.finalBuffer),
    finalBufferPayloadRef: null,
    fullResponse,
    fullResponsePayloadRef: null,
    fullResponseByteLength: Buffer.byteLength(fullResponse, 'utf8'),
    fullResponseSha256: fullResponse ? sha256(fullResponse) : null,
    usage: stream.usage === undefined ? null : cloneJsonSafe(stream.usage),
  };
}

function normalizeLmStudioError(input, response) {
  const err = input.error;
  if (!err && !input.errorRawBody) return null;
  const rawBody = input.errorRawBody || err?.rawBody || null;
  return {
    ...compactError(err || new Error('LM Studio provider error')),
    statusCode: Number(err?.statusCode || input.statusCode || response?.statusCode || 0) || null,
    rawBody,
    rawBodyPayloadRef: null,
    object: err?.object === undefined ? null : cloneJsonSafe(err.object),
  };
}

function classifyLmStudioOutcome(input, response, stream) {
  if (input.outcome) return input.outcome;
  if (input.error) {
    const code = String(input.error.code || '').toUpperCase();
    if (code === 'TIMEOUT' || /timed out/i.test(input.error.message || '')) return 'timeout';
    if (code === 'ABORT_ERR' || /aborted|abort/i.test(input.error.message || '')) return 'aborted';
    return 'network_error';
  }
  if (response.statusCode >= 400) return 'http_error';
  if (stream?.terminator === 'timeout') return 'timeout';
  if (stream?.terminator === 'aborted') return 'aborted';
  if (stream?.terminator === 'network_error') return 'network_error';
  if (stream?.terminator === 'end_without_done') return 'stream_end_without_done';
  const hasMalformedFrame = Array.isArray(stream?.frames) && stream.frames.some((frame) => frame.parseError);
  if (hasMalformedFrame && !stream?.doneSeen) return 'malformed_sse';
  if (!stream && response.bodyText && response.jsonParseError) return 'invalid_json';
  return 'success';
}

function buildLmStudioProviderCallPackage(input = {}) {
  const context = input.captureContext || input.context || {};
  const mode = inferLmStudioMode(input, context);
  const requestStartedAt = input.requestStartedAt || input.startedAt || nowIso();
  const responseCompletedAt = input.responseCompletedAt || input.completedAt || nowIso();
  const request = normalizeLmStudioRequest(input, context, mode);
  const response = normalizeLmStudioResponse(input, mode);
  const stream = mode === 'stream' ? normalizeLmStudioStream(input) : null;
  const outcome = classifyLmStudioOutcome(input, response, stream);

  return {
    schemaVersion: SCHEMA_VERSION,
    captureVersion: input.captureVersion || context.captureVersion || LM_STUDIO_CAPTURE_VERSION,
    providerId: context.providerId || input.providerId || 'lm-studio',
    providerResearchId: context.providerResearchId || input.providerResearchId || 'lm-studio-openai-compatible',
    providerPathType: context.providerPathType || input.providerPathType || (mode === 'stream'
      ? 'lm-studio-http-stream'
      : 'lm-studio-http-nonstream'),
    callSite: context.callSite || input.callSite || '',
    operation: context.operation || input.operation || '',
    source: context.source || input.source || null,
    metadata: resolveCaptureMetadata(input, context),
    request: null,
    response: null,
    cli: null,
    lmStudio: {
      mode,
      request,
      response,
      stream,
      error: normalizeLmStudioError(input, response),
    },
    timing: {
      requestStartedAt,
      requestWrittenAt: input.requestWrittenAt || null,
      responseHeadersAt: input.responseHeadersAt || null,
      responseCompletedAt,
      durationMs: Number.isFinite(input.durationMs)
        ? input.durationMs
        : Math.max(new Date(responseCompletedAt).getTime() - new Date(requestStartedAt).getTime(), 0),
    },
    outcome,
    error: input.error
      ? {
          ...compactError(input.error),
          rawBody: input.error.rawBody || input.errorRawBody || null,
          object: input.error.object === undefined ? null : cloneJsonSafe(input.error.object),
        }
      : null,
    redaction: {
      applied: false,
      redactedHeaderNames: [],
      redactedBodyPaths: [],
      notes: [],
    },
    storage: {
      inline: true,
      externalPayloads: [],
      notes: [],
      truncated: false,
      truncationReason: null,
    },
  };
}

function normalizeLlmGatewayParseError(err) {
  if (!err) return null;
  return {
    name: err.name || 'SyntaxError',
    message: err.message || String(err),
  };
}

function getHeaderValue(headers = {}, name) {
  const target = String(name || '').toLowerCase();
  if (!headers || typeof headers !== 'object') return null;
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === target) {
      if (Array.isArray(value)) return value[0] === undefined ? null : String(value[0]);
      return value === undefined || value === null ? null : String(value);
    }
  }
  return null;
}

function parseDataUrl(value) {
  const text = typeof value === 'string' ? value : '';
  const match = text.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!match) return null;
  const data = match[2] || '';
  let decodedByteLength = null;
  try {
    decodedByteLength = Buffer.from(data, 'base64').length;
  } catch {
    decodedByteLength = null;
  }
  return {
    mediaType: match[1] || '',
    decodedByteLength,
  };
}

function extractLlmGatewayImages(body) {
  const images = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (value.type === 'image_url' && value.image_url && typeof value.image_url.url === 'string') {
      const dataUrlInfo = parseDataUrl(value.image_url.url);
      if (dataUrlInfo) {
        images.push({
          seq: images.length,
          mediaType: dataUrlInfo.mediaType,
          source: 'data-url',
          dataUrlSha256: sha256(value.image_url.url),
          decodedByteLength: dataUrlInfo.decodedByteLength,
          dataUrlPayloadRef: null,
        });
      }
    }
    Object.values(value).forEach(visit);
  };
  visit(body);
  return images;
}

function buildLlmGatewayNoResponsePackage() {
  return {
    received: false,
    statusCode: 0,
    statusMessage: '',
    httpVersion: '',
    headers: {},
    redactedHeaderNames: [],
    rawHeaders: [],
    trailers: {},
    rawTrailers: [],
    gatewayRequestId: null,
    bodyChunks: [],
    bodyText: '',
    bodyTextPayloadRef: null,
    bodyByteLength: 0,
    bodySha256: null,
    parsedJson: null,
    parsedJsonPayloadRef: null,
    jsonParseError: null,
  };
}

function normalizeLlmGatewayTextChunks(chunks = []) {
  return normalizeCliTextChunks(chunks);
}

function normalizeLlmGatewayRequest(input, context) {
  const baseUrl = input.baseUrl || context.baseUrl || 'http://127.0.0.1:4100';
  const urlPath = input.urlPath || input.path || '/v1/chat/completions';
  const url = new URL(urlPath, baseUrl);
  const serializedBody = serializeBody(input.body);
  const bodyJson = serializedBody.bodyJson;
  const images = extractLlmGatewayImages(bodyJson);
  return {
    method: input.method || context.method || 'POST',
    baseUrl,
    url: url.toString(),
    protocol: url.protocol,
    hostname: url.hostname,
    port: normalizePort(url),
    path: `${url.pathname}${url.search}`,
    urlPath,
    headers: input.headers || {},
    redactedHeaderNames: [],
    ...serializedBody,
    bodyTextPayloadRef: null,
    bodyJsonPayloadRef: null,
    modelRequested: context.modelRequested || input.modelRequested || bodyJson?.model || '',
    stream: Boolean(bodyJson?.stream),
    timeoutMs: input.timeoutMs || context.timeoutMs || null,
    hasImages: images.length > 0,
    images,
  };
}

function normalizeLlmGatewayResponse(input) {
  if (!input.response && !input.statusCode) {
    return buildLlmGatewayNoResponsePackage();
  }

  const bodyText = typeof input.response?.bodyText === 'string'
    ? input.response.bodyText
    : (typeof input.response?.body === 'string' ? input.response.body : '');
  const parsedResult = input.response?.parsedJson !== undefined
    ? { parsed: cloneJsonSafe(input.response.parsedJson), parseError: null, parseable: true }
    : safeJsonParse(bodyText);
  const headers = input.response?.headers || {};

  return {
    received: Boolean(input.response || input.statusCode),
    statusCode: Number(input.response?.statusCode || input.statusCode || 0),
    statusMessage: input.response?.statusMessage || '',
    httpVersion: input.response?.httpVersion || '',
    headers,
    redactedHeaderNames: [],
    rawHeaders: input.response?.rawHeaders || [],
    trailers: input.response?.trailers || {},
    rawTrailers: input.response?.rawTrailers || [],
    gatewayRequestId: getHeaderValue(headers, 'x-request-id'),
    bodyChunks: normalizeLlmGatewayTextChunks(input.response?.bodyChunks),
    bodyText,
    bodyTextPayloadRef: null,
    bodyByteLength: Buffer.byteLength(bodyText, 'utf8'),
    bodySha256: bodyText ? sha256(bodyText) : null,
    parsedJson: parsedResult.parsed,
    parsedJsonPayloadRef: null,
    jsonParseError: normalizeLlmGatewayParseError(parsedResult.parseError),
  };
}

function buildLlmGatewayMetadata(response) {
  const parsed = response?.parsedJson;
  const metadata = parsed && typeof parsed === 'object' && parsed.gateway && typeof parsed.gateway === 'object'
    ? cloneJsonSafe(parsed.gateway)
    : null;
  if (!metadata && !response?.gatewayRequestId) return null;
  return {
    requestId: response?.gatewayRequestId || null,
    metadata,
    usage: metadata?.usage === undefined ? null : cloneJsonSafe(metadata.usage),
    cost: metadata?.cost === undefined ? null : cloneJsonSafe(metadata.cost),
    credits: metadata?.credits === undefined ? null : cloneJsonSafe(metadata.credits),
  };
}

function buildLlmGatewayProviderStatus(context, response) {
  const operation = context.operation || '';
  if (operation !== 'provider-status') return null;
  const parsed = response?.parsedJson;
  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: null,
      provider: 'llm-gateway',
      authenticated: null,
      upstream: null,
      gateway: null,
      error: null,
    };
  }
  return {
    ok: typeof parsed.ok === 'boolean' ? parsed.ok : null,
    provider: parsed.provider ? String(parsed.provider) : 'llm-gateway',
    authenticated: typeof parsed.authenticated === 'boolean' ? parsed.authenticated : null,
    upstream: parsed.upstream === undefined ? null : cloneJsonSafe(parsed.upstream),
    gateway: parsed.gateway === undefined ? null : cloneJsonSafe(parsed.gateway),
    error: parsed.error === undefined ? null : cloneJsonSafe(parsed.error),
  };
}

function classifyLlmGatewayOutcome(input, response) {
  if (input.outcome) return input.outcome;
  if (input.error) {
    const code = String(input.error.code || '').toUpperCase();
    if (code === 'TIMEOUT' || /timed out/i.test(input.error.message || '')) return 'timeout';
    if (code === 'ABORT_ERR' || /aborted|abort|cancel/i.test(input.error.message || '')) return 'aborted';
    return 'network_error';
  }
  if (response.statusCode >= 400) return 'http_error';
  if (response.bodyText && response.jsonParseError) return 'invalid_json';
  return 'success';
}

function normalizeLlmGatewayError(input, response, outcome) {
  const err = input.error;
  if (!err && outcome === 'success') return null;
  const parsed = response?.parsedJson;
  const gatewayError = parsed && typeof parsed === 'object' && parsed.error && typeof parsed.error === 'object'
    ? parsed.error
    : null;
  const rawBody = input.errorRawBody || err?.rawBody || response?.bodyText || null;
  return {
    ...compactError(err || new Error('LLM Gateway provider error')),
    statusCode: Number(err?.statusCode || input.statusCode || response?.statusCode || 0) || null,
    rawBody,
    rawBodyPayloadRef: null,
    object: err?.object === undefined
      ? (parsed === undefined ? null : cloneJsonSafe(parsed))
      : cloneJsonSafe(err.object),
    gatewayErrorType: gatewayError?.type ? String(gatewayError.type) : '',
    gatewayErrorCode: gatewayError?.code ? String(gatewayError.code) : '',
    gatewayErrorMessage: gatewayError?.message ? String(gatewayError.message) : '',
    nodeErrorCode: err?.code ? String(err.code) : '',
  };
}

function buildLlmGatewayProviderCallPackage(input = {}) {
  const context = input.captureContext || input.context || {};
  const requestStartedAt = input.requestStartedAt || input.startedAt || nowIso();
  const responseCompletedAt = input.responseCompletedAt || input.completedAt || nowIso();
  const request = normalizeLlmGatewayRequest(input, context);
  const response = normalizeLlmGatewayResponse(input);
  const outcome = classifyLlmGatewayOutcome(input, response);

  return {
    schemaVersion: SCHEMA_VERSION,
    captureVersion: input.captureVersion || context.captureVersion || LLM_GATEWAY_CAPTURE_VERSION,
    providerId: context.providerId || input.providerId || 'llm-gateway',
    providerResearchId: context.providerResearchId || input.providerResearchId || 'llm-gateway',
    providerPathType: context.providerPathType || input.providerPathType || 'gateway-http',
    callSite: context.callSite || input.callSite || '',
    operation: context.operation || input.operation || '',
    source: context.source || input.source || null,
    metadata: resolveCaptureMetadata(input, context),
    request: null,
    response: null,
    cli: null,
    lmStudio: null,
    llmGateway: {
      request,
      response,
      gateway: buildLlmGatewayMetadata(response),
      providerStatus: buildLlmGatewayProviderStatus(context, response),
      error: normalizeLlmGatewayError(input, response, outcome),
    },
    timing: {
      requestStartedAt,
      requestWrittenAt: input.requestWrittenAt || null,
      responseHeadersAt: input.responseHeadersAt || null,
      responseCompletedAt,
      durationMs: Number.isFinite(input.durationMs)
        ? input.durationMs
        : Math.max(new Date(responseCompletedAt).getTime() - new Date(requestStartedAt).getTime(), 0),
    },
    outcome,
    error: input.error
      ? {
          ...compactError(input.error),
          rawBody: input.error.rawBody || input.errorRawBody || null,
          object: input.error.object === undefined ? null : cloneJsonSafe(input.error.object),
        }
      : null,
    redaction: {
      applied: false,
      redactedHeaderNames: [],
      redactedBodyPaths: [],
      notes: [],
    },
    storage: {
      inline: true,
      externalPayloads: [],
      notes: [],
      truncated: false,
      truncationReason: null,
    },
  };
}

function parseGeminiInlineData(value) {
  if (!value || typeof value !== 'object') return null;
  const data = typeof value.data === 'string' ? value.data : '';
  if (!data) return null;
  let decodedByteLength = null;
  try {
    decodedByteLength = Buffer.from(data, 'base64').length;
  } catch {
    decodedByteLength = null;
  }
  return {
    mediaType: value.mime_type || value.mimeType || '',
    decodedByteLength,
    data,
  };
}

function extractGeminiImages(body) {
  const images = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const inlineData = parseGeminiInlineData(value.inline_data || value.inlineData);
    if (inlineData) {
      images.push({
        seq: images.length,
        mediaType: inlineData.mediaType,
        source: 'inline-data',
        dataSha256: sha256(inlineData.data),
        decodedByteLength: inlineData.decodedByteLength,
        dataPayloadRef: null,
      });
    }
    Object.values(value).forEach(visit);
  };
  visit(body);
  return images;
}

function buildGeminiNoResponsePackage() {
  return {
    received: false,
    statusCode: 0,
    statusMessage: '',
    httpVersion: '',
    headers: {},
    redactedHeaderNames: [],
    rawHeaders: [],
    trailers: {},
    rawTrailers: [],
    bodyChunks: [],
    bodyText: '',
    bodyTextPayloadRef: null,
    bodyByteLength: 0,
    bodySha256: null,
    parsedJson: null,
    parsedJsonPayloadRef: null,
    jsonParseError: null,
    responseId: '',
    modelVersion: '',
    promptFeedback: null,
    usageMetadata: null,
  };
}

function normalizeGeminiRequest(input, context) {
  const baseUrl = input.baseUrl || context.baseUrl || 'https://generativelanguage.googleapis.com';
  const urlPath = input.urlPath || input.path || '/v1beta/models/gemini-3.5-flash:generateContent';
  const url = new URL(urlPath, baseUrl);
  const serializedBody = serializeBody(input.body);
  const bodyJson = serializedBody.bodyJson;
  const images = extractGeminiImages(bodyJson);
  return {
    method: input.method || context.method || 'POST',
    baseUrl,
    url: url.toString(),
    protocol: url.protocol,
    hostname: url.hostname,
    port: normalizePort(url),
    path: `${url.pathname}${url.search}`,
    urlPath,
    headers: input.headers || {},
    redactedHeaderNames: [],
    ...serializedBody,
    bodyTextPayloadRef: null,
    bodyJsonPayloadRef: null,
    modelRequested: context.modelRequested || input.modelRequested || '',
    stream: /streamGenerateContent/i.test(urlPath),
    timeoutMs: input.timeoutMs || context.timeoutMs || null,
    hasImages: images.length > 0,
    images,
  };
}

function normalizeGeminiResponse(input) {
  if (!input.response && !input.statusCode) {
    return buildGeminiNoResponsePackage();
  }

  const bodyText = typeof input.response?.bodyText === 'string'
    ? input.response.bodyText
    : (typeof input.response?.body === 'string' ? input.response.body : '');
  const parsedResult = input.response?.parsedJson !== undefined
    ? { parsed: cloneJsonSafe(input.response.parsedJson), parseError: null, parseable: true }
    : safeJsonParse(bodyText);
  const parsed = parsedResult.parsed && typeof parsedResult.parsed === 'object' ? parsedResult.parsed : null;

  return {
    received: Boolean(input.response || input.statusCode),
    statusCode: Number(input.response?.statusCode || input.statusCode || 0),
    statusMessage: input.response?.statusMessage || '',
    httpVersion: input.response?.httpVersion || '',
    headers: input.response?.headers || {},
    redactedHeaderNames: [],
    rawHeaders: input.response?.rawHeaders || [],
    trailers: input.response?.trailers || {},
    rawTrailers: input.response?.rawTrailers || [],
    bodyChunks: normalizeLlmGatewayTextChunks(input.response?.bodyChunks),
    bodyText,
    bodyTextPayloadRef: null,
    bodyByteLength: Buffer.byteLength(bodyText, 'utf8'),
    bodySha256: bodyText ? sha256(bodyText) : null,
    parsedJson: parsedResult.parsed,
    parsedJsonPayloadRef: null,
    jsonParseError: normalizeLlmGatewayParseError(parsedResult.parseError),
    responseId: parsed?.responseId ? String(parsed.responseId) : '',
    modelVersion: parsed?.modelVersion ? String(parsed.modelVersion) : '',
    promptFeedback: parsed?.promptFeedback === undefined ? null : cloneJsonSafe(parsed.promptFeedback),
    usageMetadata: parsed?.usageMetadata === undefined ? null : cloneJsonSafe(parsed.usageMetadata),
  };
}

function classifyGeminiOutcome(input, response) {
  if (input.outcome) return input.outcome;
  if (input.error) {
    const code = String(input.error.code || '').toUpperCase();
    if (code === 'TIMEOUT' || /timed out/i.test(input.error.message || '')) return 'timeout';
    if (code === 'ABORT_ERR' || /aborted|abort|cancel/i.test(input.error.message || '')) return 'aborted';
    return 'network_error';
  }
  if (response.statusCode >= 400) return 'http_error';
  if (response.bodyText && response.jsonParseError) return 'invalid_json';
  return 'success';
}

function buildGeminiProviderStatus(context, response) {
  if ((context.operation || '') !== 'provider-status') return null;
  const parsed = response?.parsedJson;
  const googleError = parsed && typeof parsed === 'object' && parsed.error && typeof parsed.error === 'object'
    ? parsed.error
    : null;
  return {
    ok: response?.statusCode >= 200 && response?.statusCode < 300,
    authenticated: response?.statusCode >= 200 && response?.statusCode < 300,
    model: context.modelRequested || response?.modelVersion || '',
    error: googleError ? cloneJsonSafe(googleError) : null,
  };
}

function normalizeGeminiError(input, response, outcome) {
  const err = input.error;
  if (!err && outcome === 'success') return null;
  const parsed = response?.parsedJson;
  const googleError = parsed && typeof parsed === 'object' && parsed.error && typeof parsed.error === 'object'
    ? parsed.error
    : null;
  const rawBody = input.errorRawBody || err?.rawBody || response?.bodyText || null;
  return {
    ...compactError(err || new Error('Gemini API provider error')),
    statusCode: Number(err?.statusCode || input.statusCode || response?.statusCode || 0) || null,
    rawBody,
    rawBodyPayloadRef: null,
    object: err?.object === undefined
      ? (parsed === undefined ? null : cloneJsonSafe(parsed))
      : cloneJsonSafe(err.object),
    googleErrorCode: Number.isFinite(googleError?.code) ? googleError.code : null,
    googleErrorStatus: googleError?.status ? String(googleError.status) : '',
    googleErrorMessage: googleError?.message ? String(googleError.message) : '',
    googleErrorDetails: googleError?.details === undefined ? null : cloneJsonSafe(googleError.details),
    nodeErrorCode: err?.code ? String(err.code) : '',
  };
}

function buildGeminiApiProviderCallPackage(input = {}) {
  const context = input.captureContext || input.context || {};
  const requestStartedAt = input.requestStartedAt || input.startedAt || nowIso();
  const responseCompletedAt = input.responseCompletedAt || input.completedAt || nowIso();
  const request = normalizeGeminiRequest(input, context);
  const response = normalizeGeminiResponse(input);
  const outcome = classifyGeminiOutcome(input, response);

  return {
    schemaVersion: SCHEMA_VERSION,
    captureVersion: input.captureVersion || context.captureVersion || GEMINI_API_CAPTURE_VERSION,
    providerId: context.providerId || input.providerId || 'gemini',
    providerResearchId: context.providerResearchId || input.providerResearchId || 'gemini-api',
    providerPathType: context.providerPathType || input.providerPathType || 'direct-http',
    callSite: context.callSite || input.callSite || '',
    operation: context.operation || input.operation || '',
    source: context.source || input.source || null,
    metadata: resolveCaptureMetadata(input, context),
    request: null,
    response: null,
    cli: null,
    lmStudio: null,
    llmGateway: null,
    geminiApi: {
      request,
      response,
      providerStatus: buildGeminiProviderStatus(context, response),
      error: normalizeGeminiError(input, response, outcome),
    },
    timing: {
      requestStartedAt,
      requestWrittenAt: input.requestWrittenAt || null,
      responseHeadersAt: input.responseHeadersAt || null,
      responseCompletedAt,
      durationMs: Number.isFinite(input.durationMs)
        ? input.durationMs
        : Math.max(new Date(responseCompletedAt).getTime() - new Date(requestStartedAt).getTime(), 0),
    },
    outcome,
    error: input.error
      ? {
          ...compactError(input.error),
          rawBody: input.error.rawBody || input.errorRawBody || null,
          object: input.error.object === undefined ? null : cloneJsonSafe(input.error.object),
        }
      : null,
    redaction: {
      applied: false,
      redactedHeaderNames: [],
      redactedBodyPaths: [],
      notes: [],
    },
    storage: {
      inline: true,
      externalPayloads: [],
      notes: [],
      truncated: false,
      truncationReason: null,
    },
  };
}

function buildHttpProviderCallPackage(input = {}) {
  const context = input.captureContext || input.context || {};
  const requestStartedAt = input.requestStartedAt || input.startedAt || nowIso();
  const responseCompletedAt = input.responseCompletedAt || input.completedAt || nowIso();
  const baseUrl = input.baseUrl || context.baseUrl || 'http://localhost';
  const urlPath = input.urlPath || input.path || '/';
  const url = new URL(urlPath, baseUrl);
  const serializedBody = serializeBody(input.body);
  const responseBodyText = typeof input.response?.bodyText === 'string'
    ? input.response.bodyText
    : (typeof input.response?.body === 'string' ? input.response.body : '');
  const parsedResult = input.response?.parsedJson !== undefined
    ? { parsed: input.response.parsedJson, parseError: null, parseable: true }
    : safeJsonParse(responseBodyText);
  const outcome = classifyHttpOutcome({
    ...input,
    response: {
      ...(input.response || {}),
      bodyText: responseBodyText,
    },
  }, parsedResult.parseable);

  return {
    schemaVersion: SCHEMA_VERSION,
    captureVersion: CAPTURE_VERSION,
    providerId: context.providerId || input.providerId || '',
    providerResearchId: context.providerResearchId || input.providerResearchId || '',
    providerPathType: context.providerPathType || input.providerPathType || 'direct-http',
    callSite: context.callSite || input.callSite || '',
    operation: context.operation || input.operation || '',
    source: context.source || input.source || null,
    metadata: resolveCaptureMetadata(input, context),
    request: {
      method: input.method || context.method || 'POST',
      url: url.toString(),
      protocol: url.protocol,
      hostname: url.hostname,
      port: normalizePort(url),
      path: `${url.pathname}${url.search}`,
      headers: input.headers || {},
      redactedHeaderNames: [],
      ...serializedBody,
      bodyPayloadRef: null,
      modelRequested: context.modelRequested || input.modelRequested || serializedBody.bodyJson?.model || '',
      timeoutMs: input.timeoutMs || context.timeoutMs || null,
    },
    response: buildResponsePackage(input, responseBodyText, parsedResult),
    timing: {
      requestStartedAt,
      requestWrittenAt: input.requestWrittenAt || null,
      responseHeadersAt: input.responseHeadersAt || null,
      responseCompletedAt,
      durationMs: Number.isFinite(input.durationMs)
        ? input.durationMs
        : Math.max(new Date(responseCompletedAt).getTime() - new Date(requestStartedAt).getTime(), 0),
    },
    outcome,
    error: input.error
      ? {
          ...compactError(input.error),
          rawBody: input.error.rawBody || null,
          object: input.error.object || null,
        }
      : null,
    redaction: {
      applied: false,
      redactedHeaderNames: [],
      redactedBodyPaths: [],
      notes: [],
    },
    storage: {
      inline: true,
      externalPayloads: [],
      truncated: false,
      truncationReason: null,
    },
  };
}

async function recordProviderCallPackage(envelope, options = {}) {
  if (!options.force && !isProviderCallPackageCaptureEnabled()) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }

  if (mongoose.connection.readyState !== 1) {
    return { ok: false, skipped: true, reason: 'mongoose_not_connected' };
  }

  try {
    const packageId = options.packageId || new mongoose.Types.ObjectId();
    const redacted = redactProviderCallPackage(envelope);
    redacted._id = packageId;
    const prepared = await externalizeProviderCallPackagePayloads(redacted, {
      packageId,
      maxInlineBytes: options.maxInlineBytes,
      payloadRoot: options.payloadRoot,
      now: options.now,
      fields: options.fields,
      kindByField: options.kindByField,
    });

    // Short-retention stamp for probe packages: override the schema's default
    // expiresAt (long forensic retention) so health-probe noise self-cleans
    // via the existing TTL index on expiresAt.
    if ((prepared.operation || envelope?.operation) === PROBE_OPERATION) {
      prepared.expiresAt = new Date(Date.now() + resolveProbeTtlHours() * 60 * 60 * 1000);
    }

    const doc = await ProviderCallPackage.create(prepared);
    return { ok: true, id: String(doc._id) };
  } catch (err) {
    return {
      ok: false,
      error: {
        name: err.name || 'Error',
        message: err.message || String(err),
        code: err.code || '',
      },
    };
  }
}

async function recordHttpProviderCallPackage(input, options = {}) {
  try {
    const envelope = buildHttpProviderCallPackage(input);
    return await recordProviderCallPackage(envelope, options);
  } catch (err) {
    return {
      ok: false,
      error: {
        name: err.name || 'Error',
        message: err.message || String(err),
        code: err.code || '',
      },
    };
  }
}

function recordHttpProviderCallPackageInBackground(input, options = {}) {
  const promise = Promise.resolve()
    .then(() => recordHttpProviderCallPackage(input, options))
    .catch((err) => ({
      ok: false,
      error: {
        name: err.name || 'Error',
        message: err.message || String(err),
        code: err.code || '',
      },
    }));
  inFlightBackgroundRecords.add(promise);
  promise.finally(() => {
    inFlightBackgroundRecords.delete(promise);
  });
  return { queued: true, promise };
}

function cliPayloadOptions(options = {}) {
  return {
    ...options,
    fields: options.fields || [
      'cli.stdin.text',
      'cli.stdout.text',
      'cli.stdout.lines',
      'cli.stdout.jsonlEvents',
      'cli.stdout.malformedLines',
      'cli.stdout.finalBuffer',
      'cli.stderr.text',
    ],
    kindByField: {
      'cli.stdin.text': 'cli_stdin',
      'cli.stdout.text': 'cli_stdout',
      'cli.stdout.lines': 'cli_stdout_lines',
      'cli.stdout.jsonlEvents': 'cli_stdout_jsonl_events',
      'cli.stdout.malformedLines': 'cli_stdout_malformed_lines',
      'cli.stdout.finalBuffer': 'cli_stdout_final_buffer',
      'cli.stderr.text': 'cli_stderr',
      ...(options.kindByField || {}),
    },
  };
}

async function recordCliProviderCallPackage(input, options = {}) {
  try {
    const envelope = buildCliProviderCallPackage(input);
    return await recordProviderCallPackage(envelope, cliPayloadOptions(options));
  } catch (err) {
    return {
      ok: false,
      error: {
        name: err.name || 'Error',
        message: err.message || String(err),
        code: err.code || '',
      },
    };
  }
}

function lmStudioPayloadOptions(options = {}) {
  return {
    ...options,
    fields: options.fields || [
      'lmStudio.request.bodyText',
      'lmStudio.request.bodyJson',
      'lmStudio.response.bodyText',
      'lmStudio.response.parsedJson',
      'lmStudio.stream.parsedChunks',
      'lmStudio.stream.finalBuffer',
      'lmStudio.stream.fullResponse',
      'lmStudio.error.rawBody',
    ],
    kindByField: {
      'lmStudio.request.bodyText': 'lm_studio_request_body',
      'lmStudio.request.bodyJson': 'lm_studio_request_body_json',
      'lmStudio.response.bodyText': 'lm_studio_response_body',
      'lmStudio.response.parsedJson': 'lm_studio_response_parsed_json',
      'lmStudio.stream.parsedChunks': 'lm_studio_stream_parsed_chunks',
      'lmStudio.stream.finalBuffer': 'lm_studio_stream_final_buffer',
      'lmStudio.stream.fullResponse': 'lm_studio_stream_full_response',
      'lmStudio.error.rawBody': 'lm_studio_error_raw_body',
      ...(options.kindByField || {}),
    },
  };
}

function llmGatewayPayloadOptions(options = {}) {
  return {
    ...options,
    fields: options.fields || [
      'llmGateway.request.bodyText',
      'llmGateway.request.bodyJson',
      'llmGateway.response.bodyText',
      'llmGateway.response.parsedJson',
      'llmGateway.error.rawBody',
    ],
    kindByField: {
      'llmGateway.request.bodyText': 'llm_gateway_request_body',
      'llmGateway.request.bodyJson': 'llm_gateway_request_body_json',
      'llmGateway.response.bodyText': 'llm_gateway_response_body',
      'llmGateway.response.parsedJson': 'llm_gateway_response_parsed_json',
      'llmGateway.error.rawBody': 'llm_gateway_error_raw_body',
      ...(options.kindByField || {}),
    },
  };
}

function geminiApiPayloadOptions(options = {}) {
  return {
    ...options,
    fields: options.fields || [
      'geminiApi.request.bodyText',
      'geminiApi.request.bodyJson',
      'geminiApi.response.bodyText',
      'geminiApi.response.parsedJson',
      'geminiApi.error.rawBody',
    ],
    kindByField: {
      'geminiApi.request.bodyText': 'gemini_api_request_body',
      'geminiApi.request.bodyJson': 'gemini_api_request_body_json',
      'geminiApi.response.bodyText': 'gemini_api_response_body',
      'geminiApi.response.parsedJson': 'gemini_api_response_parsed_json',
      'geminiApi.error.rawBody': 'gemini_api_error_raw_body',
      ...(options.kindByField || {}),
    },
  };
}

async function recordLmStudioProviderCallPackage(input, options = {}) {
  try {
    const envelope = buildLmStudioProviderCallPackage(input);
    return await recordProviderCallPackage(envelope, lmStudioPayloadOptions(options));
  } catch (err) {
    return {
      ok: false,
      error: {
        name: err.name || 'Error',
        message: err.message || String(err),
        code: err.code || '',
      },
    };
  }
}

async function recordLlmGatewayProviderCallPackage(input, options = {}) {
  try {
    const envelope = buildLlmGatewayProviderCallPackage(input);
    return await recordProviderCallPackage(envelope, llmGatewayPayloadOptions(options));
  } catch (err) {
    return {
      ok: false,
      error: {
        name: err.name || 'Error',
        message: err.message || String(err),
        code: err.code || '',
      },
    };
  }
}

async function recordGeminiApiProviderCallPackage(input, options = {}) {
  try {
    const envelope = buildGeminiApiProviderCallPackage(input);
    return await recordProviderCallPackage(envelope, geminiApiPayloadOptions(options));
  } catch (err) {
    return {
      ok: false,
      error: {
        name: err.name || 'Error',
        message: err.message || String(err),
        code: err.code || '',
      },
    };
  }
}

function recordProviderCallPackageInBackground(envelope, options = {}) {
  const promise = Promise.resolve()
    .then(() => recordProviderCallPackage(envelope, options))
    .catch((err) => ({
      ok: false,
      error: {
        name: err.name || 'Error',
        message: err.message || String(err),
        code: err.code || '',
      },
    }));
  inFlightBackgroundRecords.add(promise);
  promise.finally(() => {
    inFlightBackgroundRecords.delete(promise);
  });
  return { queued: true, promise };
}

function recordCliProviderCallPackageInBackground(input, options = {}) {
  const promise = Promise.resolve()
    .then(() => recordCliProviderCallPackage(input, options))
    .catch((err) => ({
      ok: false,
      error: {
        name: err.name || 'Error',
        message: err.message || String(err),
        code: err.code || '',
      },
    }));
  inFlightBackgroundRecords.add(promise);
  promise.finally(() => {
    inFlightBackgroundRecords.delete(promise);
  });
  return { queued: true, promise };
}

function recordLmStudioProviderCallPackageInBackground(input, options = {}) {
  const promise = Promise.resolve()
    .then(() => recordLmStudioProviderCallPackage(input, options))
    .catch((err) => ({
      ok: false,
      error: {
        name: err.name || 'Error',
        message: err.message || String(err),
        code: err.code || '',
      },
    }));
  inFlightBackgroundRecords.add(promise);
  promise.finally(() => {
    inFlightBackgroundRecords.delete(promise);
  });
  return { queued: true, promise };
}

function recordLlmGatewayProviderCallPackageInBackground(input, options = {}) {
  const promise = Promise.resolve()
    .then(() => recordLlmGatewayProviderCallPackage(input, options))
    .catch((err) => ({
      ok: false,
      error: {
        name: err.name || 'Error',
        message: err.message || String(err),
        code: err.code || '',
      },
    }));
  inFlightBackgroundRecords.add(promise);
  promise.finally(() => {
    inFlightBackgroundRecords.delete(promise);
  });
  return { queued: true, promise };
}

function recordGeminiApiProviderCallPackageInBackground(input, options = {}) {
  const promise = Promise.resolve()
    .then(() => recordGeminiApiProviderCallPackage(input, options))
    .catch((err) => ({
      ok: false,
      error: {
        name: err.name || 'Error',
        message: err.message || String(err),
        code: err.code || '',
      },
    }));
  inFlightBackgroundRecords.add(promise);
  promise.finally(() => {
    inFlightBackgroundRecords.delete(promise);
  });
  return { queued: true, promise };
}

async function __waitForProviderPackageRecorderSettled() {
  const pending = Array.from(inFlightBackgroundRecords);
  if (pending.length === 0) {
    await Promise.resolve();
    return;
  }
  await Promise.allSettled(pending);
}

function buildResponseChunk(seq, chunk, receivedAt = new Date()) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  return {
    seq,
    receivedAt,
    byteLength: Buffer.byteLength(text, 'utf8'),
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
    text,
    textPayloadRef: null,
  };
}

module.exports = {
  CAPTURE_VERSION,
  CLI_CAPTURE_VERSION,
  GEMINI_API_CAPTURE_VERSION,
  LLM_GATEWAY_CAPTURE_VERSION,
  LM_STUDIO_CAPTURE_VERSION,
  SCHEMA_VERSION,
  buildCliProviderCallPackage,
  buildGeminiApiProviderCallPackage,
  buildHttpProviderCallPackage,
  buildLlmGatewayProviderCallPackage,
  buildLmStudioProviderCallPackage,
  buildResponseChunk,
  __waitForProviderPackageRecorderSettled,
  isProviderCallPackageCaptureEnabled,
  recordCliProviderCallPackage,
  recordCliProviderCallPackageInBackground,
  recordGeminiApiProviderCallPackage,
  recordGeminiApiProviderCallPackageInBackground,
  recordHttpProviderCallPackage,
  recordHttpProviderCallPackageInBackground,
  recordLlmGatewayProviderCallPackage,
  recordLlmGatewayProviderCallPackageInBackground,
  recordLmStudioProviderCallPackage,
  recordLmStudioProviderCallPackageInBackground,
  recordProviderCallPackage,
  recordProviderCallPackageInBackground,
};
