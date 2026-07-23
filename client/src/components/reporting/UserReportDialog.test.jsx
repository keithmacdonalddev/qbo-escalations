import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import UserReportDialog from './UserReportDialog.jsx';

const reportingMocks = vi.hoisted(() => ({
  createSubmissionId: vi.fn(() => 'submission-component-001'),
  loadReportingBootstrap: vi.fn(),
  submitUserReport: vi.fn(),
}));

vi.mock('../../api/ticketSnitchReporting.js', () => reportingMocks);

beforeEach(() => {
  reportingMocks.createSubmissionId.mockReturnValue('submission-component-001');
  reportingMocks.loadReportingBootstrap.mockReset().mockResolvedValue({
    ok: true,
    available: true,
    reportToken: 'report-token',
    requestId: 'bootstrap-request',
  });
  reportingMocks.submitUserReport.mockReset().mockResolvedValue({
    ok: true,
    ticket: { id: 'work-1', key: 'QBO-51' },
    idempotentReplay: false,
    requestId: 'report-request',
  });
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
