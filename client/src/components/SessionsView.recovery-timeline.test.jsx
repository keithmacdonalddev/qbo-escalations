import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { RecoveryTimeline } from './SessionsView.jsx';

const CONTACTED_OPERATION = {
  operationId: 'recovery-operation-technical-id',
  planId: 'recovery-plan-technical-id',
  attemptNumber: 2,
  strategy: 'rerun-stage',
  status: 'succeeded',
  originalEvidence: {
    failureCode: 'TRIAGE_SAVE_FAILED',
    failureMessage: 'The original triage result could not be saved.',
    failedRun: {
      id: 'original-run-technical-id',
      completedAt: '2026-07-20T21:30:00.000Z',
    },
    resultId: 'original-result-technical-id',
    packageId: 'original-package-technical-id',
    traceIds: ['original-trace-technical-id'],
  },
  attempts: [{
    attempt: 1,
    triageResultId: 'recovered-result-technical-id',
    provenance: {
      plannedProvider: 'lm-studio',
      plannedModel: 'qwen3',
      contactedProviders: [
        { role: 'primary', provider: 'lm-studio', model: 'qwen3' },
        { role: 'fallback', provider: 'openai', model: 'gpt-5.5' },
        { role: 'repair', provider: 'openai', model: 'gpt-5.5-repair' },
      ],
      providerPackageIds: ['provider-package-technical-id'],
      triageResultIds: ['recovered-result-technical-id'],
      fallbackContacted: true,
      costMayHaveBeenIncurred: true,
    },
  }],
  downstreamReviewRequired: true,
  knowledgeDraftNeedsReview: {
    status: 'needs-review',
    reason: 'The previous triage result was lost, so this draft could not be checked against it.',
  },
  confirmedAt: '2026-07-20T21:31:00.000Z',
  startedAt: '2026-07-20T21:32:00.000Z',
  completedAt: '2026-07-20T21:33:00.000Z',
};

const NO_HANDOFF_OPERATION = {
  operationId: 'recovery-without-handoff',
  attemptNumber: 3,
  strategy: 'rerun-stage',
  status: 'failed',
  originalEvidence: {
    failureMessage: 'The retry was stopped before provider handoff.',
    receipt: { recordedAt: '2026-07-20T22:00:00.000Z' },
  },
  attempts: [{ attempt: 1, provenance: { contactedProviders: [] } }],
  startedAt: '2026-07-20T22:01:00.000Z',
  completedAt: '2026-07-20T22:02:00.000Z',
};

describe('SessionsView recovery timeline', () => {
  it('shows the original failure, retry numbering, provider handoffs, and downstream review warning', () => {
    render(<RecoveryTimeline historyState={{
      state: 'ready',
      operations: [CONTACTED_OPERATION, NO_HANDOFF_OPERATION],
    }} />);

    const contactedAttempt = screen.getByRole('heading', {
      name: 'Attempt 2: Recovered and verified',
    }).closest('article');
    const noHandoffAttempt = screen.getByRole('heading', { name: 'Attempt 3: Failed' }).closest('article');
    const contactedSummary = contactedAttempt.querySelector('ul');
    const noHandoffSummary = noHandoffAttempt.querySelector('ul');

    const originalFailure = within(contactedSummary).getByText('Original failure').closest('li');
    expect(originalFailure).toHaveTextContent('The original triage result could not be saved.');
    expect(originalFailure).toHaveTextContent('Jul 20');
    expect(originalFailure).toHaveTextContent('TRIAGE_SAVE_FAILED');

    expect(within(contactedSummary).getByText(/Planned provider: lm-studio · qwen3/)).toBeVisible();
    expect(within(contactedSummary).getByText(/Provider contacted: lm-studio · qwen3/)).toBeVisible();
    expect(within(contactedSummary).getByText(/Fallback contacted: openai · gpt-5.5/)).toBeVisible();
    expect(within(contactedSummary).getByText(/Repair attempt contacted: openai · gpt-5.5-repair/)).toBeVisible();
    expect(within(noHandoffSummary).getByText(/No provider handoff recorded/)).toBeVisible();
    expect(within(contactedSummary).getByText(/previous triage result was lost/i)).toBeVisible();
  });

  it('keeps technical identifiers inside the expandable details', async () => {
    const user = userEvent.setup();
    render(<RecoveryTimeline historyState={{ state: 'ready', operations: [CONTACTED_OPERATION] }} />);

    const details = screen.getByText('Technical details').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(within(details).getByText('recovery-operation-technical-id')).not.toBeVisible();
    expect(within(details).getByText('original-trace-technical-id')).not.toBeVisible();
    expect(within(details).getByText('provider-package-technical-id')).not.toBeVisible();

    await user.click(within(details).getByText('Technical details'));

    expect(details).toHaveAttribute('open');
    expect(within(details).getByText('recovery-operation-technical-id')).toBeVisible();
    expect(within(details).getByText('original-trace-technical-id')).toBeVisible();
    expect(within(details).getByText('provider-package-technical-id')).toBeVisible();
  });

  it('labels reordered and role-less provider contacts without inferring roles from list position', () => {
    const operation = {
      ...CONTACTED_OPERATION,
      operationId: 'reordered-roleless-contacts',
      attempts: [{
        attempt: 1,
        provenance: {
          contactedProviders: [
            { role: 'fallback', provider: 'openai', model: 'fallback-first' },
            { provider: 'local-provider', model: 'role-not-recorded' },
            { role: 'primary', provider: 'lm-studio', model: 'primary-last' },
          ],
        },
      }],
    };
    render(<RecoveryTimeline historyState={{ state: 'ready', operations: [operation] }} />);

    expect(screen.getByText(/Fallback contacted: openai · fallback-first/)).toBeVisible();
    expect(screen.getByText(/Provider contacted: local-provider · role-not-recorded/)).toBeVisible();
    expect(screen.getByText(/Provider contacted: lm-studio · primary-last/)).toBeVisible();
    expect(screen.queryByText(/Fallback contacted: local-provider/)).not.toBeInTheDocument();
  });
});
