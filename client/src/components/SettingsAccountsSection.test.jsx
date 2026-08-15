import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SettingsAccountsSection from './SettingsAccountsSection.jsx';

const PERMISSIONS = [
  { id: 'gmail-read', label: 'Read email and inbox details', granted: true },
  { id: 'gmail-send', label: 'Send email', granted: true },
  { id: 'calendar', label: 'Read and manage calendar events', granted: true },
];

function account(email = 'owner@example.test', overrides = {}) {
  return {
    email,
    lastGmailAccessAt: '2026-08-14T20:00:00.000Z',
    lastCalendarAccessAt: '2026-08-14T20:00:00.000Z',
    permissions: PERMISSIONS,
    missingPermissions: [],
    ...overrides,
  };
}

function renderSection(overrides = {}) {
  const props = {
    googleAuth: { loading: false, connected: false, appConfigured: true, permissions: [] },
    connectedAccounts: [],
    selectedDefaultEmailAccount: '',
    selectedDefaultSendingAccount: '',
    selectedDefaultCalendarAccount: '',
    missingDefaultEmailAccount: false,
    missingDefaultSendingAccount: false,
    missingDefaultCalendarAccount: false,
    savedFlash: null,
    savingDefault: '',
    onGoogleConnect: vi.fn(),
    onGoogleReauthorize: vi.fn(),
    onGoogleDisconnect: vi.fn(),
    onGoogleRefresh: vi.fn(),
    googleConnecting: false,
    googleDisconnecting: false,
    googleRefreshing: false,
    onDefaultEmailAccountChange: vi.fn().mockResolvedValue(true),
    onDefaultSendingAccountChange: vi.fn().mockResolvedValue(true),
    onDefaultCalendarAccountChange: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return { props, ...render(<SettingsAccountsSection {...props} />) };
}

function connectedProps(accounts) {
  return {
    googleAuth: {
      loading: false,
      connected: true,
      appConfigured: true,
      email: accounts[0].email,
      permissions: accounts[0].permissions,
      missingPermissions: accounts[0].missingPermissions,
    },
    connectedAccounts: accounts,
  };
}

describe('SettingsAccountsSection', () => {
  it('keeps the production overview focused on the actionable Google journey', async () => {
    const user = userEvent.setup();
    const { props } = renderSection();

    expect(screen.getByRole('region', { name: 'Google connection' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Google connection' }).parentElement).toHaveClass('settings-accounts-grid');
    expect(screen.queryByText(/Questrade/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Connect Google account' }));
    expect(props.onGoogleConnect).toHaveBeenCalledOnce();
  });

  it('adds a balanced development-only Questrade journey without replacing Google', async () => {
    const user = userEvent.setup();
    const questradeConnection = {
      loading: false,
      error: '',
      changingScenario: false,
      refresh: vi.fn(),
      selectScenario: vi.fn(),
      data: {
        state: 'disconnected',
        scenario: 'disconnected',
        accountType: 'Margin',
        fixtureControlsAvailable: true,
        scenarios: [{ id: 'disconnected', label: 'Not connected' }],
      },
    };
    renderSection({ ...connectedProps([account()]), questradeConnection });

    expect(screen.getByRole('region', { name: 'Google connection' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Questrade connection' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Questrade development preview' })).not.toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Open Questrade' }));
    expect(screen.getByRole('heading', { name: 'Questrade', level: 2 })).toBeVisible();
    expect(screen.getByText('No Questrade authorization')).toBeVisible();
    expect(screen.getByText('Simulated data · No token is stored and Questrade is not contacted.')).toBeVisible();
  });

  it('opens a focused layered account view and removes pointless default selectors', async () => {
    const user = userEvent.setup();
    const first = account();
    renderSection(connectedProps([first]));

    expect(screen.getByText('Verified')).toBeVisible();
    expect(screen.queryByText(first.email)).not.toBeInTheDocument();
    const openButton = screen.getByRole('button', { name: 'Manage Google' });
    await user.click(openButton);

    expect(screen.getByRole('dialog', { name: 'Google account settings' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Google', level: 2 })).toBeVisible();
    expect(screen.getByText(first.email)).toBeVisible();
    expect(screen.getByText('This account handles inbox, sending, and calendar.')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Account uses' })).not.toBeInTheDocument();
    const close = screen.getByRole('button', { name: 'Close Google account settings' });
    expect(close).toHaveFocus();
    await user.click(close);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connected Accounts' })).toBeVisible());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Manage Google' })).toHaveFocus());
  });

  it('uses navigable purpose rows and an accessible checkmarked chooser for multiple accounts', async () => {
    const user = userEvent.setup();
    const first = account('first@example.test');
    const second = account('second@example.test');
    const onDefaultEmailAccountChange = vi.fn().mockResolvedValue(true);
    renderSection({
      ...connectedProps([first, second]),
      selectedDefaultEmailAccount: first.email,
      onDefaultEmailAccountChange,
    });

    await user.click(screen.getByRole('button', { name: 'Manage Google' }));
    expect(screen.getByRole('heading', { name: 'All accounts are ready' })).toBeVisible();
    const uses = screen.getByRole('heading', { name: 'Account uses' }).closest('section');
    await user.click(within(uses).getByRole('button', { name: /Inbox/ }));

    expect(screen.getByRole('heading', { name: 'Choose inbox account' })).toBeVisible();
    expect(screen.getByRole('radio', { name: /Automatic/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /first@example.test/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: /second@example.test/ }));
    expect(onDefaultEmailAccountChange).toHaveBeenCalledWith({ target: { value: second.email } });
    expect(screen.getByRole('heading', { name: 'Account uses' })).toBeVisible();
  });

  it('preserves the old account and gives retry guidance when a default save fails', async () => {
    const user = userEvent.setup();
    const first = account('first@example.test');
    const second = account('second@example.test');
    renderSection({
      ...connectedProps([first, second]),
      selectedDefaultEmailAccount: first.email,
      onDefaultEmailAccountChange: vi.fn().mockResolvedValue(false),
    });

    await user.click(screen.getByRole('button', { name: 'Manage Google' }));
    await user.click(screen.getByRole('button', { name: /Inbox/ }));
    await user.click(screen.getByRole('radio', { name: /second@example.test/ }));

    expect(screen.getByRole('alert')).toHaveTextContent('Your previous account is still in use. Try again.');
    expect(screen.getByRole('radio', { name: /first@example.test/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps save waiting visible and prevents duplicate account choices', async () => {
    const user = userEvent.setup();
    const first = account('first@example.test');
    const second = account('second@example.test');
    let finishSave;
    renderSection({
      ...connectedProps([first, second]),
      selectedDefaultEmailAccount: first.email,
      onDefaultEmailAccountChange: vi.fn(() => new Promise((resolve) => { finishSave = resolve; })),
    });

    await user.click(screen.getByRole('button', { name: 'Manage Google' }));
    await user.click(screen.getByRole('button', { name: /Inbox/ }));
    await user.click(screen.getByRole('radio', { name: /second@example.test/ }));

    expect(screen.getByRole('status')).toHaveTextContent('Saving choice…');
    expect(screen.getByRole('radio', { name: /first@example.test/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /second@example.test/ })).toBeDisabled();

    finishSave(true);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Account uses' })).toBeVisible());
  });

  it('shows one coherent repair state and only offers reauthorization when permissions are missing', async () => {
    const user = userEvent.setup();
    const partial = account('partial@example.test', {
      lastCalendarAccessAt: null,
      permissions: PERMISSIONS.map((permission) => permission.id === 'calendar' ? { ...permission, granted: false } : permission),
      missingPermissions: ['Read and manage calendar events'],
    });
    const { props } = renderSection(connectedProps([partial]));

    expect(screen.getByText('Needs attention')).toBeVisible();
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Manage Google' }));
    await user.click(screen.getByRole('button', { name: 'Repair access' }));
    expect(props.onGoogleReauthorize).toHaveBeenCalledWith(partial.email);

    const permissionsTrigger = screen.getByRole('button', { name: 'View Google permissions' });
    await user.click(permissionsTrigger);
    const permissions = screen.getByRole('region', { name: 'Google permissions' });
    expect(permissions).toHaveAttribute('aria-hidden', 'false');
    expect(within(permissions).getByText('Read and manage calendar events').closest('li')).toHaveClass('is-missing');
    await user.keyboard('{Escape}');
    expect(permissions).toHaveAttribute('aria-hidden', 'true');
    expect(permissionsTrigger).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Google' })).toBeVisible();
  });

  it('does not invent a repair action when access has not been verified yet', async () => {
    const user = userEvent.setup();
    const unverified = account('unverified@example.test', {
      lastGmailAccessAt: null,
      lastCalendarAccessAt: null,
    });
    renderSection(connectedProps([unverified]));

    expect(screen.getByText('Not yet verified')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Manage Google' }));
    const neutralHealth = screen.getByRole('heading', { name: 'Access has not been verified yet' }).closest('section');
    expect(neutralHealth).toHaveClass('is-neutral');
    expect(neutralHealth).not.toHaveClass('is-connected');
    expect(screen.queryByRole('button', { name: 'Repair access' })).not.toBeInTheDocument();
  });

  it('preserves last-confirmed evidence through an offline verification error and offers recovery', async () => {
    const user = userEvent.setup();
    const first = account();
    const { props } = renderSection({
      ...connectedProps([first]),
      googleAuth: { ...connectedProps([first]).googleAuth, verificationError: 'offline' },
    });

    expect(screen.getByText('Offline')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Manage Google' }));
    expect(screen.getByText('Showing the last confirmed account details. Check your connection and try again.')).toBeVisible();
    expect(screen.getByText(first.email)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onGoogleRefresh).toHaveBeenCalledOnce();
  });

  it('summarizes permissions on demand and opens a consequence-focused disconnect confirmation', async () => {
    const user = userEvent.setup();
    const first = account();
    const { props } = renderSection(connectedProps([first]));

    await user.click(screen.getByRole('button', { name: 'Manage Google' }));
    expect(screen.queryByRole('region', { name: 'Google permissions' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View Google permissions' }));
    expect(screen.getByRole('region', { name: 'Google permissions' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Disconnect…' }));

    const dialog = screen.getByRole('dialog', { name: 'Disconnect Google?' });
    expect(within(dialog).getByText(/Your email, events, and Google account stay unchanged/)).toBeVisible();
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    const confirm = within(dialog).getByRole('button', { name: 'Disconnect Google' });
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    expect(props.onGoogleDisconnect).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Disconnect Google?' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Google account settings' })).toBeVisible();
  });

  it('returns keyboard focus to the next useful action after disconnect and reconnect', async () => {
    const user = userEvent.setup();
    const first = account();
    const rendered = renderSection(connectedProps([first]));

    await user.click(screen.getByRole('button', { name: 'Manage Google' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect…' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Disconnect Google?' })).getByRole('button', { name: 'Disconnect Google' }));
    expect(rendered.props.onGoogleDisconnect).toHaveBeenCalledOnce();

    const disconnectedProps = {
      ...rendered.props,
      googleAuth: { loading: false, connected: false, appConfigured: true, permissions: [] },
      connectedAccounts: [],
      connectionFeedback: 'Google access was removed from this workspace. You can connect again at any time.',
    };
    rendered.rerender(<SettingsAccountsSection {...disconnectedProps} />);

    const connect = await screen.findByRole('button', { name: 'Connect Google account' });
    await waitFor(() => expect(connect).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent('Google access was removed');
    await user.keyboard('{Enter}');
    expect(rendered.props.onGoogleConnect).toHaveBeenCalledOnce();

    rendered.rerender(
      <SettingsAccountsSection
        {...disconnectedProps}
        {...connectedProps([first])}
        connectionFeedback="Google is connected again. Mail and Calendar access has been restored."
      />,
    );

    const open = await screen.findByRole('button', { name: 'Manage Google' });
    await waitFor(() => expect(open).toHaveFocus());
    expect(screen.getByText('Verified')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Google is connected again');
  });

  it('replaces an unavailable Google dead action with visible recovery guidance', () => {
    renderSection({ googleAuth: { loading: false, connected: false, appConfigured: false, permissions: [] } });

    expect(screen.getByText('Unavailable')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Connect Google account/i })).not.toBeInTheDocument();
    expect(screen.getByText('Google sign-in needs setup.')).toBeVisible();
    expect(screen.getByText(/Configure the Google connection on the server, then refresh this page/)).toBeVisible();
  });

  it('announces in-progress Google connection feedback without offering a second activation', () => {
    renderSection({ googleConnecting: true });
    const action = screen.getByRole('button', { name: 'Connecting Google account' });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute('aria-busy', 'true');
  });
});
