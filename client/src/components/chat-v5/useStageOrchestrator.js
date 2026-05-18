import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sendChatMessage } from '../../api/chatApi.js';
import { apiFetch } from '../../api/http.js';
import { consumeSSEStream } from '../../api/sse.js';
import { normalizeError } from '../../utils/normalizeError.js';
import {
  readImageParserProfileRuntime,
  readPipelineProfileRuntimeStates,
} from './pipelineRuntime.js';

// Client-emitted events that represent user interaction rather than agent
// pipeline work. Kept in sync with the server-side UI_EVENT_KINDS set in
// server/src/lib/stage-events.js so both sides categorize the same kinds
// the same way.
const UI_LOCAL_EVENT_KINDS = new Set([
  'parser.popup_opened',
  'parser.popup_closed',
  'parser.replay_skipped',
]);

const INITIAL_STAGE_STATE = {
  parser: { status: 'pending', startedAt: null, finishedAt: null, durationMs: null, error: null, fallbackUsed: false },
  triage: { status: 'pending', startedAt: null, finishedAt: null, durationMs: null, error: null, fallbackUsed: false, fallbackReason: '' },
  inv: { status: 'pending', startedAt: null, finishedAt: null, durationMs: null, error: null, fallbackUsed: false },
  main: { status: 'pending', startedAt: null, finishedAt: null, durationMs: null, error: null, fallbackUsed: false },
};

const PARSED_FIELD_LABELS = [
  { key: 'coid', label: 'COID' },
  { key: 'mid', label: 'MID' },
  { key: 'caseNumber', label: 'Case #' },
  { key: 'clientContact', label: 'Client / contact' },
  { key: 'agentName', label: 'Phone agent' },
  { key: 'attemptingTo', label: 'Attempting to' },
  { key: 'expectedOutcome', label: 'Expected outcome' },
  { key: 'actualOutcome', label: 'Actual outcome' },
  { key: 'kbToolsUsed', label: 'KB / tools used' },
  { key: 'triedTestAccount', label: 'Tried test account' },
  { key: 'tsSteps', label: 'Steps tried' },
];

function durationFromStart(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return null;
  return Math.max(0, finishedAt - startedAt);
}

function deriveParsedFieldsFromCaseIntake(caseIntake) {
  const raw = caseIntake?.parseFields;
  if (!raw || typeof raw !== 'object') return [];
  const out = [];
  for (const def of PARSED_FIELD_LABELS) {
    const value = typeof raw[def.key] === 'string' ? raw[def.key].trim() : '';
    if (value) out.push({ key: def.key, label: def.label, value });
  }
  return out;
}

function normalizeInvMatches(rawArray) {
  if (!Array.isArray(rawArray)) return [];
  return rawArray.map((m, i) => {
    const score = Number(m?.score) || 0;
    const similarity = Math.max(0, Math.min(100, Math.round(score * 100)));
    const status = (m?.status || '').toLowerCase() || 'open';
    return {
      id: m?.invNumber || `INV-${i}`,
      title: m?.subject || m?.summary || 'Investigation match',
      similarity,
      status,
      age: m?.lastUpdated ? formatRelative(m.lastUpdated) : '',
      note: m?.confidence === 'high' ? 'high confidence' : (m?.confidence === 'likely' ? 'likely match' : ''),
      best: i === 0,
      _raw: m,
    };
  });
}

function formatRelative(value) {
  try {
    const d = new Date(value);
    const ms = Date.now() - d.getTime();
    if (!Number.isFinite(ms) || ms < 0) return '';
    const days = Math.floor(ms / 86_400_000);
    if (days < 1) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? '' : 's'} ago`;
  } catch {
    return '';
  }
}

function buildEmptyAnalystState() {
  return {
    text: '',
    thinking: '',
    isStreaming: false,
    error: null,
    conversationId: null,
  };
}

function cleanRuntimeValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildWorkflowAgentRuntimePayload(runtimeByStage = {}) {
  const inv = runtimeByStage.inv || {};
  const triage = runtimeByStage.triage || {};
  return {
    'known-issue-search-agent': inv,
    'triage-agent': triage,
  };
}

function buildMainRuntimePayload(runtimeByStage = {}) {
  const main = runtimeByStage.main || {};
  const payload = {};
  const provider = cleanRuntimeValue(main.provider);
  const mode = cleanRuntimeValue(main.mode);
  const model = cleanRuntimeValue(main.model);
  const fallbackProvider = cleanRuntimeValue(main.fallbackProvider);
  const fallbackModel = cleanRuntimeValue(main.fallbackModel);
  const reasoningEffort = cleanRuntimeValue(main.reasoningEffort);

  if (provider) payload.primaryProvider = provider;
  if (mode) payload.mode = mode;
  if (model) payload.primaryModel = model;
  if (fallbackProvider) payload.fallbackProvider = fallbackProvider;
  if (fallbackModel) payload.fallbackModel = fallbackModel;
  if (reasoningEffort) payload.reasoningEffort = reasoningEffort;
  return payload;
}

function buildPipelineChatPayload(basePayload, runtimeByStage = {}) {
  return {
    ...basePayload,
    ...buildMainRuntimePayload(runtimeByStage),
    agentRuntime: buildWorkflowAgentRuntimePayload(runtimeByStage),
  };
}

async function readPipelineRuntimeForExecution() {
  try {
    return await readPipelineProfileRuntimeStates();
  } catch {
    return {};
  }
}

async function parseImageWithApi(imageDataUrl, signal, parserRuntime = null, onStageEvent = null) {
  const cfg = parserRuntime?.provider ? parserRuntime : await readImageParserProfileRuntime();
  if (!cfg.provider) {
    throw Object.assign(new Error('No Image Parser provider configured. Open Agents > Image Parser > Configuration to choose one.'), {
      code: 'NO_PARSER_PROVIDER',
    });
  }
  const start = Date.now();
  const wantsStream = typeof onStageEvent === 'function';
  const res = await apiFetch('/api/image-parser/parse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(wantsStream ? { Accept: 'text/event-stream' } : {}),
    },
    body: JSON.stringify({
      image: imageDataUrl,
      provider: cfg.provider,
      model: cfg.model || undefined,
      reasoningEffort: cfg.reasoningEffort || undefined,
      promptId: 'escalation-template-parser',
    }),
    timeout: 210_000,
    noRetry: true,
    signal,
  });

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const isSse = wantsStream && contentType.includes('text/event-stream');

  let data;
  if (isSse) {
    let completed = null;
    let errorPayload = null;
    await consumeSSEStream(res, (eventType, payload) => {
      if (eventType === 'stage_event') {
        try { onStageEvent(payload); } catch { /* noop */ }
      } else if (eventType === 'parse_complete') {
        completed = payload;
      } else if (eventType === 'error') {
        errorPayload = payload;
      }
    });
    if (errorPayload && !completed) {
      data = { ok: false, error: errorPayload.error || errorPayload.message || 'Parse failed', code: errorPayload.code };
    } else {
      data = completed || { ok: false, error: 'Parse stream ended without a result.' };
    }
  } else {
    data = await res.json().catch(() => ({ ok: false, error: res.statusText }));
  }

  if (!data?.ok || (!isSse && !res.ok)) {
    const msg = data?.error || `Parse failed (HTTP ${res.status})`;
    throw Object.assign(new Error(msg), { code: data?.code || 'PARSE_FAILED' });
  }
  return {
    text: data.text || data.sourceText || '',
    sourceText: data.sourceText || data.text || '',
    providerUsed: data.providerUsed || cfg.provider,
    modelUsed: data.modelUsed || data.usage?.model || cfg.model || '',
    reasoningEffortUsed: cfg.reasoningEffort || '',
    elapsedMs: Date.now() - start,
  };
}

export function useStageOrchestrator() {
  const [imageCaptured, setImageCaptured] = useState(false);
  const [activeWidget, setActiveWidget] = useState('image');
  const [splitView, setSplitView] = useState(false);
  const [stageState, setStageState] = useState(INITIAL_STAGE_STATE);
  const [manualNav, setManualNav] = useState(false);

  // Pipeline data state — driven entirely by SSE events + parse response
  const [capturedImageSrc, setCapturedImageSrc] = useState(null);
  const [capturedFileMeta, setCapturedFileMeta] = useState(null);
  const [caseIntake, setCaseIntake] = useState(null);
  const [triageCard, setTriageCard] = useState(null);
  const [invMatches, setInvMatches] = useState([]);
  const [analyst, setAnalyst] = useState(buildEmptyAnalystState);
  const [conversationId, setConversationId] = useState(null);
  const [requestError, setRequestError] = useState(null);
  const [chatLog, setChatLog] = useState([]);
  // Live stage events streamed from the server. Bucketed by stageId so the
  // pipeline-card popout can show terminal-style logs for whichever card the
  // user clicks. Cleared on reset().
  const [stageEvents, setStageEvents] = useState({});

  const abortRef = useRef(null);
  const parseAbortRef = useRef(null);
  const tokenRef = useRef(0);
  const streamingTextRef = useRef('');

  const reset = useCallback(() => {
    tokenRef.current += 1;
    if (abortRef.current) {
      try { abortRef.current(); } catch { /* noop */ }
      abortRef.current = null;
    }
    if (parseAbortRef.current) {
      try { parseAbortRef.current.abort(); } catch { /* noop */ }
      parseAbortRef.current = null;
    }
    streamingTextRef.current = '';
    setImageCaptured(false);
    setActiveWidget('image');
    setSplitView(false);
    setStageState(INITIAL_STAGE_STATE);
    setManualNav(false);
    setCapturedImageSrc(null);
    setCapturedFileMeta(null);
    setCaseIntake(null);
    setTriageCard(null);
    setInvMatches([]);
    setAnalyst(buildEmptyAnalystState());
    setConversationId(null);
    setRequestError(null);
    setChatLog([]);
    setStageEvents({});
  }, []);

  const handleCaseIntake = useCallback((data) => {
    if (!data || typeof data !== 'object') return;
    setCaseIntake(data);

    const runs = Array.isArray(data.runs) ? data.runs : [];
    const parserRun = runs.find((r) => r?.phase === 'parse-template');
    const knownIssueRun = runs.find((r) => r?.phase === 'known-issue-search');
    const triageRun = runs.find((r) => r?.phase === 'triage');
    const analystRun = runs.find((r) => r?.phase === 'analyst');

    setStageState((prev) => {
      const next = { ...prev };
      const now = Date.now();

      // Parser is flipped to 'done' locally when the image-parser HTTP call resolves.
      // The case_intake event still carries authoritative timing — adopt it if parser
      // hasn't already finished, and ensure we don't leave it stuck in 'running'.
      if (parserRun) {
        const isFailed = parserRun.status === 'failed';
        const finishedAt = prev.parser.finishedAt || now;
        const startedAt = prev.parser.startedAt
          || (parserRun.durationMs ? finishedAt - parserRun.durationMs : finishedAt);
        const alreadyFinal = prev.parser.status === 'done' || prev.parser.status === 'failed';
        next.parser = {
          ...prev.parser,
          status: isFailed ? 'failed' : (alreadyFinal ? prev.parser.status : 'done'),
          startedAt,
          finishedAt,
          durationMs: prev.parser.durationMs ?? (parserRun.durationMs ?? durationFromStart(startedAt, finishedAt)),
          error: isFailed ? (parserRun.summary || 'Parser failed') : null,
          fallbackUsed: Boolean(parserRun.fallback?.used ?? parserRun.fallbackUsed),
        };
      }

      if (knownIssueRun) {
        const status = knownIssueRun.status === 'failed' ? 'failed' : 'done';
        const finishedAt = now;
        const startedAt = prev.inv.startedAt
          || (knownIssueRun.durationMs ? finishedAt - knownIssueRun.durationMs : finishedAt);
        next.inv = {
          ...prev.inv,
          status,
          startedAt,
          finishedAt,
          durationMs: knownIssueRun.durationMs ?? durationFromStart(startedAt, finishedAt),
          error: knownIssueRun.status === 'failed' ? (knownIssueRun.summary || 'INV search failed') : null,
          fallbackUsed: Boolean(knownIssueRun.fallback?.used ?? knownIssueRun.fallbackUsed),
        };
      } else if (prev.inv.status === 'pending' || prev.inv.status === 'running') {
        next.inv = { ...prev.inv, status: 'done', startedAt: prev.inv.startedAt || now, finishedAt: now, durationMs: prev.inv.startedAt ? now - prev.inv.startedAt : 0 };
      }

      if (triageRun) {
        const isFailed = triageRun.status === 'failed';
        const finishedAt = now;
        const startedAt = prev.triage.startedAt
          || (triageRun.durationMs ? finishedAt - triageRun.durationMs : finishedAt);
        const fallbackUsed = Boolean(triageRun.fallback?.used ?? triageRun.fallbackUsed);
        next.triage = {
          ...prev.triage,
          status: isFailed ? 'failed' : 'done',
          startedAt,
          finishedAt,
          durationMs: triageRun.durationMs ?? durationFromStart(startedAt, finishedAt),
          error: isFailed ? (triageRun.summary || 'Triage failed') : null,
          fallbackUsed,
          fallbackReason: fallbackUsed ? (triageRun.fallback?.reason || triageRun.summary || '') : '',
        };
      }

      if (analystRun) {
        if (analystRun.status === 'running') {
          next.main = {
            ...prev.main,
            status: 'running',
            startedAt: prev.main.startedAt || now,
            error: null,
          };
        } else if (analystRun.status === 'completed') {
          const finishedAt = now;
          const startedAt = prev.main.startedAt || (analystRun.durationMs ? finishedAt - analystRun.durationMs : finishedAt);
          next.main = {
            ...prev.main,
            status: 'done',
            startedAt,
            finishedAt,
            durationMs: analystRun.durationMs ?? durationFromStart(startedAt, finishedAt),
          };
        } else if (analystRun.status === 'failed') {
          const finishedAt = now;
          next.main = {
            ...prev.main,
            status: 'failed',
            finishedAt,
            durationMs: prev.main.startedAt ? finishedAt - prev.main.startedAt : 0,
            error: analystRun.summary || 'Analyst failed',
          };
        }
      }

      return next;
    });
  }, []);

  const handleTriageCard = useCallback((data) => {
    if (!data || typeof data !== 'object') return;
    setTriageCard(data);
  }, []);

  const handleStageEvent = useCallback((data) => {
    if (!data || typeof data !== 'object') return;
    const stageId = typeof data.stageId === 'string' ? data.stageId : '';
    if (!stageId) return;
    setStageEvents((prev) => {
      const list = Array.isArray(prev[stageId]) ? prev[stageId] : [];
      // Cap live buffer at ~250 to mirror server-side persistence cap.
      const next = list.length >= 250 ? list.slice(-249) : list;
      return { ...prev, [stageId]: [...next, data] };
    });
  }, []);

  // Local sequence counter so client-side emits interleave cleanly with the
  // server-side stream when sorted by (ts, seq). The popout's sort already
  // tolerates duplicate seq values, but a shared monotonic counter keeps the
  // visual order stable.
  const localSeqRef = useRef(10000);
  const pushLocalStageEvent = useCallback((stageId, kind, data = null) => {
    if (!stageId || !kind) return;
    const ts = Date.now();
    localSeqRef.current += 1;
    handleStageEvent({
      stageId,
      runId: '',
      ts,
      seq: localSeqRef.current,
      kind,
      category: UI_LOCAL_EVENT_KINDS.has(kind) ? 'ui' : 'run',
      source: 'client',
      data: data || null,
    });
  }, [handleStageEvent]);

  const handleInvMatches = useCallback((data) => {
    setInvMatches(normalizeInvMatches(data));
  }, []);

  const handleInit = useCallback((data) => {
    if (data?.conversationId) setConversationId(data.conversationId);
    if (data?.caseIntake) handleCaseIntake(data.caseIntake);
  }, [handleCaseIntake]);

  const handleChunk = useCallback((data) => {
    const piece = data?.text || '';
    if (!piece) return;
    streamingTextRef.current += piece;
    setAnalyst((prev) => ({ ...prev, isStreaming: true, text: streamingTextRef.current }));
    setStageState((prev) => {
      if (prev.main.status === 'running' || prev.main.status === 'done' || prev.main.status === 'failed') return prev;
      return { ...prev, main: { ...prev.main, status: 'running', startedAt: prev.main.startedAt || Date.now() } };
    });
  }, []);

  const handleDone = useCallback((data) => {
    const finalText = streamingTextRef.current || data?.fullResponse || '';
    if (data?.caseIntake) handleCaseIntake(data.caseIntake);
    setAnalyst((prev) => ({
      ...prev,
      isStreaming: false,
      text: finalText,
      conversationId: data?.conversationId || prev.conversationId,
    }));
    setChatLog((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.role === 'analyst-stream') {
        next[next.length - 1] = { ...last, text: finalText, isStreaming: false };
      } else {
        next.push({ role: 'analyst-stream', text: finalText, isStreaming: false });
      }
      return next;
    });
    setStageState((prev) => {
      if (prev.main.status === 'done') return prev;
      const finishedAt = Date.now();
      const startedAt = prev.main.startedAt || finishedAt;
      return {
        ...prev,
        main: { ...prev.main, status: 'done', startedAt, finishedAt, durationMs: finishedAt - startedAt },
      };
    });
    streamingTextRef.current = '';
  }, [handleCaseIntake]);

  const markFailureInProgress = useCallback((normalized) => {
    setStageState((prev) => {
      const next = { ...prev };
      const now = Date.now();
      ['parser', 'triage', 'inv', 'main'].forEach((k) => {
        if (next[k].status === 'running' || next[k].status === 'pending') {
          next[k] = {
            ...next[k],
            status: 'failed',
            finishedAt: now,
            durationMs: next[k].startedAt ? now - next[k].startedAt : 0,
            error: normalized?.message || 'Request failed',
          };
        }
      });
      return next;
    });
  }, []);

  const handleError = useCallback((err) => {
    const normalized = normalizeError(err);
    setRequestError(normalized);
    setAnalyst((prev) => ({ ...prev, isStreaming: false, error: normalized }));
    markFailureInProgress(normalized);
    streamingTextRef.current = '';
  }, [markFailureInProgress]);

  const runChatStream = useCallback((payload, token) => {
    const { abort } = sendChatMessage(payload, {
      onInit: (data) => { if (tokenRef.current === token) handleInit(data); },
      onStatus: () => {},
      onTriageCard: (data) => { if (tokenRef.current === token) handleTriageCard(data); },
      onCaseIntake: (data) => { if (tokenRef.current === token) handleCaseIntake(data); },
      onInvMatches: (data) => { if (tokenRef.current === token) handleInvMatches(data); },
      onStageEvent: (data) => { if (tokenRef.current === token) handleStageEvent(data); },
      onChunk: (data) => { if (tokenRef.current === token) handleChunk(data); },
      onThinking: () => {},
      onDone: (data) => { if (tokenRef.current === token) handleDone(data); },
      onError: (err) => { if (tokenRef.current === token) handleError(err); },
      onProviderError: () => {},
      onFallback: () => {},
      onLocalStage: () => {},
    });
    abortRef.current = abort;
  }, [handleCaseIntake, handleChunk, handleDone, handleError, handleInit, handleInvMatches, handleStageEvent, handleTriageCard]);

  const startRequestWithImage = useCallback(async (imageDataUrl) => {
    const token = ++tokenRef.current;
    if (abortRef.current) {
      try { abortRef.current(); } catch { /* noop */ }
      abortRef.current = null;
    }
    if (parseAbortRef.current) {
      try { parseAbortRef.current.abort(); } catch { /* noop */ }
      parseAbortRef.current = null;
    }
    const parseAbort = new AbortController();
    parseAbortRef.current = parseAbort;
    streamingTextRef.current = '';
    setRequestError(null);
    setAnalyst(buildEmptyAnalystState());
    // Mark parser as running while the image-parser HTTP call runs.
    setStageState((prev) => ({
      ...prev,
      parser: { ...prev.parser, status: 'running', startedAt: Date.now(), finishedAt: null, durationMs: null, error: null },
      triage: { ...prev.triage, status: 'pending', startedAt: null, finishedAt: null, durationMs: null, error: null },
      inv: { ...prev.inv, status: 'pending', startedAt: null, finishedAt: null, durationMs: null, error: null },
      main: { ...prev.main, status: 'pending', startedAt: null, finishedAt: null, durationMs: null, error: null },
    }));

    pushLocalStageEvent('parser', 'parser.parse_requested', {
      via: 'chat-v5',
      hasImage: Boolean(imageDataUrl),
    });

    const runtimeByStage = await readPipelineRuntimeForExecution();
    pushLocalStageEvent('parser', 'parser.runtime_loaded', {
      provider: runtimeByStage.parser?.provider || '',
      model: runtimeByStage.parser?.model || '',
      reasoningEffort: runtimeByStage.parser?.reasoningEffort || '',
    });
    pushLocalStageEvent('parser', 'parser.client_request_started', {
      provider: runtimeByStage.parser?.provider || '',
      model: runtimeByStage.parser?.model || '',
      imageBytes: typeof imageDataUrl === 'string' ? imageDataUrl.length : 0,
    });
    let parseResult;
    try {
      parseResult = await parseImageWithApi(
        imageDataUrl,
        parseAbort.signal,
        runtimeByStage.parser,
        (serverEvent) => {
          if (tokenRef.current !== token) return;
          handleStageEvent(serverEvent);
        }
      );
    } catch (err) {
      if (tokenRef.current !== token) return;
      // If we aborted because of a cancel, reset() already cleared state — bail.
      if (parseAbort.signal.aborted) return;
      const normalized = normalizeError(err);
      setRequestError(normalized);
      setStageState((prev) => {
        const now = Date.now();
        return {
          ...prev,
          parser: {
            ...prev.parser,
            status: 'failed',
            finishedAt: now,
            durationMs: prev.parser.startedAt ? now - prev.parser.startedAt : 0,
            error: normalized?.message || 'Image parser failed',
          },
        };
      });
      return;
    }

    if (tokenRef.current !== token) return;
    pushLocalStageEvent('parser', 'parser.client_result_received', {
      provider: parseResult?.providerUsed || '',
      model: parseResult?.modelUsed || '',
      textLength: (parseResult?.text || '').length,
      elapsedMs: parseResult?.elapsedMs ?? 0,
    });
    if (!parseResult.sourceText && !parseResult.text) {
      const normalized = normalizeError({ message: 'Image parser returned no text.' });
      setRequestError(normalized);
      setStageState((prev) => {
        const now = Date.now();
        return {
          ...prev,
          parser: {
            ...prev.parser,
            status: 'failed',
            finishedAt: now,
            durationMs: prev.parser.startedAt ? now - prev.parser.startedAt : 0,
            error: normalized.message,
          },
        };
      });
      return;
    }

    // Parser is done the moment the image-parser HTTP call resolves with text.
    // Don't wait for the server's case_intake SSE event — server-side triage
    // shouldn't keep the parser spinner alive (was Cause C of the stuck UI).
    setStageState((prev) => {
      const now = Date.now();
      const parserStarted = prev.parser.startedAt || now;
      return {
        ...prev,
        parser: {
          ...prev.parser,
          status: 'done',
          startedAt: parserStarted,
          finishedAt: now,
          durationMs: parseResult.elapsedMs ?? (now - parserStarted),
          error: null,
        },
        triage: {
          ...prev.triage,
          status: 'running',
          startedAt: prev.triage.startedAt || now,
          finishedAt: null,
          durationMs: null,
          error: null,
        },
        inv: prev.inv.status === 'pending'
          ? { ...prev.inv, status: 'running', startedAt: prev.inv.startedAt || now }
          : prev.inv,
      };
    });
    pushLocalStageEvent('parser', 'parser.completed_result_posted', {
      provider: parseResult.providerUsed || '',
      model: parseResult.modelUsed || '',
      elapsedMs: parseResult.elapsedMs ?? 0,
      textLength: (parseResult.sourceText || parseResult.text || '').length,
    });

    // Submit to /api/chat with parsedEscalationText.
    const payload = buildPipelineChatPayload({
      message: 'Escalation captured via screenshot. See parsed template below for full context.',
      conversationId: conversationId || undefined,
      images: [],
      imageMeta: [],
      mode: 'single',
      parsedEscalationText: parseResult.sourceText || parseResult.text,
      parsedEscalationSource: 'image-parser',
      parsedEscalationProvider: parseResult.providerUsed,
      parsedEscalationModel: parseResult.modelUsed,
      parsedEscalationElapsedMs: parseResult.elapsedMs,
    }, runtimeByStage);
    runChatStream(payload, token);
  }, [conversationId, handleStageEvent, pushLocalStageEvent, runChatStream]);

  const captureImage = useCallback((imageDataUrl, fileMeta) => {
    if (imageCaptured) return;
    if (!imageDataUrl) return;
    pushLocalStageEvent('parser', 'parser.image_received', {
      name: fileMeta?.name || '',
      type: fileMeta?.type || '',
      sizeBytes: fileMeta?.size ?? null,
      via: 'chat-v5-upload',
    });
    setImageCaptured(true);
    setCapturedImageSrc(imageDataUrl);
    setCapturedFileMeta(fileMeta || null);
    pushLocalStageEvent('parser', 'parser.image_preview_ready', {
      dataUrlLength: typeof imageDataUrl === 'string' ? imageDataUrl.length : 0,
      isDataUrl: typeof imageDataUrl === 'string' && imageDataUrl.startsWith('data:'),
    });
    setTimeout(() => setActiveWidget('parser'), 320);
    startRequestWithImage(imageDataUrl);
  }, [imageCaptured, pushLocalStageEvent, startRequestWithImage]);

  const sendOperatorMessage = useCallback(async (text) => {
    const clean = (text || '').trim();
    if (!clean) return;
    setChatLog((prev) => [...prev, { role: 'operator', text: clean }, { role: 'analyst-stream', text: '', isStreaming: true }]);
    streamingTextRef.current = '';
    setAnalyst((prev) => ({ ...prev, isStreaming: true, text: '', error: null }));

    const token = ++tokenRef.current;
    if (abortRef.current) {
      try { abortRef.current(); } catch { /* noop */ }
      abortRef.current = null;
    }

    const runtimeByStage = await readPipelineRuntimeForExecution();
    if (tokenRef.current !== token) return;

    const { abort } = sendChatMessage(buildPipelineChatPayload({
      message: clean,
      conversationId: conversationId || undefined,
      images: [],
      mode: 'single',
    }, runtimeByStage), {
      onInit: (data) => { if (tokenRef.current === token && data?.conversationId) setConversationId(data.conversationId); },
      onStatus: () => {},
      onTriageCard: () => {},
      onCaseIntake: (data) => { if (tokenRef.current === token) handleCaseIntake(data); },
      onInvMatches: (data) => { if (tokenRef.current === token) handleInvMatches(data); },
      onStageEvent: (data) => { if (tokenRef.current === token) handleStageEvent(data); },
      onChunk: (data) => {
        if (tokenRef.current !== token) return;
        const piece = data?.text || '';
        if (!piece) return;
        streamingTextRef.current += piece;
        setAnalyst((prev) => ({ ...prev, isStreaming: true, text: streamingTextRef.current }));
        setChatLog((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'analyst-stream') {
            next[next.length - 1] = { ...last, text: streamingTextRef.current, isStreaming: true };
          }
          return next;
        });
      },
      onThinking: () => {},
      onDone: (data) => {
        if (tokenRef.current !== token) return;
        const finalText = streamingTextRef.current || data?.fullResponse || '';
        setAnalyst((prev) => ({ ...prev, isStreaming: false, text: finalText }));
        setChatLog((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'analyst-stream') {
            next[next.length - 1] = { ...last, text: finalText, isStreaming: false };
          }
          return next;
        });
        streamingTextRef.current = '';
      },
      onError: (err) => {
        if (tokenRef.current !== token) return;
        const normalized = normalizeError(err);
        setAnalyst((prev) => ({ ...prev, isStreaming: false, error: normalized }));
        setChatLog((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'analyst-stream') {
            next[next.length - 1] = {
              ...last,
              text: last.text || `Error: ${normalized?.message || 'Request failed'}`,
              isStreaming: false,
              error: true,
            };
          }
          return next;
        });
        streamingTextRef.current = '';
      },
      onProviderError: () => {},
      onFallback: () => {},
      onLocalStage: () => {},
    });
    abortRef.current = abort;
  }, [conversationId, handleCaseIntake, handleInvMatches, handleStageEvent]);

  useEffect(() => {
    if (manualNav) return undefined;
    if (activeWidget === 'parser' && stageState.parser.status === 'done' && stageState.triage.status === 'running') {
      const elapsedSinceTriageStart = stageState.triage.startedAt ? Date.now() - stageState.triage.startedAt : 0;
      const triageMinVisible = 1400;
      const delay = Math.max(0, triageMinVisible - elapsedSinceTriageStart);
      const id = setTimeout(() => {
        setActiveWidget((prev) => (prev === 'parser' ? 'triage' : prev));
      }, delay);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [manualNav, activeWidget, stageState.parser.status, stageState.triage.status, stageState.triage.startedAt]);

  useEffect(() => {
    if (manualNav) return undefined;
    // If parser and triage both finished before user could see triage card,
    // briefly show triage card then hop to analyst.
    if (activeWidget === 'parser' && stageState.parser.status === 'done' && stageState.triage.status === 'done') {
      const id = setTimeout(() => {
        setActiveWidget((prev) => (prev === 'parser' ? 'triage' : prev));
      }, 700);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [manualNav, activeWidget, stageState.parser.status, stageState.triage.status]);

  useEffect(() => {
    if (manualNav) return undefined;
    if (activeWidget === 'triage' && stageState.triage.status === 'done' && stageState.main.status === 'running') {
      const id = setTimeout(() => {
        setActiveWidget((prev) => (prev === 'triage' ? 'main' : prev));
        setSplitView(false);
      }, 350);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [manualNav, activeWidget, stageState.triage.status, stageState.main.status]);

  useEffect(() => {
    if (manualNav) return undefined;
    // Triage failed unexpectedly — don't leave the operator stuck on the parser
    // card. Show the triage card briefly so the failure is visible, then hop to
    // analyst output. The analyst can still produce a useful answer.
    if (stageState.triage.status === 'failed' && (activeWidget === 'parser' || activeWidget === 'image')) {
      const id = setTimeout(() => {
        setActiveWidget((prev) => (prev === 'parser' || prev === 'image' ? 'triage' : prev));
      }, 400);
      return () => clearTimeout(id);
    }
    if (stageState.triage.status === 'failed' && activeWidget === 'triage' && (stageState.main.status === 'running' || stageState.main.status === 'done' || stageState.main.status === 'failed')) {
      const id = setTimeout(() => {
        setActiveWidget((prev) => (prev === 'triage' ? 'main' : prev));
        setSplitView(false);
      }, 900);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [manualNav, activeWidget, stageState.triage.status, stageState.main.status]);

  useEffect(() => () => {
    if (abortRef.current) {
      try { abortRef.current(); } catch { /* noop */ }
      abortRef.current = null;
    }
  }, []);

  const showWidget = useCallback((name) => {
    setActiveWidget(name);
    setSplitView(false);
    setManualNav(true);
  }, []);

  const toggleSplit = useCallback(() => {
    setSplitView((prev) => !prev);
    setManualNav(true);
  }, []);

  const parsedFields = deriveParsedFieldsFromCaseIntake(caseIntake);

  // Per-stage event counts shared between the agent card (compact "12 / 30"
  // counter) and the event-log panel header. Live counts always win; once
  // the live buffer drains we fall back to the persisted eventCount on the
  // matching caseIntake.runs[i] so completed cards stay accurate on reload.
  const liveEventCounts = useMemo(() => {
    const phaseByKey = { parser: 'parse-template', inv: 'known-issue-search', triage: 'triage', main: 'analyst' };
    const runs = Array.isArray(caseIntake?.runs) ? caseIntake.runs : [];
    const isRunCategory = (ev) => {
      if (!ev) return false;
      if (ev.category === 'ui') return false;
      // Defensive: events arriving from older code paths may lack a category.
      // Fall back to the local UI allowlist so popup events still don't count.
      if (!ev.category && UI_LOCAL_EVENT_KINDS.has(ev.kind)) return false;
      return true;
    };
    const out = {};
    for (const stageKey of ['parser', 'inv', 'triage', 'main']) {
      const liveList = Array.isArray(stageEvents?.[stageKey]) ? stageEvents[stageKey] : [];
      if (liveList.length > 0) {
        out[stageKey] = liveList.filter(isRunCategory).length;
        continue;
      }
      const phase = phaseByKey[stageKey];
      const run = runs.find((r) => r && r.phase === phase);
      const persisted = Number(run?.eventCount);
      if (Number.isFinite(persisted) && persisted > 0) {
        out[stageKey] = persisted;
        continue;
      }
      const savedEvents = Array.isArray(run?.events) ? run.events : [];
      out[stageKey] = savedEvents.filter(isRunCategory).length;
    }
    return out;
  }, [stageEvents, caseIntake]);

  const allDone =
    stageState.parser.status === 'done'
    && (stageState.triage.status === 'done' || stageState.triage.status === 'failed')
    && (stageState.inv.status === 'done' || stageState.inv.status === 'failed')
    && (stageState.main.status === 'done' || stageState.main.status === 'failed');

  return {
    imageCaptured,
    captureImage,
    reset,
    activeWidget,
    showWidget,
    splitView,
    toggleSplit,
    stageState,
    stageEvents,
    liveEventCounts,
    pushLocalStageEvent,
    allDone,
    capturedImageSrc,
    capturedFileMeta,
    caseIntake,
    triageCard,
    invMatches,
    parsedFields,
    analyst,
    chatLog,
    sendOperatorMessage,
    requestError,
    conversationId,
  };
}
