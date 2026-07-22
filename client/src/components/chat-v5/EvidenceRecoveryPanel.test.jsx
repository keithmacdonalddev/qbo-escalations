import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EvidenceRecoveryPanel from './EvidenceRecoveryPanel.jsx';
import EvidenceSummary from './EvidenceSummary.jsx';
import { useEvidenceRecovery } from './useEvidenceRecovery.js';

const apiMocks = vi.hoisted(() => ({
  acceptEvidenceRecoveryCandidate: vi.fn(),
  cancelEvidenceRecovery: vi.fn(),
  confirmEvidenceRecovery: vi.fn(),
  getEvidenceRecoveryOperation: vi.fn(),
  getEvidenceRecoveryOptions: vi.fn(),
  listActiveEvidenceRecoveries: vi.fn(),
}));

vi.mock('../../api/evidenceRecoveryApi.js', () => apiMocks);

vi.mock('../../api/chatApi.js', () => ({
  getConversationMeta: vi.fn(),
}));

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

const FINGERPRINT = {
  contractVersion: 1,
  evidenceUpdatedAt: '2026-07-22T12:00:00.000Z',
  missingCodes: ['TRIAGE_CARD'],
};

function makeOption(overrides = {}) {
  return {
    planId: 'plan-repersist',
    strategy: 'repersist',
    recommended: true,
    reason: 'Reuse the already validated triage result and repair only the missing save.',
    aiCallNeeded: false,
    estimatedDuration: 'Usually less than a minute.',
    cancellationBoundary: 'You can cancel before the saved update is committed.',
    expectedWrites: ['Repairs the missing saved triage card.'],
    downstream: {},
    artifacts: [{ code: 'TRIAGE_CARD', label: 'Triage card' }],
    artifactCodes: ['TRIAGE_CARD'],
    readiness: { label: 'Ready' },
    runtimeSnapshot: null,
    evidenceFingerprint: FINGERPRINT,
    ...overrides,
  };
}

function makeController(options, overrides = {}) {
  return {
    isOpen: true,
    optionsState: 'ready',
    recovery: { evidenceFingerprint: FINGERPRINT, options },
    optionsError: '',
    operation: null,
    selectedOption: null,
    startPending: false,
    startError: '',
    operationError: '',
    acceptPending: false,
    cancelPending: false,
    evidenceChangedMessage: '',
    confirmRecovery: vi.fn(),
    refreshOptions: vi.fn(),
    requestCancel: vi.fn(),
    acceptCandidate: vi.fn(),
    recoverLater: vi.fn(),
    tryAgain: vi.fn(),
    ...overrides,
  };
}

function makeIncompleteEvidence() {
  return {
    state: 'ready',
    evidence: {
      status: 'incomplete',
      acknowledged: false,
      summary: {
        headline: 'The triage result is not safely saved.',
        nextStep: 'Review the safe recovery choices.',
        trusted: ['Image extraction'],
        noRepeatNeeded: ['Image Parser'],
      },
      missing: [{
        code: 'TRIAGE_CARD',
        label: 'Triage card',
        explanation: 'The triage card save could not be verified.',
      }],
      identifiers: { evidenceFingerprint: 'finding-remains-visible' },
      artifacts: [],
    },
  };
}

function RecoveryEntryHarness() {
  const controller = useEvidenceRecovery({ conversationId: 'conversation-recover-later' });
  return (
    <>
      <EvidenceSummary
        runEvidence={makeIncompleteEvidence()}
        onAcknowledge={() => {}}
        onReviewRecovery={controller.openRecovery}
      />
      <EvidenceRecoveryPanel controller={controller} />
    </>
  );
}

function TerminalHarness({ controller }) {
  const [finding] = useState(makeIncompleteEvidence);
  return (
    <>
      <EvidenceSummary runEvidence={finding} onAcknowledge={() => {}} />
      <EvidenceRecoveryPanel controller={controller} />
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', createMemoryStorage());
  apiMocks.listActiveEvidenceRecoveries.mockResolvedValue({ operations: [] });
});

describe('EvidenceRecoveryPanel choices', () => {
  it('renders one ordered grouped summary with no-cost recovery before provider calls and unknown-cost copy', async () => {
    const user = userEvent.setup();
    const safest = makeOption();
    const rerun = makeOption({
      planId: 'plan-rerun',
      strategy: 'rerun-stage',
      recommended: false,
      reason: 'Run triage again from the verified session information.',
      aiCallNeeded: true,
      costEstimate: {
        amountKnown: false,
        amount: null,
        message: 'A provider call is required, but the cost amount is unknown because no reliable estimate is available.',
      },
      estimatedDuration: 'About 30–60 seconds.',
      cancellationBoundary: 'After provider handoff, cancellation is best effort and cost may still be incurred.',
      expectedWrites: ['Saves a newly validated triage result.'],
      runtimeSnapshot: {
        provider: 'openai',
        model: 'gpt-recovery-test',
        fallbackProvider: 'anthropic',
        fallbackModel: 'claude-recovery-backup',
      },
      readiness: {
        label: 'Ready from the most recent check',
        keyRequired: true,
        keyConfigured: true,
        recentHealth: { ok: true, status: 'healthy' },
      },
    });

    render(<EvidenceRecoveryPanel controller={makeController([rerun, safest])} />);

    const panel = screen.getByRole('region', { name: 'Evidence recovery options' });
    expect(within(panel).getByText('Recommended')).toBeVisible();
    const groupHeadings = within(panel).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(groupHeadings.indexOf('No-cost recoveries')).toBeLessThan(groupHeadings.indexOf('Provider-call recoveries'));
    expect(within(panel).getByRole('heading', { name: safest.reason })).toBeVisible();
    expect(within(panel).getByText('This does not call the AI again and will not add AI cost.')).toBeVisible();
    expect(within(panel).queryByText('Advanced options')).not.toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: rerun.reason })).toBeVisible();
    expect(within(panel).getByText(/cost amount is unknown/i)).toBeVisible();
    expect(within(panel).getByText('plan-repersist')).not.toBeVisible();
    expect(within(panel).getByText('repersist')).not.toBeVisible();
    expect(within(panel).getByText(
      'Primary: openai · gpt-recovery-test; fallback: anthropic · claude-recovery-backup.',
    )).toBeVisible();
    expect(within(panel).getByText('About 30–60 seconds.')).toBeVisible();
    expect(within(panel).getByText(rerun.cancellationBoundary)).toBeVisible();
    expect(within(panel).getByText('plan-rerun')).not.toBeVisible();

    const rerunSection = within(panel).getByRole('heading', { name: rerun.reason }).closest('section');
    await user.click(within(rerunSection).getByText('Technical details'));
    expect(within(rerunSection).getByText('plan-rerun')).toBeVisible();
    expect(within(rerunSection).getByText('rerun-stage')).toBeVisible();
  });

  it('explains manual-review-only findings without offering a start action', () => {
    const manual = makeOption({
      planId: 'plan-manual-review',
      strategy: 'manual-review',
      reason: 'The historical triage source is no longer available to verify.',
      recommended: true,
    });

    render(<EvidenceRecoveryPanel controller={makeController([manual])} />);

    expect(screen.getByRole('heading', { name: 'Human review is required' })).toBeVisible();
    expect(screen.getByText(manual.reason)).toBeVisible();
    expect(screen.getByText(/No automatic work will start/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Start/i })).not.toBeInTheDocument();
  });

  it.each([
    {
      caseName: 'missing provider key',
      readiness: { label: 'Provider key missing', keyRequired: true, keyConfigured: false },
      explanation: /required provider access key is not configured/i,
    },
    {
      caseName: 'failing recent provider health',
      readiness: {
        label: 'Recent health check failed',
        keyRequired: true,
        keyConfigured: true,
        recentHealth: { ok: false, status: 'unhealthy' },
      },
      explanation: /AI provider may be unavailable/i,
    },
  ])('blocks Start for $caseName without calling confirmation', async ({ readiness, explanation }) => {
    const user = userEvent.setup();
    const rerun = makeOption({
      planId: 'plan-blocked-rerun',
      strategy: 'rerun-stage',
      aiCallNeeded: true,
      runtimeSnapshot: { provider: 'openai', model: 'gpt-recovery-test' },
      readiness,
    });
    const controller = makeController([rerun], {
      confirmRecovery: apiMocks.confirmEvidenceRecovery,
    });

    render(<EvidenceRecoveryPanel controller={controller} />);

    expect(screen.getByRole('alert')).toHaveTextContent(explanation);
    const start = screen.getByRole('button', { name: 'Start recovery' });
    expect(start).toBeDisabled();
    await user.click(start);
    expect(apiMocks.confirmEvidenceRecovery).not.toHaveBeenCalled();
  });
});

describe('EvidenceRecoveryPanel outcomes', () => {
  it('uses neutral provider-call cancellation wording until durable handoff is reported', () => {
    const option = makeOption({ strategy: 'rerun-stage', aiCallNeeded: true });
    const baseController = makeController([option], {
      selectedOption: option,
      operation: {
        operationId: 'operation-running',
        attemptNumber: 2,
        strategy: 'rerun-stage',
        status: 'running',
        progress: [],
      },
    });
    const { rerender } = render(<EvidenceRecoveryPanel controller={baseController} />);

    expect(screen.getByRole('button', {
      name: 'Request cancel — if the AI call already started it may still complete and incur cost',
    })).toBeVisible();
    expect(screen.queryByText(/no cost incurred/i)).not.toBeInTheDocument();

    rerender(<EvidenceRecoveryPanel controller={{
      ...baseController,
      operation: {
        ...baseController.operation,
        providerHandoffAt: '2026-07-22T12:00:01.000Z',
      },
    }} />);

    expect(screen.getByRole('button', {
      name: 'Request cancel — the AI call already started and may still complete and incur cost',
    })).toBeVisible();
  });

  it('shows cancellation as pending confirmation without falling back to recovery options', () => {
    const option = makeOption({ strategy: 'rerun-stage' });
    const controller = makeController([option], {
      selectedOption: option,
      operation: {
        operationId: 'operation-cancel-requested',
        strategy: 'rerun-stage',
        status: 'cancel-requested',
      },
    });

    render(<EvidenceRecoveryPanel controller={controller} />);

    const panel = screen.getByRole('region', { name: 'Cancelling recovery' });
    expect(within(panel).getByRole('heading', {
      name: 'Cancelling — waiting for confirmation…',
    })).toBeVisible();
    expect(within(panel).getByText(/This page will keep checking/)).toBeVisible();
    expect(within(panel).queryByRole('button', { name: /Start/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Evidence recovery options' })).not.toBeInTheDocument();
  });

  it('opens from the incomplete finding and Recover later closes without posting or clearing it', async () => {
    const user = userEvent.setup();
    apiMocks.getEvidenceRecoveryOptions.mockResolvedValue({
      recovery: { evidenceFingerprint: FINGERPRINT, options: [makeOption()] },
    });

    render(<RecoveryEntryHarness />);

    const finding = screen.getByRole('region', { name: 'Evidence completeness warning' });
    await user.click(within(finding).getByRole('button', { name: 'Review recovery options' }));
    expect(await screen.findByRole('region', { name: 'Evidence recovery options' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Recover later' }));

    expect(screen.queryByRole('region', { name: 'Evidence recovery options' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Evidence completeness warning' })).toBeVisible();
    expect(screen.getByText('The triage result is not safely saved.')).toBeVisible();
    expect(apiMocks.confirmEvidenceRecovery).not.toHaveBeenCalled();
    expect(apiMocks.acceptEvidenceRecoveryCandidate).not.toHaveBeenCalled();
    expect(apiMocks.cancelEvidenceRecovery).not.toHaveBeenCalled();
  });

  it('renders Recovered with the evidence items that are now trustworthy', () => {
    const option = makeOption();
    const controller = makeController([option], {
      selectedOption: option,
      operation: {
        operationId: 'operation-succeeded',
        strategy: 'repersist',
        status: 'succeeded',
        postRecoveryEvidence: {
          status: 'complete',
          confirmedTargetCodes: ['TRIAGE_CARD'],
          remainingMissingCodes: [],
        },
      },
    });

    render(<EvidenceRecoveryPanel controller={controller} />);

    const result = screen.getByRole('region', { name: 'Recovered' });
    expect(within(result).getByText('Recovery finished and the saved evidence was checked again.')).toBeVisible();
    expect(within(result).getByText('What is now trustworthy')).toBeVisible();
    expect(within(result).getByText('Triage card')).toBeVisible();
    expect(within(result).getByText('Evidence complete')).toBeVisible();
  });

  it('renders succeeded-unverified as saved without retry or nothing-changed copy', async () => {
    const user = userEvent.setup();
    const option = makeOption();
    const controller = makeController([option], {
      selectedOption: option,
      operation: {
        operationId: 'operation-succeeded-unverified',
        attemptNumber: 3,
        strategy: 'repersist',
        status: 'succeeded-unverified',
        conversationWriteApplied: true,
        knowledgeDraftNeedsReview: {
          recoveryOperationId: 'operation-succeeded-unverified',
          markedAt: '2026-07-22T12:00:02.000Z',
        },
        postRecoveryEvidence: {
          status: 'incomplete',
          confirmedTargetCodes: [],
          remainingMissingCodes: ['TRIAGE_CARD'],
        },
      },
    });

    render(<EvidenceRecoveryPanel controller={controller} />);

    const result = screen.getByRole('region', { name: 'Recovery saved; confirmation incomplete' });
    expect(within(result).getByText(
      'Recovery data was saved, but final confirmation could not be completed — check the evidence status.',
    )).toBeVisible();
    expect(within(result).getByText(/knowledge draft may need review/i)).toBeVisible();
    expect(within(result).queryByText('No unreviewed replacement was applied.')).not.toBeInTheDocument();
    expect(within(result).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    await user.click(within(result).getByText('Technical details'));
    expect(within(result).getByText('3')).toBeVisible();
  });

  it.each([
    {
      status: 'failed',
      heading: 'Recovery failed',
      explanation: 'The provider stopped before a safe saved update was made.',
    },
    {
      status: 'manual-review',
      heading: 'Human review required',
      explanation: 'The source evidence needs a person to verify it.',
    },
  ])('renders $heading plainly and keeps the incomplete finding visible', ({ status, heading, explanation }) => {
    const option = makeOption();
    const controller = makeController([option], {
      selectedOption: option,
      operation: {
        operationId: `operation-${status}`,
        strategy: 'repersist',
        status,
        errorMessage: explanation,
        postRecoveryEvidence: {
          status: 'incomplete',
          confirmedTargetCodes: [],
          remainingMissingCodes: ['TRIAGE_CARD'],
        },
      },
    });

    render(<TerminalHarness controller={controller} />);

    const result = screen.getByRole('region', { name: heading });
    expect(within(result).getByText(explanation)).toBeVisible();
    expect(within(result).getByText('No unreviewed replacement was applied.')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Evidence completeness warning' })).toBeVisible();
    expect(screen.getByText('The triage result is not safely saved.')).toBeVisible();
  });
});
