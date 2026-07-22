import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import EvidenceSummary from './EvidenceSummary.jsx';

function makeEvidence(overrides = {}) {
  const summary = {
    headline: '2 expected evidence items are not saved.',
    userResults: { savedCount: 2, expectedCount: 4 },
    supportingNote: 'The saved results remain available.',
    trusted: [],
    atRisk: [],
    unverifiable: [],
    noRepeatNeeded: [],
    nextStep: 'Copy the missing results before leaving.',
    ...overrides.summary,
  };

  return {
    status: 'incomplete',
    settled: true,
    checkedAt: '2026-07-21T12:00:00.000Z',
    contractVersion: 1,
    settlingUntil: null,
    acknowledged: false,
    stages: [],
    artifacts: [],
    missing: [],
    identifiers: {},
    ...overrides,
    summary,
  };
}

function ready(evidence) {
  return { state: 'ready', evidence };
}

describe('EvidenceSummary', () => {
  it('states that evidence is being checked without showing a false warning', () => {
    render(<EvidenceSummary runEvidence={{ state: 'loading', evidence: null }} />);

    expect(screen.getByText('Checking whether this run’s evidence was saved…')).toBeVisible();
    expect(screen.queryByRole('region', { name: /warning/i })).not.toBeInTheDocument();
  });

  it('shows one quiet confirmation with the exact saved-result count and supporting note', () => {
    const headline = 'Evidence complete — all 3 of 3 expected results were safely saved.';
    render(
      <EvidenceSummary
        runEvidence={ready(makeEvidence({
          status: 'complete',
          acknowledged: true,
          summary: {
            headline,
            userResults: { savedCount: 3, expectedCount: 3 },
            supportingNote: 'The full run record is available in this session.',
          },
        }))}
      />,
    );

    expect(screen.getAllByText(`✓ ${headline}`)).toHaveLength(1);
    expect(screen.getByText('The full run record is available in this session.')).toBeVisible();
    expect(screen.queryByRole('region', { name: /warning/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows complete evidence for an honest workflow failure without calling the workflow successful', () => {
    const headline = 'Workflow failed, but its evidence was safely recorded.';
    render(
      <EvidenceSummary
        runEvidence={ready(makeEvidence({
          status: 'complete',
          summary: {
            headline,
            userResults: { savedCount: 2, expectedCount: 2 },
            supportingNote: 'All applicable supporting records were verified.',
          },
        }))}
      />,
    );

    expect(screen.getByText(`✓ ${headline}`)).toBeVisible();
    expect(screen.queryByText(/Workflow complete/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /warning/i })).not.toBeInTheDocument();
  });

  it('combines incomplete evidence into one summary with expandable missing and technical details', async () => {
    const user = userEvent.setup();
    const headline = '2 expected evidence items are not saved.';
    render(
      <EvidenceSummary
        runEvidence={ready(makeEvidence({
          artifacts: [
            { code: 'triage-result', label: 'Triage result', state: 'missing', ids: {} },
            { code: 'analyst-result', label: 'Analyst answer', state: 'missing', ids: {} },
          ],
          missing: [
            {
              code: 'triage-result',
              label: 'Triage result',
              explanation: 'The triage result was produced but its save could not be verified.',
            },
            {
              code: 'analyst-result',
              label: 'Analyst answer',
              explanation: 'The analyst answer was produced but its save could not be verified.',
            },
          ],
          identifiers: { conversationId: 'conversation-123', traceIds: ['trace-a', 'trace-b'] },
          summary: {
            headline,
            trusted: ['Image extraction'],
            noRepeatNeeded: ['Image Parser'],
            supportingNote: 'The saved image extraction remains available.',
            nextStep: 'Copy the triage result and analyst answer before leaving.',
          },
        }))}
        onAcknowledge={() => {}}
      />,
    );

    const warnings = screen.getAllByRole('region', { name: 'Evidence completeness warning' });
    expect(warnings).toHaveLength(1);
    const warning = warnings[0];
    expect(within(warning).getAllByText(headline)).toHaveLength(1);
    expect(within(warning).getByText('What happened')).toBeVisible();
    expect(within(warning).getByText('What can I trust')).toBeVisible();
    expect(within(warning).getByText('Saved: Image extraction')).toBeVisible();
    expect(within(warning).getByText('No repeat needed: Image Parser')).toBeVisible();
    expect(within(warning).getByText('What should I do now')).toBeVisible();
    expect(within(warning).getByText('Copy the triage result and analyst answer before leaving.')).toBeVisible();

    const triageExplanation = within(warning).getByText(
      'The triage result was produced but its save could not be verified.',
    );
    const analystExplanation = within(warning).getByText(
      'The analyst answer was produced but its save could not be verified.',
    );
    expect(triageExplanation).not.toBeVisible();
    expect(analystExplanation).not.toBeVisible();
    await user.click(within(warning).getAllByText('Triage result')[0]);
    await user.click(within(warning).getAllByText('Analyst answer')[0]);
    expect(triageExplanation).toBeVisible();
    expect(analystExplanation).toBeVisible();

    const technicalId = within(warning).getByText('conversation-123');
    expect(technicalId).not.toBeVisible();
    await user.click(within(warning).getByText('Technical details'));
    expect(technicalId).toBeVisible();
    expect(within(warning).getByText('trace-a, trace-b')).toBeVisible();
  });

  it('uses neutral unknown wording and refreshes on request', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(
      <EvidenceSummary
        runEvidence={ready(makeEvidence({
          status: 'unknown',
          settled: false,
          summary: {
            headline: 'Evidence is still settling, so completeness is not known yet.',
            nextStep: 'Check again after the run settles.',
          },
        }))}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByText('Evidence is still settling, so completeness is not known yet. Check again after the run settles.')).toBeVisible();
    expect(screen.queryByRole('region', { name: /warning/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('reports an unavailable check neutrally and retries through the refresh callback', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<EvidenceSummary runEvidence={{ state: 'unavailable', evidence: null }} onRefresh={onRefresh} />);

    expect(screen.getByText('Couldn’t check whether this run’s evidence was saved.')).toBeVisible();
    expect(screen.queryByRole('region', { name: /warning/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('acknowledges a finding, keeps it expandable, and restores the control for a new finding', async () => {
    const user = userEvent.setup();
    const onAcknowledge = vi.fn();
    const firstFinding = makeEvidence({
      missing: [{
        code: 'triage-result',
        label: 'Triage result',
        explanation: 'The triage save could not be verified.',
      }],
      identifiers: { evidenceFingerprint: 'fingerprint-1' },
    });
    const { rerender } = render(
      <EvidenceSummary runEvidence={ready(firstFinding)} onAcknowledge={onAcknowledge} />,
    );

    await user.click(screen.getByRole('button', { name: 'Acknowledge' }));
    expect(onAcknowledge).toHaveBeenCalledOnce();

    rerender(
      <EvidenceSummary
        runEvidence={ready(makeEvidence({
          ...firstFinding,
          acknowledged: true,
        }))}
        onAcknowledge={onAcknowledge}
      />,
    );
    const acknowledgedSummary = screen.getByText(`Acknowledged · ${firstFinding.summary.headline}`);
    expect(acknowledgedSummary).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /warning/i })).not.toBeInTheDocument();
    expect(screen.getByText('What happened')).not.toBeVisible();
    await user.click(acknowledgedSummary);
    expect(screen.getByText('What happened')).toBeVisible();
    await user.click(screen.getByText('Triage result'));
    expect(screen.getByText('The triage save could not be verified.')).toBeVisible();

    rerender(
      <EvidenceSummary
        runEvidence={ready(makeEvidence({
          missing: [{
            code: 'analyst-result',
            label: 'Analyst answer',
            explanation: 'A newer analyst save could not be verified.',
          }],
          identifiers: { evidenceFingerprint: 'fingerprint-2' },
          acknowledged: false,
          summary: { headline: '2 expected evidence items are not saved.' },
        }))}
        onAcknowledge={onAcknowledge}
      />,
    );
    expect(screen.getByText('2 expected evidence items are not saved.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeEnabled();
  });

  it('shows acknowledgement failure and leaves the finding actionable', () => {
    render(
      <EvidenceSummary
        runEvidence={ready(makeEvidence())}
        acknowledgeError="The acknowledgement could not be saved."
        onAcknowledge={() => {}}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('The acknowledgement could not be saved.');
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeEnabled();
    expect(screen.getByRole('region', { name: 'Evidence completeness warning' })).toBeVisible();
  });
});
