import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import QuestradeConnectedAccount, { QuestradeAccountDetails, QuestradeDeveloperPreview } from './QuestradeConnectedAccount.jsx';

function buildConnection() {
  return {
    changingScenario: false,
    selectScenario: vi.fn(),
    data: {
      state: 'connected',
      statusLabel: 'Connected',
      mode: 'simulated',
      scenario: 'healthy-margin',
      fixtureControlsAvailable: true,
      selectedAccountKey: 'opaque-margin-1',
      accounts: [{ accountKey: 'opaque-margin-1', label: 'Margin account', accountType: 'Margin', status: 'Active' }],
      serviceHealth: { accounts: 'available', balances: 'available', positions: 'available', orders: 'available', executions: 'available' },
      lastVerifiedAt: '2026-08-15T12:00:00.000Z',
      lastSuccessfulSyncAt: '2026-08-15T12:00:00.000Z',
      canDisconnect: true,
      scenarios: [
        { id: 'disconnected', label: 'Not connected' },
        { id: 'healthy-margin', label: 'Connected' },
        { id: 'token-expired', label: 'Reauthorization required' },
      ],
    },
  };
}

describe('QuestradeConnectedAccount', () => {
  it('presents a compact preview provider entry with a useful destination', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<QuestradeConnectedAccount connection={buildConnection()} onOpen={onOpen} />);

    expect(screen.getByRole('region', { name: 'Questrade connection' })).toBeVisible();
    expect(screen.getByText('Personal investments · Margin account')).toBeVisible();
    expect(screen.getByText('Connected')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Open Questrade' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('settles a healthy live connection into a concise account summary', async () => {
    const user = userEvent.setup();
    render(<QuestradeAccountDetails connection={{
      data: {
        mode: 'live',
        state: 'connected',
        secureStorageReady: true,
        canDisconnect: true,
        selectedAccountKey: 'opaque-margin-1',
        accounts: [{ accountKey: 'opaque-margin-1', label: 'Margin account', accountType: 'Margin' }],
        serviceHealth: { accounts: 'available', balances: 'available', positions: 'available', orders: 'available', executions: 'available' },
        lastVerifiedAt: new Date(Date.now() - (2 * 60 * 60_000)).toISOString(),
      },
    }} onBack={() => {}} />);

    expect(screen.getByText('Connected')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Questrade is connected' })).not.toBeInTheDocument();
    expect(screen.getByText('Margin account')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Connected Questrade account' })).getByText(/Read-only portfolio access/)).toBeVisible();
    expect(screen.getByText('Verified 2 hours ago')).toBeVisible();
    expect(screen.queryByText('Live connection')).not.toBeInTheDocument();
    expect(screen.queryByText('Authorization')).not.toBeInTheDocument();
    expect(screen.queryByText('Service checks')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View read-only access details' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Disconnect Questrade' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'View read-only access details' }));
    const details = screen.getByRole('region', { name: 'Read-only access details' });
    expect(within(details).getByText('Portfolio data')).toBeVisible();
    expect(within(details).getByText('Not requested')).toBeVisible();
    expect(within(details).getByText('Not permitted')).toBeVisible();
  });

  it('reveals the live token field only after an explicit connect action and clears it after success', async () => {
    const user = userEvent.setup();
    const connect = vi.fn().mockResolvedValue({ state: 'connected' });
    const connection = {
      connect,
      data: {
        mode: 'live',
        state: 'disconnected',
        secureStorageReady: true,
        accounts: [],
        serviceHealth: {},
      },
    };
    render(<QuestradeAccountDetails connection={connection} onBack={() => {}} />);

    expect(screen.queryByLabelText('Authorization token')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View connection capabilities' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Questrade…' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Connect Questrade…' }));
    expect(screen.getByRole('link', { name: /Open Questrade/ })).toHaveAttribute('href', 'https://apphub.questrade.com/UI/ManageApp.aspx');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Connect Questrade…' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Connect Questrade…' }));
    const token = screen.getByLabelText('Authorization token');
    expect(token).toHaveAttribute('type', 'password');
    await user.type(token, 'manual-token-canary');
    await user.click(screen.getByRole('button', { name: 'Connect account' }));

    expect(connect).toHaveBeenCalledWith('manual-token-canary');
    expect(screen.queryByLabelText('Authorization token')).not.toBeInTheDocument();
  });

  it('presents multiple live accounts as opaque choices', async () => {
    const user = userEvent.setup();
    const selectAccount = vi.fn().mockResolvedValue({ state: 'connected' });
    render(<QuestradeAccountDetails connection={{
      selectAccount,
      data: {
        mode: 'live',
        state: 'account-selection-required',
        secureStorageReady: true,
        accounts: [
          { accountKey: 'opaque-1', label: 'Margin account 1', status: 'Active' },
          { accountKey: 'opaque-2', label: 'Margin account 2', status: 'Active' },
        ],
      },
    }} onBack={() => {}} />);

    expect(screen.getByText('Margin account 1')).toBeVisible();
    expect(screen.getByText('Margin account 2')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Margin account 2/ }));
    expect(selectAccount).toHaveBeenCalledWith('opaque-2');
  });

  it('offers reauthorization only for authorization evidence and submits through the renewal action', async () => {
    const user = userEvent.setup();
    const reauthorize = vi.fn().mockResolvedValue({ state: 'connected' });
    render(<QuestradeAccountDetails connection={{
      reauthorize,
      data: {
        mode: 'live',
        state: 'reauthorization-required',
        secureStorageReady: true,
        canDisconnect: true,
        selectedAccountKey: 'opaque-1',
        accounts: [{ accountKey: 'opaque-1', label: 'Margin account', accountType: 'Margin' }],
        serviceHealth: {},
      },
    }} onBack={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Reconnect Questrade…' }));
    await user.type(screen.getByLabelText('Authorization token'), 'renewal-token-canary');
    await user.click(screen.getByRole('button', { name: 'Renew authorization' }));
    expect(reauthorize).toHaveBeenCalledWith('renewal-token-canary');
  });

  it('uses retry for temporary verification failure instead of asking for a new token', async () => {
    const user = userEvent.setup();
    const retryVerification = vi.fn().mockResolvedValue({ state: 'connected' });
    render(<QuestradeAccountDetails connection={{
      retryVerification,
      data: {
        mode: 'live',
        state: 'offline',
        secureStorageReady: true,
        canDisconnect: true,
        canRetryVerification: true,
        selectedAccountKey: 'opaque-1',
        accounts: [{ accountKey: 'opaque-1', label: 'Margin account', accountType: 'Margin' }],
        serviceHealth: { accounts: 'available', balances: 'offline' },
        lastCheckAt: '2026-08-15T12:00:00.000Z',
      },
    }} onBack={() => {}} />);

    expect(screen.queryByRole('button', { name: /Reconnect Questrade/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retryVerification).toHaveBeenCalledOnce();
  });

  it('confirms disconnect and keeps failed remote revocation recoverable', async () => {
    const user = userEvent.setup();
    const disconnect = vi.fn().mockResolvedValue({ state: 'disconnected' });
    const base = {
      mode: 'live',
      state: 'connected',
      secureStorageReady: true,
      canDisconnect: true,
      selectedAccountKey: 'opaque-1',
      accounts: [{ accountKey: 'opaque-1', label: 'Margin account', accountType: 'Margin' }],
      serviceHealth: { accounts: 'available' },
      lastVerifiedAt: '2026-08-15T12:00:00.000Z',
    };
    const { rerender } = render(<QuestradeAccountDetails connection={{ disconnect, data: base }} onBack={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Disconnect Questrade' }));
    expect(screen.getByRole('heading', { name: 'Disconnect Questrade?' })).toBeVisible();
    expect(screen.getByText('Portfolio updates will stop. Saved information stays available.')).toBeVisible();
    expect(screen.getByText('Margin account')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close Questrade account settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('heading', { name: 'Disconnect Questrade?' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect Questrade' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Disconnect Questrade' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(disconnect).toHaveBeenCalledOnce();

    const retryRevocation = vi.fn().mockResolvedValue({ state: 'disconnected' });
    const forgetLocal = vi.fn().mockResolvedValue({ state: 'disconnected' });
    rerender(<QuestradeAccountDetails connection={{
      retryRevocation,
      forgetLocal,
      data: { ...base, state: 'revocation-pending', credentialState: 'revocation-pending', canForgetLocal: true },
    }} onBack={() => {}} />);
    expect(screen.getByRole('button', { name: 'Retry revocation' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Remove locally…' }));
    expect(screen.getByText(/First revoke this authorization in Questrade/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Remove locally' }));
    expect(forgetLocal).toHaveBeenCalledOnce();
  });

  it('keeps fixture selection in an explicitly development-only testing component', async () => {
    const user = userEvent.setup();
    const connection = buildConnection();
    render(<QuestradeDeveloperPreview connection={connection} />);

    expect(screen.getByRole('region', { name: 'Questrade state simulator' })).toHaveAttribute('data-development-only', 'true');
    await user.selectOptions(screen.getByLabelText('Simulated Questrade state'), 'token-expired');
    expect(connection.selectScenario).toHaveBeenCalledWith('token-expired');
  });

  it('shows safe account facts and opens capabilities in a dismissible anchored popover', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<QuestradeAccountDetails connection={buildConnection()} onBack={onBack} />);

    expect(screen.getByRole('heading', { name: 'Margin account preview is ready' })).toBeVisible();
    expect(screen.getByText('Simulated data · No token is stored and Questrade is not contacted.')).toBeVisible();
    expect(screen.getByText('Margin demo')).toBeVisible();
    const trigger = screen.getByRole('button', { name: 'View connection capabilities' });
    const popover = document.getElementById(trigger.getAttribute('aria-controls'));
    expect(popover).toHaveAttribute('aria-hidden', 'true');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(popover).toHaveAttribute('aria-hidden', 'false');
    expect(popover).toHaveAttribute('data-open', 'true');
    expect(screen.getByText('Balances, positions, orders, and executions')).toBeVisible();
    expect(screen.getByText('Not allowed')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(popover).toHaveAttribute('aria-hidden', 'true');
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(screen.getByRole('heading', { name: 'Account' }));
    expect(popover).toHaveAttribute('aria-hidden', 'true');
    await user.click(screen.getByRole('button', { name: 'Close Questrade account settings' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
