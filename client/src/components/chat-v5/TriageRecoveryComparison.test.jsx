import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TriageRecoveryComparison from './TriageRecoveryComparison.jsx';

const apiMocks = vi.hoisted(() => ({
  acceptEvidenceRecoveryCandidate: vi.fn(),
  cancelEvidenceRecovery: vi.fn(),
  confirmEvidenceRecovery: vi.fn(),
  getEvidenceRecoveryOperation: vi.fn(),
  getEvidenceRecoveryOptions: vi.fn(),
  listActiveEvidenceRecoveries: vi.fn(),
}));

vi.mock('../../api/evidenceRecoveryApi.js', () => apiMocks);

function makeOperation() {
  return {
    operationId: 'operation-awaiting-review',
    attemptNumber: 2,
    strategy: 'rerun-stage',
    status: 'awaiting-acceptance',
    candidateResult: {
      card: {
        agent: 'Recovery Agent',
        client: 'Recovery Client',
        category: 'payroll',
        severity: 'P1',
        read: 'Several payroll payments may be blocked.',
        action: 'Escalate to Payroll Support.',
        missingInfo: ['Affected company ID'],
        confidence: 'medium',
      },
      comparison: {
        candidateSha256: 'candidate-sha-256',
        previousSha256: 'previous-sha-256',
        differences: [
          { field: 'severity', previous: 'P2', candidate: 'P1' },
          {
            field: 'read',
            previous: 'One payroll payment is pending.',
            candidate: 'Several payroll payments may be blocked.',
          },
        ],
        plainSummary: [
          'Severity changed from P2 to P1.',
          'The quick read now says several payroll payments may be blocked.',
        ],
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TriageRecoveryComparison', () => {
  it('shows previous and candidate values, highlights only server-listed differences, and explains them plainly', () => {
    render(<TriageRecoveryComparison operation={makeOperation()} />);

    expect(screen.getByText('Severity changed from P2 to P1.')).toBeVisible();
    expect(screen.getByText('The quick read now says several payroll payments may be blocked.')).toBeVisible();

    const severityRow = screen.getByRole('rowheader', { name: 'Severity' }).closest('[role="row"]');
    expect(severityRow).toHaveClass('is-changed');
    expect(within(severityRow).getByText('P2')).toBeVisible();
    expect(within(severityRow).getByText('P1')).toBeVisible();

    const agentRow = screen.getByRole('rowheader', { name: 'Agent' }).closest('[role="row"]');
    expect(agentRow).not.toHaveClass('is-changed');
    const unchangedCells = within(agentRow).getAllByRole('cell');
    expect(unchangedCells).toHaveLength(2);
    expect(unchangedCells[0]).toHaveTextContent('Recovery Agent');
    expect(unchangedCells[1]).toHaveTextContent('Recovery Agent');
    unchangedCells.forEach((cell) => expect(cell).not.toHaveClass('is-changed'));
  });

  it('warns when the previously shown comparison card could not be fully verified', () => {
    const operation = makeOperation();
    operation.candidateResult.comparison.previousResultVerified = false;
    render(<TriageRecoveryComparison operation={operation} />);

    expect(screen.getByRole('status')).toHaveTextContent(/previously shown result could not be fully verified/i);
    expect(screen.getByRole('status')).toHaveTextContent(/against what was visible before recovery/i);
  });

  it('passes the exact shown hashes only after the user explicitly accepts', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<TriageRecoveryComparison operation={makeOperation()} onAccept={onAccept} />);

    expect(onAccept).not.toHaveBeenCalled();
    expect(screen.getByText('candidate-sha-256')).not.toBeVisible();
    expect(screen.getByText('previous-sha-256')).not.toBeVisible();

    await user.click(screen.getByText('Technical details'));
    const technical = screen.getByText('Technical details').closest('details');
    expect(within(technical).getByText('Attempt number')).toBeVisible();
    expect(within(technical).getByText('2')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Accept recovered result' }));

    expect(onAccept).toHaveBeenCalledOnce();
    expect(onAccept).toHaveBeenCalledWith({
      candidateSha256: 'candidate-sha-256',
      previousSha256: 'previous-sha-256',
    });
  });

  it('keeps the candidate for later without accepting, cancelling, or making an API mutation', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    const onKeepLater = vi.fn();
    render(
      <TriageRecoveryComparison
        operation={makeOperation()}
        onAccept={onAccept}
        onKeepLater={onKeepLater}
      />,
    );

    expect(screen.getByText(/It will never be accepted automatically/)).toBeVisible();
    expect(onAccept).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep for review later' }));

    expect(onKeepLater).toHaveBeenCalledOnce();
    expect(onAccept).not.toHaveBeenCalled();
    expect(apiMocks.acceptEvidenceRecoveryCandidate).not.toHaveBeenCalled();
    expect(apiMocks.cancelEvidenceRecovery).not.toHaveBeenCalled();
    expect(apiMocks.confirmEvidenceRecovery).not.toHaveBeenCalled();
  });

  it('explains a parked stored copy, its acceptance deadline, and backup-provider provenance', () => {
    const operation = {
      ...makeOperation(),
      strategy: 'repersist',
      acceptExpiresAt: '2030-01-02T15:04:00.000Z',
      runtimeSnapshot: {
        provider: 'openai',
        model: 'gpt-primary',
        fallbackProvider: 'anthropic',
        fallbackModel: 'claude-backup',
        actualProvider: 'anthropic',
        actualModel: 'claude-backup',
      },
    };

    render(<TriageRecoveryComparison operation={operation} />);

    expect(screen.getByRole('region', { name: 'Review stored triage copy' })).toBeVisible();
    expect(screen.getByRole('heading', {
      name: 'We found a stored copy that differs from what is currently shown',
    })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Currently shown' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Stored copy' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Accept stored copy' })).toBeEnabled();
    expect(screen.getByText((content) => (
      content.startsWith('You can accept this until ')
      && content.includes('2030')
      && content.endsWith('; after that it will need human review.')
    ))).toBeVisible();
    expect(screen.getByText(
      'This result was produced by the backup provider anthropic · claude-backup after the primary openai · gpt-primary failed.',
    )).toBeVisible();
  });

  it('disables acceptance locally once the stored result deadline has passed', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<TriageRecoveryComparison
      operation={{ ...makeOperation(), acceptExpiresAt: '2020-01-02T15:04:00.000Z' }}
      onAccept={onAccept}
    />);

    expect(screen.getByRole('alert')).toHaveTextContent(/acceptance deadline has passed/i);
    const accept = screen.getByRole('button', { name: 'Acceptance deadline passed' });
    expect(accept).toBeDisabled();
    await user.click(accept);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('re-checks long deadlines after the maximum timer interval instead of expiring early', async () => {
    vi.useFakeTimers();
    try {
      const start = new Date('2026-07-23T12:00:00.000Z');
      vi.setSystemTime(start);
      const maxTimerMs = 2_147_483_647;
      const deadline = new Date(start.getTime() + maxTimerMs + 5_000).toISOString();
      render(<TriageRecoveryComparison operation={{ ...makeOperation(), acceptExpiresAt: deadline }} />);

      expect(screen.getByRole('button', { name: 'Accept recovered result' })).toBeEnabled();
      await act(async () => { vi.advanceTimersByTime(maxTimerMs); });
      expect(screen.getByRole('button', { name: 'Accept recovered result' })).toBeEnabled();
      expect(screen.queryByText(/acceptance deadline has passed/i)).not.toBeInTheDocument();

      await act(async () => { vi.advanceTimersByTime(5_025); });
      expect(screen.getByRole('button', { name: 'Acceptance deadline passed' })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
