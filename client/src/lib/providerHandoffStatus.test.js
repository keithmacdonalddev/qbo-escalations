import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProviderHandoffToast,
  normalizeProviderHandoffStatus,
} from './providerHandoffStatus.js';

test('normalizes package capture lifecycle statuses', () => {
  const started = normalizeProviderHandoffStatus({
    kind: 'provider.package_capture_started',
    data: { providerId: 'lm-studio', providerPackageId: 'pkg-1', status: 'started' },
  });
  assert.equal(started.level, 'info');
  assert.match(started.summary, /Package capture started/);
  assert.match(started.summary, /pkg-1/);

  const saved = normalizeProviderHandoffStatus({
    kind: 'provider.package_capture_saved',
    data: { providerId: 'llm-gateway', providerPackageId: 'pkg-2', status: 'complete' },
  });
  assert.equal(saved.level, 'success');
  assert.equal(saved.toast, true);

  const failed = normalizeProviderHandoffStatus({
    kind: 'provider.package_capture_failed',
    data: { providerId: 'gemini', providerPackageId: 'pkg-3', reason: 'Mongo write failed' },
  });
  assert.equal(failed.level, 'error');
  assert.match(failed.summary, /Mongo write failed/);
});

test('classifies provider timeout, HTTP, and invalid JSON errors', () => {
  const timeout = normalizeProviderHandoffStatus({
    kind: 'error',
    data: { code: 'TIMEOUT', message: 'Request timed out', provider: 'lm-studio' },
  });
  assert.equal(timeout.title, 'Provider timeout');
  assert.equal(timeout.level, 'error');

  const http = normalizeProviderHandoffStatus({
    kind: 'error',
    data: { code: 'PROVIDER_ERROR', message: 'LLM Gateway API error (HTTP 502): bad gateway', provider: 'llm-gateway' },
  });
  assert.equal(http.title, 'Provider HTTP error');
  assert.match(http.summary, /http=502/);

  const invalidJson = normalizeProviderHandoffStatus({
    kind: 'error',
    data: { code: 'PROVIDER_ERROR', message: 'Gemini provider package response body is not valid JSON: Unexpected token' },
  });
  assert.equal(invalidJson.title, 'Provider returned invalid JSON');
});

test('normalizes package wait retry and load failure statuses', () => {
  const retry = normalizeProviderHandoffStatus({
    kind: 'parser.provider_package_load_retry',
    data: { providerPackageId: 'pkg-4', attempt: 3, timeoutMs: 30000 },
  });
  assert.equal(retry.level, 'warning');
  assert.match(retry.summary, /attempt=3/);

  const failed = normalizeProviderHandoffStatus({
    kind: 'parser.provider_package_load_failed',
    data: { providerPackageId: 'pkg-4', attempts: 12, timeoutMs: 30000 },
  });
  assert.equal(failed.level, 'error');
  assert.equal(failed.toast, true);
});

test('surfaces parser extraction failures and finite handoff toasts', () => {
  const extraction = normalizeProviderHandoffStatus({
    kind: 'parser.output_validated',
    data: { passed: false, confidence: 'low', fieldsFound: 2, issueCount: 4 },
  });
  assert.equal(extraction.title, 'Parser extraction failed');
  assert.equal(extraction.level, 'error');

  const toast = getProviderHandoffToast({
    kind: 'error',
    data: { code: 'PARSER_EMPTY_RESULT', message: 'Image parser returned no text.' },
  });
  assert.equal(toast.type, 'error');
  assert.equal(toast.duration, 9000);
});
