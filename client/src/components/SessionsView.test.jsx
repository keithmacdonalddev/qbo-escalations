import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SessionsView from './SessionsView.jsx';

const mocks = vi.hoisted(() => ({
  acknowledgeConversationEvidence: vi.fn(),
  deleteConversation: vi.fn(),
  exportConversation: vi.fn(),
  getConversation: vi.fn(),
  getConversationEvidence: vi.fn(),
  getConversationTraces: vi.fn(),
  listConversations: vi.fn(),
  updateConversation: vi.fn(),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('../api/chatApi.js', () => ({
  acknowledgeConversationEvidence: mocks.acknowledgeConversationEvidence,
  deleteConversation: mocks.deleteConversation,
  exportConversation: mocks.exportConversation,
  getConversation: mocks.getConversation,
  getConversationEvidence: mocks.getConversationEvidence,
  listConversations: mocks.listConversations,
  updateConversation: mocks.updateConversation,
}));

vi.mock('../api/traceApi.js', () => ({
  getConversationTraces: mocks.getConversationTraces,
}));

vi.mock('../hooks/useToast.jsx', () => ({
  useToast: () => mocks.toast,
}));

vi.mock('../lib/providerCatalog.js', () => ({
  getProviderLabel: (provider) => provider || 'Unknown',
}));

const SESSION_ID = 'session-evidence-1';
const SESSION = {
  _id: SESSION_ID,
  title: 'Evidence integration session',
  provider: 'claude',
  messageCount: 2,
  messages: [
    { role: 'user', content: 'Question' },
    { role: 'assistant', content: 'Answer' },
  ],
  caseIntake: { status: 'analyst-complete', runs: [] },
  createdAt: '2026-07-21T10:00:00.000Z',
  updatedAt: '2026-07-21T10:05:00.000Z',
};

function makeEvidence({ status, headline, artifactState }) {
  return {
    status,
    settled: status !== 'unknown',
    acknowledged: false,
    summary: {
      headline,
      userResults: { savedCount: status === 'incomplete' ? 1 : 2, expectedCount: 2 },
      supportingNote: status === 'complete'
        ? 'All applicable supporting records were verified.'
        : '1 supporting record could not be verified.',
    },
    stages: [{ phase: 'analyst', expected: true, attempted: true, status }],
    artifacts: [{
      code: 'ANALYST_MESSAGE',
      label: 'Analyst answer',
      state: artifactState,
      explanation: `Analyst answer is ${artifactState}.`,
      ids: {},
    }],
    identifiers: { conversationId: SESSION_ID },
  };
}

const evidenceCases = [
  {
    name: 'complete',
    listStatus: 'complete',
    chipLabel: 'Evidence complete',
    headline: 'Evidence complete — all 2 of 2 expected results were safely saved.',
    artifactState: 'confirmed',
    groupHeading: 'Confirmed',
  },
  {
    name: 'incomplete',
    listStatus: 'incomplete',
    chipLabel: 'Evidence incomplete',
    headline: '1 expected evidence item is not saved.',
    artifactState: 'missing',
    groupHeading: 'Missing',
  },
  {
    name: 'unknown',
    listStatus: 'unknown',
    chipLabel: null,
    headline: 'Evidence is still settling, so completeness is not known yet.',
    artifactState: 'unverifiable',
    groupHeading: 'Unverifiable',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConversation.mockResolvedValue(SESSION);
  mocks.getConversationTraces.mockResolvedValue([]);
});

describe.each(evidenceCases)('SessionsView $name evidence integration', (evidenceCase) => {
  it('keeps the list chip and Audit-tab evidence section consistent with the server response', async () => {
    const evidence = makeEvidence({
      status: evidenceCase.listStatus,
      headline: evidenceCase.headline,
      artifactState: evidenceCase.artifactState,
    });
    mocks.listConversations.mockResolvedValue([{ ...SESSION, evidenceStatus: evidenceCase.listStatus }]);
    mocks.getConversationEvidence.mockResolvedValue(evidence);

    const view = render(<SessionsView />);

    expect(await screen.findByText(SESSION.title)).toBeVisible();
    if (evidenceCase.chipLabel) {
      const chip = screen.getByLabelText(evidenceCase.chipLabel);
      expect(chip).toHaveAttribute('title', evidenceCase.chipLabel);
    } else {
      expect(screen.queryByLabelText(/Evidence (complete|incomplete)/)).not.toBeInTheDocument();
    }

    view.rerender(<SessionsView sessionId={SESSION_ID} />);
    await screen.findByRole('heading', { name: SESSION.title });
    await waitFor(() => expect(mocks.getConversationEvidence).toHaveBeenCalledWith(SESSION_ID));

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Audit' }));

    const evidenceHeading = screen.getByRole('heading', { name: 'Evidence completeness' });
    const evidenceSection = evidenceHeading.closest('section');
    expect(within(evidenceSection).getByText(evidenceCase.headline)).toBeVisible();
    expect(within(evidenceSection).getByRole('heading', { name: evidenceCase.groupHeading })).toBeVisible();
    expect(within(evidenceSection).getByText('Analyst answer')).toBeVisible();
    if (evidenceCase.name === 'incomplete') {
      expect(within(evidenceSection).getByRole('button', { name: 'Acknowledge' })).toBeEnabled();
    } else {
      expect(within(evidenceSection).queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
    }
  });
});
