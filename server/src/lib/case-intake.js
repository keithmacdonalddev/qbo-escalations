'use strict';

const { randomUUID } = require('node:crypto');

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
}) {
  return {
    id: randomUUID(),
    agentId: safeString(agentId, ''),
    agentName: safeString(agentName, ''),
    phase: safeString(phase, ''),
    status: safeString(status, 'pending'),
    provider: safeString(provider, ''),
    model: safeString(model, ''),
    traceId: safeString(traceId, ''),
    startedAt: startedAt ? normalizeDate(startedAt) : new Date(),
    completedAt: completedAt ? normalizeDate(completedAt) : null,
    summary: safeString(summary, ''),
    detail: clonePlain(detail, null),
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

  const parserRun = createRun({
    agentId: 'escalation-template-parser',
    agentName: 'Escalation Template Parser',
    phase: 'parse-template',
    status: canonicalTemplate ? 'completed' : 'failed',
    provider: parserProviderUsed,
    model: parserModelUsed,
    traceId,
    startedAt: now,
    completedAt: now,
    summary: canonicalTemplate
      ? `Canonical template captured (${canonicalTemplate.length} chars).`
      : 'No canonical template text was available.',
    detail: {
      validation: parseMeta?.validation || null,
    },
  });

  const triageRun = createRun({
    agentId: 'triage-agent',
    agentName: 'Triage Agent',
    phase: 'triage',
    status: triageError ? 'failed' : 'completed',
    provider: parserProviderUsed,
    model: parserModelUsed,
    traceId,
    startedAt: now,
    completedAt: now,
    summary: triageError
      ? safeString(triageError.message || triageError.code, 'Triage did not complete.')
      : summarizeTriageCard(triageCard),
    detail: triageError ? clonePlain(triageError, null) : {
      confidence: triageCard?.confidence || parseMeta?.confidence || '',
      missingInfo: Array.isArray(triageCard?.missingInfo) ? triageCard.missingInfo : [],
    },
  });

  const analystRun = createRun({
    agentId: 'chat',
    agentName: 'QBO Analyst',
    phase: 'analyst',
    status: 'running',
    provider: analystProvider,
    model: analystModel,
    traceId,
    startedAt: now,
    completedAt: null,
    summary: 'Deep support guidance is running.',
  });

  return {
    ...intake,
    status: CASE_STATUS.ANALYST_RUNNING,
    source: 'escalation-template-parser',
    canonicalTemplate,
    parseFields,
    parseMeta,
    triageCard,
    runs: [
      parserRun,
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
  const completedRun = {
    ...previous,
    id: safeString(previous.id, '') || randomUUID(),
    agentId: safeString(previous.agentId, 'chat'),
    agentName: safeString(previous.agentName, 'QBO Analyst'),
    phase: 'analyst',
    status: 'completed',
    provider: safeString(provider, previous.provider || ''),
    model: safeString(model, previous.model || ''),
    traceId: safeString(traceId, previous.traceId || ''),
    startedAt: previous.startedAt || now,
    completedAt: now,
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
  const failedRun = {
    ...previous,
    id: safeString(previous.id, '') || randomUUID(),
    agentId: safeString(previous.agentId, 'chat'),
    agentName: safeString(previous.agentName, 'QBO Analyst'),
    phase: 'analyst',
    status: 'failed',
    provider: safeString(provider, previous.provider || ''),
    model: safeString(model, previous.model || ''),
    traceId: safeString(traceId, previous.traceId || ''),
    startedAt: previous.startedAt || now,
    completedAt: now,
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

module.exports = {
  CASE_STATUS,
  appendCaseIntakeFollowUp,
  buildCaseIntakeFromParsedEscalation,
  completeCaseIntakeAnalystRun,
  failCaseIntakeAnalystRun,
  normalizeExistingIntake,
};
