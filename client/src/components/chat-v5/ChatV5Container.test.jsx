import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatV5Container from './ChatV5Container.jsx';
import { hasUnsavedWork } from '../../lib/unsavedWorkGuard.js';
import { ToastProvider } from '../../hooks/useToast.jsx';

const mocks = vi.hoisted(() => ({
  unsavedAnswer: 'Exact analyst answer preserved after the final save failed.',
  apiFetchJson: vi.fn(),
  getConversation: vi.fn(),
  getConversationMeta: vi.fn(),
  getEventStats: vi.fn(),
  listAgentIdentities: vi.fn(),
  openAgentTest: vi.fn(),
  refreshRunEvidence: vi.fn(),
}));

const unsavedAnswer = mocks.unsavedAnswer;

vi.mock('../chat/ImageParserPopup.jsx', () => ({
  default: () => null,
}));

vi.mock('./useStageOrchestrator.js', () => ({
  useStageOrchestrator: () => ({
    imageCaptured: false,
    captureImage: vi.fn(),
    reset: vi.fn(),
    stageState: {
      parser: { status: 'done', startedAt: 1, finishedAt: 2, durationMs: 1, error: null, fallbackUsed: false },
      inv: { status: 'done', startedAt: 1, finishedAt: 2, durationMs: 1, error: null, fallbackUsed: false },
      triage: { status: 'done', startedAt: 1, finishedAt: 2, durationMs: 1, error: null, fallbackUsed: false, fallbackReason: '', providerPackageId: '' },
      main: { status: 'failed', startedAt: 1, finishedAt: 2, durationMs: 1, error: 'The final conversation save failed.', fallbackUsed: false },
    },
    stageEvents: {},
    liveEventCounts: {},
    ingestStageEvent: vi.fn(),
    pushLocalStageEvent: vi.fn(),
    capturedImageSrc: null,
    caseIntake: null,
    triageCard: null,
    triageConversationSave: { state: 'idle', error: null, retryAllowed: false },
    runEvidence: { state: 'idle', evidence: null, error: null },
    refreshRunEvidence: mocks.refreshRunEvidence,
    invMatches: [],
    parsedFields: [],
    analyst: {
      text: mocks.unsavedAnswer,
      thinking: '',
      isStreaming: false,
      error: { code: 'ONDONE_SAVE_FAILED', message: 'The final conversation save failed.' },
      conversationId: 'conversation-unsaved',
      unsavedText: mocks.unsavedAnswer,
      unsavedError: 'The final conversation save failed.',
    },
    chatLog: [{ role: 'analyst-stream', text: mocks.unsavedAnswer, isStreaming: false, error: true }],
    sendOperatorMessage: vi.fn(),
    requestError: { code: 'ONDONE_SAVE_FAILED', message: 'The final conversation save failed.' },
    conversationId: 'conversation-unsaved',
    clearResumeTarget: vi.fn(),
    restoreCapturedImage: vi.fn(),
    hydrateFromSavedCaseIntake: vi.fn(),
  }),
}));

vi.mock('../../api/agentIdentitiesApi.js', () => ({
  listAgentIdentities: mocks.listAgentIdentities,
}));

vi.mock('../../api/chatApi.js', () => ({
  acknowledgeConversationEvidence: vi.fn(),
  getConversation: mocks.getConversation,
  getConversationMeta: mocks.getConversationMeta,
  getEventStats: mocks.getEventStats,
}));

vi.mock('../../api/escalationsApi.js', () => ({
  getEscalation: vi.fn(),
  getEscalationKnowledge: vi.fn(),
}));

vi.mock('../../api/http.js', () => ({
  apiFetch: vi.fn(),
  apiFetchJson: mocks.apiFetchJson,
}));

vi.mock('../agent-tests/AgentTestModalProvider.jsx', () => ({
  useAgentTestModal: () => ({ openAgentTest: mocks.openAgentTest }),
}));

vi.mock('./pipelineRuntime.js', () => ({
  buildPipelineRuntimePayload: () => ({}),
  PIPELINE_RUNTIME_IDS: {
    parser: 'escalation-template-parser',
    inv: 'known-issue-search-agent',
    triage: 'triage-agent',
    main: 'chat',
  },
  readPipelineProfileRuntimeStates: vi.fn().mockResolvedValue({}),
  readPipelineRuntimeStatesSync: () => ({}),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiFetchJson.mockResolvedValue({ stages: {} });
  mocks.getConversation.mockResolvedValue(null);
  mocks.getConversationMeta.mockResolvedValue({});
  mocks.getEventStats.mockResolvedValue({ byStage: {}, totals: {} });
  mocks.listAgentIdentities.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatV5Container unsaved analyst protection', () => {
  it('keeps the ONDONE_SAVE_FAILED answer visible and guarded until one confirmed dismissal', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(
      <ToastProvider>
        <ChatV5Container />
      </ToastProvider>,
    );

    expect(await screen.findByText(unsavedAnswer)).toBeVisible();
    expect(screen.getByRole('region', { name: 'Analyst answer not saved' })).toBeVisible();
    await waitFor(() => expect(hasUnsavedWork()).toBe(true));

    await user.click(screen.getByRole('button', { name: 'Dismiss warning' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: 'Analyst answer not saved' })).toBeVisible();
    expect(screen.getByText(unsavedAnswer)).toBeVisible();
    expect(hasUnsavedWork()).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Dismiss warning' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Analyst answer not saved' })).not.toBeInTheDocument();
      expect(hasUnsavedWork()).toBe(false);
    });
    expect(screen.getByText(unsavedAnswer)).toBeVisible();
  });
});
