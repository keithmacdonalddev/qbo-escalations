'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');

const ProviderCallPackage = require('../models/ProviderCallPackage');
const { redactProviderCallPackage } = require('./provider-call-package-redaction');
const { externalizeProviderCallPackagePayloads, sha256 } = require('./provider-call-package-payload-store');

const CAPTURE_VERSION = 'provider-harness-http-v0.1';
const SCHEMA_VERSION = '0.1';
let warnedMongooseNotConnected = false;

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
  if (!options.force && !isProviderCallPackageCaptureEnabled()) {
    return { ok: false, skipped: true, reason: 'disabled' };
  }

  if (mongoose.connection.readyState !== 1) {
    if (options.log !== false && !warnedMongooseNotConnected) {
      warnedMongooseNotConnected = true;
      console.warn('[provider-call-package-recorder] capture skipped: mongoose is not connected');
    }
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
    });

    const doc = await ProviderCallPackage.create(prepared);
    return { ok: true, id: String(doc._id) };
  } catch (err) {
    if (options.log !== false) {
      console.warn('[provider-call-package-recorder] record failed:', err.message);
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
    const envelope = buildHttpProviderCallPackage(input);
    return await recordProviderCallPackage(envelope, options);
  } catch (err) {
    if (options.log !== false) {
      console.warn('[provider-call-package-recorder] capture failed:', err.message);
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
  SCHEMA_VERSION,
  buildHttpProviderCallPackage,
  buildResponseChunk,
  isProviderCallPackageCaptureEnabled,
  recordHttpProviderCallPackage,
  recordProviderCallPackage,
};
