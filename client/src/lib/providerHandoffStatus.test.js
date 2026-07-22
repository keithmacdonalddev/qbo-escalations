import { expect, test } from 'vitest';
import {
  getProviderHandoffToast,
  normalizeProviderHandoffStatus,
} from './providerHandoffStatus.js';

test('normalizes package capture lifecycle statuses', () => {
  const started = normalizeProviderHandoffStatus({
    kind: 'provider.package_capture_started',
    data: { providerId: 'lm-studio', providerPackageId: 'pkg-1', status: 'started' },
  });
  expect(started.level).toBe('info');
  expect(started.summary).toMatch(/Package capture started/);
  expect(started.summary).toMatch(/pkg-1/);

  const saved = normalizeProviderHandoffStatus({
    kind: 'provider.package_capture_saved',
    data: { providerId: 'llm-gateway', providerPackageId: 'pkg-2', status: 'complete' },
  });
  expect(saved.level).toBe('success');
  expect(saved.toast).toBe(true);

  const readRetry = normalizeProviderHandoffStatus({
    kind: 'provider.package_capture_read_retry',
    data: { providerId: 'llm-gateway', providerPackageId: 'pkg-2', attempt: 1 },
  });
  expect(readRetry.level).toBe('warning');
  expect(readRetry.summary).toMatch(/readback retry/i);

  const readConfirmed = normalizeProviderHandoffStatus({
    kind: 'provider.package_capture_read_confirmed',
    data: { providerId: 'llm-gateway', providerPackageId: 'pkg-2', status: 'complete' },
  });
  expect(readConfirmed.level).toBe('success');
  expect(readConfirmed.toast).toBe(true);

  const failed = normalizeProviderHandoffStatus({
    kind: 'provider.package_capture_failed',
    data: { providerId: 'gemini', providerPackageId: 'pkg-3', reason: 'Mongo write failed' },
  });
  expect(failed.level).toBe('error');
  expect(failed.summary).toMatch(/Mongo write failed/);
});

test('classifies provider timeout, HTTP, and invalid JSON errors', () => {
  const timeout = normalizeProviderHandoffStatus({
    kind: 'error',
    data: { code: 'TIMEOUT', message: 'Request timed out', provider: 'lm-studio' },
  });
  expect(timeout.title).toBe('Provider timeout');
  expect(timeout.level).toBe('error');

  const http = normalizeProviderHandoffStatus({
    kind: 'error',
    data: { code: 'PROVIDER_ERROR', message: 'LLM Gateway API error (HTTP 502): bad gateway', provider: 'llm-gateway' },
  });
  expect(http.title).toBe('Provider HTTP error');
  expect(http.summary).toMatch(/http=502/);

  const invalidJson = normalizeProviderHandoffStatus({
    kind: 'error',
    data: { code: 'PROVIDER_ERROR', message: 'Gemini provider package response body is not valid JSON: Unexpected token' },
  });
  expect(invalidJson.title).toBe('Provider returned invalid JSON');
});

test('normalizes package wait retry and load failure statuses', () => {
  const retry = normalizeProviderHandoffStatus({
    kind: 'parser.provider_package_load_retry',
    data: { providerPackageId: 'pkg-4', attempt: 3, timeoutMs: 30000 },
  });
  expect(retry.level).toBe('warning');
  expect(retry.summary).toMatch(/attempt=3/);

  const failed = normalizeProviderHandoffStatus({
    kind: 'parser.provider_package_load_failed',
    data: { providerPackageId: 'pkg-4', attempts: 12, timeoutMs: 30000 },
  });
  expect(failed.level).toBe('error');
  expect(failed.toast).toBe(true);
});

test('surfaces parser extraction failures and finite handoff toasts', () => {
  const extraction = normalizeProviderHandoffStatus({
    kind: 'parser.output_validated',
    data: { passed: false, confidence: 'low', fieldsFound: 2, issueCount: 4 },
  });
  expect(extraction.title).toBe('Parser extraction failed');
  expect(extraction.level).toBe('error');

  const toast = getProviderHandoffToast({
    kind: 'error',
    data: { code: 'PARSER_EMPTY_RESULT', message: 'Image parser returned no text.' },
  });
  expect(toast.type).toBe('error');
  expect(toast.duration).toBe(9000);
});
