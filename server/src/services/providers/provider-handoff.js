'use strict';

const ProviderCallPackage = require('../../models/ProviderCallPackage');

const DEFAULT_CAPTURE_READBACK_ATTEMPTS = 5;
const DEFAULT_CAPTURE_READBACK_DELAY_MS = 50;

function emitProviderEvent(onProviderEvent, type, data = {}) {
  if (typeof onProviderEvent !== 'function') return;
  try {
    onProviderEvent(type, data);
  } catch {
    // Provider-event listeners must not change provider call behavior.
  }
}

function setPackageCapturePromise(providerTrace, promise) {
  if (!providerTrace || !promise || typeof promise.then !== 'function') return providerTrace;
  Object.defineProperty(providerTrace, 'packageCapturePromise', {
    value: promise,
    enumerable: false,
    configurable: true,
  });
  return providerTrace;
}

function getPackageCapturePromise(providerTrace) {
  const promise = providerTrace?.packageCapturePromise;
  return promise && typeof promise.then === 'function' ? promise : null;
}

function withProviderTraceUpdates(providerTrace, updates = {}) {
  const next = {
    ...(providerTrace || {}),
    ...updates,
  };
  return setPackageCapturePromise(next, getPackageCapturePromise(providerTrace));
}

function captureFailureReason(result) {
  if (!result) return 'unknown capture failure';
  if (result.reason) return String(result.reason);
  if (result.error?.message) return String(result.error.message);
  if (result.error?.code) return String(result.error.code);
  return 'unknown capture failure';
}

function readbackAttempts() {
  const value = Number.parseInt(process.env.PROVIDER_PACKAGE_CAPTURE_READBACK_ATTEMPTS || '', 10);
  return Number.isInteger(value) && value > 0 ? Math.min(value, 20) : DEFAULT_CAPTURE_READBACK_ATTEMPTS;
}

function readbackDelayMs() {
  const value = Number.parseInt(process.env.PROVIDER_PACKAGE_CAPTURE_READBACK_DELAY_MS || '', 10);
  return Number.isInteger(value) && value >= 0 ? Math.min(value, 1000) : DEFAULT_CAPTURE_READBACK_DELAY_MS;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attachProviderTraceToError(err, providerTrace) {
  if (err && providerTrace) {
    err.providerTrace = withProviderTraceUpdates(providerTrace, {
      outcome: providerTrace.outcome || 'error',
    });
  }
  return err;
}

function makeRequiredCaptureError(message, providerTrace, extraTrace = {}) {
  const nextTrace = withProviderTraceUpdates(providerTrace, {
    outcome: 'package_capture_failed',
    packageCaptureStatus: 'failed',
    captureMode: 'required',
    ...extraTrace,
  });
  const err = new Error(message);
  err.code = 'PROVIDER_PACKAGE_CAPTURE_FAILED';
  err.captureMode = 'required';
  err.provider = nextTrace.providerId || nextTrace.provider || '';
  err.model = nextTrace.model || nextTrace.modelRequested || '';
  err.providerPackageId = nextTrace.providerPackageId || null;
  return attachProviderTraceToError(err, nextTrace);
}

async function confirmProviderPackageReadable({
  providerPackageId,
  providerTrace,
  onProviderEvent,
  providerId,
  providerHarness,
} = {}) {
  if (!ProviderCallPackage.db || ProviderCallPackage.db.readyState !== 1) {
    throw makeRequiredCaptureError(
      `Provider package ${providerPackageId} capture is required, but MongoDB is not connected for readback confirmation`,
      providerTrace,
      { packageReadbackStatus: 'mongo_unavailable' }
    );
  }

  const attempts = readbackAttempts();
  const delayMs = readbackDelayMs();
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const found = await ProviderCallPackage.exists({ _id: providerPackageId });
      if (found) {
        emitProviderEvent(onProviderEvent, 'provider.package_capture_read_confirmed', {
          providerId,
          providerHarness,
          providerPackageId,
          captureMode: 'required',
          status: 'complete',
          attempts: attempt,
          surfaceToUser: true,
          displayMessage: `Provider package ${providerPackageId} saved and readable in MongoDB - complete`,
        });
        return { ok: true, attempts: attempt };
      }
    } catch (err) {
      lastError = err;
    }

    if (attempt < attempts) {
      emitProviderEvent(onProviderEvent, 'provider.package_capture_read_retry', {
        providerId,
        providerHarness,
        providerPackageId,
        captureMode: 'required',
        status: 'retrying',
        attempt,
        attempts,
        reason: lastError?.message || 'package not readable yet',
      });
      if (delayMs > 0) await delay(delayMs);
    }
  }

  const reason = lastError?.message || `package was not readable after ${attempts} attempts`;
  throw makeRequiredCaptureError(
    `Provider package ${providerPackageId} capture is required, but MongoDB readback confirmation failed: ${reason}`,
    providerTrace,
    {
      packageReadbackStatus: 'failed',
      packageReadbackAttempts: attempts,
      packageReadbackReason: reason,
    }
  );
}

function observeProviderPackageCapture({
  providerTrace,
  capture,
  onProviderEvent,
  providerId,
  providerHarness,
} = {}) {
  if (!providerTrace || !capture?.queued) return providerTrace;

  providerTrace.packageCaptureStatus = 'queued';
  setPackageCapturePromise(providerTrace, capture.promise);

  emitProviderEvent(onProviderEvent, 'provider.package_capture_started', {
    providerId,
    providerHarness,
    providerPackageId: providerTrace.providerPackageId,
    status: 'started',
  });

  if (!capture.promise || typeof capture.promise.then !== 'function') {
    return providerTrace;
  }

  capture.promise.then((result) => {
    if (result?.ok) {
      emitProviderEvent(onProviderEvent, 'provider.package_capture_saved', {
        providerId,
        providerHarness,
        providerPackageId: providerTrace.providerPackageId || result.id || null,
        status: 'complete',
        surfaceToUser: true,
        displayMessage: `Provider package ${providerTrace.providerPackageId || result.id || ''} saved to database - complete`,
      });
      return;
    }

    emitProviderEvent(onProviderEvent, 'provider.package_capture_failed', {
      providerId,
      providerHarness,
      providerPackageId: providerTrace.providerPackageId || null,
      status: 'error',
      reason: captureFailureReason(result),
      error: result?.error || null,
      surfaceToUser: true,
      displayMessage: `Provider package ${providerTrace.providerPackageId || ''} failed to save to database - error`,
    });
  });

  return providerTrace;
}

async function requireProviderPackageCapture({ providerTrace, onProviderEvent, providerId, providerHarness } = {}) {
  if (!providerTrace?.captureEnabled) return providerTrace;
  providerTrace.captureMode = 'required';

  const providerPackageId = providerTrace.providerPackageId;
  if (!providerPackageId) {
    throw makeRequiredCaptureError(
      'Provider package capture is required but no providerPackageId was reserved',
      providerTrace
    );
  }

  const capturePromise = getPackageCapturePromise(providerTrace);
  if (!capturePromise) {
    throw makeRequiredCaptureError(
      `Provider package ${providerPackageId} capture is required but no recorder promise was attached`,
      providerTrace
    );
  }

  emitProviderEvent(onProviderEvent, 'provider.package_capture_wait_started', {
    providerId,
    providerHarness,
    providerPackageId,
    captureMode: 'required',
    status: 'started',
  });

  const result = await capturePromise;
  if (result?.ok) {
    providerTrace.packageCaptureStatus = 'saved';
    if (result.id) providerTrace.providerPackageId = String(result.id);
    await confirmProviderPackageReadable({
      providerPackageId: providerTrace.providerPackageId,
      providerTrace,
      onProviderEvent,
      providerId,
      providerHarness,
    });
    emitProviderEvent(onProviderEvent, 'provider.package_capture_confirmed', {
      providerId,
      providerHarness,
      providerPackageId: providerTrace.providerPackageId,
      captureMode: 'required',
      status: 'complete',
    });
    providerTrace.packageReadbackStatus = 'confirmed';
    return providerTrace;
  }

  const reason = captureFailureReason(result);
  throw makeRequiredCaptureError(
    `Provider package ${providerPackageId} failed to save to MongoDB: ${reason}`,
    providerTrace,
    { packageCaptureReason: reason }
  );
}

module.exports = {
  attachProviderTraceToError,
  observeProviderPackageCapture,
  requireProviderPackageCapture,
  setPackageCapturePromise,
  withProviderTraceUpdates,
};
