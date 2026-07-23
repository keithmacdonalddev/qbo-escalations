import { afterEach, expect, it, vi } from 'vitest';
import {
  createSubmissionId,
  loadReportingBootstrap,
  submitUserReport,
} from './ticketSnitchReporting.js';

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = '';
});

it('loads reporting availability without exposing a credential', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ ok: true, available: true, reportToken: 'short-lived-form-token' }),
  });
  const result = await loadReportingBootstrap();
  expect(result.available).toBe(true);
  expect(fetchMock).toHaveBeenCalledWith('/api/ticket-snitch/reporting/bootstrap', expect.objectContaining({
    credentials: 'same-origin',
  }));
  expect(JSON.stringify(result)).not.toContain('ts_');
});

it('submits only allow-listed browser context and removes route query data', async () => {
  window.location.hash = '#/escalations?customer=private';
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 201,
    headers: new Headers(),
    json: async () => ({ ok: true, ticket: { key: 'QBO-1' } }),
  });
  await submitUserReport({
    reportToken: 'form-token',
    submissionId: 'submission-api-test-001',
    observedAt: '2026-07-23T03:00:00.000Z',
    kind: 'problem',
    title: 'Save failed',
    explanation: 'The save operation did not update the record.',
    includeDiagnostics: false,
  });
  const options = fetchMock.mock.calls[0][1];
  const body = JSON.parse(options.body);
  expect(options.headers['X-QBO-Report-Token']).toBe('form-token');
  expect(body.context.routeName).toBe('#/escalations');
  expect(body.context.browser).toBeUndefined();
  expect(body.context.viewport).toBeUndefined();
  expect(body).not.toHaveProperty('reporter');
  expect(body).not.toHaveProperty('projectId');
});

it('creates stable non-secret submission identifiers in the browser', () => {
  const first = createSubmissionId();
  const second = createSubmissionId();
  expect(first).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  expect(second).not.toBe(first);
});
