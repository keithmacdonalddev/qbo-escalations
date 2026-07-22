import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStageOrchestrator } from './useStageOrchestrator.js';

const mocks = vi.hoisted(() => ({
  getConversationEvidence: vi.fn(),
  apiFetch: vi.fn(),
  readApiResponse: vi.fn(),
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

vi.mock('../../api/http.js', () => ({
  apiFetch: mocks.apiFetch,
  readApiResponse: mocks.readApiResponse,
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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function successfulParserResponse() {
  return jsonResponse({
    ok: true,
    text: 'Customer cannot reconcile the bank account.',
    sourceText: 'Customer cannot reconcile the bank account.',
    role: 'escalation',
    providerUsed: 'codex',
    modelUsed: 'test-parser',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readImageParserProfileRuntime.mockResolvedValue({ provider: 'codex', model: 'test-parser' });
  mocks.readApiResponse.mockImplementation(async (response) => response.json());
  mocks.readPipelineProfileRuntimeStates.mockResolvedValue({
    parser: { provider: 'codex', model: 'test-parser' },
  });
  mocks.runTriageStream.mockReturnValue({ abort: vi.fn() });
  mocks.sendChatMessage.mockReturnValue({ abort: vi.fn() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useStageOrchestrator evidence integration', () => {
  it('starts with an empty, pending pipeline that is ready for image intake', () => {
    const { result } = renderHook(() => useStageOrchestrator());

    expect(result.current.imageCaptured).toBe(false);
    expect(result.current.activeWidget).toBe('image');
    expect(result.current.requestError).toBeNull();
    expect(result.current.stageState).toMatchObject({
      parser: { status: 'pending' },
      triage: { status: 'pending' },
      inv: { status: 'pending' },
      main: { status: 'pending' },
    });
  });

  it('surfaces a parser request failure and does not start downstream stages', async () => {
    mocks.apiFetch.mockRejectedValue(Object.assign(new Error('Parser unavailable'), { code: 'PARSER_OFFLINE' }));
    const { result } = renderHook(() => useStageOrchestrator());

    act(() => {
      result.current.captureImage('data:image/png;base64,abc', { name: 'case.png', type: 'image/png', size: 3 });
    });
    await flushReactWork();

    expect(result.current.imageCaptured).toBe(true);
    expect(result.current.requestError).toMatchObject({ code: 'PARSER_OFFLINE', message: 'Parser unavailable' });
    expect(result.current.stageState.parser).toMatchObject({ status: 'failed', error: 'Parser unavailable' });
    expect(result.current.stageState.triage.status).toBe('pending');
    expect(mocks.runTriageStream).not.toHaveBeenCalled();
    expect(mocks.sendChatMessage).not.toHaveBeenCalled();
  });

  it('rejects an empty successful parser response before triage or analyst work starts', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true, text: '', sourceText: '' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const { result } = renderHook(() => useStageOrchestrator());

    act(() => {
      result.current.captureImage('data:image/png;base64,abc', { name: 'empty.png', type: 'image/png' });
    });
    await flushReactWork();

    expect(result.current.requestError.message).toBe('Image parser returned no text.');
    expect(result.current.stageState.parser.status).toBe('failed');
    expect(mocks.runTriageStream).not.toHaveBeenCalled();
    expect(mocks.sendChatMessage).not.toHaveBeenCalled();
  });

  it('rejects parser output that failed canonical validation before it reaches downstream agents', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      text: 'Untrusted parser output',
      parseMeta: { passed: false, issues: [{ message: 'missing customer goal' }] },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const { result } = renderHook(() => useStageOrchestrator());

    act(() => {
      result.current.captureImage('data:image/png;base64,abc', { name: 'invalid.png', type: 'image/png' });
    });
    await flushReactWork();

    expect(result.current.requestError).toMatchObject({ code: 'PARSER_VALIDATION_FAILED' });
    expect(result.current.requestError.message).toContain('missing customer goal');
    expect(result.current.stageState.parser.status).toBe('failed');
    expect(mocks.runTriageStream).not.toHaveBeenCalled();
    expect(mocks.sendChatMessage).not.toHaveBeenCalled();
  });

  it('cancels an in-flight parser request and restores the initial state on reset', async () => {
    let capturedSignal;
    mocks.apiFetch.mockImplementation((_url, options) => {
      capturedSignal = options.signal;
      return new Promise(() => {});
    });
    const { result } = renderHook(() => useStageOrchestrator());

    act(() => {
      result.current.captureImage('data:image/png;base64,abc', { name: 'cancel.png', type: 'image/png' });
    });
    await flushReactWork();
    act(() => result.current.reset());

    expect(capturedSignal.aborted).toBe(true);
    expect(result.current.imageCaptured).toBe(false);
    expect(result.current.capturedImageSrc).toBeNull();
    expect(result.current.requestError).toBeNull();
    expect(result.current.stageState.parser.status).toBe('pending');
  });

  it('starts triage and analyst streams with the parsed escalation text', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      text: 'Customer cannot reconcile the bank account.',
      sourceText: 'Customer cannot reconcile the bank account.',
      role: 'escalation',
      providerUsed: 'codex',
      modelUsed: 'test-parser',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const { result } = renderHook(() => useStageOrchestrator());

    act(() => {
      result.current.captureImage('data:image/png;base64,abc', { name: 'case.png', type: 'image/png' });
    });
    await flushReactWork();

    expect(result.current.stageState.parser.status).toBe('done');
    expect(mocks.runTriageStream).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Customer cannot reconcile the bank account.' }),
      expect.any(Object),
    );
    expect(mocks.sendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        parsedEscalationText: 'Customer cannot reconcile the bank account.',
        parsedEscalationSource: 'image-parser',
      }),
      expect.any(Object),
    );
  });

  it('settles a complete image workflow, retains its conversation, saves triage, and checks evidence', async () => {
    let triageHandlers;
    let chatHandlers;
    mocks.apiFetch
      .mockResolvedValueOnce(successfulParserResponse())
      .mockResolvedValueOnce(jsonResponse({ ok: true, caseIntake: { status: 'analyst-complete', runs: [] } }));
    mocks.getConversationEvidence.mockResolvedValue({ status: 'complete', settlingUntil: null });
    mocks.runTriageStream.mockImplementation((_payload, handlers) => {
      triageHandlers = handlers;
      return { abort: vi.fn() };
    });
    mocks.sendChatMessage.mockImplementation((_payload, handlers) => {
      chatHandlers = handlers;
      return { abort: vi.fn() };
    });
    const { result } = renderHook(() => useStageOrchestrator());

    act(() => result.current.captureImage('data:image/png;base64,abc', { name: 'complete.png', type: 'image/png' }));
    await flushReactWork();
    act(() => chatHandlers.onInit({ conversationId: 'conversation-complete' }));
    act(() => triageHandlers.onComplete({
      ok: true,
      card: { category: 'banking', summary: 'Reconcile issue', nextAction: 'Review opening balance' },
      elapsedMs: 12,
    }));
    act(() => {
      chatHandlers.onCaseIntake({
        status: 'analyst-complete',
        runs: [
          { phase: 'parse-template', status: 'completed' },
          { phase: 'known-issue-search', status: 'completed' },
          { phase: 'triage', status: 'completed' },
          { phase: 'analyst', status: 'completed' },
        ],
      });
      chatHandlers.onChunk({ text: 'Final saved analyst answer.' });
      chatHandlers.onDone({ conversationId: 'conversation-complete' });
    });
    await flushReactWork();
    await flushReactWork();

    expect(result.current.conversationId).toBe('conversation-complete');
    expect(result.current.stageState).toMatchObject({
      parser: { status: 'done' },
      inv: { status: 'done' },
      triage: { status: 'done' },
      main: { status: 'done' },
    });
    expect(result.current.analyst.text).toBe('Final saved analyst answer.');
    expect(result.current.triageCard).toMatchObject({ category: 'banking' });
    expect(result.current.triageConversationSave.state).toBe('saved');
    expect(mocks.apiFetch).toHaveBeenNthCalledWith(2, '/api/conversations/conversation-complete/triage-result', expect.any(Object));
    expect(mocks.getConversationEvidence).toHaveBeenCalledWith('conversation-complete');
  });

  it('preserves a visible triage card and marks it unsaved when persistence fails', async () => {
    let triageHandlers;
    let chatHandlers;
    mocks.apiFetch
      .mockResolvedValueOnce(successfulParserResponse())
      .mockRejectedValueOnce(new Error('Triage save unavailable'));
    mocks.runTriageStream.mockImplementation((_payload, handlers) => {
      triageHandlers = handlers;
      return { abort: vi.fn() };
    });
    mocks.sendChatMessage.mockImplementation((_payload, handlers) => {
      chatHandlers = handlers;
      return { abort: vi.fn() };
    });
    const { result } = renderHook(() => useStageOrchestrator());

    act(() => result.current.captureImage('data:image/png;base64,abc', { name: 'unsaved.png', type: 'image/png' }));
    await flushReactWork();
    act(() => chatHandlers.onInit({ conversationId: 'conversation-unsaved-triage' }));
    act(() => triageHandlers.onComplete({
      ok: true,
      card: { category: 'payroll', summary: 'Visible triage result', nextAction: 'Review tax setup' },
    }));
    act(() => chatHandlers.onDone({ fullResponse: 'Analyst completed.' }));
    await flushReactWork();

    expect(result.current.triageCard).toMatchObject({ summary: 'Visible triage result' });
    expect(result.current.triageConversationSave).toMatchObject({
      state: 'failed',
      error: 'Triage save unavailable',
    });
  });

  it('records a live analyst provider fallback and clears it on reset', async () => {
    let handlers;
    mocks.sendChatMessage.mockImplementation((_payload, nextHandlers) => {
      handlers = nextHandlers;
      return { abort: vi.fn() };
    });
    const { result } = renderHook(() => useStageOrchestrator());

    await act(async () => result.current.sendOperatorMessage('Use fallback if needed.'));
    act(() => handlers.onFallback({ from: 'claude', to: 'codex', reason: 'PROVIDER_TIMEOUT' }));

    expect(result.current.stageState.main).toMatchObject({
      fallbackUsed: true,
      fallbackReason: 'PROVIDER_TIMEOUT',
    });
    act(() => result.current.reset());
    expect(result.current.stageState.main).toMatchObject({ fallbackUsed: false, fallbackReason: '' });
  });

  it('aborts every active leg on unmount and ignores late stream callbacks', async () => {
    const chatAbort = vi.fn();
    const triageAbort = vi.fn();
    let chatHandlers;
    let triageHandlers;
    mocks.apiFetch.mockResolvedValueOnce(successfulParserResponse());
    mocks.runTriageStream.mockImplementation((_payload, handlers) => {
      triageHandlers = handlers;
      return { abort: triageAbort };
    });
    mocks.sendChatMessage.mockImplementation((_payload, handlers) => {
      chatHandlers = handlers;
      return { abort: chatAbort };
    });
    const { result, unmount } = renderHook(() => useStageOrchestrator());

    act(() => result.current.captureImage('data:image/png;base64,abc', { name: 'late.png', type: 'image/png' }));
    await flushReactWork();
    unmount();
    expect(chatAbort).toHaveBeenCalledOnce();
    expect(triageAbort).toHaveBeenCalledOnce();
    expect(() => {
      chatHandlers.onChunk({ text: 'late analyst text' });
      triageHandlers.onComplete({ ok: true, card: { summary: 'late triage' } });
    }).not.toThrow();
  });

  it('reset clears scheduled widget timers and late callbacks cannot repopulate the fresh workflow', async () => {
    vi.useFakeTimers();
    const chatAbort = vi.fn();
    const triageAbort = vi.fn();
    let chatHandlers;
    let triageHandlers;
    mocks.apiFetch.mockResolvedValueOnce(successfulParserResponse());
    mocks.runTriageStream.mockImplementation((_payload, handlers) => {
      triageHandlers = handlers;
      return { abort: triageAbort };
    });
    mocks.sendChatMessage.mockImplementation((_payload, handlers) => {
      chatHandlers = handlers;
      return { abort: chatAbort };
    });
    const { result } = renderHook(() => useStageOrchestrator());

    act(() => result.current.captureImage('data:image/png;base64,abc', { name: 'timer-reset.png', type: 'image/png' }));
    await flushReactWork();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => result.current.reset());
    expect(chatAbort).toHaveBeenCalledOnce();
    expect(triageAbort).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      chatHandlers.onChunk({ text: 'late analyst result' });
      chatHandlers.onDone({ conversationId: 'late-conversation' });
      triageHandlers.onComplete({ ok: true, card: { summary: 'late triage result' } });
    });
    await act(async () => vi.runAllTimersAsync());
    expect(result.current.imageCaptured).toBe(false);
    expect(result.current.conversationId).toBeNull();
    expect(result.current.analyst.text).toBe('');
    expect(result.current.triageCard).toBeNull();
    expect(result.current.stageState).toMatchObject({
      parser: { status: 'pending' }, triage: { status: 'pending' }, inv: { status: 'pending' }, main: { status: 'pending' },
    });
  });

  it('switches saved sessions without duplication and refuses stale saved hydration after live evidence', async () => {
    let chatHandlers;
    mocks.sendChatMessage.mockImplementation((_payload, handlers) => {
      chatHandlers = handlers;
      return { abort: vi.fn() };
    });
    const { result, rerender } = renderHook(
      ({ id }) => useStageOrchestrator({ resumeConversationId: id }),
      { initialProps: { id: 'conversation-a' } },
    );
    const savedA = { status: 'analyst-complete', runs: [{ phase: 'triage', status: 'completed', summary: 'A' }] };
    const savedB = { status: 'analyst-complete', runs: [{ phase: 'triage', status: 'completed', summary: 'B' }] };
    act(() => result.current.hydrateFromSavedCaseIntake(savedA));
    rerender({ id: 'conversation-b' });
    act(() => result.current.hydrateFromSavedCaseIntake(savedB));
    expect(result.current.caseIntake).toBe(savedB);
    expect(result.current.caseIntake.runs).toHaveLength(1);

    await act(async () => result.current.sendOperatorMessage('Start live work.'));
    act(() => chatHandlers.onCaseIntake({ status: 'running', runs: [{ phase: 'analyst', status: 'running' }] }));
    act(() => result.current.hydrateFromSavedCaseIntake(savedA));
    expect(result.current.caseIntake.status).toBe('running');
  });

  it('skips triage for a non-escalation image but still sends the parsed context to the analyst', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      text: 'This is a dashboard screenshot.',
      role: 'dashboard',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const { result } = renderHook(() => useStageOrchestrator());

    act(() => {
      result.current.captureImage('data:image/png;base64,abc', { name: 'dashboard.png', type: 'image/png' });
    });
    await flushReactWork();

    expect(mocks.runTriageStream).not.toHaveBeenCalled();
    expect(mocks.sendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        parsedEscalationText: 'This is a dashboard screenshot.',
        pipelineReceipts: expect.objectContaining({
          triage: expect.objectContaining({
            planned: false,
            skipReason: 'Parser classified this image as dashboard.',
          }),
        }),
      }),
      expect.any(Object),
    );
    expect(result.current.stageState.triage.status).toBe('done');
  });

  it('hydrates saved fallback evidence truthfully without inventing live stage events', () => {
    const savedCaseIntake = {
      status: 'analyst-complete',
      runs: [{
        phase: 'triage',
        status: 'completed',
        fallback: { used: true, reason: 'Primary provider unavailable' },
        events: [{ stage: 'triage', kind: 'completed', data: { status: 'success' } }],
      }],
    };
    const { result } = renderHook(() => useStageOrchestrator({
      resumeConversationId: 'saved-conversation',
    }));

    act(() => result.current.hydrateFromSavedCaseIntake(savedCaseIntake));
    act(() => result.current.hydrateFromSavedCaseIntake(savedCaseIntake));

    expect(result.current.stageState.triage).toMatchObject({
      status: 'done',
      fallbackUsed: true,
      fallbackReason: 'Primary provider unavailable',
    });
    expect(result.current.caseIntake).toBe(savedCaseIntake);
    expect(result.current.stageEvents).toEqual({});
  });

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
