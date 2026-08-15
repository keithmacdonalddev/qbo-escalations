import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ConnectedAccountCard from './ConnectedAccountCard.jsx';

describe('ConnectedAccountCard', () => {
  it('keeps provider peers compact and exposes a single purposeful entry action', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <ConnectedAccountCard
        icon={<span>G</span>}
        providerName="Google"
        providerDescription="Inbox, sending, and calendar"
        statusLabel="Verified"
        statusTone="connected"
        badges={['Local']}
        notice={<p>Connection guidance</p>}
        onOpen={onOpen}
        openLabel="Manage"
      />,
    );

    expect(screen.getByRole('region', { name: 'Google connection' })).toBeVisible();
    expect(screen.getByText('Verified')).toBeVisible();
    expect(screen.getByText('Local')).toBeVisible();
    expect(screen.getByText('Connection guidance')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Manage Google' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('does not invent an entry action when a provider has no real destination', () => {
    render(
      <ConnectedAccountCard
        icon={<span>Q</span>}
        providerName="Questrade"
        providerDescription="Portfolio context"
        statusLabel="Not available"
        statusTone="unavailable"
      />,
    );

    expect(screen.getByText('Not available')).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
