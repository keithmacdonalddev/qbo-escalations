import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sendChatMessage } from '../../api/chatApi.js';
import { apiFetch } from '../../api/http.js';
import { consumeSSEStream } from '../../api/sse.js';
import { showImageParserStageToast } from '../../lib/imageParserStageToasts.js';
import {
  summarizeImageParserValidationFailure,
  summarizeProviderPackageCaptureFailure,
} from '../../lib/imageParserValidation.js';
import { useToast } from '../../hooks/useToast.jsx';
import useTriage from '../../hooks/useTriage.js';
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
  triage: { status: 'pending', startedAt: null, finishedAt: null, durationMs: null, error: null, fallbackUsed: false, fallbackReason: '', providerPackageId: '' },
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

// Saved-run lookup table: caseIntake.runs[].phase → pipeline stage key.
const SAVED_RUN_PHASE_BY_STAGE_KEY = {
  parser: 'parse-template',
  inv: 'known-issue-search',
  triage: 'triage',
  main: 'analyst',
};

// Rebuild the INV-match display list from a saved caseIntake's
// known-issue-search run, mirroring the server's live mapping
// (known-issue-search-agent.js knownIssueSearchToInvMatchResult): matches
// surface only when the run completed with detail.status 'match', filtered
// to high/medium confidence, capped at 3, confidence converted to the legacy
// labels (high→'high', medium→'likely' — what drives normalizeInvMatches'
// note text), and the score the live ssePayload derives unconditionally
// (high→45, medium→32). The persisted detail.matches are the agent's raw
// matches (flat invNumber/subject/confidence — case-intake.js:323 stores
// them without a joined investigation doc; the nested `investigation` read
// below is purely defensive).
function invMatchesFromSavedRuns(runs) {
  const list = Array.isArray(runs) ? runs : [];
  const run = list.find((r) => r && r.phase === SAVED_RUN_PHASE_BY_STAGE_KEY.inv);
  if (!run || run.status !== 'completed' || run.detail?.status !== 'match') return [];
  const raw = Array.isArray(run.detail?.matches) ? run.detail.matches : [];
  return raw
    .filter((m) => m && (m.confidence === 'high' || m.confidence === 'medium'))
    .slice(0, 3)
    .map((m) => {
      const inv = m.investigation && typeof m.investigation === 'object' ? m.investigation : {};
      return {
        invNumber: m.invNumber || inv.invNumber || '',
        subject: m.subject || inv.subject || '',
        summary: m.summary || inv.summary || '',
        status: m.status || inv.status || '',
        lastUpdated: m.lastUpdated || inv.lastUpdated || null,
        confidence: m.confidence === 'medium' ? 'likely' : m.confidence,
        score: m.confidence === 'high' ? 45 : 32,
      };
    })
    .filter((m) => m.invNumber || m.subject);
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
  let sawFailureStageEvent = false;
  if (isSse) {
    // The /parse SSE route delivers every terminal outcome — success AND
    // failure — as a single `parse_complete` frame ({ ok:false, code, error }
    // on failure). It never emits a top-level `error` frame (bus.emit('error')
    // is sent as a `stage_event` with kind:'error'). So `parse_complete` is the
    // sole terminal; the only fallback is a stream that closed early.
    let completed = null;
    await consumeSSEStream(res, (eventType, payload) => {
      if (eventType === 'stage_event') {
        if (
          payload?.kind === 'error'
          || /fail|error|timeout/i.test(String(payload?.data?.status || ''))
        ) {
          sawFailureStageEvent = true;
        }
        try { onStageEvent(payload); } catch { /* noop */ }
      } else if (eventType === 'parse_complete') {
        completed = payload;
      }
    });
    data = completed || { ok: false, error: 'Parse stream ended without a result.', code: 'STREAM_INCOMPLETE' };
  } else {
    data = await res.json().catch(() => ({ ok: false, error: res.statusText }));
  }

  if (!data?.ok || (!isSse && !res.ok)) {
    const captureFailure = summarizeProviderPackageCaptureFailure(data || {});
    const msg = captureFailure?.message || data?.error || `Parse failed (HTTP ${res.status})`;
    throw Object.assign(new Error(msg), {
      code: data?.code || 'PARSE_FAILED',
      detail: data?.detail || '',
      status: res.status,
      statusText: res.statusText || '',
      providerTrace: data?.providerTrace || null,
      captureMode: data?.captureMode || data?.providerTrace?.captureMode || null,
      providerPackageId: data?.providerTrace?.providerPackageId || null,
      stageEventAlreadyEmitted: sawFailureStageEvent,
    });
  }
  const validation = summarizeImageParserValidationFailure(data?.parseMeta);
  if (validation) {
    throw Object.assign(new Error(`${validation.message} The staged parser result was not used.`), {
      code: validation.code,
      detail: validation.issue,
      status: res.status,
      statusText: res.statusText || '',
      providerTrace: data?.providerTrace || null,
      stageEventAlreadyEmitted: false,
    });
  }
  return {
    text: data.text || data.sourceText || '',
    sourceText: data.sourceText || data.text || '',
    parseFields: data.parseFields || {},
    parseMeta: data.parseMeta || null,
    providerUsed: data.providerUsed || cfg.provider,
    modelUsed: data.modelUsed || data.usage?.model || cfg.model || '',
    reasoningEffortUsed: cfg.reasoningEffort || '',
    providerTrace: data.providerTrace || null,
    role: data.role || '',
    elapsedMs: Date.now() - start,
  };
}

export function useStageOrchestrator({ resumeConversationId = null } = {}) {
  const toast = useToast();
  const { runTriageStream } = useTriage();
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
  // Saved-conversation id adopted from the route for true resume; see the
  // effect below. Fallback target only — a server-assigned conversationId
  // always takes precedence in outgoing payloads.
  const [resumeTargetId, setResumeTargetId] = useState(null);
  const [requestError, setRequestError] = useState(null);
  const [chatLog, setChatLog] = useState([]);
  // Live stage events streamed from the server. Bucketed by stageId so the
  // pipeline-card popout can show terminal-style logs for whichever card the
  // user clicks. Cleared on reset().
  const [stageEvents, setStageEvents] = useState({});

  const abortRef = useRef(null);
  const parseAbortRef = useRef(null);
  const triageAbortRef = useRef(null);
  // Synchronous mirror of imageCaptured for restoreCapturedImage(). A ref
  // (flipped inline in captureImage/reset, not via effect) keeps that
  // callback's identity stable across renders AND closes the same-tick race
  // where a resume-restore resolving right after a live capture could read a
  // stale false and clobber the live image.
  const imageCapturedRef = useRef(false);
  // Where the current caseIntake came from: null (none), 'saved' (hydrated
  // from a resumed session's record), or 'live' (SSE case_intake). Lets
  // hydrateFromSavedCaseIntake replace stale saved state when switching
  // between saved sessions while NEVER overwriting a live run's state.
  const caseIntakeSourceRef = useRef(null);
  // Deferred triage persistence. The standalone /api/triage harness runs in
  // parallel with the /api/chat analyst leg, so its result can't ride the
  // chat payload and a mid-request write would be clobbered by the chat
  // route's final conversation.save(). Instead the settled triage result is
  // stashed here and POSTed to /api/conversations/:id/triage-result only
  // after BOTH legs settle — the chat route saves the conversation before
  // emitting done/error, so the late write is race-free. Refs (not state)
  // keep every handler involved identity-stable.
  const pendingTriagePersistRef = useRef(null);
  const chatLegSettledRef = useRef(false);
  const conversationIdRef = useRef(null);
  const tokenRef = useRef(0);
  const streamingTextRef = useRef('');
  const toastedStageKeysRef = useRef(new Set());
  // Deferred widget-switch timer scheduled in captureImage(). Tracked so it can
  // be cleared on reset() and unmount — otherwise it can fire setActiveWidget
  // after the pipeline was reset or the component unmounted.
  const widgetSwitchTimerRef = useRef(null);

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
    if (triageAbortRef.current) {
      try { triageAbortRef.current(); } catch { /* noop */ }
      triageAbortRef.current = null;
    }
    if (widgetSwitchTimerRef.current) {
      clearTimeout(widgetSwitchTimerRef.current);
      widgetSwitchTimerRef.current = null;
    }
    streamingTextRef.current = '';
    toastedStageKeysRef.current.clear();
    imageCapturedRef.current = false;
    caseIntakeSourceRef.current = null;
    pendingTriagePersistRef.current = null;
    chatLegSettledRef.current = false;
    conversationIdRef.current = null;
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
    setResumeTargetId(null);
    setRequestError(null);
    setChatLog([]);
    setStageEvents({});
  }, []);

  // True resume: when the chat is opened at #/chat/{id} (a saved session),
  // remember that id so new messages append to the saved Conversation record
  // instead of creating a new one. Kept separate from `conversationId` (which
  // is only ever set from server responses) so a live session's own id always
  // wins — outgoing payloads use `conversationId || resumeTargetId`. The prop
  // going null (navigating away from the chat view) keeps the current target,
  // matching the always-mounted session-persistence semantics; reset() (the
  // "New" button) clears it so a fresh workflow starts a fresh conversation.
  useEffect(() => {
    const clean = typeof resumeConversationId === 'string' ? resumeConversationId.trim() : '';
    if (clean) setResumeTargetId(clean);
  }, [resumeConversationId]);

  // Poisoned-resume escape hatch: when the container's history fetch confirms
  // the routed conversation no longer exists (404), it calls this so outgoing
  // sends stop targeting the dead id and fall back to creating a fresh
  // conversation. Guarded by id so a stale fetch resolving after the route
  // moved on can never clear a newer, valid target.
  const clearResumeTarget = useCallback((id) => {
    const clean = typeof id === 'string' ? id.trim() : '';
    setResumeTargetId((prev) => (!clean || prev === clean ? null : prev));
  }, []);

  // True resume: re-display a saved session's pipeline screenshot (dock
  // thumbnail / parser popup seed). Display-only — imageCaptured stays false
  // so a fresh upload into the resumed session still runs captureImage() and
  // the full pipeline. Replaces (or clears, on '') whatever a previously
  // resumed session restored, so switching between saved sessions never
  // shows a stale thumbnail; a live capture (imageCaptured) is never touched.
  const restoreCapturedImage = useCallback((src) => {
    if (imageCapturedRef.current) return;
    const clean = typeof src === 'string' ? src.trim() : '';
    setCapturedImageSrc(clean || null);
  }, []);

  // True resume: hydrate the pipeline surfaces (stage-card outcomes, parsed
  // template fields, triage card, INV matches) from a saved caseIntake when a
  // session is reopened cold. Adopting the saved record as the orchestrator's
  // own caseIntake unifies every consumer on one source — the container's
  // pastCaseIntake fallback clears itself once a caseIntake exists, so the
  // workflow/stage log panels keep reading the exact same record.
  //
  // Live always wins, twice over: (1) we bail when a capture is in flight, a
  // chat stream is open, or the current caseIntake came from a live SSE
  // event; (2) a real run starting later simply overwrites all of this via
  // handleCaseIntake/handleTriageCard/handleInvMatches, same as before.
  // Passing null (route points at a dead/unreadable record) clears previously
  // hydrated state. Stages with no saved run — or a non-terminal saved status
  // (e.g. a run interrupted mid-flight) — honestly stay 'pending'/Waiting;
  // nothing is faked as completed, nothing is marked running, and no live
  // events are emitted.
  const hydrateFromSavedCaseIntake = useCallback((savedCaseIntake) => {
    if (imageCapturedRef.current || abortRef.current || caseIntakeSourceRef.current === 'live') return;
    const record = savedCaseIntake && typeof savedCaseIntake === 'object' ? savedCaseIntake : null;
    const runs = Array.isArray(record?.runs) ? record.runs : [];
    caseIntakeSourceRef.current = record ? 'saved' : null;
    setCaseIntake(record);
    setTriageCard(record?.triageCard && typeof record.triageCard === 'object' ? record.triageCard : null);
    setInvMatches(normalizeInvMatches(invMatchesFromSavedRuns(runs)));
    setStageState(() => {
      const next = { ...INITIAL_STAGE_STATE };
      for (const [stageKey, phase] of Object.entries(SAVED_RUN_PHASE_BY_STAGE_KEY)) {
        const run = runs.find((r) => r && r.phase === phase);
        if (!run) continue;
        const status = run.status === 'completed' ? 'done' : (run.status === 'failed' ? 'failed' : null);
        if (!status) continue;
        const durationMs = Number.isFinite(Number(run.durationMs)) ? Number(run.durationMs) : null;
        const fallbackUsed = Boolean(run.fallback?.used ?? run.fallbackUsed);
        next[stageKey] = {
          ...INITIAL_STAGE_STATE[stageKey],
          status,
          durationMs,
          error: status === 'failed' ? (run.summary || 'Stage failed') : null,
          fallbackUsed,
          ...(stageKey === 'triage' ? {
            fallbackReason: fallbackUsed ? (run.fallback?.reason || run.summary || '') : '',
            // Saved triage runs persist the provider-call package id under
            // detail (see applyTriageResultToCaseIntake in server
            // lib/case-intake.js) — restore it so the dock's "View model
            // reasoning" launcher works on resumed sessions too.
            providerPackageId: typeof run.detail?.providerPackageId === 'string' ? run.detail.providerPackageId : '',
          } : {}),
        };
      }
      return next;
    });
  }, []);

  const handleCaseIntake = useCallback((data) => {
    if (!data || typeof data !== 'object') return;
    caseIntakeSourceRef.current = 'live';
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
    const toastKey = [
      data.runId || '',
      data.stageId || '',
      data.kind || '',
      data.seq ?? '',
      data?.data?.providerPackageId || '',
      data?.data?.displayMessage || '',
    ].join(':');
    if (!toastedStageKeysRef.current.has(toastKey)) {
      if (showImageParserStageToast(toast, data)) {
        toastedStageKeysRef.current.add(toastKey);
      }
    }
    setStageEvents((prev) => {
      const list = Array.isArray(prev[stageId]) ? prev[stageId] : [];
      // Cap live buffer at ~250 to mirror server-side persistence cap.
      const next = list.length >= 250 ? list.slice(-249) : list;
      return { ...prev, [stageId]: [...next, data] };
    });
  }, [toast]);

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
    if (data?.conversationId) {
      conversationIdRef.current = data.conversationId;
      setConversationId(data.conversationId);
    }
    if (data?.caseIntake) handleCaseIntake(data.caseIntake);
  }, [handleCaseIntake]);

  // POST the settled triage result onto the saved conversation. Fire-and-
  // forget: a failure here only means the resumed session shows the honest
  // "Waiting" triage state, exactly as before this persistence existed.
  // Runs at most once per pipeline run, only when a conversation id exists
  // (so the operator test harness, which has no conversation, can never
  // write), and only after both the triage stream and the chat leg settle.
  const persistTriageResult = useCallback(() => {
    const pending = pendingTriagePersistRef.current;
    if (!pending || pending.posted) return;
    if (!chatLegSettledRef.current) return;
    const conversationIdForPersist = conversationIdRef.current;
    if (!conversationIdForPersist) return;
    pending.posted = true;
    apiFetch(`/api/conversations/${encodeURIComponent(conversationIdForPersist)}/triage-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pending.payload),
      timeout: 15_000,
      noRetry: true,
    }).catch(() => { /* non-fatal — resume shows honest Waiting */ });
  }, []);

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
    // The chat leg has settled (and the server has already saved the
    // conversation — save happens before the done event) so a stashed
    // triage result can now be persisted race-free.
    chatLegSettledRef.current = true;
    persistTriageResult();
  }, [handleCaseIntake, persistTriageResult]);

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
    // Failed chat legs still settle — persist the triage result so the
    // session resumes honestly with whatever triage actually produced.
    chatLegSettledRef.current = true;
    persistTriageResult();
  }, [markFailureInProgress, persistTriageResult]);

  const runChatStream = useCallback((payload, token) => {
    const { abort } = sendChatMessage(payload, {
      onInit: (data) => { if (tokenRef.current === token) handleInit(data); },
      onStatus: () => {},
      onTriageCard: () => {},
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
  }, [handleCaseIntake, handleChunk, handleDone, handleError, handleInit, handleInvMatches, handleStageEvent]);

  const startTriageStream = useCallback((parseResult, runtimeByStage, token) => {
    const text = (parseResult?.sourceText || parseResult?.text || '').trim();
    const role = cleanRuntimeValue(parseResult?.role).toLowerCase();
    const now = Date.now();

    if (!text || (role && role !== 'escalation')) {
      const reason = !text
        ? 'Parser returned no escalation text for triage.'
        : `Parser classified this image as ${role}.`;
      pushLocalStageEvent('triage', 'stage.skipped', {
        code: !text ? 'TRIAGE_EMPTY_INPUT' : 'TRIAGE_NON_ESCALATION_ROLE',
        reason,
      });
      setStageState((prev) => ({
        ...prev,
        triage: {
          ...prev.triage,
          status: 'done',
          startedAt: prev.triage.startedAt || now,
          finishedAt: now,
          durationMs: prev.triage.startedAt ? now - prev.triage.startedAt : 0,
          error: null,
          fallbackUsed: false,
          fallbackReason: '',
        },
      }));
      return;
    }

    if (triageAbortRef.current) {
      try { triageAbortRef.current(); } catch { /* noop */ }
      triageAbortRef.current = null;
    }

    const triageRuntime = runtimeByStage?.triage || runtimeByStage?.['triage-agent'] || {};
    const provider = cleanRuntimeValue(triageRuntime.provider);
    const model = cleanRuntimeValue(triageRuntime.model);
    const reasoningEffort = cleanRuntimeValue(triageRuntime.reasoningEffort);
    const serviceTier = cleanRuntimeValue(triageRuntime.serviceTier);
    // Wave 2 universal failover: forward the triage agent profile's configured
    // backup so the server's failover gate (hasFailoverIntent) turns on. Without
    // these, a primary-provider failure goes straight to the deterministic rule
    // card with no second-provider attempt. triageRuntime always carries a
    // fallbackProvider/fallbackModel pair (defaults to a neutral alternate).
    const fallbackProvider = cleanRuntimeValue(triageRuntime.fallbackProvider);
    const fallbackModel = cleanRuntimeValue(triageRuntime.fallbackModel);
    const startedAt = Date.now();
    // Buffer the harness's server-streamed stage events (incl. llm.thinking)
    // so the settled result persists onto the conversation with the same
    // event fidelity the parser/INV stages get from their server-side buses.
    const triageStreamEvents = [];

    setStageState((prev) => ({
      ...prev,
      triage: {
        ...prev.triage,
        status: 'running',
        startedAt: prev.triage.startedAt || startedAt,
        finishedAt: null,
        durationMs: null,
        error: null,
        fallbackUsed: false,
        fallbackReason: '',
        providerPackageId: '',
      },
    }));
    pushLocalStageEvent('triage', 'triage.client_request_started', {
      provider,
      model,
      reasoningEffort,
      textLength: text.length,
      status: 'sent',
      surfaceToUser: true,
      displayMessage: 'triage payload sent to server - sent',
    });

    const request = runTriageStream({
      text,
      provider,
      model,
      reasoningEffort,
      serviceTier,
      // Carry the configured backup so the server gate enables failover. The
      // standalone triage route + resolveAgentBackup read fallbackProvider/
      // fallbackModel off the flat agentRuntime object, so we send triageRuntime
      // itself (matching the triage-tests route's contract), with the explicit
      // fallback pair taking precedence when set.
      fallbackProvider,
      fallbackModel,
      agentRuntime: triageRuntime,
      timeoutMs: 120_000,
    }, {
      onStageEvent: (data) => {
        if (tokenRef.current !== token) return;
        if (triageStreamEvents.length < 250) triageStreamEvents.push(data);
        handleStageEvent(data);
      },
      onComplete: (data) => {
        if (tokenRef.current !== token) return;
        triageAbortRef.current = null;
        const card = data?.card || data?.triageCard || data?.fallbackCard || null;
        if (card) handleTriageCard(card);
        const finishedAt = Date.now();
        const failed = data?.ok === false && !data?.card && !data?.triageCard;
        // fallbackUsed means a real substitute path produced the card (rule
        // fallback or provider failover) — NOT a genuine model result that
        // merely failed soft validation. The server reports the latter as
        // status 'degraded' with fallbackUsed false, so keep the two separate.
        const fallbackUsed = Boolean(card?.fallback?.used || data?.triageMeta?.fallbackUsed || data?.fallbackUsed || data?.fallbackCard);
        const degraded = data?.status === 'degraded' || fallbackUsed;
        pushLocalStageEvent('triage', 'triage.client_result_received', {
          provider: data?.providerUsed || provider,
          model: data?.modelUsed || model,
          elapsedMs: data?.elapsedMs ?? (finishedAt - startedAt),
          status: failed ? 'failed' : (degraded ? 'degraded' : 'success'),
          providerPackageId: data?.triageMeta?.providerPackageId || '',
          fallbackUsed,
        });
        setStageState((prev) => ({
          ...prev,
          triage: {
            ...prev.triage,
            status: failed ? 'failed' : 'done',
            startedAt: prev.triage.startedAt || startedAt,
            finishedAt,
            durationMs: data?.elapsedMs ?? (finishedAt - (prev.triage.startedAt || startedAt)),
            error: failed ? (data?.error || 'Triage failed.') : null,
            fallbackUsed,
            fallbackReason: card?.fallback?.reason || data?.triageMeta?.fallbackReason || '',
            providerPackageId: data?.triageMeta?.providerPackageId || '',
          },
        }));
        // Stash the settled result for deferred persistence onto the
        // conversation (failed and fallback outcomes persist honestly too).
        pendingTriagePersistRef.current = {
          posted: false,
          payload: {
            triageCard: card || null,
            triageMeta: data?.triageMeta || null,
            error: failed
              ? { code: data?.code || 'TRIAGE_FAILED', message: data?.error || 'Triage failed.' }
              : null,
            events: triageStreamEvents,
            durationMs: data?.elapsedMs ?? (finishedAt - startedAt),
            startedAt,
            completedAt: finishedAt,
          },
        };
        persistTriageResult();
      },
      onError: (err) => {
        if (tokenRef.current !== token) return;
        triageAbortRef.current = null;
        const normalized = normalizeError(err);
        const failedAt = Date.now();
        pushLocalStageEvent('triage', 'error', {
          code: normalized.code || 'TRIAGE_FAILED',
          message: normalized.message || 'Triage failed',
          status: 'error',
          surfaceToUser: true,
          displayMessage: normalized.message || 'Triage failed',
        });
        setStageState((prev) => {
          const finishedAt = Date.now();
          const stageStartedAt = prev.triage.startedAt || startedAt;
          return {
            ...prev,
            triage: {
              ...prev.triage,
              status: 'failed',
              startedAt: stageStartedAt,
              finishedAt,
              durationMs: finishedAt - stageStartedAt,
              error: normalized.message || 'Triage failed',
              providerPackageId: '',
            },
          };
        });
        // Persist the failure honestly (status 'failed' + summary) so a
        // resumed session reflects what actually happened.
        pendingTriagePersistRef.current = {
          posted: false,
          payload: {
            triageCard: null,
            triageMeta: null,
            error: {
              code: normalized.code || 'TRIAGE_FAILED',
              message: normalized.message || 'Triage failed',
            },
            events: triageStreamEvents,
            durationMs: failedAt - startedAt,
            startedAt,
            completedAt: failedAt,
          },
        };
        persistTriageResult();
      },
    });
    triageAbortRef.current = request.abort;
  }, [handleStageEvent, handleTriageCard, persistTriageResult, pushLocalStageEvent, runTriageStream]);

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
    // Fresh pipeline run: drop any stale triage persistence state from a
    // previous run so this run's result is stashed and posted on its own.
    pendingTriagePersistRef.current = null;
    chatLegSettledRef.current = false;
    setRequestError(null);
    setAnalyst(buildEmptyAnalystState());
    // Mark parser as running while the image-parser HTTP call runs.
    setStageState((prev) => ({
      ...prev,
      parser: { ...prev.parser, status: 'running', startedAt: Date.now(), finishedAt: null, durationMs: null, error: null },
      triage: { ...prev.triage, status: 'pending', startedAt: null, finishedAt: null, durationMs: null, error: null, providerPackageId: '' },
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
      status: 'sent',
      surfaceToUser: true,
      displayMessage: 'payload sent to server - sent',
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
      if (!err?.stageEventAlreadyEmitted) {
        pushLocalStageEvent('parser', 'error', {
          code: normalized.code || 'PARSE_FAILED',
          message: normalized.message || 'Image parser failed',
          detail: normalized.detail || '',
          status: 'error',
          providerPackageId: err?.providerTrace?.providerPackageId || null,
          providerHarness: err?.providerTrace?.providerHarness || null,
          surfaceToUser: true,
          displayMessage: normalized.message || 'Image parser failed',
        });
      }
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
    const providerPackageId = parseResult?.providerTrace?.providerPackageId || '';
    if (providerPackageId) {
      pushLocalStageEvent('parser', 'parser.provider_content_received_client', {
        provider: parseResult?.providerUsed || '',
        providerPackageId,
        status: 'received',
        surfaceToUser: true,
        displayMessage: `providerPackageId: ${providerPackageId} content received in client - received`,
      });
    }
    pushLocalStageEvent('parser', 'parser.client_result_received', {
      provider: parseResult?.providerUsed || '',
      model: parseResult?.modelUsed || '',
      textLength: (parseResult?.text || '').length,
      elapsedMs: parseResult?.elapsedMs ?? 0,
      providerPackageId: providerPackageId || null,
    });
    if (!parseResult.sourceText && !parseResult.text) {
      const normalized = normalizeError({ message: 'Image parser returned no text.' });
      pushLocalStageEvent('parser', 'error', {
        code: 'PARSER_EMPTY_RESULT',
        message: normalized.message,
        status: 'error',
        provider: parseResult?.providerUsed || '',
        model: parseResult?.modelUsed || '',
        providerPackageId: providerPackageId || null,
        surfaceToUser: true,
        displayMessage: normalized.message,
      });
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
    startTriageStream(parseResult, runtimeByStage, token);

    // Submit to /api/chat with parsedEscalationText.
    const payload = buildPipelineChatPayload({
      message: 'Escalation captured via screenshot. See parsed template below for full context.',
      conversationId: conversationId || resumeTargetId || undefined,
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
  }, [conversationId, resumeTargetId, handleStageEvent, pushLocalStageEvent, runChatStream, startTriageStream]);

  const captureImage = useCallback((imageDataUrl, fileMeta) => {
    if (imageCaptured) return;
    if (!imageDataUrl) return;
    pushLocalStageEvent('parser', 'parser.image_received', {
      name: fileMeta?.name || '',
      type: fileMeta?.type || '',
      sizeBytes: fileMeta?.size ?? null,
      via: 'chat-v5-upload',
    });
    imageCapturedRef.current = true;
    setImageCaptured(true);
    setCapturedImageSrc(imageDataUrl);
    setCapturedFileMeta(fileMeta || null);
    pushLocalStageEvent('parser', 'parser.image_preview_ready', {
      dataUrlLength: typeof imageDataUrl === 'string' ? imageDataUrl.length : 0,
      isDataUrl: typeof imageDataUrl === 'string' && imageDataUrl.startsWith('data:'),
    });
    if (widgetSwitchTimerRef.current) clearTimeout(widgetSwitchTimerRef.current);
    widgetSwitchTimerRef.current = setTimeout(() => {
      widgetSwitchTimerRef.current = null;
      setActiveWidget('parser');
    }, 320);
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
    if (triageAbortRef.current) {
      try { triageAbortRef.current(); } catch { /* noop */ }
      triageAbortRef.current = null;
    }

    const runtimeByStage = await readPipelineRuntimeForExecution();
    if (tokenRef.current !== token) return;

    const { abort } = sendChatMessage(buildPipelineChatPayload({
      message: clean,
      conversationId: conversationId || resumeTargetId || undefined,
      images: [],
      mode: 'single',
    }, runtimeByStage), {
      onInit: (data) => {
        if (tokenRef.current !== token || !data?.conversationId) return;
        conversationIdRef.current = data.conversationId;
        setConversationId(data.conversationId);
      },
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
  }, [conversationId, resumeTargetId, handleCaseIntake, handleInvMatches, handleStageEvent]);

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
    // Also cancel any in-flight image parse so its SSE consumer can't call
    // setState after this component unmounts.
    if (parseAbortRef.current) {
      try { parseAbortRef.current.abort(); } catch { /* noop */ }
      parseAbortRef.current = null;
    }
    if (triageAbortRef.current) {
      try { triageAbortRef.current(); } catch { /* noop */ }
      triageAbortRef.current = null;
    }
    if (widgetSwitchTimerRef.current) {
      clearTimeout(widgetSwitchTimerRef.current);
      widgetSwitchTimerRef.current = null;
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
    ingestStageEvent: handleStageEvent,
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
    clearResumeTarget,
    restoreCapturedImage,
    hydrateFromSavedCaseIntake,
  };
}
