'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const mongoose = require('mongoose');

const {
  buildResponseChunk,
  isProviderCallPackageCaptureEnabled,
  recordGeminiApiProviderCallPackageInBackground,
} = require('../provider-call-package-recorder');
const {
  attachProviderTraceToError,
  observeProviderPackageCapture,
  requireProviderPackageCapture,
  withProviderTraceUpdates,
} = require('./provider-handoff');

const DEFAULT_GEMINI_API_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_API_GENERATE_CONTENT_CALL_SITE = 'gemini-api-provider-harness:generateContent';
const GEMINI_API_SOURCE_FILE = 'server/src/services/providers/gemini-api-provider-harness.js';

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value || '').digest('hex');
}

function byteLength(value) {
  return Buffer.byteLength(value || '', 'utf8');
}

function emitProviderEvent(onProviderEvent, type, data = {}) {
  if (typeof onProviderEvent !== 'function') return;
  try {
    onProviderEvent(type, {
      providerId: 'gemini',
      providerHarness: 'gemini-api',
      timestamp: nowIso(),
      ...data,
    });
  } catch (err) {
    console.warn('[gemini-api-provider-harness] provider event listener failed:', err.message);
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
    providerId: 'gemini',
    providerResearchId: 'gemini-api',
    providerPathType: 'direct-http',
    providerHarness: 'gemini-api',
    operation,
    callSite,
    modelRequested: model,
    model,
    requestStartedAt: startedAt,
    providerPackageId: providerPackageId ? String(providerPackageId) : null,
    captureEnabled: Boolean(captureEnabled),
    packageCaptureQueued: false,
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
  responseFinishedAt,
}) {
  if (!captureEnabled || !packageId) {
    return { queued: false, packageId: null };
  }

  const captureInput = {
    providerId: 'gemini',
    providerResearchId: 'gemini-api',
    providerPathType: 'direct-http',
    callSite: captureContext.callSite || GEMINI_API_GENERATE_CONTENT_CALL_SITE,
    operation: captureContext.operation || 'generate-content',
    method: request.method,
    baseUrl: request.baseUrl,
    urlPath: request.urlPath,
    body: request.body,
    headers: request.headers,
    timeoutMs: request.timeoutMs,
    captureContext,
    requestStartedAt,
    requestWrittenAt: request.requestWrittenAt || null,
    responseCompletedAt: responseFinishedAt,
    response,
    error,
    outcome,
    source: {
      file: GEMINI_API_SOURCE_FILE,
      functionName: captureContext.functionName || 'sendGeminiGenerateContent',
      helperName: 'sendJsonRequest',
    },
    metadata: {
      ...(captureContext.metadata || {}),
      providerHarness: 'gemini-api',
      modelRequested: captureContext.modelRequested || null,
    },
  };

  const queued = recordGeminiApiProviderCallPackageInBackground(captureInput, {
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
  const providerTrace = createProviderTraceBase({
    model: captureContext.modelRequested,
    operation: captureContext.operation || 'generate-content',
    callSite: captureContext.callSite || GEMINI_API_GENERATE_CONTENT_CALL_SITE,
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
        responseFinishedAt: finishedAt,
      });

      providerTrace.responseFinishedAt = finishedAt;
      providerTrace.durationMs = Date.now() - startedMs;
      providerTrace.packageCaptureQueued = capture.queued;
      providerTrace.outcome = outcome;
      observeProviderPackageCapture({
        providerTrace,
        capture,
        onProviderEvent,
        providerId: 'gemini',
        providerHarness: 'gemini-api',
      });
      emitProviderEvent(onProviderEvent, 'provider.harness_error', {
        outcome,
        errorCode: err.code,
        errorMessage: err.message,
        providerPackageId: providerTrace.providerPackageId,
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
            outcome,
          });
          observeProviderPackageCapture({
            providerTrace: finalTrace,
            capture,
            onProviderEvent,
            providerId: 'gemini',
            providerHarness: 'gemini-api',
          });

          emitProviderEvent(onProviderEvent, 'provider.harness_response_received', {
            statusCode: finalTrace.statusCode,
            durationMs: finalTrace.durationMs,
            responseBodyBytes: finalTrace.responseBodyBytes,
            providerPackageId: finalTrace.providerPackageId,
          });
          if (capture.queued) {
            emitProviderEvent(onProviderEvent, 'provider.package_capture_queued', {
              providerPackageId: finalTrace.providerPackageId,
              captureEnabled: true,
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
      const err = new Error('Gemini request aborted');
      err.name = 'AbortError';
      err.code = 'ABORT_ERR';
      rejectOnce(err, 'aborted');
      req.destroy(err);
      return;
    }

    if (signal) {
      const onAbort = () => {
        const err = new Error('Gemini request aborted');
        err.name = 'AbortError';
        err.code = 'ABORT_ERR';
        rejectOnce(err, 'aborted');
        req.destroy(err);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    }

    req.on('timeout', () => {
      const err = new Error(`Gemini API request timed out after ${timeoutMs}ms`);
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

async function sendGeminiGenerateContent({
  body,
  model,
  timeoutMs,
  getApiKey,
  captureContext = {},
  onProviderEvent,
  signal,
} = {}) {
  const effectiveModel = model || captureContext.modelRequested || DEFAULT_GEMINI_MODEL;
  const apiKey = typeof getApiKey === 'function' ? await getApiKey('gemini') : null;
  if (!apiKey) {
    const err = new Error('Gemini API key not configured');
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }

  const requestBody = body && typeof body === 'object' ? body : {};
  const effectiveCaptureContext = {
    providerId: 'gemini',
    providerResearchId: 'gemini-api',
    providerPathType: 'direct-http',
    callSite: GEMINI_API_GENERATE_CONTENT_CALL_SITE,
    operation: 'generate-content',
    functionName: 'sendGeminiGenerateContent',
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
      baseUrl: DEFAULT_GEMINI_API_URL,
      path: `/v1beta/models/${encodeURIComponent(effectiveModel)}:generateContent`,
      body: requestBody,
      headers: {
        'x-goog-api-key': apiKey,
      },
      timeoutMs,
      captureContext: effectiveCaptureContext,
      onProviderEvent,
      signal,
    });
  } catch (err) {
    throw attachProviderTraceToError(err, err.providerTrace);
  }

  let providerTrace = response.providerTrace;
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const err = new Error(`Gemini API error (HTTP ${response.statusCode}): ${(response.body || '').slice(0, 500)}`);
    err.code = 'PROVIDER_ERROR';
    err.statusCode = response.statusCode;
    providerTrace = withProviderTraceUpdates(providerTrace, {
      outcome: 'http_error',
    });
    await requireProviderPackageCapture({
      providerTrace,
      onProviderEvent,
      providerId: 'gemini',
      providerHarness: 'gemini-api',
    });
    emitProviderEvent(onProviderEvent, 'provider.harness_error', {
      outcome: 'http_error',
      statusCode: response.statusCode,
      errorCode: err.code,
      errorMessage: err.message,
      providerPackageId: providerTrace.providerPackageId,
    });
    throw attachProviderTraceToError(err, providerTrace);
  }

  if (response.parseError) {
    const err = new Error(`Gemini returned invalid JSON: ${(response.body || '').slice(0, 200)}`);
    err.code = 'PROVIDER_ERROR';
    providerTrace = withProviderTraceUpdates(providerTrace, {
      outcome: 'invalid_json',
    });
    await requireProviderPackageCapture({
      providerTrace,
      onProviderEvent,
      providerId: 'gemini',
      providerHarness: 'gemini-api',
    });
    emitProviderEvent(onProviderEvent, 'provider.harness_error', {
      outcome: 'invalid_json',
      errorCode: err.code,
      errorMessage: err.message,
      providerPackageId: providerTrace.providerPackageId,
    });
    throw attachProviderTraceToError(err, providerTrace);
  }

  providerTrace = withProviderTraceUpdates(providerTrace, {
    outcome: 'success',
    model: response.parsedJson?.modelVersion || effectiveModel,
    modelVersion: response.parsedJson?.modelVersion || null,
    responseId: response.parsedJson?.responseId || null,
  });
  await requireProviderPackageCapture({
    providerTrace,
    onProviderEvent,
    providerId: 'gemini',
    providerHarness: 'gemini-api',
  });

  emitProviderEvent(onProviderEvent, 'provider.package_ready_for_agent', {
    outcome: 'success',
    model: providerTrace.model,
    providerPackageId: providerTrace.providerPackageId,
  });

  return {
    providerTrace,
  };
}

module.exports = {
  GEMINI_API_GENERATE_CONTENT_CALL_SITE,
  GEMINI_GENERATE_CONTENT_CALL_SITE: GEMINI_API_GENERATE_CONTENT_CALL_SITE,
  sendGeminiGenerateContent,
};
