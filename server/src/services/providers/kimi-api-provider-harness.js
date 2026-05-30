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

const DEFAULT_KIMI_API_URL = process.env.KIMI_API_URL || 'https://api.moonshot.ai';
const DEFAULT_KIMI_MODEL = 'kimi-k2.5';
const KIMI_API_CHAT_COMPLETION_CALL_SITE = 'kimi-api-provider-harness:sendChatCompletion';
const KIMI_API_SOURCE_FILE = 'server/src/services/providers/kimi-api-provider-harness.js';

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
      providerId: 'kimi',
      providerHarness: 'kimi-api',
      timestamp: nowIso(),
      ...data,
    });
  } catch {
    // Provider-event listeners must not affect provider call behavior.
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
    providerId: 'kimi',
    providerResearchId: 'kimi-api',
    providerPathType: 'direct-http',
    providerHarness: 'kimi-api',
    operation,
    callSite,
    modelRequested: model,
    model,
    requestStartedAt: startedAt,
    providerPackageId: providerPackageId ? String(providerPackageId) : null,
    captureEnabled: Boolean(captureEnabled),
    packageCaptureQueued: false,
    packageCaptureStatus: captureEnabled ? 'pending' : 'disabled',
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
    providerId: 'kimi',
    providerResearchId: 'kimi-api',
    providerPathType: 'direct-http',
    callSite: captureContext.callSite || KIMI_API_CHAT_COMPLETION_CALL_SITE,
    operation: captureContext.operation || 'chat-completion',
    method: request.method,
    baseUrl: request.baseUrl,
    urlPath: request.urlPath,
    body: request.body,
    headers: request.headers,
    timeoutMs: request.timeoutMs,
    captureContext,
    requestStartedAt,
    requestWrittenAt: request.requestWrittenAt || null,
    responseHeadersAt: request.responseHeadersAt || null,
    responseCompletedAt: responseFinishedAt,
    response,
    error,
    outcome,
    source: {
      file: KIMI_API_SOURCE_FILE,
      functionName: captureContext.functionName || 'sendKimiChatCompletion',
      helperName: 'sendJsonRequest',
    },
    metadata: {
      ...(captureContext.metadata || {}),
      providerHarness: 'kimi-api',
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
    responseHeadersAt: null,
  };
  const providerTrace = createProviderTraceBase({
    model: captureContext.modelRequested,
    operation: captureContext.operation || 'chat-completion',
    callSite: captureContext.callSite || KIMI_API_CHAT_COMPLETION_CALL_SITE,
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

    function rejectOnce(err, outcome) {
      if (settled) return;
      settled = true;
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
        providerId: 'kimi',
        providerHarness: 'kimi-api',
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
        requestMetadata.responseHeadersAt = nowIso();

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
            providerId: 'kimi',
            providerHarness: 'kimi-api',
          });

          emitProviderEvent(onProviderEvent, 'provider.harness_response_received', {
            statusCode: finalTrace.statusCode,
            durationMs: finalTrace.durationMs,
            responseBodyBytes: finalTrace.responseBodyBytes,
            outcome,
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

    req.on('timeout', () => {
      const err = new Error(`Kimi API request timed out after ${timeoutMs}ms`);
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

async function waitForRequiredCapture(providerTrace, onProviderEvent) {
  return requireProviderPackageCapture({
    providerTrace,
    onProviderEvent,
    providerId: 'kimi',
    providerHarness: 'kimi-api',
  });
}

async function sendKimiChatCompletion({
  body,
  model,
  timeoutMs,
  getApiKey,
  captureContext = {},
  onProviderEvent,
  baseUrl = DEFAULT_KIMI_API_URL,
} = {}) {
  const effectiveModel = model || body?.model || DEFAULT_KIMI_MODEL;
  const apiKey = typeof getApiKey === 'function' ? await getApiKey('kimi') : null;
  if (!apiKey) {
    const err = new Error('Moonshot API key not configured');
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }

  const requestBody = {
    ...(body && typeof body === 'object' ? body : {}),
    model: effectiveModel,
  };
  const effectiveCaptureContext = {
    providerId: 'kimi',
    providerResearchId: 'kimi-api',
    providerPathType: 'direct-http',
    callSite: KIMI_API_CHAT_COMPLETION_CALL_SITE,
    operation: 'chat-completion',
    functionName: 'sendKimiChatCompletion',
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
      baseUrl,
      path: '/v1/chat/completions',
      body: requestBody,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      timeoutMs,
      captureContext: effectiveCaptureContext,
      onProviderEvent,
    });
  } catch (err) {
    let providerTrace = err.providerTrace;
    if (providerTrace?.captureEnabled) {
      providerTrace = await waitForRequiredCapture(providerTrace, onProviderEvent);
    }
    throw attachProviderTraceToError(err, providerTrace || err.providerTrace);
  }

  let providerTrace = response.providerTrace;
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const err = new Error(`Kimi API error (HTTP ${response.statusCode}): ${(response.body || '').slice(0, 500)}`);
    err.code = 'PROVIDER_ERROR';
    err.statusCode = response.statusCode;
    providerTrace = withProviderTraceUpdates(providerTrace, {
      outcome: 'http_error',
    });
    providerTrace = await waitForRequiredCapture(providerTrace, onProviderEvent);
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
    const err = new Error(`Kimi returned invalid JSON: ${(response.body || '').slice(0, 200)}`);
    err.code = 'PROVIDER_ERROR';
    providerTrace = withProviderTraceUpdates(providerTrace, {
      outcome: 'invalid_json',
    });
    providerTrace = await waitForRequiredCapture(providerTrace, onProviderEvent);
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
    model: response.parsedJson?.model || effectiveModel,
    responseId: response.parsedJson?.id || null,
    responseObject: response.parsedJson?.object || null,
  });
  providerTrace = await waitForRequiredCapture(providerTrace, onProviderEvent);

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
  DEFAULT_KIMI_MODEL,
  KIMI_API_CHAT_COMPLETION_CALL_SITE,
  sendKimiChatCompletion,
};
