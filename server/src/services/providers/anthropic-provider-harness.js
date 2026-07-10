'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const mongoose = require('mongoose');

const {
  buildResponseChunk,
  isProviderCallPackageCaptureEnabled,
  recordHttpProviderCallPackageInBackground,
} = require('../provider-call-package-recorder');
const {
  attachProviderTraceToError,
  observeProviderPackageCapture,
  requireProviderPackageCapture,
  withProviderTraceUpdates,
} = require('./provider-handoff');

const DEFAULT_ANTHROPIC_API_URL = 'https://api.anthropic.com';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5';
const ANTHROPIC_MESSAGES_CALL_SITE = 'anthropic-provider-harness:sendMessages';
const ANTHROPIC_SOURCE_FILE = 'server/src/services/providers/anthropic-provider-harness.js';

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value || '').digest('hex');
}

function byteLength(value) {
  return Buffer.byteLength(value || '', 'utf8');
}

function getAnthropicApiUrl() {
  return process.env.ANTHROPIC_API_URL || DEFAULT_ANTHROPIC_API_URL;
}

function emitProviderEvent(onProviderEvent, type, data = {}) {
  if (typeof onProviderEvent !== 'function') return;
  try {
    onProviderEvent(type, {
      providerId: 'anthropic',
      providerHarness: 'anthropic-api',
      timestamp: nowIso(),
      ...data,
    });
  } catch (err) {
    console.warn('[anthropic-provider-harness] provider event listener failed:', err.message);
  }
}

function createProviderTraceBase({
  model,
  operation,
  callSite,
  captureEnabled,
  providerPackageId,
  startedAt,
  requestBodyText,
}) {
  return {
    providerId: 'anthropic',
    providerResearchId: 'anthropic-api',
    providerPathType: 'direct-http',
    providerHarness: 'anthropic-api',
    operation,
    callSite,
    modelRequested: model,
    model,
    requestStartedAt: startedAt,
    providerPackageId: providerPackageId ? String(providerPackageId) : null,
    captureEnabled: Boolean(captureEnabled),
    packageCaptureQueued: false,
    packageCaptureStatus: captureEnabled ? 'reserved' : 'disabled',
    requestBodySha256: sha256(requestBodyText),
    requestBodyBytes: byteLength(requestBodyText),
    outcome: 'started',
  };
}

function queueCapture({
  packageId,
  captureEnabled,
  captureContext,
  request,
  response,
  error,
  outcome,
  requestStartedAt,
  responseHeadersAt,
  responseFinishedAt,
}) {
  if (!captureEnabled || !packageId) {
    return { queued: false, packageId: null, promise: null };
  }

  const captureInput = {
    providerId: 'anthropic',
    providerResearchId: 'anthropic-api',
    providerPathType: 'direct-http',
    callSite: captureContext.callSite || ANTHROPIC_MESSAGES_CALL_SITE,
    operation: captureContext.operation || 'messages',
    method: request.method,
    baseUrl: request.baseUrl,
    urlPath: request.urlPath,
    body: request.body,
    headers: request.headers,
    timeoutMs: request.timeoutMs,
    captureContext,
    requestStartedAt,
    requestWrittenAt: request.requestWrittenAt || null,
    responseHeadersAt: responseHeadersAt || null,
    responseCompletedAt: responseFinishedAt,
    response,
    error,
    outcome,
    source: {
      file: ANTHROPIC_SOURCE_FILE,
      functionName: captureContext.functionName || 'sendAnthropicMessages',
      helperName: 'sendJsonRequest',
    },
    metadata: {
      ...(captureContext.metadata || {}),
      providerHarness: 'anthropic-api',
      modelRequested: captureContext.modelRequested || null,
    },
  };

  const queued = recordHttpProviderCallPackageInBackground(captureInput, {
    packageId,
    force: captureContext.forceCapture === true,
  });

  return {
    queued: Boolean(queued && queued.queued),
    packageId: String(packageId),
    promise: queued && queued.promise ? queued.promise : null,
  };
}

function sendJsonRequest({
  method,
  baseUrl,
  path,
  body,
  headers = {},
  timeoutMs,
  captureContext = {},
  onProviderEvent,
  signal,
}) {
  const url = new URL(path, baseUrl);
  const requestBodyText = JSON.stringify(body || {});
  const startedAt = nowIso();
  const startedMs = Date.now();
  const captureEnabled = captureContext.forceCapture === true || isProviderCallPackageCaptureEnabled(captureContext);
  const packageId = captureEnabled ? new mongoose.Types.ObjectId() : null;
  const requestHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Content-Length': Buffer.byteLength(requestBodyText),
    ...headers,
  };
  const requestMetadata = {
    method,
    baseUrl,
    urlPath: path,
    url: url.toString(),
    headers: requestHeaders,
    body,
    bodyByteLength: byteLength(requestBodyText),
    timeoutMs,
    requestWrittenAt: null,
  };
  let responseHeadersAt = null;
  const providerTrace = createProviderTraceBase({
    model: captureContext.modelRequested,
    operation: captureContext.operation || 'messages',
    callSite: captureContext.callSite || ANTHROPIC_MESSAGES_CALL_SITE,
    captureEnabled,
    providerPackageId: packageId,
    startedAt,
    requestBodyText,
  });

  emitProviderEvent(onProviderEvent, 'provider.harness_request_started', {
    callSite: providerTrace.callSite,
    operation: providerTrace.operation,
    model: providerTrace.model,
    url: url.toString(),
    captureEnabled,
    providerPackageId: providerTrace.providerPackageId,
    packageCaptureStatus: providerTrace.packageCaptureStatus,
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutTriggered = false;
    let removeAbortListener = null;
    function cleanupAbortListener() {
      removeAbortListener?.();
      removeAbortListener = null;
    }

    function rejectOnce(err, outcome) {
      if (settled) return;
      settled = true;
      cleanupAbortListener();
      const finishedAt = nowIso();
      const capture = queueCapture({
        packageId,
        captureEnabled,
        captureContext,
        request: requestMetadata,
        response: null,
        error: {
          message: err.message,
          code: err.code,
          name: err.name,
        },
        outcome,
        requestStartedAt: startedAt,
        responseHeadersAt,
        responseFinishedAt: finishedAt,
      });

      providerTrace.responseFinishedAt = finishedAt;
      providerTrace.durationMs = Date.now() - startedMs;
      providerTrace.packageCaptureQueued = capture.queued;
      providerTrace.packageCaptureStatus = capture.queued ? 'queued' : providerTrace.packageCaptureStatus;
      providerTrace.outcome = outcome;
      observeProviderPackageCapture({
        providerTrace,
        capture,
        onProviderEvent,
        providerId: 'anthropic',
        providerHarness: 'anthropic-api',
      });
      emitProviderEvent(onProviderEvent, 'provider.harness_error', {
        outcome,
        errorCode: err.code,
        errorMessage: err.message,
        providerPackageId: providerTrace.providerPackageId,
        packageCaptureStatus: providerTrace.packageCaptureStatus,
      });
      reject(attachProviderTraceToError(err, providerTrace));
    }

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method,
        headers: requestHeaders,
        timeout: timeoutMs,
      },
      (res) => {
        const responseChunks = [];
        const responseTextChunks = [];
        responseHeadersAt = nowIso();

        emitProviderEvent(onProviderEvent, 'provider.harness_response_headers_received', {
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          providerPackageId: providerTrace.providerPackageId,
        });

        res.on('data', (chunk) => {
          const buffer = Buffer.from(chunk);
          responseChunks.push(buffer);
          if (captureEnabled) {
            responseTextChunks.push(buildResponseChunk(responseTextChunks.length, buffer, new Date()));
          }
        });

        res.on('error', (err) => {
          rejectOnce(err, 'network_error');
        });

        res.on('end', () => {
          if (settled) return;
          settled = true;
          cleanupAbortListener();
          const finishedAt = nowIso();
          const rawBodyText = Buffer.concat(responseChunks).toString('utf8');
          let parsedJson = null;
          let parseError = null;

          try {
            parsedJson = rawBodyText ? JSON.parse(rawBodyText) : null;
          } catch (err) {
            parseError = err.message;
          }

          const captureResponse = {
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            httpVersion: res.httpVersion,
            headers: res.headers,
            rawHeaders: res.rawHeaders,
            trailers: res.trailers,
            rawTrailers: res.rawTrailers || [],
            rawBodyText,
            bodyText: rawBodyText,
            bodyChunks: responseTextChunks,
            parsedJson: parseError ? undefined : parsedJson,
            parseError,
          };
          const outcome = parseError
            ? 'invalid_json'
            : (res.statusCode >= 200 && res.statusCode < 300 ? 'success' : 'http_error');
          const capture = queueCapture({
            packageId,
            captureEnabled,
            captureContext,
            request: requestMetadata,
            response: captureResponse,
            error: null,
            outcome,
            requestStartedAt: startedAt,
            responseHeadersAt,
            responseFinishedAt: finishedAt,
          });

          const finalTrace = withProviderTraceUpdates(providerTrace, {
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            httpVersion: res.httpVersion,
            responseFinishedAt: finishedAt,
            durationMs: Date.now() - startedMs,
            responseBodySha256: sha256(rawBodyText),
            responseBodyBytes: byteLength(rawBodyText),
            responseParseError: parseError,
            packageCaptureQueued: capture.queued,
            packageCaptureStatus: capture.queued ? 'queued' : providerTrace.packageCaptureStatus,
            outcome,
          });
          observeProviderPackageCapture({
            providerTrace: finalTrace,
            capture,
            onProviderEvent,
            providerId: 'anthropic',
            providerHarness: 'anthropic-api',
          });

          emitProviderEvent(onProviderEvent, 'provider.harness_response_received', {
            statusCode: finalTrace.statusCode,
            durationMs: finalTrace.durationMs,
            responseBodyBytes: finalTrace.responseBodyBytes,
            providerPackageId: finalTrace.providerPackageId,
            packageCaptureStatus: finalTrace.packageCaptureStatus,
          });
          if (capture.queued) {
            emitProviderEvent(onProviderEvent, 'provider.package_capture_queued', {
              providerPackageId: finalTrace.providerPackageId,
              captureEnabled: true,
              packageCaptureStatus: finalTrace.packageCaptureStatus,
            });
          }

          resolve({
            statusCode: res.statusCode,
            body: rawBodyText,
            parsedJson,
            parseError,
            providerTrace: finalTrace,
          });
        });
      }
    );

    if (signal?.aborted) {
      const err = new Error('Anthropic request aborted');
      err.name = 'AbortError';
      err.code = 'ABORT_ERR';
      rejectOnce(err, 'aborted');
      req.destroy(err);
      return;
    }

    if (signal) {
      const onAbort = () => {
        const err = new Error('Anthropic request aborted');
        err.name = 'AbortError';
        err.code = 'ABORT_ERR';
        rejectOnce(err, 'aborted');
        req.destroy(err);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    }

    req.on('timeout', () => {
      const err = new Error(`Anthropic API request timed out after ${timeoutMs}ms`);
      err.code = 'PROVIDER_TIMEOUT';
      timeoutTriggered = true;
      rejectOnce(err, 'timeout');
      req.destroy(err);
    });

    req.on('error', (err) => {
      const outcome = timeoutTriggered || err.code === 'PROVIDER_TIMEOUT' ? 'timeout' : 'network_error';
      rejectOnce(err, outcome);
    });

    req.write(requestBodyText);
    requestMetadata.requestWrittenAt = nowIso();
    req.end();
  });
}

async function requireCaptureForTrace(providerTrace, onProviderEvent) {
  if (!providerTrace?.captureEnabled) return providerTrace;
  return requireProviderPackageCapture({
    providerTrace,
    onProviderEvent,
    providerId: 'anthropic',
    providerHarness: 'anthropic-api',
  });
}

async function sendAnthropicMessages({
  body,
  model,
  timeoutMs,
  getApiKey,
  captureContext = {},
  onProviderEvent,
  signal,
} = {}) {
  const effectiveModel = model || body?.model || captureContext.modelRequested || DEFAULT_ANTHROPIC_MODEL;
  const apiKey = typeof getApiKey === 'function' ? await getApiKey('anthropic') : null;
  if (!apiKey) {
    const err = new Error('Anthropic API key not configured');
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }

  const requestBody = {
    ...(body && typeof body === 'object' ? body : {}),
    model: effectiveModel,
  };
  const effectiveCaptureContext = {
    providerId: 'anthropic',
    providerResearchId: 'anthropic-api',
    providerPathType: 'direct-http',
    callSite: ANTHROPIC_MESSAGES_CALL_SITE,
    operation: 'messages',
    functionName: 'sendAnthropicMessages',
    modelRequested: effectiveModel,
    ...captureContext,
    metadata: {
      ...(captureContext.metadata || {}),
    },
  };

  let response;
  try {
    response = await sendJsonRequest({
      method: 'POST',
      baseUrl: getAnthropicApiUrl(),
      path: '/v1/messages',
      body: requestBody,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      timeoutMs,
      captureContext: effectiveCaptureContext,
      onProviderEvent,
      signal,
    });
  } catch (err) {
    if (err.providerTrace?.captureEnabled) {
      const providerTrace = await requireCaptureForTrace(err.providerTrace, onProviderEvent);
      throw attachProviderTraceToError(err, providerTrace);
    }
    throw attachProviderTraceToError(err, err.providerTrace);
  }

  let providerTrace = response.providerTrace;
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const err = new Error(`Anthropic API error (HTTP ${response.statusCode}): ${(response.body || '').slice(0, 500)}`);
    err.code = 'PROVIDER_ERROR';
    err.statusCode = response.statusCode;
    providerTrace = withProviderTraceUpdates(providerTrace, {
      outcome: 'http_error',
    });
    await requireCaptureForTrace(providerTrace, onProviderEvent);
    emitProviderEvent(onProviderEvent, 'provider.harness_error', {
      outcome: 'http_error',
      statusCode: response.statusCode,
      errorCode: err.code,
      errorMessage: err.message,
      providerPackageId: providerTrace.providerPackageId,
      packageCaptureStatus: providerTrace.packageCaptureStatus,
    });
    throw attachProviderTraceToError(err, providerTrace);
  }

  if (response.parseError) {
    const err = new Error(`Anthropic returned invalid JSON: ${(response.body || '').slice(0, 200)}`);
    err.code = 'PROVIDER_ERROR';
    providerTrace = withProviderTraceUpdates(providerTrace, {
      outcome: 'invalid_json',
    });
    await requireCaptureForTrace(providerTrace, onProviderEvent);
    emitProviderEvent(onProviderEvent, 'provider.harness_error', {
      outcome: 'invalid_json',
      errorCode: err.code,
      errorMessage: err.message,
      providerPackageId: providerTrace.providerPackageId,
      packageCaptureStatus: providerTrace.packageCaptureStatus,
    });
    throw attachProviderTraceToError(err, providerTrace);
  }

  providerTrace = withProviderTraceUpdates(providerTrace, {
    outcome: 'success',
    model: response.parsedJson?.model || effectiveModel,
    responseId: response.parsedJson?.id || null,
    responseType: response.parsedJson?.type || null,
  });
  await requireCaptureForTrace(providerTrace, onProviderEvent);

  emitProviderEvent(onProviderEvent, 'provider.package_ready_for_agent', {
    outcome: 'success',
    model: providerTrace.model,
    providerPackageId: providerTrace.providerPackageId,
    packageCaptureStatus: providerTrace.packageCaptureStatus,
  });

  return {
    providerTrace,
  };
}

module.exports = {
  ANTHROPIC_MESSAGES_CALL_SITE,
  sendAnthropicMessages,
};
