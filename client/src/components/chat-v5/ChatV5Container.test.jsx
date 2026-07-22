import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatV5Container from './ChatV5Container.jsx';
import { hasUnsavedWork } from '../../lib/unsavedWorkGuard.js';
import { ToastProvider } from '../../hooks/useToast.jsx';

const mocks = vi.hoisted(() => ({
  unsavedAnswer: 'Exact analyst answer preserved after the final save failed.',
  apiFetchJson: vi.fn(),
  captureImage: vi.fn(),
  getConversation: vi.fn(),
  getConversationMeta: vi.fn(),
  getEscalation: vi.fn(),
  getEscalationKnowledge: vi.fn(),
  getEventStats: vi.fn(),
  hydrateFromSavedCaseIntake: vi.fn(),
  listAgentIdentities: vi.fn(),
  openAgentTest: vi.fn(),
  refreshRunEvidence: vi.fn(),
  reset: vi.fn(),
  orchestratorOverrides: {},
}));

const unsavedAnswer = mocks.unsavedAnswer;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

vi.mock('../chat/ImageParserPopup.jsx', () => ({
  default: () => null,
}));

vi.mock('./useStageOrchestrator.js', () => ({
  useStageOrchestrator: () => ({
    imageCaptured: false,
    captureImage: mocks.captureImage,
    reset: mocks.reset,
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
    hydrateFromSavedCaseIntake: mocks.hydrateFromSavedCaseIntake,
    ...mocks.orchestratorOverrides,
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
  getEscalation: mocks.getEscalation,
  getEscalationKnowledge: mocks.getEscalationKnowledge,
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
  Object.keys(mocks.orchestratorOverrides).forEach((key) => delete mocks.orchestratorOverrides[key]);
  mocks.apiFetchJson.mockResolvedValue({ stages: {} });
  mocks.getConversation.mockResolvedValue(null);
  mocks.getConversationMeta.mockResolvedValue({});
  mocks.getEscalation.mockResolvedValue(null);
  mocks.getEscalationKnowledge.mockResolvedValue(null);
  mocks.getEventStats.mockResolvedValue({ byStage: {}, totals: {} });
  mocks.listAgentIdentities.mockResolvedValue([]);
});

afterEach(() => {
  window.location.hash = '';
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

describe('ChatV5Container image intake', () => {
  function renderContainer() {
    return render(<ToastProvider><ChatV5Container /></ToastProvider>);
  }

  it('selects one image file and forwards its exact metadata', async () => {
    const { container } = renderContainer();
    const input = container.querySelector('input[type="file"][accept="image/*"]');
    const image = new File(['image-bytes'], 'case.png', { type: 'image/png' });

    await userEvent.upload(input, image);

    await waitFor(() => expect(mocks.captureImage).toHaveBeenCalledOnce());
    expect(mocks.captureImage.mock.calls[0][0]).toMatch(/^data:image\/png;base64,/);
    expect(mocks.captureImage.mock.calls[0][1]).toEqual({ name: 'case.png', size: image.size, type: 'image/png' });
  });

  it('accepts drop and paste, ignores non-images, and chooses the first image from multiple files', async () => {
    renderContainer();
    const intake = screen.getByRole('button', { name: 'Upload escalation screenshot' });
    const text = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    const first = new File(['first'], 'first.jpg', { type: 'image/jpeg' });
    const second = new File(['second'], 'second.png', { type: 'image/png' });

    fireEvent.drop(intake, { dataTransfer: { files: [text] } });
    expect(mocks.captureImage).not.toHaveBeenCalled();

    fireEvent.drop(intake, { dataTransfer: { files: [text, first, second] } });
    await waitFor(() => expect(mocks.captureImage).toHaveBeenCalledOnce());
    expect(mocks.captureImage.mock.calls[0][1].name).toBe('first.jpg');

    mocks.captureImage.mockClear();
    fireEvent.paste(intake, {
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => second }] },
    });
    await waitFor(() => expect(mocks.captureImage).toHaveBeenCalledOnce());
    expect(mocks.captureImage.mock.calls[0][1].name).toBe('second.png');
  });

  it('opens the picker from the keyboard and resets through an explicit confirmed action', async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderContainer();

    screen.getByRole('button', { name: 'Upload escalation screenshot' }).focus();
    await user.keyboard('{Enter}');
    expect(click).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Start a new workflow' }));
    expect(mocks.reset).toHaveBeenCalledOnce();
  });

  it('resets a genuinely captured workflow back to visible image intake', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    Object.assign(mocks.orchestratorOverrides, {
      imageCaptured: true,
      capturedImageSrc: 'data:image/png;base64,captured',
      capturedFileMeta: { name: 'captured.png', type: 'image/png', size: 8 },
      requestError: null,
      analyst: { text: 'Prior result', thinking: '', isStreaming: false, error: null, unsavedText: '', unsavedError: '' },
      chatLog: [{ role: 'analyst-stream', text: 'Prior result', isStreaming: false }],
    });
    mocks.reset.mockImplementation(() => {
      Object.assign(mocks.orchestratorOverrides, {
        imageCaptured: false,
        capturedImageSrc: null,
        capturedFileMeta: null,
        analyst: { text: '', thinking: '', isStreaming: false, error: null, unsavedText: '', unsavedError: '' },
        chatLog: [],
      });
    });
    const { rerender } = renderContainer();

    expect(screen.getByText('Screenshot captured')).toBeVisible();
    expect(screen.getByText('Prior result')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Start a new workflow' }));
    rerender(<ToastProvider><ChatV5Container /></ToastProvider>);

    expect(mocks.reset).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Upload escalation screenshot' })).toBeVisible();
    expect(screen.getByText('Upload screenshot')).toBeVisible();
    expect(screen.queryByText('Screenshot captured')).not.toBeInTheDocument();
    expect(screen.queryByText('Prior result')).not.toBeInTheDocument();
  });
});

describe('ChatV5Container rendered workflow states', () => {
  function renderContainer(props = {}) {
    return render(<ToastProvider><ChatV5Container {...props} /></ToastProvider>);
  }

  it('shows image intake first without false completed workflow output', () => {
    Object.assign(mocks.orchestratorOverrides, {
      imageCaptured: false,
      stageState: {
        parser: { status: 'pending' }, inv: { status: 'pending' }, triage: { status: 'pending' }, main: { status: 'pending' },
      },
      analyst: { text: '', thinking: '', isStreaming: false, error: null, unsavedText: '', unsavedError: '' },
      chatLog: [], requestError: null,
    });
    renderContainer();

    expect(screen.getByRole('button', { name: 'Upload escalation screenshot' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Analyst answer not saved' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Evidence complete/i)).not.toBeInTheDocument();
  });

  it('keeps a parser validation failure attached to the parser stage and visible to the user', () => {
    Object.assign(mocks.orchestratorOverrides, {
      imageCaptured: true,
      capturedImageSrc: 'data:image/png;base64,invalid',
      stageState: {
        parser: { status: 'failed', error: 'Parser output did not match the canonical escalation template.' },
        inv: { status: 'pending' }, triage: { status: 'pending' }, main: { status: 'pending' },
      },
      requestError: { code: 'PARSER_VALIDATION_FAILED', message: 'Parser output did not match the canonical escalation template.' },
      analyst: { text: '', thinking: '', isStreaming: false, error: null, unsavedText: '', unsavedError: '' },
      chatLog: [],
    });
    renderContainer();

    expect(screen.getAllByText('Parser output did not match the canonical escalation template.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Visible triage result')).not.toBeInTheDocument();
  });

  it('clears a parser failure and shows successful output after reset and retry', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const failure = 'Parser output did not match the escalation template.';
    Object.assign(mocks.orchestratorOverrides, {
      imageCaptured: true,
      capturedImageSrc: 'data:image/png;base64,failed',
      stageState: {
        parser: { status: 'failed', error: failure },
        inv: { status: 'pending' }, triage: { status: 'pending' }, main: { status: 'pending' },
      },
      requestError: { code: 'PARSER_VALIDATION_FAILED', message: failure },
      analyst: { text: '', thinking: '', isStreaming: false, error: null, unsavedText: '', unsavedError: '' },
      chatLog: [],
    });
    mocks.reset.mockImplementation(() => Object.assign(mocks.orchestratorOverrides, {
      imageCaptured: false,
      capturedImageSrc: null,
      stageState: { parser: { status: 'pending' }, inv: { status: 'pending' }, triage: { status: 'pending' }, main: { status: 'pending' } },
      requestError: null,
    }));
    mocks.captureImage.mockImplementation(() => Object.assign(mocks.orchestratorOverrides, {
      imageCaptured: true,
      capturedImageSrc: 'data:image/png;base64,retried',
      parsedFields: [{ key: 'attemptingTo', value: 'Retry succeeds with trusted evidence' }],
      stageState: { parser: { status: 'done' }, inv: { status: 'pending' }, triage: { status: 'pending' }, main: { status: 'pending' } },
      requestError: null,
    }));
    const { container, rerender } = renderContainer();
    expect(screen.getAllByText(failure).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Start a new workflow' }));
    rerender(<ToastProvider><ChatV5Container /></ToastProvider>);
    const input = container.querySelector('input[type="file"][accept="image/*"]');
    await user.upload(input, new File(['retry'], 'retry.png', { type: 'image/png' }));
    rerender(<ToastProvider><ChatV5Container /></ToastProvider>);

    expect(screen.queryByText(failure)).not.toBeInTheDocument();
    expect(screen.getByText('Retry succeeds with trusted evidence')).toBeVisible();
  });

  it('renders parsed evidence, triage, known-issue findings, analyst output, and complete evidence distinctly', () => {
    const headline = 'Evidence complete — all 4 of 4 expected results were safely saved.';
    Object.assign(mocks.orchestratorOverrides, {
      imageCaptured: true,
      capturedImageSrc: 'data:image/png;base64,complete',
      parsedFields: [{ key: 'attemptingTo', label: 'CX IS ATTEMPTING TO', value: 'Reconcile the bank account' }],
      triageCard: { category: 'banking', summary: 'Review the opening balance', nextStep: 'Compare statements' },
      invMatches: [{ id: 'INV-12345', title: 'Bank reconciliation issue', similarity: 50, status: 'Open' }],
      analyst: { text: 'Final analyst guidance', thinking: '', isStreaming: false, error: null, unsavedText: '', unsavedError: '' },
      chatLog: [{ role: 'analyst-stream', text: 'Final analyst guidance', isStreaming: false }],
      requestError: null,
      runEvidence: {
        state: 'ready',
        evidence: { status: 'complete', acknowledged: true, summary: { headline, userResults: { savedCount: 4, expectedCount: 4 }, supportingNote: 'All results are retained.' } },
      },
    });
    renderContainer();

    expect(screen.getByRole('complementary', { name: 'Escalation evidence and agent output' })).toBeVisible();
    expect(screen.getByText('CX IS ATTEMPTING TO:')).toBeVisible();
    expect(screen.getByText('Reconcile the bank account')).toBeVisible();
    expect(screen.getByText('Review the opening balance')).toBeVisible();
    expect(screen.getByText('Compare statements')).toBeVisible();
    expect(screen.getByText('Bank reconciliation issue')).toBeVisible();
    expect(screen.getByText('Final analyst guidance')).toBeVisible();
    expect(screen.getByText(`✓ ${headline}`)).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Evidence completeness warning' })).not.toBeInTheDocument();
  });

  it.each([
    ['triage', 'The triage provider did not return a usable result.'],
    ['main', 'The analyst stream ended before a final answer was returned.'],
  ])('keeps a %s failure attached to that workflow stage', (failedStage, message) => {
    Object.assign(mocks.orchestratorOverrides, {
      imageCaptured: true,
      capturedImageSrc: 'data:image/png;base64,failed',
      stageState: {
        parser: { status: 'done' },
        inv: { status: 'done' },
        triage: failedStage === 'triage' ? { status: 'failed', error: message } : { status: 'done' },
        main: failedStage === 'main' ? { status: 'failed', error: message } : { status: 'pending' },
      },
      triageCard: null,
      analyst: { text: '', thinking: '', isStreaming: false, error: null, unsavedText: '', unsavedError: '' },
      chatLog: [],
      requestError: failedStage === 'main' ? { code: 'ANALYST_FAILED', message } : null,
    });
    renderContainer();

    expect(screen.getAllByText(message).length).toBeGreaterThan(0);
    expect(screen.queryByText('Final analyst guidance')).not.toBeInTheDocument();
  });

  it('shows incomplete evidence as an actionable warning instead of a complete result', () => {
    const headline = '2 expected evidence items are not saved.';
    Object.assign(mocks.orchestratorOverrides, {
      imageCaptured: true,
      capturedImageSrc: 'data:image/png;base64,incomplete',
      requestError: null,
      analyst: { text: 'Visible answer', thinking: '', isStreaming: false, error: null, unsavedText: '', unsavedError: '' },
      chatLog: [{ role: 'analyst-stream', text: 'Visible answer', isStreaming: false }],
      runEvidence: {
        state: 'ready',
        evidence: {
          status: 'incomplete',
          acknowledged: false,
          missing: [{ code: 'triage-result', label: 'Triage result', explanation: 'The triage save could not be verified.' }],
          identifiers: { evidenceFingerprint: 'container-incomplete' },
          summary: { headline, nextStep: 'Copy the visible result before leaving.' },
        },
      },
    });
    renderContainer();

    const warning = screen.getByRole('region', { name: 'Evidence completeness warning' });
    expect(warning).toBeVisible();
    expect(screen.getByText(headline)).toBeVisible();
    expect(screen.queryByText(/Evidence complete/i)).not.toBeInTheDocument();
  });

  it('keeps an unsaved triage result visible and blocks linked-case navigation when the user stays', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mocks.getConversationMeta.mockResolvedValue({ escalationId: 'escalation-guarded' });
    mocks.getEscalation.mockResolvedValue({ _id: 'escalation-guarded', status: 'open', coid: 'COID-GUARDED', category: 'banking' });
    mocks.getEscalationKnowledge.mockResolvedValue({ id: 'knowledge-guarded', reviewStatus: 'draft' });
    Object.assign(mocks.orchestratorOverrides, {
      imageCaptured: true,
      triageCard: { severity: 'P2', category: 'banking', summary: 'Visible unsaved triage result', nextAction: 'Copy this result first' },
      triageConversationSave: { state: 'failed', error: 'The triage result could not be saved.', retryAllowed: false },
      requestError: null,
    });
    renderContainer();

    expect(await screen.findByRole('region', { name: 'Triage card not saved' })).toBeVisible();
    expect(screen.getByText('Visible unsaved triage result')).toBeVisible();
    await waitFor(() => expect(hasUnsavedWork()).toBe(true));
    await user.click(await screen.findByRole('button', { name: 'Finish Case' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(window.location.hash).not.toContain('escalation-guarded');
    expect(screen.getByText('Visible unsaved triage result')).toBeVisible();
  });

  it('navigates from a linked chat to both its escalation and knowledge record', async () => {
    const user = userEvent.setup();
    mocks.getConversationMeta.mockResolvedValue({ escalationId: 'escalation-linked' });
    mocks.getEscalation.mockResolvedValue({ _id: 'escalation-linked', status: 'resolved', coid: 'COID-LINKED', category: 'payroll' });
    mocks.getEscalationKnowledge.mockResolvedValue({ id: 'knowledge-linked', reviewStatus: 'draft' });
    Object.assign(mocks.orchestratorOverrides, {
      requestError: null,
      analyst: { text: 'Saved answer', thinking: '', isStreaming: false, error: null, unsavedText: '', unsavedError: '' },
      chatLog: [{ role: 'analyst-stream', text: 'Saved answer', isStreaming: false }],
    });
    renderContainer();

    await user.click(await screen.findByRole('button', { name: 'Finish Case' }));
    expect(window.location.hash).toBe('#/escalations/escalation-linked');
    window.location.hash = '#/chat/conversation-unsaved';
    await user.click(screen.getByRole('button', { name: 'Review Knowledge' }));
    expect(window.location.hash).toBe('#/knowledge/knowledge-linked');
  });

  it('hydrates a saved conversation route once', async () => {
    const saved = { _id: 'conversation-resume', caseIntake: { status: 'analyst-complete', runs: [] }, messages: [] };
    mocks.getConversation.mockResolvedValue(saved);
    Object.assign(mocks.orchestratorOverrides, {
      conversationId: null,
      imageCaptured: false,
      chatLog: [],
      analyst: { text: '', thinking: '', isStreaming: false, error: null, unsavedText: '', unsavedError: '' },
      requestError: null,
    });
    renderContainer({ conversationIdFromRoute: 'conversation-resume' });

    await waitFor(() => expect(mocks.getConversation).toHaveBeenCalledWith('conversation-resume'));
    await waitFor(() => expect(mocks.hydrateFromSavedCaseIntake).toHaveBeenCalledWith(saved.caseIntake));
  });

  it('switches rendered saved routes once and ignores a stale earlier response', async () => {
    const first = deferred();
    const savedB = { _id: 'conversation-b', caseIntake: { status: 'analyst-complete', runs: [{ phase: 'analyst', status: 'completed' }] }, messages: [] };
    mocks.getConversation.mockImplementation((id) => (id === 'conversation-a' ? first.promise : Promise.resolve(savedB)));
    Object.assign(mocks.orchestratorOverrides, {
      conversationId: null,
      imageCaptured: false,
      chatLog: [],
      analyst: { text: '', thinking: '', isStreaming: false, error: null, unsavedText: '', unsavedError: '' },
      requestError: null,
    });
    const { rerender } = renderContainer({ conversationIdFromRoute: 'conversation-a' });
    await waitFor(() => expect(mocks.getConversation).toHaveBeenCalledWith('conversation-a'));

    rerender(<ToastProvider><ChatV5Container conversationIdFromRoute="conversation-b" /></ToastProvider>);
    await waitFor(() => expect(mocks.hydrateFromSavedCaseIntake).toHaveBeenCalledWith(savedB.caseIntake));
    first.resolve({ _id: 'conversation-a', caseIntake: { status: 'analyst-complete', runs: [{ phase: 'analyst', status: 'failed' }] }, messages: [] });
    await waitFor(() => expect(mocks.hydrateFromSavedCaseIntake).toHaveBeenCalledTimes(1));

    rerender(<ToastProvider><ChatV5Container conversationIdFromRoute="conversation-b" /></ToastProvider>);
    expect(mocks.hydrateFromSavedCaseIntake).toHaveBeenCalledTimes(1);
  });
});
