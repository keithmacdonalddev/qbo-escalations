import { afterEach, expect, it, vi } from 'vitest';
import {
  createSubmissionId,
  loadCustomerReceipt,
  loadReportingBootstrap,
  replyToCustomerReceipt,
  submitUserReport,
  validateCustomerReceipt,
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
  expect(body).not.toHaveProperty('contact');
});

it('includes only optional self-reported contact details when the user supplies them', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 201,
    headers: new Headers(),
    json: async () => ({ ok: true, ticket: { key: 'QBO-3' } }),
  });
  await submitUserReport({
    reportToken: 'form-token',
    submissionId: 'submission-api-contact-001',
    observedAt: '2026-07-23T03:01:00.000Z',
    kind: 'feedback',
    title: 'Follow-up requested',
    explanation: 'I would like to be contacted about this feedback in the future.',
    reporterName: '  Ada Lovelace  ',
    reporterEmail: ' ADA@Example.TEST ',
    includeDiagnostics: false,
  });
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.contact).toEqual({ name: 'Ada Lovelace', email: 'ada@example.test' });
  expect(body).not.toHaveProperty('reporter');
  expect(body).not.toHaveProperty('actorId');
});

it('creates stable non-secret submission identifiers in the browser', () => {
  const first = createSubmissionId();
  const second = createSubmissionId();
  expect(first).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  expect(second).not.toBe(first);
});

it('encodes only the explicitly approved screenshot in the report request', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 201,
    headers: new Headers(),
    json: async () => ({ ok: true, ticket: { key: 'QBO-2' }, evidence: { status: 'attached' } }),
  });
  const screenshot = new File(['safe screenshot bytes'], 'page.png', { type: 'image/png' });
  await submitUserReport({
    reportToken: 'form-token',
    submissionId: 'submission-api-shot-001',
    observedAt: '2026-07-23T03:15:00.000Z',
    kind: 'feedback',
    title: 'Screenshot feedback',
    explanation: 'This screenshot was deliberately selected for the report.',
    includeDiagnostics: false,
    screenshot,
  });
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.screenshot).toEqual({
    filename: 'page.png',
    contentType: 'image/png',
    base64: btoa('safe screenshot bytes'),
  });
  expect(body).not.toHaveProperty('cookies');
  expect(body).not.toHaveProperty('authorization');
});

it('uses only the QBO receipt handle and anti-forgery token for customer follow-up', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ ok: true, data: { key: 'QBO-71', version: 4 } }),
  });
  const handle = `qtr_${'a'.repeat(16)}.${'b'.repeat(112)}.${'c'.repeat(22)}`;
  await loadCustomerReceipt({ reportToken: 'report-token', receiptHandle: handle });
  await replyToCustomerReceipt({
    reportToken: 'report-token',
    receiptHandle: handle,
    actionId: 'reply-action-0001',
    body: 'More details from the reporter.',
  });
  await validateCustomerReceipt({
    reportToken: 'report-token',
    receiptHandle: handle,
    actionId: 'validation-action-0001',
    workItemVersion: 4,
    outcome: 'fixed',
    note: 'The repair works now.',
  });
  for (const [, options] of fetchMock.mock.calls) {
    expect(options.headers['X-QBO-Report-Token']).toBe('report-token');
    expect(options.headers['X-QBO-Ticket-Receipt']).toBe(handle);
    expect(JSON.stringify(options)).not.toContain('tsr_');
  }
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    actionId: 'reply-action-0001',
    body: 'More details from the reporter.',
  });
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
    actionId: 'validation-action-0001',
    workItemVersion: 4,
    outcome: 'fixed',
    note: 'The repair works now.',
  });
});
