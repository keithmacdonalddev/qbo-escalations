import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import QuestradeConnectedAccount from './QuestradeConnectedAccount.jsx';

const scenarios = [
  { id: 'disconnected', label: 'Not connected' },
  { id: 'healthy-margin', label: 'Connected' },
  { id: 'token-expired', label: 'Reauthorization required' },
];

function buildConnection(overrides = {}) {
  return {
    loading: false,
    error: '',
    changingScenario: false,
    refresh: vi.fn(),
    selectScenario: vi.fn(),
    data: {
      state: 'connected',
      statusLabel: 'Connected',
      summary: 'The simulated Margin account is connected.',
      action: 'Review the safe account label.',
      accountType: 'Margin',
      mode: 'simulated',
      scenario: 'healthy-margin',
      safeAccountId: 'margin-demo-01',
      lastSuccessfulSyncAt: '2026-08-14T18:30:00.000Z',
      fixtureControlsAvailable: true,
      scenarios,
    },
    ...overrides,
  };
}

describe('QuestradeConnectedAccount', () => {
  it('shows an unmistakable safe simulated Margin account state', () => {
    render(<QuestradeConnectedAccount connection={buildConnection()} />);
    expect(screen.getByRole('region', { name: 'Questrade connection' })).toBeVisible();
    expect(screen.getByText('Margin')).toBeVisible();
    expect(screen.getByText('Simulated')).toBeVisible();
    expect(screen.getByText('margin-demo-01')).toBeVisible();
    expect(screen.getByText(/No Questrade request or token is used/)).toBeVisible();
    expect(screen.queryByText(/balance|market value/i)).not.toBeInTheDocument();
  });

  it('lets the user select every Stage 1 state without a live connection action', async () => {
    const user = userEvent.setup();
    const connection = buildConnection();
    render(<QuestradeConnectedAccount connection={connection} />);
    await user.selectOptions(screen.getByLabelText('Simulated Questrade state'), 'token-expired');
    expect(connection.selectScenario).toHaveBeenCalledWith('token-expired');
    expect(screen.queryByRole('button', { name: /connect questrade/i })).not.toBeInTheDocument();
  });

  it('preserves the last complete snapshot message during an outage', () => {
    render(<QuestradeConnectedAccount connection={buildConnection({
      data: {
        ...buildConnection().data,
        state: 'degraded',
        statusLabel: 'Questrade unavailable',
        summary: 'The simulated service is unavailable.',
        action: 'Wait and retry later.',
        previousSnapshotAvailable: true,
      },
    })} />);
    expect(screen.getByText('Previous complete snapshot preserved')).toBeVisible();
    expect(screen.getByText('Questrade unavailable')).toBeVisible();
  });
});
