'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');

const ProviderCallPackage = require('../models/ProviderCallPackage');
const { redactProviderCallPackage } = require('./provider-call-package-redaction');
const { externalizeProviderCallPackagePayloads, sha256 } = require('./provider-call-package-payload-store');
const { colorProviderHarnessLine, providerHarnessTrace } = require('../lib/provider-harness-trace');

const CAPTURE_VERSION = 'provider-harness-http-v0.1';
const CLI_CAPTURE_VERSION = 'provider-harness-cli-v0.2';
const SCHEMA_VERSION = '0.1';
let warnedMongooseNotConnected = false;
const inFlightBackgroundRecords = new Set();

function isProviderCallPackageCaptureEnabled() {
  return String(process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE || '').toLowerCase() === 'true';
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
  providerHarnessTrace('provider-call-package.recordProviderCallPackage.enter', {
    providerId: envelope?.providerId || '',
    providerResearchId: envelope?.providerResearchId || '',
    providerPathType: envelope?.providerPathType || '',
    callSite: envelope?.callSite || '',
    operation: envelope?.operation || '',
    outcome: envelope?.outcome || '',
    captureEnabled: isProviderCallPackageCaptureEnabled(),
    force: Boolean(options.force),
  });
  if (!options.force && !isProviderCallPackageCaptureEnabled()) {
    providerHarnessTrace('provider-call-package.recordProviderCallPackage.skipped', {
      providerId: envelope?.providerId || '',
      callSite: envelope?.callSite || '',
      reason: 'disabled',
    });
    return { ok: false, skipped: true, reason: 'disabled' };
  }

  if (mongoose.connection.readyState !== 1) {
    providerHarnessTrace('provider-call-package.recordProviderCallPackage.skipped', {
      providerId: envelope?.providerId || '',
      callSite: envelope?.callSite || '',
      reason: 'mongoose_not_connected',
      readyState: mongoose.connection.readyState,
    });
    if (options.log !== false && !warnedMongooseNotConnected) {
      warnedMongooseNotConnected = true;
      console.warn(colorProviderHarnessLine('[provider-call-package-recorder] capture skipped: mongoose is not connected'));
    }
    return { ok: false, skipped: true, reason: 'mongoose_not_connected' };
  }

  try {
    const packageId = options.packageId || new mongoose.Types.ObjectId();
    providerHarnessTrace('provider-call-package.recordProviderCallPackage.redaction.start', {
      providerId: envelope?.providerId || '',
      callSite: envelope?.callSite || '',
      packageId: String(packageId),
    });
    const redacted = redactProviderCallPackage(envelope);
    providerHarnessTrace('provider-call-package.recordProviderCallPackage.redaction.done', {
      providerId: redacted?.providerId || '',
      callSite: redacted?.callSite || '',
      packageId: String(packageId),
      redactedHeaderNames: redacted?.redaction?.redactedHeaderNames || [],
      redactedBodyPathCount: Array.isArray(redacted?.redaction?.redactedBodyPaths)
        ? redacted.redaction.redactedBodyPaths.length
        : 0,
    });
    redacted._id = packageId;
    providerHarnessTrace('provider-call-package.recordProviderCallPackage.payload_store.start', {
      providerId: redacted?.providerId || '',
      callSite: redacted?.callSite || '',
      packageId: String(packageId),
    });
    const prepared = await externalizeProviderCallPackagePayloads(redacted, {
      packageId,
      maxInlineBytes: options.maxInlineBytes,
      payloadRoot: options.payloadRoot,
      now: options.now,
      fields: options.fields,
      kindByField: options.kindByField,
    });
    providerHarnessTrace('provider-call-package.recordProviderCallPackage.payload_store.done', {
      providerId: prepared?.providerId || '',
      callSite: prepared?.callSite || '',
      packageId: String(packageId),
      inline: Boolean(prepared?.storage?.inline),
      externalPayloadCount: Array.isArray(prepared?.storage?.externalPayloads)
        ? prepared.storage.externalPayloads.length
        : 0,
    });

    providerHarnessTrace('provider-call-package.recordProviderCallPackage.mongo.insert.start', {
      providerId: prepared?.providerId || '',
      callSite: prepared?.callSite || '',
      packageId: String(packageId),
    });
    const doc = await ProviderCallPackage.create(prepared);
    providerHarnessTrace('provider-call-package.recordProviderCallPackage.mongo.insert.done', {
      providerId: prepared?.providerId || '',
      callSite: prepared?.callSite || '',
      id: String(doc._id),
    });
    return { ok: true, id: String(doc._id) };
  } catch (err) {
    providerHarnessTrace('provider-call-package.recordProviderCallPackage.failed', {
      providerId: envelope?.providerId || '',
      callSite: envelope?.callSite || '',
      errorName: err.name || 'Error',
      errorCode: err.code || '',
      errorMessage: err.message || '',
    });
    if (options.log !== false) {
      console.warn(colorProviderHarnessLine(`[provider-call-package-recorder] record failed: ${err.message}`));
    }
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
    providerHarnessTrace('provider-call-package.recordHttpProviderCallPackage.enter', {
      providerId: input?.captureContext?.providerId || input?.providerId || '',
      callSite: input?.captureContext?.callSite || input?.callSite || '',
      method: input?.method || '',
      baseUrl: input?.baseUrl || '',
      urlPath: input?.urlPath || '',
      statusCode: input?.response?.statusCode || 0,
      hasError: Boolean(input?.error),
      outcome: input?.outcome || '',
    });
    const envelope = buildHttpProviderCallPackage(input);
    providerHarnessTrace('provider-call-package.recordHttpProviderCallPackage.envelope_built', {
      providerId: envelope?.providerId || '',
      providerResearchId: envelope?.providerResearchId || '',
      providerPathType: envelope?.providerPathType || '',
      callSite: envelope?.callSite || '',
      operation: envelope?.operation || '',
      outcome: envelope?.outcome || '',
      statusCode: envelope?.response?.statusCode || 0,
      requestBodyBytes: envelope?.request?.bodyByteLength || 0,
      responseBodyBytes: envelope?.response?.bodyByteLength || 0,
    });
    return await recordProviderCallPackage(envelope, options);
  } catch (err) {
    providerHarnessTrace('provider-call-package.recordHttpProviderCallPackage.failed', {
      errorName: err.name || 'Error',
      errorCode: err.code || '',
      errorMessage: err.message || '',
    });
    if (options.log !== false) {
      console.warn(colorProviderHarnessLine(`[provider-call-package-recorder] capture failed: ${err.message}`));
    }
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
    providerHarnessTrace('provider-call-package.recordCliProviderCallPackage.enter', {
      providerId: input?.captureContext?.providerId || input?.providerId || '',
      providerResearchId: input?.captureContext?.providerResearchId || input?.providerResearchId || '',
      callSite: input?.captureContext?.callSite || input?.callSite || '',
      operation: input?.captureContext?.operation || input?.operation || '',
      command: input?.command || '',
      outcome: input?.outcome || '',
      exitCode: input?.exitCode,
      signal: input?.signal || '',
      stdoutBytes: Buffer.byteLength(normalizeString(input?.stdoutText), 'utf8'),
      stderrBytes: Buffer.byteLength(normalizeString(input?.stderrText), 'utf8'),
      hasError: Boolean(input?.error),
    });
    const envelope = buildCliProviderCallPackage(input);
    providerHarnessTrace('provider-call-package.recordCliProviderCallPackage.envelope_built', {
      providerId: envelope?.providerId || '',
      providerResearchId: envelope?.providerResearchId || '',
      providerPathType: envelope?.providerPathType || '',
      callSite: envelope?.callSite || '',
      operation: envelope?.operation || '',
      command: envelope?.cli?.command || '',
      outcome: envelope?.outcome || '',
      stdoutBytes: envelope?.cli?.stdout?.byteLength || 0,
      stdoutLineCount: Array.isArray(envelope?.cli?.stdout?.lines) ? envelope.cli.stdout.lines.length : 0,
      jsonlEventCount: Array.isArray(envelope?.cli?.stdout?.jsonlEvents) ? envelope.cli.stdout.jsonlEvents.length : 0,
      malformedLineCount: Array.isArray(envelope?.cli?.stdout?.malformedLines) ? envelope.cli.stdout.malformedLines.length : 0,
      stderrBytes: envelope?.cli?.stderr?.byteLength || 0,
    });
    return await recordProviderCallPackage(envelope, cliPayloadOptions(options));
  } catch (err) {
    providerHarnessTrace('provider-call-package.recordCliProviderCallPackage.failed', {
      errorName: err.name || 'Error',
      errorCode: err.code || '',
      errorMessage: err.message || '',
    });
    if (options.log !== false) {
      console.warn(colorProviderHarnessLine(`[provider-call-package-recorder] CLI capture failed: ${err.message}`));
    }
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
  providerHarnessTrace('provider-call-package.recordCliProviderCallPackage.background_queued', {
    providerId: input?.captureContext?.providerId || input?.providerId || '',
    callSite: input?.captureContext?.callSite || input?.callSite || '',
    operation: input?.captureContext?.operation || input?.operation || '',
    command: input?.command || '',
  });
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
  SCHEMA_VERSION,
  buildCliProviderCallPackage,
  buildHttpProviderCallPackage,
  buildResponseChunk,
  __waitForProviderPackageRecorderSettled,
  isProviderCallPackageCaptureEnabled,
  recordCliProviderCallPackage,
  recordCliProviderCallPackageInBackground,
  recordHttpProviderCallPackage,
  recordProviderCallPackage,
  recordProviderCallPackageInBackground,
};
