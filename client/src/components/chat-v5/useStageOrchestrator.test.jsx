import { act, renderHook } from '@testing-library/react';
import { useStageOrchestrator } from './useStageOrchestrator.js';

const mocks = vi.hoisted(() => ({
  getConversationEvidence: vi.fn(),
  readImageParserProfileRuntime: vi.fn(),
  readPipelineProfileRuntimeStates: vi.fn(),
  runTriageStream: vi.fn(),
  sendChatMessage: vi.fn(),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../api/chatApi.js', () => ({
  getConversationEvidence: mocks.getConversationEvidence,
  sendChatMessage: mocks.sendChatMessage,
}));

vi.mock('../../hooks/useToast.jsx', () => ({
  useToast: () => mocks.toast,
}));

vi.mock('../../hooks/useTriage.js', () => ({
  default: () => ({ runTriageStream: mocks.runTriageStream }),
}));

vi.mock('./pipelineRuntime.js', () => ({
  readImageParserProfileRuntime: mocks.readImageParserProfileRuntime,
  readPipelineProfileRuntimeStates: mocks.readPipelineProfileRuntimeStates,
}));

async function flushReactWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readImageParserProfileRuntime.mockResolvedValue({});
  mocks.readPipelineProfileRuntimeStates.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useStageOrchestrator evidence integration', () => {
  it('preserves streamed analyst text when ONDONE_SAVE_FAILED reports that the final conversation save failed', async () => {
    const visibleAnswer = 'Keep this exact analyst answer visible.';
    mocks.sendChatMessage.mockImplementation((_payload, handlers) => {
      handlers.onChunk({ text: visibleAnswer });
      handlers.onError(Object.assign(new Error('The final conversation save failed.'), {
        code: 'ONDONE_SAVE_FAILED',
      }));
      return { abort: vi.fn() };
    });
    const { result } = renderHook(() => useStageOrchestrator());

    await act(async () => {
      await result.current.sendOperatorMessage('Follow up on the escalation.');
    });

    expect(result.current.analyst.text).toBe(visibleAnswer);
    expect(result.current.analyst.unsavedText).toBe(visibleAnswer);
    expect(result.current.analyst.unsavedError).toBe('The final conversation save failed.');
    expect(result.current.analyst.error.code).toBe('ONDONE_SAVE_FAILED');
    expect(result.current.chatLog.at(-1)).toMatchObject({
      role: 'analyst-stream',
      isStreaming: false,
      error: true,
    });
  });

  it('fires exactly one delayed evidence recheck at settlingUntil and does not poll again', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:00:00.000Z'));
    mocks.getConversationEvidence
      .mockResolvedValueOnce({
        status: 'unknown',
        settlingUntil: '2026-07-21T12:00:01.000Z',
        summary: { headline: 'Evidence is still settling, so completeness is not known yet.' },
      })
      .mockResolvedValueOnce({
        status: 'complete',
        settlingUntil: null,
        summary: { headline: 'Evidence complete — all applicable results were safely saved.' },
      });
    const { result } = renderHook(() => useStageOrchestrator({
      resumeConversationId: 'conversation-settling',
    }));

    act(() => {
      result.current.hydrateFromSavedCaseIntake({
        status: 'analyst-complete',
        runs: [{ phase: 'analyst', status: 'completed' }],
      });
    });
    await flushReactWork();

    expect(mocks.getConversationEvidence).toHaveBeenCalledTimes(1);
    expect(mocks.getConversationEvidence).toHaveBeenLastCalledWith('conversation-settling');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_049);
    });
    expect(mocks.getConversationEvidence).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.getConversationEvidence).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mocks.getConversationEvidence).toHaveBeenCalledTimes(2);
  });
});
