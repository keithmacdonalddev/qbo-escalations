import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuestradeSnapshotWorkbench from './QuestradeSnapshotWorkbench.jsx';
import useInvestmentSnapshotWorkbench from '../../hooks/useInvestmentSnapshotWorkbench.js';

vi.mock('../../hooks/useInvestmentSnapshotWorkbench.js', () => ({ default: vi.fn() }));

const completeRun = {
  runId: 'safe-stage3a-run-01',
  accountKey: 'safe-stage3a-account-01',
  status: 'completed',
  steps: ['account', 'balances', 'positions', 'validate', 'publish'].map((id) => ({ id, status: 'completed' })),
};

const snapshot = {
  snapshotId: 'safe-stage3a-snapshot-01',
  contentHash: '1234567890abcdef1234567890abcdef',
  observedAt: '2026-08-15T12:00:00.000Z',
  fetchedAt: '2026-08-15T12:01:00.000Z',
  counts: { currencies: 2, positions: 1 },
  balances: [
    { currency: 'CAD', cash: '-425.75', totalEquity: '10110.25', buyingPower: '20220.5' },
    { currency: 'USD', cash: '410.1', totalEquity: '5830.3', buyingPower: '11660.6' },
  ],
  positions: [{ symbol: 'FIXTURE-SHORT', quantity: '-7.25', averagePrice: null, marketValue: '-785.25' }],
};

function state(overrides = {}) {
  return {
    deleteLocalData: vi.fn(), deleting: false, dropAndReconnect: vi.fn(), error: '', forceReplayGap: vi.fn(),
    loading: false, refresh: vi.fn(), run: vi.fn(), selectScenario: vi.fn(), setSource: vi.fn(),
    setTransportEnabled: vi.fn(), source: 'simulated', starting: false,
    transport: { connected: true }, transportEnabled: true, transportNotice: '',
    workbench: {
      readiness: 'ready',
      scenario: 'healthy-margin-cad-usd',
      scenarios: [{ id: 'healthy-margin-cad-usd', label: 'Healthy Margin · CAD and USD' }],
      account: { accountKey: 'safe-stage3a-account-01', label: 'Margin account', accountType: 'Margin' },
      activeRun: null,
      latestRun: completeRun,
      latestSnapshot: snapshot,
      storedCounts: { accounts: 1, runs: 1, snapshots: 1, total: 3 },
    },
    ...overrides,
  };
}

describe('QuestradeSnapshotWorkbench', () => {
  beforeEach(() => useInvestmentSnapshotWorkbench.mockReturnValue(state()));

  it('renders complete normalized evidence without inventing missing values', () => {
    render(<QuestradeSnapshotWorkbench />);
    expect(screen.getByRole('heading', { name: 'Questrade snapshot reconciliation' })).toBeVisible();
    expect(screen.getByText('Latest complete snapshot')).toBeVisible();
    expect(screen.getByText('-425.75')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /View normalized records/i }));
    expect(screen.getByText('FIXTURE-SHORT')).toBeVisible();
    expect(screen.getByText('Unknown')).toBeVisible();
  });

  it('states that an incomplete run did not replace the prior complete snapshot', () => {
    useInvestmentSnapshotWorkbench.mockReturnValue(state({
      workbench: {
        ...state().workbench,
        latestRun: {
          ...completeRun,
          status: 'incomplete',
          failureSection: 'positions',
          steps: completeRun.steps.map((step) => step.id === 'positions' ? { ...step, status: 'failed' } : step),
        },
      },
    }));
    render(<QuestradeSnapshotWorkbench />);
    expect(screen.getByText(/No new snapshot was saved; the prior complete snapshot is still latest/i)).toBeVisible();
    expect(screen.getByText('Still latest · Integrity confirmed')).toBeVisible();
    expect(screen.getByText(/Stopped at Positions/i)).toBeVisible();
  });

  it('briefly confirms a newly completed snapshot without announcing old evidence on initial load', () => {
    const running = state({
      workbench: {
        ...state().workbench,
        activeRun: { ...completeRun, status: 'running', steps: completeRun.steps.map((step, index) => ({ ...step, status: index ? 'pending' : 'running' })) },
        latestRun: null,
        latestSnapshot: null,
      },
    });
    useInvestmentSnapshotWorkbench.mockReturnValue(running);
    const view = render(<QuestradeSnapshotWorkbench />);
    expect(screen.queryByText('Complete snapshot saved.')).not.toBeInTheDocument();

    useInvestmentSnapshotWorkbench.mockReturnValue(state());
    view.rerender(<QuestradeSnapshotWorkbench />);
    expect(screen.getByText('Complete snapshot saved.')).toBeVisible();
  });

  it('keeps deletion bounded behind the exact typed confirmation', () => {
    const remove = vi.fn();
    useInvestmentSnapshotWorkbench.mockReturnValue(state({ deleteLocalData: remove }));
    render(<QuestradeSnapshotWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /Local data and privacy/i }));
    fireEvent.click(screen.getByRole('button', { name: /Delete local investment data/i }));
    const confirm = screen.getByRole('button', { name: 'Delete local data' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DELETE INVESTMENT DATA' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(remove).toHaveBeenCalledWith('DELETE INVESTMENT DATA');
  });

  it('moves focus to the honest empty state after completed deletion', async () => {
    let finishDelete;
    const remove = vi.fn(() => new Promise((resolve) => { finishDelete = resolve; }));
    let current = state({ deleteLocalData: remove });
    useInvestmentSnapshotWorkbench.mockImplementation(() => current);
    const view = render(<QuestradeSnapshotWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /Local data and privacy/i }));
    fireEvent.click(screen.getByRole('button', { name: /Delete local investment data/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DELETE INVESTMENT DATA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete local data' }));
    await waitFor(() => expect(remove).toHaveBeenCalled());

    current = state({
      deleteLocalData: remove,
      workbench: { ...state().workbench, activeRun: null, latestRun: null, latestSnapshot: null, storedCounts: { accounts: 0, runs: 0, snapshots: 0, total: 0 } },
    });
    view.rerender(<QuestradeSnapshotWorkbench />);
    await act(async () => finishDelete({}));
    await waitFor(() => expect(screen.getByText('No complete snapshot saved')).toHaveFocus());
  });

  it('replaces confirmation controls with a stable progress state while deleting', () => {
    useInvestmentSnapshotWorkbench.mockReturnValue(state({ deleting: true }));
    render(<QuestradeSnapshotWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /Local data and privacy/i }));
    fireEvent.click(screen.getByRole('button', { name: /Delete local investment data/i }));

    expect(screen.getByRole('heading', { name: /Delete local investment data from this computer/i })).toBeVisible();
    expect(screen.getByText(/This removes 1 account record.+Questrade authorization and the rest of the app remain unchanged/i)).toBeVisible();
    expect(screen.getByText('Deleting local investment data…')).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/Type DELETE INVESTMENT DATA/i)).not.toBeInTheDocument();
  });

  it('shows one recovery action when live verification is blocked', () => {
    const openAccounts = vi.fn();
    useInvestmentSnapshotWorkbench.mockReturnValue(state({
      source: 'live',
      workbench: { readiness: 'blocked', sourceError: { message: 'Connect Questrade first.' }, storedCounts: { total: 0 } },
    }));
    render(<QuestradeSnapshotWorkbench onOpenConnectedAccounts={openAccounts} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Connected Accounts' }));
    expect(openAccounts).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
  });
});
