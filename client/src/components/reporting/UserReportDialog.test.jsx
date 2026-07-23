import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import UserReportDialog from './UserReportDialog.jsx';

const reportingMocks = vi.hoisted(() => ({
  createSubmissionId: vi.fn(() => 'submission-component-001'),
  loadReportingBootstrap: vi.fn(),
  loadCustomerReceipt: vi.fn(),
  replyToCustomerReceipt: vi.fn(),
  submitUserReport: vi.fn(),
  validateCustomerReceipt: vi.fn(),
}));
const screenshotMocks = vi.hoisted(() => ({
  captureScreenFrame: vi.fn(),
  screenCaptureSupported: vi.fn(() => true),
  validateScreenshotFile: vi.fn((file) => file),
}));

vi.mock('../../api/ticketSnitchReporting.js', () => reportingMocks);
vi.mock('../../context/AppAuthContext.jsx', () => ({
  useAppAuth: () => ({ user: { id: 'qbo-test-user' } }),
}));
vi.mock('./screenshotCapture.js', () => screenshotMocks);

beforeEach(() => {
  const values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
  });
  reportingMocks.createSubmissionId.mockReturnValue('submission-component-001');
  reportingMocks.loadReportingBootstrap.mockReset().mockResolvedValue({
    ok: true,
    available: true,
    reportToken: 'report-token',
    requestId: 'bootstrap-request',
    screenshotAvailable: true,
  });
  reportingMocks.submitUserReport.mockReset().mockResolvedValue({
    ok: true,
    ticket: { id: 'work-1', key: 'QBO-51' },
    idempotentReplay: false,
    requestId: 'report-request',
    evidence: { requested: false, status: 'not_requested' },
  });
  reportingMocks.loadCustomerReceipt.mockReset().mockResolvedValue({
    ok: true,
    data: {
      key: 'QBO-71',
      title: 'Customer follow-up test',
      status: 'verification',
      statusLabel: 'Verification',
      publicSummary: 'The repair is ready for confirmation.',
      needsReporterReply: false,
      canValidate: true,
      reporterValidation: { outcome: '', note: '', submittedAt: null },
      updates: [{ id: 'update-1', direction: 'team', authorLabel: 'Ticket Snitch team', body: 'Please verify the repair.', createdAt: '2026-07-23T03:00:00.000Z' }],
      version: 4,
      updatedAt: '2026-07-23T03:00:00.000Z',
    },
    requestId: 'receipt-request',
  });
  reportingMocks.replyToCustomerReceipt.mockReset().mockResolvedValue({ ok: true });
  reportingMocks.validateCustomerReceipt.mockReset().mockResolvedValue({ ok: true });
  screenshotMocks.captureScreenFrame.mockReset().mockResolvedValue(new File(['screen'], 'capture.png', { type: 'image/png' }));
  screenshotMocks.screenCaptureSupported.mockReset().mockReturnValue(true);
  screenshotMocks.validateScreenshotFile.mockReset().mockImplementation((file) => file);
});

it('offers the three plain-language choices and validates the short form', async () => {
  const user = userEvent.setup();
  render(<UserReportDialog open onClose={() => {}} />);

  expect(await screen.findByRole('dialog', { name: 'Send feedback' })).toBeVisible();
  expect(screen.getByRole('radio', { name: /Problem/ })).toBeChecked();
  expect(screen.getByRole('radio', { name: /Feature request/ })).toBeVisible();
  expect(screen.getByRole('radio', { name: /Feedback/ })).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'Send report' }));
  expect(screen.getByText('Enter at least 3 characters.')).toBeVisible();
  expect(screen.getByText(/Enter at least 10 characters/)).toBeVisible();
  expect(reportingMocks.submitUserReport).not.toHaveBeenCalled();
});

it('submits consented feedback and shows the returned Ticket Snitch case key', async () => {
  const user = userEvent.setup();
  render(<UserReportDialog open onClose={() => {}} errorCode="SAFE_ERROR" />);
  await screen.findByRole('button', { name: 'Send report' });

  await user.click(screen.getByRole('radio', { name: /Feedback/ }));
  await user.type(screen.getByLabelText('Short title'), 'Make filters easier to scan');
  await user.type(screen.getByLabelText('What should we know?'), 'Grouping the filters would make review much faster.');
  await user.click(screen.getByRole('checkbox', { name: /Include basic diagnostics/ }));
  await user.click(screen.getByRole('button', { name: 'Send report' }));

  await waitFor(() => expect(reportingMocks.submitUserReport).toHaveBeenCalledWith({
    reportToken: 'report-token',
    submissionId: 'submission-component-001',
    observedAt: expect.any(String),
    kind: 'feedback',
    title: 'Make filters easier to scan',
    explanation: 'Grouping the filters would make review much faster.',
    includeDiagnostics: true,
    errorCode: 'SAFE_ERROR',
    screenshot: null,
  }));
  expect(await screen.findByText('QBO-51')).toBeVisible();
  expect(screen.getByText(/ready for human review/i)).toBeVisible();
});

it('explains duplicate-safe replay without claiming a second case', async () => {
  reportingMocks.submitUserReport.mockResolvedValue({
    ok: true,
    ticket: { id: 'work-1', key: 'QBO-51' },
    idempotentReplay: true,
    requestId: 'retry-request',
  });
  const user = userEvent.setup();
  render(<UserReportDialog open onClose={() => {}} />);
  await screen.findByRole('button', { name: 'Send report' });
  await user.type(screen.getByLabelText('Short title'), 'Retry the same report');
  await user.type(screen.getByLabelText('What should we know?'), 'This report is retried after an uncertain response.');
  await user.click(screen.getByRole('button', { name: 'Send report' }));
  expect(await screen.findByText('This report was already received. No duplicate was created.')).toBeVisible();
});

it('shows an honest unavailable state when the server connection is not configured', async () => {
  reportingMocks.loadReportingBootstrap.mockResolvedValue({
    ok: true,
    available: false,
    unavailableReason: 'TICKET_SNITCH_NOT_CONFIGURED',
    requestId: 'bootstrap-unavailable',
  });
  render(<UserReportDialog open onClose={() => {}} />);
  expect(await screen.findByText('Reporting is not connected on this server.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Send report' })).not.toBeInTheDocument();
});

it('preserves the draft and request ID after a permission failure', async () => {
  reportingMocks.submitUserReport.mockRejectedValue(Object.assign(new Error('Origin denied'), {
    status: 403,
    code: 'TICKET_SNITCH_REPORT_ORIGIN_DENIED',
    requestId: 'permission-request',
  }));
  const user = userEvent.setup();
  render(<UserReportDialog open onClose={() => {}} />);
  await screen.findByRole('button', { name: 'Send report' });
  await user.type(screen.getByLabelText('Short title'), 'Permission failure');
  await user.type(screen.getByLabelText('What should we know?'), 'The draft should remain after this failure.');
  await user.click(screen.getByRole('button', { name: 'Send report' }));
  expect(await screen.findByText(/not permitted to submit reports/i)).toBeVisible();
  expect(screen.getByText('Request ID: permission-request')).toBeVisible();
  expect(screen.getByLabelText('Short title')).toHaveValue('Permission failure');
});

it('preserves a valid draft while offline and does not attempt submission', async () => {
  const originalOnline = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
  Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
  try {
    const user = userEvent.setup();
    render(<UserReportDialog open onClose={() => {}} />);
    await screen.findByText(/You are offline. Your draft is preserved/i);
    await user.type(screen.getByLabelText('Short title'), 'Offline report draft');
    await user.type(screen.getByLabelText('What should we know?'), 'This explanation must remain available while offline.');
    expect(screen.getByRole('button', { name: 'Send report' })).toBeDisabled();
    expect(screen.getByLabelText('Short title')).toHaveValue('Offline report draft');
    expect(reportingMocks.submitUserReport).not.toHaveBeenCalled();
  } finally {
    if (originalOnline) Object.defineProperty(Navigator.prototype, 'onLine', originalOnline);
    else delete Navigator.prototype.onLine;
  }
});

it('hands an expired QBO session back to the sign-in flow without losing the draft', async () => {
  reportingMocks.loadReportingBootstrap.mockRejectedValue(Object.assign(new Error('Sign in first.'), {
    status: 401,
    code: 'QBO_AUTH_REQUIRED',
    requestId: 'expired-session-request',
  }));
  const onAuthenticationRequired = vi.fn();
  render(<UserReportDialog open onClose={() => {}} onAuthenticationRequired={onAuthenticationRequired} />);
  await waitFor(() => expect(onAuthenticationRequired).toHaveBeenCalledOnce());
});

it('captures only after an explicit action and lets the user preview, replace, and remove the optional image', async () => {
  const user = userEvent.setup();
  render(<UserReportDialog open onClose={() => {}} />);
  await screen.findByRole('button', { name: 'Capture screenshot' });
  expect(screenshotMocks.captureScreenFrame).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Capture screenshot' }));
  expect(screenshotMocks.captureScreenFrame).toHaveBeenCalledOnce();
  expect(await screen.findByText('capture.png')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Retake' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Replace' })).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'Remove' }));
  expect(screen.queryByText('capture.png')).not.toBeInTheDocument();
  expect(screen.getByText('Screenshot removed from this report.')).toBeVisible();
});

it('submits an approved screenshot and confirms that it became case evidence', async () => {
  reportingMocks.submitUserReport.mockResolvedValue({
    ok: true,
    ticket: { id: 'work-shot', key: 'QBO-63' },
    idempotentReplay: false,
    requestId: 'shot-request',
    evidence: { requested: true, status: 'attached', id: 'evidence-shot' },
  });
  const user = userEvent.setup();
  render(<UserReportDialog open onClose={() => {}} />);
  await screen.findByRole('button', { name: 'Capture screenshot' });
  await user.type(screen.getByLabelText('Short title'), 'Screenshot evidence report');
  await user.type(screen.getByLabelText('What should we know?'), 'The selected screenshot shows the reported layout problem.');
  await user.click(screen.getByRole('button', { name: 'Capture screenshot' }));
  await user.click(screen.getByRole('button', { name: 'Send report' }));

  await waitFor(() => expect(reportingMocks.submitUserReport).toHaveBeenCalledWith(expect.objectContaining({
    screenshot: expect.objectContaining({ name: 'capture.png', type: 'image/png' }),
  })));
  expect(await screen.findByText('QBO-63')).toBeVisible();
  expect(screen.getByText('Your approved screenshot is attached as case evidence.')).toBeVisible();
});

it('preserves a created case and retries only with the same duplicate-safe draft identity after evidence failure', async () => {
  reportingMocks.submitUserReport
    .mockResolvedValueOnce({
      ok: true,
      ticket: { id: 'work-partial', key: 'QBO-64' },
      idempotentReplay: false,
      requestId: 'case-created',
      evidence: { requested: true, status: 'failed', message: 'Evidence storage is temporarily unavailable.', requestId: 'evidence-failed' },
    })
    .mockResolvedValueOnce({
      ok: true,
      ticket: { id: 'work-partial', key: 'QBO-64' },
      idempotentReplay: true,
      requestId: 'case-replayed',
      evidence: { requested: true, status: 'attached', id: 'evidence-partial' },
    });
  const user = userEvent.setup();
  render(<UserReportDialog open onClose={() => {}} />);
  await screen.findByRole('button', { name: 'Capture screenshot' });
  await user.type(screen.getByLabelText('Short title'), 'Partial evidence retry');
  await user.type(screen.getByLabelText('What should we know?'), 'The case must remain safe while the screenshot attachment is retried.');
  await user.click(screen.getByRole('button', { name: 'Capture screenshot' }));
  await user.click(screen.getByRole('button', { name: 'Send report' }));

  expect(await screen.findByText('Report received; screenshot needs another try')).toBeVisible();
  expect(screen.getByText('QBO-64')).toBeVisible();
  expect(screen.getByText(/will not create a duplicate case/i)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Retry screenshot' }));
  expect(await screen.findByText('Your approved screenshot is attached as case evidence.')).toBeVisible();
  expect(reportingMocks.submitUserReport).toHaveBeenCalledTimes(2);
  const first = reportingMocks.submitUserReport.mock.calls[0][0];
  const second = reportingMocks.submitUserReport.mock.calls[1][0];
  expect(second.submissionId).toBe(first.submissionId);
  expect(second.screenshot).toBe(first.screenshot);
});

it('keeps text reporting usable when the separate screenshot credential is unavailable', async () => {
  reportingMocks.loadReportingBootstrap.mockResolvedValue({
    ok: true,
    available: true,
    screenshotAvailable: false,
    reportToken: 'report-token',
    requestId: 'bootstrap-request',
  });
  render(<UserReportDialog open onClose={() => {}} />);
  expect(await screen.findByText(/Screenshot attachments are not connected/i)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Send report' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Capture screenshot' })).not.toBeInTheDocument();
});

it('saves an opaque report handle and supports public replies and fixed confirmation', async () => {
  const receiptHandle = `qtr_${'a'.repeat(16)}.${'b'.repeat(112)}.${'c'.repeat(22)}`;
  reportingMocks.submitUserReport.mockResolvedValue({
    ok: true,
    ticket: { id: 'work-receipt', key: 'QBO-71' },
    customerReceipt: {
      handle: receiptHandle,
      expiresAt: '2027-07-23T03:00:00.000Z',
    },
    idempotentReplay: false,
    requestId: 'report-with-receipt',
    evidence: { requested: false, status: 'not_requested' },
  });
  const user = userEvent.setup();
  render(<UserReportDialog open onClose={() => {}} />);
  await screen.findByRole('button', { name: 'Send report' });
  await user.type(screen.getByLabelText('Short title'), 'Customer follow-up test');
  await user.type(screen.getByLabelText('What should we know?'), 'I need to return and confirm whether the repair works.');
  await user.click(screen.getByRole('button', { name: 'Send report' }));
  await user.click(await screen.findByRole('button', { name: 'View report status' }));
  expect(await screen.findByText('The repair is ready for confirmation.')).toBeVisible();
  expect(reportingMocks.loadCustomerReceipt).toHaveBeenCalledWith({
    reportToken: 'report-token',
    receiptHandle,
  });
  await user.type(screen.getByLabelText('Add information or ask a question'), 'I can verify this on the same page.');
  await user.click(screen.getByRole('button', { name: 'Send reply' }));
  await waitFor(() => expect(reportingMocks.replyToCustomerReceipt).toHaveBeenCalledWith(expect.objectContaining({
    reportToken: 'report-token',
    receiptHandle,
    body: 'I can verify this on the same page.',
  })));
  await user.type(screen.getByLabelText('Optional note'), 'The repaired path now works.');
  await user.click(screen.getByRole('button', { name: 'Fixed' }));
  await waitFor(() => expect(reportingMocks.validateCustomerReceipt).toHaveBeenCalledWith(expect.objectContaining({
    reportToken: 'report-token',
    receiptHandle,
    workItemVersion: 4,
    outcome: 'fixed',
    note: 'The repaired path now works.',
  })));
});
