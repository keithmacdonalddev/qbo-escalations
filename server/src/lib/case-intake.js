'use strict';

const { randomUUID } = require('node:crypto');
const { categoryForKind } = require('./stage-events');

const CASE_STATUS = {
  NONE: 'none',
  ANALYST_RUNNING: 'analyst-running',
  ANALYST_COMPLETE: 'analyst-complete',
  FAILED: 'failed',
};

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function clonePlain(value, fallback = null) {
  if (!value || typeof value !== 'object') return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function normalizeDate(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function normalizeDurationMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function calculateDurationMs(startedAt, completedAt) {
  const start = startedAt ? normalizeDate(startedAt, null) : null;
  const end = completedAt ? normalizeDate(completedAt, null) : null;
  if (!start || !end) return null;
  return Math.max(0, end.getTime() - start.getTime());
}

function firstDurationMs(...values) {
  for (const value of values) {
    const durationMs = normalizeDurationMs(value);
    if (durationMs !== null) return durationMs;
  }
  return null;
}

function getMetaDurationMs(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const attempts = Array.isArray(meta.attempts) ? meta.attempts : [];
  const winningAttempt = attempts.find((attempt) => attempt?.status === 'ok' && attempt?.provider === meta.providerUsed)
    || attempts.find((attempt) => attempt?.status === 'ok')
    || attempts[0]
    || null;
  const candidates = Array.isArray(meta.candidates) ? meta.candidates : [];
  return firstDurationMs(
    meta.durationMs,
    meta.elapsedMs,
    meta.latencyMs,
    winningAttempt?.durationMs,
    winningAttempt?.elapsedMs,
    winningAttempt?.latencyMs,
    candidates[0]?.durationMs,
    candidates[0]?.elapsedMs,
    candidates[0]?.latencyMs
  );
}

function normalizeExistingIntake(existing) {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? clonePlain(existing, {})
    : {};
  return {
    status: safeString(base.status, CASE_STATUS.NONE) || CASE_STATUS.NONE,
    source: safeString(base.source, ''),
    canonicalTemplate: safeString(base.canonicalTemplate, ''),
    parseFields: clonePlain(base.parseFields, null),
    parseMeta: clonePlain(base.parseMeta, null),
    knownIssueSearchResult: clonePlain(base.knownIssueSearchResult, null),
    triageCard: clonePlain(base.triageCard, null),
    followUps: Array.isArray(base.followUps) ? base.followUps : [],
    runs: Array.isArray(base.runs) ? base.runs : [],
    activeRunId: safeString(base.activeRunId, ''),
    updatedAt: base.updatedAt || null,
  };
}

function createRun({
  agentId,
  agentName,
  phase,
  status,
  provider,
  model,
  traceId,
  summary,
  detail,
  startedAt,
  completedAt,
  durationMs,
  fallbackUsed,
  fallbackFrom,
  fallbackReason,
}) {
  const normalizedStartedAt = startedAt ? normalizeDate(startedAt) : new Date();
  const normalizedCompletedAt = completedAt ? normalizeDate(completedAt) : null;
  const fallbackUsedBool = Boolean(fallbackUsed);
  return {
    id: randomUUID(),
    agentId: safeString(agentId, ''),
    agentName: safeString(agentName, ''),
    phase: safeString(phase, ''),
    status: safeString(status, 'pending'),
    provider: safeString(provider, ''),
    model: safeString(model, ''),
    traceId: safeString(traceId, ''),
    startedAt: normalizedStartedAt,
    completedAt: normalizedCompletedAt,
    durationMs: firstDurationMs(durationMs, calculateDurationMs(normalizedStartedAt, normalizedCompletedAt)),
    fallbackUsed: fallbackUsedBool,
    fallbackFrom: safeString(fallbackFrom, ''),
    fallback: {
      used: fallbackUsedBool,
      reason: fallbackUsedBool ? safeString(fallbackReason, '') : '',
      from: fallbackUsedBool ? safeString(fallbackFrom, '') : '',
    },
    summary: safeString(summary, ''),
    detail: clonePlain(detail, null),
    events: [],
    eventCount: 0,
  };
}

function replacePhaseRun(runs, nextRun) {
  return [
    ...runs.filter((run) => run && run.phase !== nextRun.phase),
    nextRun,
  ];
}

function summarizeTriageCard(card) {
  if (!card || typeof card !== 'object') return '';
  const prefix = [card.severity, card.category].filter(Boolean).join(' ');
  const read = safeString(card.read || card.quickRead || '', '').trim();
  return [prefix, read].filter(Boolean).join(' - ').slice(0, 220);
}

function summarizeKnownIssueSearch(searchResult) {
  if (!searchResult || typeof searchResult !== 'object') return '';
  if (searchResult.status === 'match') {
    const count = Array.isArray(searchResult.matches) ? searchResult.matches.length : 0;
    return `${count} known issue candidate${count === 1 ? '' : 's'} found.`.slice(0, 220);
  }
  if (searchResult.status === 'no_reasonable_match') {
    return safeString(searchResult.noMatchReason || searchResult.summary, 'No reasonable known issue match found.').slice(0, 220);
  }
  return safeString(searchResult.summary, 'Known issue search needs more information.').slice(0, 220);
}

function appendCaseIntakeFollowUp(existing, {
  transcript,
  parserProvider,
  parserModel,
  traceId,
  note,
  createdAt,
} = {}) {
  const cleanTranscript = safeString(transcript, '').trim();
  const intake = normalizeExistingIntake(existing);
  if (!cleanTranscript) return intake;

  const now = normalizeDate(createdAt);
  const nextFollowUps = [
    ...(Array.isArray(intake.followUps) ? intake.followUps : []),
    {
      id: randomUUID(),
      source: 'follow-up-chat-parser',
      transcript: cleanTranscript,
      note: safeString(note, 'Follow-up context after the original escalation template.'),
      parserProvider: safeString(parserProvider, ''),
      parserModel: safeString(parserModel, ''),
      traceId: safeString(traceId, ''),
      createdAt: now,
    },
  ].slice(-20);

  return {
    ...intake,
    source: intake.source || 'escalation-template-parser',
    followUps: nextFollowUps,
    updatedAt: now,
  };
}

function buildCaseIntakeFromParsedEscalation({
  existing,
  sourceText,
  imageTriageContext,
  parserProvider,
  parserModel,
  analystProvider,
  analystModel,
  traceId,
  startedAt,
} = {}) {
  const canonicalTemplate = safeString(sourceText, '').trim();
  if (!canonicalTemplate && !imageTriageContext) {
    return normalizeExistingIntake(existing);
  }

  const now = normalizeDate(startedAt);
  const intake = normalizeExistingIntake(existing);
  const parseMeta = clonePlain(imageTriageContext?.parseMeta, null);
  const knownIssueSearchResult = clonePlain(imageTriageContext?.knownIssueSearchResult, null);
  const triageMeta = clonePlain(imageTriageContext?.triageMeta, null);
  const parseFields = clonePlain(imageTriageContext?.parseFields, null);
  const triageCard = clonePlain(imageTriageContext?.triageCard, null);
  const parserProviderUsed = safeString(
    parseMeta?.providerUsed || imageTriageContext?.providerUsed || parserProvider,
    ''
  );
  const parserModelUsed = safeString(
    parseMeta?.model || imageTriageContext?.model || parserModel,
    ''
  );
  const triageError = imageTriageContext?.error || null;
  const triageFallback = Boolean(triageCard?.fallback?.used || triageMeta?.usedRuleFallback);
  const triageFallbackReason = triageFallback
    ? safeString(triageCard?.fallback?.reason || triageMeta?.fallbackReason, 'Triage Agent did not produce a usable card; rule fallback is displayed.')
    : '';
  const triageFallbackFrom = triageFallback
    ? safeString(triageMeta?.fallbackFrom || triageCard?.fallback?.from, '')
    : '';
  const knownIssueMeta = knownIssueSearchResult?.meta || null;
  const parserDurationMs = getMetaDurationMs(parseMeta);
  const triageDurationMs = firstDurationMs(getMetaDurationMs(triageMeta), imageTriageContext?.elapsedMs);
  const knownIssueDurationMs = getMetaDurationMs(knownIssueMeta);

  const parserRun = createRun({
    agentId: 'escalation-template-parser',
    agentName: 'Image Parser',
    phase: 'parse-template',
    status: canonicalTemplate ? 'completed' : 'failed',
    provider: parserProviderUsed,
    model: parserModelUsed,
    traceId,
    startedAt: now,
    completedAt: now,
    durationMs: parserDurationMs,
    fallbackUsed: Boolean(parseMeta?.fallbackUsed),
    fallbackFrom: parseMeta?.fallbackFrom || '',
    summary: canonicalTemplate
      ? `Canonical template captured (${canonicalTemplate.length} chars).`
      : 'No canonical template text was available.',
    detail: {
      validation: parseMeta?.validation || null,
      attempts: Array.isArray(parseMeta?.attempts) ? parseMeta.attempts : [],
    },
  });

  const triageRun = createRun({
    agentId: 'triage-agent',
    agentName: 'Triage Agent',
    phase: 'triage',
    status: triageError ? 'failed' : 'completed',
    provider: safeString(triageMeta?.providerUsed, parserProviderUsed),
    model: safeString(triageMeta?.model, parserModelUsed),
    traceId,
    startedAt: now,
    completedAt: now,
    durationMs: triageDurationMs,
    fallbackUsed: Boolean(triageMeta?.fallbackUsed || triageFallback),
    fallbackFrom: triageFallbackFrom,
    fallbackReason: triageFallbackReason,
    summary: triageError
      ? safeString(triageError.message || triageError.code, 'Triage did not complete.')
      : triageFallback
        ? triageFallbackReason
      : summarizeTriageCard(triageCard),
    detail: triageError ? clonePlain(triageError, null) : {
      confidence: triageCard?.confidence || parseMeta?.confidence || '',
      missingInfo: Array.isArray(triageCard?.missingInfo) ? triageCard.missingInfo : [],
      source: triageCard?.source || '',
      generation: clonePlain(triageCard?.generation, null),
      fallback: clonePlain(triageCard?.fallback, null),
      runtime: clonePlain(triageCard?.runtime, null) || {
        usedDefault: Boolean(triageMeta?.usedDefaultRuntime),
        configured: triageMeta?.runtimeConfigured !== false,
        source: safeString(triageMeta?.runtimeSource, ''),
      },
      validation: triageMeta?.validation || null,
    },
  });

  const knownIssueRun = knownIssueSearchResult ? createRun({
    agentId: 'known-issue-search-agent',
    agentName: 'INV Search Agent',
    phase: 'known-issue-search',
    status: knownIssueSearchResult.ok ? 'completed' : 'failed',
    provider: safeString(knownIssueMeta?.providerUsed, parserProviderUsed),
    model: safeString(knownIssueMeta?.model, parserModelUsed),
    traceId,
    startedAt: now,
    completedAt: now,
    durationMs: knownIssueDurationMs,
    fallbackUsed: Boolean(knownIssueMeta?.fallbackUsed),
    fallbackFrom: knownIssueMeta?.fallbackFrom || '',
    summary: summarizeKnownIssueSearch(knownIssueSearchResult),
    detail: {
      status: knownIssueSearchResult.status || '',
      searches: Array.isArray(knownIssueSearchResult.searches) ? knownIssueSearchResult.searches : [],
      matches: Array.isArray(knownIssueSearchResult.matches) ? knownIssueSearchResult.matches : [],
      rejectedCandidates: Array.isArray(knownIssueSearchResult.rejectedCandidates) ? knownIssueSearchResult.rejectedCandidates : [],
      noMatchReason: safeString(knownIssueSearchResult.noMatchReason, ''),
      needsMoreInfo: Array.isArray(knownIssueSearchResult.needsMoreInfo) ? knownIssueSearchResult.needsMoreInfo : [],
      validation: knownIssueSearchResult.validation || null,
      runtime: {
        usedDefault: Boolean(knownIssueMeta?.usedDefaultRuntime),
        configured: knownIssueMeta?.runtimeConfigured !== false,
        source: safeString(knownIssueMeta?.runtimeSource, ''),
      },
    },
  }) : null;

  const analystRun = createRun({
    agentId: 'chat',
    agentName: 'QBO Assistant',
    phase: 'analyst',
    status: 'running',
    provider: analystProvider,
    model: analystModel,
    traceId,
    startedAt: now,
    completedAt: null,
    durationMs: null,
    summary: 'Deep support guidance is running.',
  });

  return {
    ...intake,
    status: CASE_STATUS.ANALYST_RUNNING,
    source: 'escalation-template-parser',
    canonicalTemplate,
    parseFields,
    parseMeta,
    knownIssueSearchResult,
    triageCard,
    runs: [
      parserRun,
      ...(knownIssueRun ? [knownIssueRun] : []),
      triageRun,
      analystRun,
    ],
    activeRunId: analystRun.id,
    updatedAt: now,
  };
}

function completeCaseIntakeAnalystRun(existing, {
  provider,
  model,
  traceId,
  summary,
  detail,
  completedAt,
} = {}) {
  const intake = normalizeExistingIntake(existing);
  const now = normalizeDate(completedAt);
  const previous = intake.runs.find((run) => run && run.phase === 'analyst') || {};
  const startedAt = previous.startedAt || now;
  const completedRun = {
    ...previous,
    id: safeString(previous.id, '') || randomUUID(),
    agentId: safeString(previous.agentId, 'chat'),
    agentName: safeString(previous.agentName, 'QBO Assistant'),
    phase: 'analyst',
    status: 'completed',
    provider: safeString(provider, previous.provider || ''),
    model: safeString(model, previous.model || ''),
    traceId: safeString(traceId, previous.traceId || ''),
    startedAt,
    completedAt: now,
    durationMs: firstDurationMs(previous.durationMs, calculateDurationMs(startedAt, now)),
    fallbackUsed: Boolean(previous.fallbackUsed || detail?.fallbackUsed),
    fallbackFrom: safeString(previous.fallbackFrom || detail?.fallbackFrom, ''),
    summary: safeString(summary, previous.summary || 'Deep support guidance completed.').slice(0, 280),
    detail: clonePlain(detail, previous.detail || null),
  };

  return {
    ...intake,
    status: CASE_STATUS.ANALYST_COMPLETE,
    runs: replacePhaseRun(intake.runs, completedRun),
    activeRunId: '',
    updatedAt: now,
  };
}

function failCaseIntakeAnalystRun(existing, {
  provider,
  model,
  traceId,
  error,
  completedAt,
} = {}) {
  const intake = normalizeExistingIntake(existing);
  const now = normalizeDate(completedAt);
  const previous = intake.runs.find((run) => run && run.phase === 'analyst') || {};
  const startedAt = previous.startedAt || now;
  const failedRun = {
    ...previous,
    id: safeString(previous.id, '') || randomUUID(),
    agentId: safeString(previous.agentId, 'chat'),
    agentName: safeString(previous.agentName, 'QBO Assistant'),
    phase: 'analyst',
    status: 'failed',
    provider: safeString(provider, previous.provider || ''),
    model: safeString(model, previous.model || ''),
    traceId: safeString(traceId, previous.traceId || ''),
    startedAt,
    completedAt: now,
    durationMs: firstDurationMs(previous.durationMs, calculateDurationMs(startedAt, now)),
    fallbackUsed: Boolean(previous.fallbackUsed),
    fallbackFrom: safeString(previous.fallbackFrom, ''),
    summary: safeString(error?.message || error?.code, 'Deep support guidance failed.').slice(0, 280),
    detail: clonePlain(error, null),
  };

  return {
    ...intake,
    status: CASE_STATUS.FAILED,
    runs: replacePhaseRun(intake.runs, failedRun),
    activeRunId: '',
    updatedAt: now,
  };
}

const MAX_EVENTS_PER_RUN = 200;

function normalizeStageEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const kind = safeString(event.kind, '');
  if (!kind) return null;
  const ts = Number.isFinite(Number(event.ts)) ? Number(event.ts) : Date.now();
  const seq = Number.isFinite(Number(event.seq)) ? Number(event.seq) : 0;
  // Trust the bus's category when present; otherwise classify by kind so
  // events from older code paths (or replayed events) get the right tag.
  const category = event.category === 'ui' || event.category === 'run'
    ? event.category
    : categoryForKind(kind);
  return {
    kind,
    ts,
    seq,
    category,
    stageId: safeString(event.stageId, ''),
    runId: safeString(event.runId, ''),
    data: event.data === undefined ? null : clonePlain(event.data, event.data),
  };
}

/**
 * Append buffered stage_event records onto the matching run in
 * caseIntake.runs[]. Stage-to-phase mapping mirrors how ChatV5Container.jsx
 * labels its cards.
 *
 * @param {object} existing - the current caseIntake (may be null)
 * @param {string} stageId  - 'parser' | 'inv' | 'triage' | 'main'
 * @param {Array}  events   - flushed events from the per-stage bus
 */
function applyStageEventsToCaseIntake(existing, stageId, events) {
  const intake = normalizeExistingIntake(existing);
  if (!stageId || !Array.isArray(events) || events.length === 0) return intake;

  const phaseByStageId = {
    parser: 'parse-template',
    inv: 'known-issue-search',
    triage: 'triage',
    main: 'analyst',
  };
  const phase = phaseByStageId[stageId];
  if (!phase) return intake;

  const normalizedEvents = events
    .map(normalizeStageEvent)
    .filter(Boolean)
    .slice(0, MAX_EVENTS_PER_RUN);

  if (normalizedEvents.length === 0) return intake;

  const runs = (Array.isArray(intake.runs) ? intake.runs : []).map((run) => {
    if (!run || run.phase !== phase) return run;
    const existingEvents = Array.isArray(run.events) ? run.events : [];
    const merged = [...existingEvents, ...normalizedEvents].slice(-MAX_EVENTS_PER_RUN);
    // eventCount tracks the live total even after the bounded events array
    // is sliced — keeps moving-average denominators truthful for long runs.
    // Only `run`-category events count toward the denominator; `ui` events
    // (popup open/close, replay-skipped, etc.) are stored for debugging but
    // never inflate counters or moving averages.
    const previousCount = Number.isFinite(Number(run.eventCount)) ? Number(run.eventCount) : 0;
    const newRunEvents = normalizedEvents.filter((ev) => ev.category !== 'ui').length;
    return {
      ...run,
      events: merged,
      eventCount: previousCount + newRunEvents,
    };
  });

  return {
    ...intake,
    runs,
    updatedAt: new Date(),
  };
}

module.exports = {
  CASE_STATUS,
  appendCaseIntakeFollowUp,
  applyStageEventsToCaseIntake,
  buildCaseIntakeFromParsedEscalation,
  completeCaseIntakeAnalystRun,
  failCaseIntakeAnalystRun,
  normalizeExistingIntake,
};
