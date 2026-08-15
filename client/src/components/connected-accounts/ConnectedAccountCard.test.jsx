import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ConnectedAccountCard from './ConnectedAccountCard.jsx';

describe('ConnectedAccountCard', () => {
  it('keeps provider identity, status, badges, and content in one reusable frame', () => {
    render(
      <ConnectedAccountCard
        icon={<span>G</span>}
        providerName="Google"
        providerDescription="Gmail & Calendar"
        statusLabel="Connected"
        statusTone="connected"
        badges={['Local']}
      >
        <p>Existing Google controls</p>
      </ConnectedAccountCard>,
    );
    expect(screen.getByRole('region', { name: 'Google connection' })).toBeVisible();
    expect(screen.getByText('Connected')).toBeVisible();
    expect(screen.getByText('Existing Google controls')).toBeVisible();
    expect(screen.getByText('Local')).toBeVisible();
  });
});
