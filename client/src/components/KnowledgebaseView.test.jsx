import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import KnowledgebaseView from './KnowledgebaseView.jsx';

const mocks = vi.hoisted(() => ({
  getKnowledgeRecord: vi.fn(),
  listKnowledgeRecords: vi.fn(),
  recordKnowledgeFeedback: vi.fn(),
  resolveKnowledgeRecoveryReview: vi.fn(),
}));

vi.mock('../api/knowledgeApi.js', () => ({
  addKnowledgeRelationship: vi.fn(), deprecateKnowledgeRecord: vi.fn(), exportKnowledge: vi.fn(),
  getKnowledgeAgentStatus: vi.fn().mockResolvedValue({}), getKnowledgeAgentRecordContext: vi.fn().mockResolvedValue(null),
  getKnowledgeOntologySummary: vi.fn().mockResolvedValue({}), getKnowledgeRecord: mocks.getKnowledgeRecord,
  getKnowledgeSummary: vi.fn().mockResolvedValue({}), listKnowledgeRecords: mocks.listKnowledgeRecords,
  publishKnowledgeRecord: vi.fn(), recordKnowledgeFeedback: mocks.recordKnowledgeFeedback, redactKnowledgeRecord: vi.fn(),
  resolveKnowledgeRecoveryReview: mocks.resolveKnowledgeRecoveryReview,
  scanKnowledgeAgent: vi.fn(), searchKnowledge: vi.fn().mockResolvedValue({ records: [], total: 0 }),
  sendKnowledgeAgentMessage: vi.fn(), updateKnowledgeRecord: vi.fn(),
}));
vi.mock('../api/escalationsApi.js', () => ({ generateEscalationKnowledge: vi.fn(), listEscalations: vi.fn().mockResolvedValue({ escalations: [] }) }));
vi.mock('../api/operationalIntelligenceApi.js', () => ({ getOperationalIntelligenceRecord: vi.fn().mockResolvedValue(null) }));
vi.mock('../api/http.js', () => ({ apiFetchJson: vi.fn().mockResolvedValue({}) }));
vi.mock('./chat-v5/TriageReasoningView.jsx', () => ({ default: () => null }));

function record(overrides = {}) {
  return {
    id: 'knowledge-1', title: 'Reconcile opening balance', category: 'banking', summary: 'Use the verified opening balance.',
    reviewStatus: 'published', trustState: 'trusted', publishTarget: 'knowledgebase', reusableOutcome: 'canonical',
    allowedUses: ['agent-response'], allowedUsesText: 'Agent response', evidence: [{ label: 'Resolved escalation' }],
    sourceIds: { escalationId: 'esc-linked' }, updatedAt: '2026-07-22T00:00:00.000Z',
    customerGoal: 'Reconcile account', reportedProblem: 'Opening balance differs', confirmedCause: 'Incorrect opening balance', finalOutcome: 'Corrected opening balance',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listKnowledgeRecords.mockResolvedValue({
    records: [record({ id: 'draft-1', title: 'Draft lesson', reviewStatus: 'draft', trustState: 'candidate' }), record()],
    total: 2,
  });
  mocks.getKnowledgeRecord.mockResolvedValue(record());
  mocks.recordKnowledgeFeedback.mockImplementation(async (_id, payload) => record({ outcomeFeedback: [{ outcome: payload.outcome }] }));
  mocks.resolveKnowledgeRecoveryReview.mockResolvedValue(record({
    reviewStatus: 'draft',
    trustState: 'candidate',
    needsReviewAfterRecovery: null,
    reviewedAfterRecovery: {
      recoveryOperationId: 'recovery-operation-1',
      resolvedAt: '2026-07-22T12:30:00.000Z',
      resolvedBy: 'local-user',
    },
  }));
});

it('distinguishes draft and published knowledge and keeps source-case navigation visible', async () => {
  render(<KnowledgebaseView />);

  expect(await screen.findByText('Draft lesson')).toBeInTheDocument();
  expect(screen.getAllByText('Reconcile opening balance').length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Draft - needs review|Published for agents/).length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByRole('link', { name: /Source Case/ }).length).toBeGreaterThan(0);
});

it('records explicit did-not-work feedback on a published linked record', async () => {
  const user = userEvent.setup();
  render(<KnowledgebaseView recordIdFromRoute="knowledge-1" />);

  const button = await screen.findByRole('button', { name: 'Did Not Work' });
  await user.click(button);

  await waitFor(() => expect(mocks.recordKnowledgeFeedback).toHaveBeenCalledWith('knowledge-1', expect.objectContaining({ outcome: 'did-not-work' })));
  expect(await screen.findByText('Outcome feedback recorded.')).toBeVisible();
});

it('shows the triage recovery marker and lets the reviewer resolve it explicitly', async () => {
  const user = userEvent.setup();
  const markedRecord = record({
    reviewStatus: 'draft',
    trustState: 'candidate',
    sourceIds: { escalationId: 'esc-linked', conversationId: 'conversation-recovered' },
    needsReviewAfterRecovery: {
      recoveryOperationId: 'recovery-operation-1',
      markedAt: '2026-07-22T12:00:00.000Z',
      reason: 'The previous triage result was lost, so this draft could not be checked against it.',
    },
  });
  mocks.getKnowledgeRecord.mockResolvedValue(markedRecord);
  mocks.listKnowledgeRecords.mockResolvedValue({ records: [markedRecord], total: 1 });

  render(<KnowledgebaseView recordIdFromRoute="knowledge-1" />);

  const marker = await screen.findByRole('region', { name: 'Needs review after triage recovery' });
  expect(marker).toHaveTextContent('The previous triage result was lost');
  expect(marker).toHaveTextContent('recovery-operation-1');
  expect(screen.getByRole('link', { name: 'Open the conversation, then view Audit → Recovery timeline' })).toHaveAttribute(
    'href',
    '#/chat/conversation-recovered',
  );

  await user.click(screen.getByRole('button', { name: 'Mark reviewed' }));

  await waitFor(() => expect(mocks.resolveKnowledgeRecoveryReview).toHaveBeenCalledWith(
    'knowledge-1',
    'recovery-operation-1',
  ));
  expect(await screen.findByText('Recovery review marked complete.')).toBeVisible();
});

it('refreshes and shows the newer recovery marker when a stale review is rejected', async () => {
  const user = userEvent.setup();
  const firstMarker = record({
    reviewStatus: 'draft',
    trustState: 'candidate',
    needsReviewAfterRecovery: {
      recoveryOperationId: 'recovery-operation-a',
      reason: 'Review recovery A.',
    },
  });
  const newerMarker = record({
    reviewStatus: 'draft',
    trustState: 'candidate',
    needsReviewAfterRecovery: {
      recoveryOperationId: 'recovery-operation-b',
      reason: 'Review the newer recovery B.',
    },
  });
  mocks.getKnowledgeRecord.mockResolvedValueOnce(firstMarker).mockResolvedValueOnce(newerMarker);
  mocks.listKnowledgeRecords.mockResolvedValue({ records: [newerMarker], total: 1 });
  const staleError = new Error('This draft was re-marked by a newer recovery — please review the current marker.');
  staleError.code = 'KNOWLEDGE_RECOVERY_REVIEW_REMARKED';
  mocks.resolveKnowledgeRecoveryReview.mockRejectedValueOnce(staleError);

  render(<KnowledgebaseView recordIdFromRoute="knowledge-1" />);
  await user.click(await screen.findByRole('button', { name: 'Mark reviewed' }));

  expect(await screen.findByText(/re-marked by a newer recovery/i)).toBeVisible();
  expect((await screen.findAllByText('Review the newer recovery B.')).some((item) => item.tagName === 'P')).toBe(true);
  expect(screen.getByText('recovery-operation-b')).toBeVisible();
  expect(mocks.getKnowledgeRecord).toHaveBeenCalledTimes(2);
});
