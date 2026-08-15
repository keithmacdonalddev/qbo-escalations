import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SettingsAccountsSection from './SettingsAccountsSection.jsx';

function renderSection(overrides = {}) {
  const props = {
    googleAuth: { loading: false, connected: false, appConfigured: true, permissions: [] },
    connectedAccounts: [],
    selectedDefaultEmailAccount: '',
    selectedDefaultSendingAccount: '',
    selectedDefaultCalendarAccount: '',
    defaultFallbackLabel: 'Use default account',
    missingDefaultEmailAccount: false,
    missingDefaultSendingAccount: false,
    missingDefaultCalendarAccount: false,
    savedFlash: null,
    savingDefault: '',
    onGoogleConnect: vi.fn(),
    onGoogleReauthorize: vi.fn(),
    onGoogleDisconnect: vi.fn(),
    googleConnecting: false,
    googleDisconnecting: false,
    onDefaultEmailAccountChange: vi.fn(),
    onDefaultSendingAccountChange: vi.fn(),
    onDefaultCalendarAccountChange: vi.fn(),
    additionalProviderCards: [<section aria-label="Questrade test card" key="questrade">Questrade</section>],
    ...overrides,
  };
  return { props, ...render(<SettingsAccountsSection {...props} />) };
}

describe('SettingsAccountsSection', () => {
  it('keeps the existing Google action while adding another provider as a peer', async () => {
    const user = userEvent.setup();
    const { props } = renderSection();
    expect(screen.getByRole('region', { name: 'Google connection' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Questrade test card' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Connect Google Account' }));
    expect(props.onGoogleConnect).toHaveBeenCalledOnce();
    expect(screen.getByText(/Disconnecting a provider revokes its access/)).toBeInTheDocument();
  });
});
