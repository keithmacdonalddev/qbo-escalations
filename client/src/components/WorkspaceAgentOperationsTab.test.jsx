import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetchJson } from '../api/http.js';
import WorkspaceAgentOperationsTab from './WorkspaceAgentOperationsTab.jsx';

vi.mock('../api/http.js', () => ({ apiFetchJson: vi.fn() }));

const profile = {
  importance: 'primary-operations-agent',
  enabled: true,
  policy: {
    proactiveEnabled: true,
    emailMonitoring: true,
    calendarMonitoring: true,
    emailOrganization: true,
    draftReplies: true,
    personalCalendarHolds: true,
    maxAutomaticBatchSize: 25,
  },
  connections: { googleAccounts: [{ email: 'primary@example.com', primary: true, connected: true }] },
  background: {
    monitor: { running: true, lastEmailCheckAt: '2026-07-23T12:00:00.000Z' },
    scheduler: { running: true, briefingHour: 7, briefingMinute: 30 },
  },
  counts: { memory: 4, activeRules: 2, conversations: 8, actions: 12 },
  permissions: {
    automatic: ['Inspect connected inboxes and calendars', 'Create email drafts without sending them'],
    confirmation: ['Send an email', 'Change or delete an existing calendar event'],
    blocked: ['All live and background work while the Workspace Agent is disabled'],
  },
  readiness: {
    ready: true,
    checks: [
      { id: 'enabled', label: 'Agent enabled', ok: true, detail: 'Live requests are allowed.' },
      { id: 'accounts', label: 'Google account connected', ok: true, detail: '1 connected account.' },
    ],
  },
  recentActions: [
    { _id: 'a1', tool: 'gmail.archive', status: 'ok', surface: 'workspace-monitor', resultSummary: 'Archived routine email', createdAt: '2026-07-23T12:00:00.000Z' },
  ],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('WorkspaceAgentOperationsTab', () => {
  it('places proactive controls and action boundaries inside Configuration', async () => {
    apiFetchJson.mockResolvedValueOnce({ ok: true, profile });

    render(<WorkspaceAgentOperationsTab section="configuration" />);

    expect(await screen.findByRole('heading', { name: 'Email and calendar authority' })).toBeVisible();
    expect(screen.getByText('Runs automatically')).toBeVisible();
    expect(screen.getByText('Requires your confirmation')).toBeVisible();
    expect(screen.getByText('Send an email')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Your email and calendar operator' })).not.toBeInTheDocument();
  });

  it('places connections, readiness, and action evidence inside Monitoring', async () => {
    apiFetchJson.mockResolvedValueOnce({ ok: true, profile });

    render(<WorkspaceAgentOperationsTab section="monitoring" />);

    expect(await screen.findByRole('heading', { name: 'Email and calendar operating state' })).toBeVisible();
    expect(screen.getByText('primary@example.com')).toBeVisible();
    expect(screen.getByText('gmail.archive')).toBeVisible();
    expect(screen.getByText('12')).toBeVisible();
  });

  it('saves proactive controls through the server policy instead of a browser-only preference', async () => {
    const user = userEvent.setup();
    apiFetchJson
      .mockResolvedValueOnce({ ok: true, profile })
      .mockResolvedValueOnce({
        ok: true,
        policy: { ...profile.policy, emailMonitoring: false },
        permissions: profile.permissions,
      });

    render(<WorkspaceAgentOperationsTab section="configuration" />);
    const emailToggle = await screen.findByRole('checkbox', { name: /Monitor email/i });
    expect(emailToggle).toBeChecked();
    await user.click(emailToggle);

    await waitFor(() => expect(apiFetchJson).toHaveBeenCalledTimes(2));
    expect(apiFetchJson.mock.calls[1][0]).toBe('/api/workspace/profile/policy');
    expect(JSON.parse(apiFetchJson.mock.calls[1][1].body)).toEqual({ policy: { emailMonitoring: false } });
    await waitFor(() => expect(emailToggle).not.toBeChecked());
  });

  it('keeps the surrounding standard profile usable when Workspace details fail', async () => {
    apiFetchJson.mockRejectedValueOnce(new Error('Route not found'));

    render(<WorkspaceAgentOperationsTab section="configuration" />);

    expect(await screen.findByText('Workspace operating details could not be loaded.')).toBeVisible();
    expect(screen.getByText(/Workspace permission data is not available from the active server/)).toBeVisible();
    expect(screen.getByText(/The rest of this profile remains available/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry Workspace details' })).toBeVisible();
    expect(screen.queryByText('Route not found')).not.toBeInTheDocument();
    expect(screen.queryByText('Workspace Agent operations are unavailable.')).not.toBeInTheDocument();
  });
});
