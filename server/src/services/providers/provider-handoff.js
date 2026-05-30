'use strict';

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

function attachProviderTraceToError(err, providerTrace) {
  if (err && providerTrace) {
    err.providerTrace = withProviderTraceUpdates(providerTrace, {
      outcome: providerTrace.outcome || 'error',
    });
  }
  return err;
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

  const providerPackageId = providerTrace.providerPackageId;
  if (!providerPackageId) {
    const err = new Error('Provider package capture is required but no providerPackageId was reserved');
    err.code = 'PROVIDER_PACKAGE_CAPTURE_FAILED';
    throw attachProviderTraceToError(err, withProviderTraceUpdates(providerTrace, {
      outcome: 'package_capture_failed',
      packageCaptureStatus: 'failed',
    }));
  }

  const capturePromise = getPackageCapturePromise(providerTrace);
  if (!capturePromise) {
    const err = new Error(`Provider package ${providerPackageId} capture is required but no recorder promise was attached`);
    err.code = 'PROVIDER_PACKAGE_CAPTURE_FAILED';
    throw attachProviderTraceToError(err, withProviderTraceUpdates(providerTrace, {
      outcome: 'package_capture_failed',
      packageCaptureStatus: 'failed',
    }));
  }

  emitProviderEvent(onProviderEvent, 'provider.package_capture_wait_started', {
    providerId,
    providerHarness,
    providerPackageId,
    status: 'started',
  });

  const result = await capturePromise;
  if (result?.ok) {
    providerTrace.packageCaptureStatus = 'saved';
    if (result.id) providerTrace.providerPackageId = String(result.id);
    emitProviderEvent(onProviderEvent, 'provider.package_capture_confirmed', {
      providerId,
      providerHarness,
      providerPackageId: providerTrace.providerPackageId,
      status: 'complete',
    });
    return providerTrace;
  }

  const reason = captureFailureReason(result);
  providerTrace.packageCaptureStatus = 'failed';
  providerTrace.outcome = 'package_capture_failed';
  const err = new Error(`Provider package ${providerPackageId} failed to save to MongoDB: ${reason}`);
  err.code = 'PROVIDER_PACKAGE_CAPTURE_FAILED';
  throw attachProviderTraceToError(err, providerTrace);
}

module.exports = {
  attachProviderTraceToError,
  observeProviderPackageCapture,
  requireProviderPackageCapture,
  setPackageCapturePromise,
  withProviderTraceUpdates,
};
