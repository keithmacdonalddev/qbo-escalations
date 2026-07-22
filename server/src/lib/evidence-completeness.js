'use strict';

const { PROVIDER_CATALOG } = require('../services/providers/catalog');

const EVIDENCE_CONTRACT_VERSION = 1;
const SETTLING_WINDOW_MS = 2 * 60 * 1000;
const IMAGE_PARSE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const TRIAGE_RESULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PROVIDER_PACKAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const PHASES = [
  'parse-template',
  'known-issue-search',
  'triage',
  'analyst',
];

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function toPlain(value) {
  if (!value || typeof value !== 'object') return value;
  if (typeof value.toObject === 'function') return value.toObject();
  return value;
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasOwn(value, key) {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function hasObjectContent(value) {
  return isObject(value) && Object.keys(value).length > 0;
}

function normalizeNow(value = new Date()) {
  if (value === null || value === undefined) return new Date();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function toTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => safeString(value, '').trim()).filter(Boolean))];
}

function compactIds(ids) {
  return Object.fromEntries(
    Object.entries(ids || {}).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== null && value !== undefined && value !== '';
    })
  );
}

function artifact({ code, label, stage, kind, state, reason, explanation, ids }) {
  return {
    code,
    label,
    stage,
    kind,
    state,
    reason,
    explanation,
    ids: compactIds(ids),
  };
}

function findRun(runs, phase) {
  return runs.find((run) => isObject(run) && run.phase === phase) || null;
}

function receiptWasSkipped(phase, receipt) {
  if (!isObject(receipt)) return false;
  if (receipt.skipped === true) return true;
  if (phase === 'triage' && receipt.planned === false) return true;
  return receipt.attempted === false && Boolean(safeString(receipt.skipReason, '').trim());
}

function receiptFailed(receipt) {
  if (!isObject(receipt)) return false;
  return receipt.failed === true
    || receipt.status === 'failed'
    || receipt.completed === false
    || Boolean(receipt.errorCode || receipt.error);
}

function receiptCompleted(receipt) {
  if (!isObject(receipt)) return false;
  return receipt.completed === true
    || receipt.status === 'completed'
    || receipt.status === 'success';
}

function getReceiptTimestamp(receipt, run, evidence, conversation) {
  const candidates = [
    receipt?.savedAt,
    receipt?.completedAt,
    receipt?.recordedAt,
    run?.completedAt,
    run?.startedAt,
    evidence?.updatedAt,
    conversation?.createdAt,
  ];
  for (const candidate of candidates) {
    const timestamp = toTimestamp(candidate);
    if (timestamp !== null) return timestamp;
  }
  return null;
}

function isLikelyExpired({ receipt, run, evidence, conversation, nowMs, ttlMs }) {
  const savedAt = getReceiptTimestamp(receipt, run, evidence, conversation);
  return savedAt !== null && nowMs - savedAt >= ttlMs;
}

function getProviderReasoningCapability(providerId) {
  const provider = PROVIDER_CATALOG.find((entry) => entry.id === providerId) || null;
  if (!provider) return null;
  const visible = provider.reasoningVisibility && provider.reasoningVisibility !== 'none';
  return provider.supportsThinking === true && visible;
}

function runHasReasoning(run) {
  const events = Array.isArray(run?.events) ? run.events : [];
  return events.some((event) => {
    const kind = safeString(event?.kind, '').toLowerCase();
    if (!kind.includes('thinking') && !kind.includes('reasoning')) return false;
    const data = event?.data;
    if (typeof data === 'string') return Boolean(data.trim());
    if (!isObject(data)) return true;
    return Boolean(
      safeString(data.delta || data.thinking || data.reasoning || data.text, '').trim()
      || Object.keys(data).length > 0
    );
  });
}

function outputArtifact({
  code,
  label,
  stage,
  present,
  applicable,
  failed,
  settling,
  ids,
}) {
  if (failed) {
    return artifact({
      code,
      label,
      stage,
      kind: 'core',
      state: 'not-applicable',
      reason: 'not-produced',
      explanation: `${label} was not produced because the stage failed; the failure is recorded separately.`,
      ids,
    });
  }
  if (!applicable) {
    return artifact({
      code,
      label,
      stage,
      kind: 'core',
      state: 'not-applicable',
      reason: 'skipped',
      explanation: `${label} was not required because this stage was skipped or did not apply.`,
      ids,
    });
  }
  if (present) {
    return artifact({
      code,
      label,
      stage,
      kind: 'core',
      state: 'confirmed',
      reason: 'saved',
      explanation: `${label} is saved with the conversation.`,
      ids,
    });
  }
  if (settling) {
    return artifact({
      code,
      label,
      stage,
      kind: 'core',
      state: 'pending',
      reason: 'settling',
      explanation: `${label} may still be arriving from the deferred save.`,
      ids,
    });
  }
  return artifact({
    code,
    label,
    stage,
    kind: 'core',
    state: 'missing',
    reason: 'produced-not-saved',
    explanation: `${label} was expected from a completed stage but is not saved with the conversation.`,
    ids,
  });
}

function runArtifact({ phase, label, expected, skipped, run, settling }) {
  if (!expected || skipped) {
    return artifact({
      code: `${phase === 'known-issue-search' ? 'INV' : phase === 'parse-template' ? 'PARSER' : phase.toUpperCase()}_RUN`,
      label,
      stage: phase,
      kind: 'core',
      state: 'not-applicable',
      reason: 'skipped',
      explanation: `${label} was not required because this stage was skipped or did not apply.`,
      ids: {},
    });
  }
  if (run) {
    return artifact({
      code: `${phase === 'known-issue-search' ? 'INV' : phase === 'parse-template' ? 'PARSER' : phase.toUpperCase()}_RUN`,
      label,
      stage: phase,
      kind: 'core',
      state: 'confirmed',
      reason: 'saved',
      explanation: run.status === 'failed'
        ? `${label} honestly records that the stage failed.`
        : `${label} is saved with the conversation.`,
      ids: { runId: run.id, traceId: run.traceId },
    });
  }
  if (settling) {
    return artifact({
      code: `${phase === 'known-issue-search' ? 'INV' : phase === 'parse-template' ? 'PARSER' : phase.toUpperCase()}_RUN`,
      label,
      stage: phase,
      kind: 'core',
      state: 'pending',
      reason: 'settling',
      explanation: `${label} may still be arriving from the deferred save.`,
      ids: {},
    });
  }
  return artifact({
    code: `${phase === 'known-issue-search' ? 'INV' : phase === 'parse-template' ? 'PARSER' : phase.toUpperCase()}_RUN`,
    label,
    stage: phase,
    kind: 'core',
    state: 'missing',
    reason: 'produced-not-saved',
    explanation: `${label} was expected but is not saved with the conversation.`,
    ids: {},
  });
}

function providerPackageArtifact({
  code,
  label,
  stage,
  expected,
  failed,
  passive,
  receipt,
  packageId,
  run,
  settling,
  evidence,
  conversation,
  nowMs,
}) {
  if (!expected) {
    return artifact({
      code,
      label,
      stage,
      kind: 'supporting',
      state: 'not-applicable',
      reason: 'skipped',
      explanation: `${label} was not required because this stage was skipped or did not apply.`,
      ids: {},
    });
  }
  if (receipt?.packageCaptureEnabled === false) {
    return artifact({
      code,
      label,
      stage,
      kind: 'supporting',
      state: 'unverifiable',
      reason: 'capture-disabled',
      explanation: `${label} cannot be verified because provider-call capture was disabled for this run.`,
      ids: {},
    });
  }
  if (receipt?.providerPackageSaveOk === false) {
    return artifact({
      code,
      label,
      stage,
      kind: 'supporting',
      state: passive ? 'unverifiable' : 'missing',
      reason: 'produced-not-saved',
      explanation: passive
        ? `${label} used passive capture without reliable Phase 1 linkage; its reported save failure does not make core session evidence incomplete.`
        : `${label} was produced, but its save failure was recorded.`,
      ids: {},
    });
  }
  if (packageId) {
    const expired = isLikelyExpired({
      receipt,
      run,
      evidence,
      conversation,
      nowMs,
      ttlMs: PROVIDER_PACKAGE_TTL_MS,
    });
    return artifact({
      code,
      label,
      stage,
      kind: 'supporting',
      state: expired ? 'unverifiable' : 'confirmed',
      reason: expired ? 'evidence-expired-likely' : 'saved',
      explanation: expired
        ? `${label} was saved, but its 30-day retention window has likely passed. The original work does not need to be repeated.`
        : `${label} has a saved package identifier.`,
      ids: { providerPackageId: packageId },
    });
  }
  if (settling) {
    return artifact({
      code,
      label,
      stage,
      kind: 'supporting',
      state: 'pending',
      reason: 'settling',
      explanation: `${label} may still be arriving from the deferred stage save.`,
      ids: {},
    });
  }
  if (failed) {
    return artifact({
      code,
      label,
      stage,
      kind: 'supporting',
      state: 'not-applicable',
      reason: 'not-produced',
      explanation: `${label} was not produced, and the stage failure is recorded in its run evidence.`,
      ids: {},
    });
  }
  return artifact({
    code,
    label,
    stage,
    kind: 'supporting',
    state: 'unverifiable',
    reason: 'capture-unsupported',
    explanation: passive
      ? `${label} may have been captured, but Phase 1 has no reliable package identifier linking it to this stage.`
      : `${label} cannot be verified because this run did not report a readable package identifier.`,
    ids: {},
  });
}

function reasoningArtifact({ code, label, stage, expected, failed, provider, captured, settling }) {
  if (!expected) {
    return artifact({
      code,
      label,
      stage,
      kind: 'supporting',
      state: 'not-applicable',
      reason: 'skipped',
      explanation: `${label} was not required because this stage was skipped or did not apply.`,
      ids: {},
    });
  }
  const capability = getProviderReasoningCapability(provider);
  if (capability === false) {
    return artifact({
      code,
      label,
      stage,
      kind: 'supporting',
      state: 'unverifiable',
      reason: 'capture-unsupported',
      explanation: `${label} cannot be captured by the provider or transport used for this stage.`,
      ids: {},
    });
  }
  if (captured) {
    return artifact({
      code,
      label,
      stage,
      kind: 'supporting',
      state: 'confirmed',
      reason: 'saved',
      explanation: `${label} is readable from the saved session evidence.`,
      ids: {},
    });
  }
  if (settling) {
    return artifact({
      code,
      label,
      stage,
      kind: 'supporting',
      state: 'pending',
      reason: 'settling',
      explanation: `${label} may still be arriving from the deferred stage save.`,
      ids: {},
    });
  }
  if (failed) {
    return artifact({
      code,
      label,
      stage,
      kind: 'supporting',
      state: 'not-applicable',
      reason: 'not-produced',
      explanation: `${label} was not produced because the stage failed.`,
      ids: {},
    });
  }
  return artifact({
    code,
    label,
    stage,
    kind: 'supporting',
    state: 'unverifiable',
    reason: capability === null ? 'legacy-unknowable' : 'not-produced',
    explanation: capability === null
      ? `${label} cannot be verified because the provider capability is unknown.`
      : `${label} was not returned in a readable form; this does not mean the stage output is missing.`,
    ids: {},
  });
}

function buildIdentifiers({ conversation, receipts, runs, traces, imageParseResult, triageResult }) {
  const traceIds = uniqueStrings([
    receipts.analyst?.traceId,
    ...runs.map((run) => run?.traceId),
    ...traces.map((trace) => trace?._id || trace?.id),
  ]);
  const requestIds = uniqueStrings([
    receipts.analyst?.requestId,
    ...traces.map((trace) => trace?.requestId),
    ...(Array.isArray(conversation.messages)
      ? conversation.messages.map((message) => message?.traceRequestId)
      : []),
  ]);
  const packageIds = uniqueStrings([
    receipts.parser?.providerPackageId,
    receipts.inv?.providerPackageId,
    receipts.triage?.providerPackageId,
    receipts.triage?.repairPackageId,
    receipts.analyst?.providerPackageId,
    triageResult?.providerPackageId,
    ...runs.map((run) => run?.detail?.providerPackageId),
  ]);
  const parseResultId = safeString(
    receipts.parser?.resultId || imageParseResult?._id || imageParseResult?.id,
    ''
  );
  const triageResultId = safeString(
    receipts.triage?.savedResultId || triageResult?._id || triageResult?.id,
    ''
  );
  const triageRunId = safeString(
    receipts.triage?.standaloneRunId || triageResult?.runId,
    ''
  );
  return compactIds({
    conversationId: safeString(conversation._id || conversation.id, ''),
    traceIds,
    requestIds,
    packageIds,
    triageRunId,
    parseResultId,
    triageResultId,
  });
}

function buildLegacyResult(conversation, now) {
  const identifiers = compactIds({
    conversationId: safeString(conversation?._id || conversation?.id, ''),
  });
  const legacyArtifact = artifact({
    code: 'EVIDENCE_RECEIPTS',
    label: 'Evidence receipts',
    stage: 'pipeline',
    kind: 'supporting',
    state: 'unverifiable',
    reason: 'legacy-unknowable',
    explanation: 'This session predates evidence receipts, so its completeness cannot be judged reliably. It is not marked incomplete.',
    ids: {},
  });
  return {
    status: 'unknown',
    settled: false,
    checkedAt: now.toISOString(),
    contractVersion: EVIDENCE_CONTRACT_VERSION,
    stages: [],
    artifacts: [legacyArtifact],
    missing: [],
    summary: {
      headline: 'Evidence completeness is unknown for this older session.',
      savedCount: 0,
      expectedCount: 0,
      trusted: [],
      atRisk: [],
      unverifiable: [legacyArtifact.label],
      noRepeatNeeded: [legacyArtifact.label],
      nextStep: 'No action is required now. Repeat work only if the original answer itself needs review.',
    },
    identifiers,
  };
}

function evaluateEvidenceCompleteness({
  conversation: rawConversation,
  triageResult: rawTriageResult,
  imageParseResult: rawImageParseResult,
  traces: rawTraces,
  now: rawNow,
} = {}) {
  const now = normalizeNow(rawNow);
  const nowMs = now.getTime();
  const conversation = toPlain(rawConversation) || {};
  const intake = toPlain(conversation.caseIntake) || {};
  const evidence = toPlain(intake.evidence) || {};
  const receipts = isObject(evidence.receipts) ? evidence.receipts : null;
  if (!receipts || Object.keys(receipts).length === 0) {
    return buildLegacyResult(conversation, now);
  }

  const runs = Array.isArray(intake.runs) ? intake.runs.map(toPlain) : [];
  const tracesProvided = rawTraces !== undefined;
  const traces = Array.isArray(rawTraces) ? rawTraces.map(toPlain) : [];
  const imageParseResultProvided = rawImageParseResult !== undefined;
  const imageParseResult = toPlain(rawImageParseResult) || null;
  const triageResultProvided = rawTriageResult !== undefined;
  const triageResult = toPlain(rawTriageResult) || null;

  const runByPhase = Object.fromEntries(PHASES.map((phase) => [phase, findRun(runs, phase)]));
  const receiptByPhase = {
    'parse-template': receipts.parser || null,
    'known-issue-search': receipts.inv || null,
    triage: receipts.triage || null,
    analyst: receipts.analyst || null,
  };
  const conversationShowsPhase = {
    'parse-template': Boolean(
      runByPhase['parse-template']
      || safeString(intake.canonicalTemplate, '').trim()
      || hasObjectContent(intake.parseFields)
    ),
    'known-issue-search': Boolean(
      runByPhase['known-issue-search']
      || hasObjectContent(intake.knownIssueSearchResult)
    ),
    triage: Boolean(runByPhase.triage || hasObjectContent(intake.triageCard)),
    analyst: Boolean(
      runByPhase.analyst
      || (Array.isArray(conversation.messages) && conversation.messages.some((message) => message?.role === 'assistant'))
    ),
  };
  const unreceiptedOccurredPhases = PHASES.filter(
    (phase) => !receiptByPhase[phase] && conversationShowsPhase[phase]
  );

  const skippedByPhase = Object.fromEntries(
    PHASES.map((phase) => [phase, receiptWasSkipped(phase, receiptByPhase[phase])])
  );
  const expectedByPhase = {
    'parse-template': Boolean(receipts.parser || runByPhase['parse-template'] || intake.canonicalTemplate || intake.parseFields),
    'known-issue-search': !skippedByPhase['known-issue-search'] && Boolean(
      receipts.inv || runByPhase['known-issue-search'] || intake.knownIssueSearchResult
    ),
    triage: !skippedByPhase.triage && Boolean(
      receipts.triage?.planned === true
      || receipts.triage?.attempted === true
      || runByPhase.triage
      || intake.triageCard
    ),
    analyst: !skippedByPhase.analyst && Boolean(receipts.analyst || runByPhase.analyst),
  };
  const attemptedByPhase = {
    'parse-template': Boolean(
      runByPhase['parse-template']
      || (receipts.parser && receipts.parser.attempted !== false)
    ),
    'known-issue-search': !skippedByPhase['known-issue-search'] && Boolean(
      runByPhase['known-issue-search']
      || receipts.inv?.attempted === true
      || intake.knownIssueSearchResult
    ),
    triage: !skippedByPhase.triage && Boolean(
      runByPhase.triage
      || receipts.triage?.attempted === true
      || receipts.triage?.planned === true
      || intake.triageCard
    ),
    analyst: !skippedByPhase.analyst && Boolean(
      runByPhase.analyst
      || (receipts.analyst && receipts.analyst.attempted !== false)
    ),
  };

  const analystRun = runByPhase.analyst;
  const analystCompletedAt = toTimestamp(
    receipts.analyst?.completedAt || analystRun?.completedAt || (intake.status === 'analyst-complete' || intake.status === 'failed' ? intake.updatedAt : null)
  );
  const triageSaveFailureReported = receipts.triage?.saveFailureReported === true
    || receipts.triage?.resultSaveOk === false;
  const finalIntakeStatus = intake.status === 'analyst-complete' || intake.status === 'failed';
  const triageSettled = skippedByPhase.triage
    || Boolean(runByPhase.triage)
    || triageSaveFailureReported
    || (analystCompletedAt !== null && nowMs - analystCompletedAt > SETTLING_WINDOW_MS);
  const settled = finalIntakeStatus && triageSettled;

  const stages = PHASES.map((phase) => {
    const receipt = receiptByPhase[phase];
    const run = runByPhase[phase];
    let status = 'not-applicable';
    if (skippedByPhase[phase]) status = 'skipped';
    else if (run?.status) status = run.status;
    else if (receiptFailed(receipt)) status = 'failed';
    else if (receiptCompleted(receipt)) status = 'completed';
    else if (expectedByPhase[phase] && attemptedByPhase[phase]) status = settled ? 'missing' : 'pending';
    else if (expectedByPhase[phase]) status = 'pending';
    return {
      phase,
      expected: expectedByPhase[phase],
      attempted: attemptedByPhase[phase],
      status,
      ...(skippedByPhase[phase]
        ? { skipReason: safeString(receipt?.skipReason, 'Stage was deliberately skipped.') }
        : {}),
    };
  });

  const parserReceipt = receipts.parser || {};
  const invReceipt = receipts.inv || {};
  const triageReceipt = receipts.triage || {};
  const analystReceipt = receipts.analyst || {};
  const parserRun = runByPhase['parse-template'];
  const invRun = runByPhase['known-issue-search'];
  const triageRun = runByPhase.triage;

  const parserFailed = parserRun?.status === 'failed' || receiptFailed(parserReceipt);
  const invFailed = invRun?.status === 'failed' || receiptFailed(invReceipt);
  const triageFailed = triageRun?.status === 'failed' || receiptFailed(triageReceipt);
  const analystFailed = analystRun?.status === 'failed' || receiptFailed(analystReceipt) || intake.status === 'failed';
  const parserProduced = !parserFailed && Boolean(
    parserReceipt.contentProduced === true
    || parserRun?.status === 'completed'
    || safeString(intake.canonicalTemplate, '').trim()
    || hasObjectContent(intake.parseFields)
  );

  const canonicalPresent = hasOwn(intake, 'canonicalTemplate')
    ? Boolean(safeString(intake.canonicalTemplate, '').trim())
    : parserReceipt.canonicalTemplateSaved === true;
  const parseFieldsPresent = hasOwn(intake, 'parseFields')
    ? hasObjectContent(intake.parseFields)
    : parserReceipt.parsedFieldsSaved === true;
  const invResultPresent = hasOwn(intake, 'knownIssueSearchResult')
    ? hasObjectContent(intake.knownIssueSearchResult)
    : invReceipt.resultSaved === true;
  const triageCardPresent = hasOwn(intake, 'triageCard')
    ? hasObjectContent(intake.triageCard)
    : triageReceipt.cardSaved === true;

  const messagesAvailable = Array.isArray(conversation.messages);
  const assistantMessage = messagesAvailable
    ? conversation.messages.find((message) => {
        if (message?.role !== 'assistant') return false;
        const requestId = safeString(analystReceipt.requestId, '');
        return !requestId || safeString(message.traceRequestId, '') === requestId;
      }) || null
    : null;
  const analystMessagePresent = messagesAvailable
    ? Boolean(assistantMessage)
    : analystReceipt.messageSaved === true;

  const artifacts = [];
  artifacts.push(outputArtifact({
    code: 'PARSED_FIELDS',
    label: 'Parsed case fields',
    stage: 'parse-template',
    present: parseFieldsPresent,
    applicable: parserProduced,
    failed: parserFailed,
    settling: false,
    ids: { parseResultId: parserReceipt.resultId },
  }));
  artifacts.push(outputArtifact({
    code: 'CANONICAL_TEMPLATE',
    label: 'Canonical escalation template',
    stage: 'parse-template',
    present: canonicalPresent,
    applicable: parserProduced,
    failed: parserFailed,
    settling: false,
    ids: { parseResultId: parserReceipt.resultId },
  }));
  artifacts.push(outputArtifact({
    code: 'INV_SEARCH_RESULT',
    label: 'Known-issue search result',
    stage: 'known-issue-search',
    present: invResultPresent,
    applicable: expectedByPhase['known-issue-search'] && attemptedByPhase['known-issue-search'],
    failed: invFailed,
    settling: false,
    ids: {},
  }));
  artifacts.push(outputArtifact({
    code: 'TRIAGE_CARD',
    label: 'Triage card in the conversation',
    stage: 'triage',
    present: triageCardPresent,
    applicable: expectedByPhase.triage && attemptedByPhase.triage,
    failed: triageFailed,
    settling: !settled && expectedByPhase.triage,
    ids: { triageResultId: triageReceipt.savedResultId, triageRunId: triageReceipt.standaloneRunId },
  }));
  artifacts.push(outputArtifact({
    code: 'ANALYST_MESSAGE',
    label: 'Analyst answer in the conversation',
    stage: 'analyst',
    present: analystMessagePresent,
    applicable: expectedByPhase.analyst && attemptedByPhase.analyst,
    failed: analystFailed,
    settling: !finalIntakeStatus,
    ids: { traceId: analystReceipt.traceId, requestId: analystReceipt.requestId },
  }));

  const runLabels = {
    'parse-template': 'Parser run record',
    'known-issue-search': 'Known-issue search run record',
    triage: 'Triage run record',
    analyst: 'Analyst run record',
  };
  for (const phase of PHASES) {
    artifacts.push(runArtifact({
      phase,
      label: runLabels[phase],
      expected: expectedByPhase[phase] && attemptedByPhase[phase],
      skipped: skippedByPhase[phase],
      run: runByPhase[phase],
      settling: !settled && (phase === 'triage' || phase === 'analyst'),
    }));
  }

  const parserHistoryExpected = parserProduced;
  if (!parserHistoryExpected) {
    artifacts.push(artifact({
      code: 'IMAGE_PARSE_RESULT',
      label: 'Parser history record',
      stage: 'parse-template',
      kind: 'supporting',
      state: 'not-applicable',
      reason: parserFailed ? 'not-produced' : 'skipped',
      explanation: parserFailed
        ? 'No parser history output was required from the failed parser stage.'
        : 'No parser history record was required because parsing did not apply.',
      ids: {},
    }));
  } else if (parserReceipt.historySaveOk === false) {
    artifacts.push(artifact({
      code: 'IMAGE_PARSE_RESULT',
      label: 'Parser history record',
      stage: 'parse-template',
      kind: 'supporting',
      state: 'missing',
      reason: 'produced-not-saved',
      explanation: 'The parser produced escalation content, but its history save was reported as failed.',
      ids: { parseResultId: parserReceipt.resultId },
    }));
  } else if (imageParseResult) {
    artifacts.push(artifact({
      code: 'IMAGE_PARSE_RESULT',
      label: 'Parser history record',
      stage: 'parse-template',
      kind: 'supporting',
      state: 'confirmed',
      reason: 'saved',
      explanation: 'The parser history record is readable.',
      ids: { parseResultId: imageParseResult._id || imageParseResult.id || parserReceipt.resultId },
    }));
  } else if (parserReceipt.historySaveOk === true && parserReceipt.resultId) {
    const expired = imageParseResultProvided && isLikelyExpired({
      receipt: parserReceipt,
      run: parserRun,
      evidence,
      conversation,
      nowMs,
      ttlMs: IMAGE_PARSE_TTL_MS,
    });
    artifacts.push(artifact({
      code: 'IMAGE_PARSE_RESULT',
      label: 'Parser history record',
      stage: 'parse-template',
      kind: 'supporting',
      state: 'unverifiable',
      reason: expired ? 'evidence-expired-likely' : 'client-reported',
      explanation: expired
        ? 'The parser history record was saved, but its 90-day retention window has likely passed. The parse does not need to be repeated.'
        : 'The parser history save was reported by the workflow, not independently confirmed because the record is not readable.',
      ids: { parseResultId: parserReceipt.resultId },
    }));
  } else {
    artifacts.push(artifact({
      code: 'IMAGE_PARSE_RESULT',
      label: 'Parser history record',
      stage: 'parse-template',
      kind: 'supporting',
      state: 'unverifiable',
      reason: 'legacy-unknowable',
      explanation: 'The parser receipt does not prove whether a separate history record was saved.',
      ids: {},
    }));
  }

  if (!expectedByPhase.triage || skippedByPhase.triage) {
    artifacts.push(artifact({
      code: 'TRIAGE_RESULT',
      label: 'Triage history record',
      stage: 'triage',
      kind: 'supporting',
      state: 'not-applicable',
      reason: 'skipped',
      explanation: 'No triage history record was required because triage was deliberately skipped.',
      ids: {},
    }));
  } else if (!settled && !triageRun) {
    artifacts.push(artifact({
      code: 'TRIAGE_RESULT',
      label: 'Triage history record',
      stage: 'triage',
      kind: 'supporting',
      state: 'pending',
      reason: 'settling',
      explanation: 'The separate triage history record may still be arriving.',
      ids: {},
    }));
  } else if (triageSaveFailureReported) {
    artifacts.push(artifact({
      code: 'TRIAGE_RESULT',
      label: 'Triage history record',
      stage: 'triage',
      kind: 'supporting',
      state: 'missing',
      reason: 'produced-not-saved',
      explanation: 'Triage completed, but its separate history save was reported as failed.',
      ids: { triageRunId: triageReceipt.standaloneRunId },
    }));
  } else if (triageResult) {
    artifacts.push(artifact({
      code: 'TRIAGE_RESULT',
      label: 'Triage history record',
      stage: 'triage',
      kind: 'supporting',
      state: 'confirmed',
      reason: 'saved',
      explanation: 'The triage history record is readable.',
      ids: {
        triageResultId: triageResult._id || triageResult.id || triageReceipt.savedResultId,
        triageRunId: triageResult.runId || triageReceipt.standaloneRunId,
      },
    }));
  } else if (triageReceipt.savedResultId || triageReceipt.standaloneRunId) {
    const triageSaveProven = triageReceipt.resultSaveOk === true || Boolean(triageReceipt.savedResultId);
    const expired = triageResultProvided && triageSaveProven && isLikelyExpired({
      receipt: triageReceipt,
      run: triageRun,
      evidence,
      conversation,
      nowMs,
      ttlMs: TRIAGE_RESULT_TTL_MS,
    });
    artifacts.push(artifact({
      code: 'TRIAGE_RESULT',
      label: 'Triage history record',
      stage: 'triage',
      kind: 'supporting',
      state: !triageResultProvided && triageSaveProven ? 'confirmed' : 'unverifiable',
      reason: expired ? 'evidence-expired-likely' : triageSaveProven ? 'saved' : 'legacy-unknowable',
      explanation: expired
        ? 'The triage history record was saved, but its 30-day retention window has likely passed. Triage does not need to be repeated.'
        : triageResultProvided && triageSaveProven
          ? 'The triage history identifier was saved, but the record is not currently readable.'
          : triageResultProvided
            ? 'The standalone triage run identifier does not prove whether a separate history record was saved.'
            : triageSaveProven
              ? 'The triage receipt confirms a saved history identifier.'
              : 'The standalone triage run identifier can be used for lookup but does not prove a history save.',
      ids: { triageResultId: triageReceipt.savedResultId, triageRunId: triageReceipt.standaloneRunId },
    }));
  } else {
    artifacts.push(artifact({
      code: 'TRIAGE_RESULT',
      label: 'Triage history record',
      stage: 'triage',
      kind: 'supporting',
      state: 'unverifiable',
      reason: 'legacy-unknowable',
      explanation: 'The triage receipt does not prove whether a separate history record was saved.',
      ids: {},
    }));
  }

  const parserPackageId = safeString(parserReceipt.providerPackageId, '');
  const invPackageId = safeString(invReceipt.providerPackageId, '');
  const triagePackageId = safeString(
    triageReceipt.providerPackageId || triageRun?.detail?.providerPackageId || triageResult?.providerPackageId,
    ''
  );
  const analystPackageId = safeString(analystReceipt.providerPackageId, '');
  artifacts.push(providerPackageArtifact({
    code: 'PARSER_PROVIDER_PACKAGE',
    label: 'Parser provider-call package',
    stage: 'parse-template',
    expected: parserProduced && attemptedByPhase['parse-template'],
    failed: parserFailed,
    passive: false,
    receipt: parserReceipt,
    packageId: parserPackageId,
    run: parserRun,
    settling: false,
    evidence,
    conversation,
    nowMs,
  }));
  artifacts.push(providerPackageArtifact({
    code: 'INV_PROVIDER_PACKAGE',
    label: 'Known-issue search provider-call package',
    stage: 'known-issue-search',
    expected: expectedByPhase['known-issue-search'] && attemptedByPhase['known-issue-search'],
    failed: invFailed,
    passive: true,
    receipt: invReceipt,
    packageId: invPackageId,
    run: invRun,
    settling: false,
    evidence,
    conversation,
    nowMs,
  }));
  artifacts.push(providerPackageArtifact({
    code: 'TRIAGE_PROVIDER_PACKAGE',
    label: 'Triage provider-call package',
    stage: 'triage',
    expected: expectedByPhase.triage && attemptedByPhase.triage,
    failed: triageFailed,
    passive: false,
    receipt: triageReceipt,
    packageId: triagePackageId,
    run: triageRun,
    settling: !settled && !triageRun,
    evidence,
    conversation,
    nowMs,
  }));
  artifacts.push(providerPackageArtifact({
    code: 'ANALYST_PROVIDER_PACKAGE',
    label: 'Analyst provider-call package',
    stage: 'analyst',
    expected: expectedByPhase.analyst && attemptedByPhase.analyst,
    failed: analystFailed,
    passive: true,
    receipt: analystReceipt,
    packageId: analystPackageId,
    run: analystRun,
    settling: !finalIntakeStatus,
    evidence,
    conversation,
    nowMs,
  }));
  if (triageReceipt.repairPackageId) {
    artifacts.push(providerPackageArtifact({
      code: 'TRIAGE_REPAIR_PACKAGE',
      label: 'Triage repair provider-call package',
      stage: 'triage',
      expected: true,
      failed: false,
      passive: false,
      receipt: triageReceipt,
      packageId: triageReceipt.repairPackageId,
      run: triageRun,
      settling: !settled && !triageRun,
      evidence,
      conversation,
      nowMs,
    }));
  }

  if (!expectedByPhase.analyst) {
    artifacts.push(artifact({
      code: 'AI_TRACE',
      label: 'AI request trace',
      stage: 'analyst',
      kind: 'supporting',
      state: 'not-applicable',
      reason: 'skipped',
      explanation: 'No AI request trace was required because the analyst stage did not apply.',
      ids: {},
    }));
  } else if (analystReceipt.traceSaveOk === false) {
    artifacts.push(artifact({
      code: 'AI_TRACE',
      label: 'AI request trace',
      stage: 'analyst',
      kind: 'supporting',
      state: 'missing',
      reason: 'produced-not-saved',
      explanation: 'The AI request trace save was reported as failed.',
      ids: { traceId: analystReceipt.traceId, requestId: analystReceipt.requestId },
    }));
  } else if (traces.length > 0) {
    artifacts.push(artifact({
      code: 'AI_TRACE',
      label: 'AI request trace',
      stage: 'analyst',
      kind: 'supporting',
      state: 'confirmed',
      reason: 'saved',
      explanation: 'At least one AI request trace is readable for this conversation.',
      ids: {
        traceIds: uniqueStrings(traces.map((trace) => trace?._id || trace?.id)),
        requestIds: uniqueStrings(traces.map((trace) => trace?.requestId)),
      },
    }));
  } else if (!tracesProvided && analystReceipt.traceId) {
    artifacts.push(artifact({
      code: 'AI_TRACE',
      label: 'AI request trace',
      stage: 'analyst',
      kind: 'supporting',
      state: 'confirmed',
      reason: 'saved',
      explanation: 'The analyst receipt records a saved AI request trace identifier.',
      ids: { traceId: analystReceipt.traceId, requestId: analystReceipt.requestId },
    }));
  } else {
    artifacts.push(artifact({
      code: 'AI_TRACE',
      label: 'AI request trace',
      stage: 'analyst',
      kind: 'supporting',
      state: 'unverifiable',
      reason: analystReceipt.traceId ? 'saved' : 'not-produced',
      explanation: analystReceipt.traceId
        ? 'The AI request trace identifier was saved, but the trace is not currently readable.'
        : 'No trace identifier was recorded, so the AI request trace cannot be verified.',
      ids: { traceId: analystReceipt.traceId, requestId: analystReceipt.requestId },
    }));
  }

  const analystThinking = messagesAvailable
    ? Boolean(safeString(assistantMessage?.thinking, '').trim())
    : analystReceipt.thinkingCaptured === true;
  const reasoningSpecs = [
    {
      code: 'PARSER_REASONING',
      label: 'Readable parser reasoning',
      phase: 'parse-template',
      run: parserRun,
      receipt: parserReceipt,
      captured: runHasReasoning(parserRun),
      failed: parserFailed,
    },
    {
      code: 'INV_REASONING',
      label: 'Readable known-issue search reasoning',
      phase: 'known-issue-search',
      run: invRun,
      receipt: invReceipt,
      captured: runHasReasoning(invRun),
      failed: invFailed,
    },
    {
      code: 'TRIAGE_REASONING',
      label: 'Readable triage reasoning',
      phase: 'triage',
      run: triageRun,
      receipt: triageReceipt,
      captured: runHasReasoning(triageRun),
      failed: triageFailed,
    },
    {
      code: 'ANALYST_REASONING',
      label: 'Readable analyst reasoning',
      phase: 'analyst',
      run: analystRun,
      receipt: analystReceipt,
      captured: analystThinking || runHasReasoning(analystRun),
      failed: analystFailed,
    },
  ];
  for (const spec of reasoningSpecs) {
    artifacts.push(reasoningArtifact({
      code: spec.code,
      label: spec.label,
      stage: spec.phase,
      expected: expectedByPhase[spec.phase] && attemptedByPhase[spec.phase],
      failed: spec.failed,
      provider: safeString(spec.run?.provider || spec.receipt?.provider, ''),
      captured: spec.captured,
      settling: spec.phase === 'triage' && !settled && !triageRun,
    }));
  }

  const unreceiptedOccurredSet = new Set(unreceiptedOccurredPhases);
  const evaluatedArtifacts = artifacts.map((item) => {
    if (!unreceiptedOccurredSet.has(item.stage)) return item;
    return {
      ...item,
      state: 'unverifiable',
      reason: 'legacy-unknowable',
      explanation: 'This stage occurred, but it has no evidence receipt, so its saved artifacts cannot be judged reliably.',
    };
  });
  const missing = evaluatedArtifacts.filter((item) => item.state === 'missing');
  const status = !settled
    ? 'unknown'
    : missing.length > 0
      ? 'incomplete'
      : unreceiptedOccurredPhases.length > 0
        ? 'unknown'
        : 'complete';
  const expectedArtifacts = evaluatedArtifacts.filter((item) => item.state !== 'not-applicable');
  const trusted = evaluatedArtifacts.filter((item) => item.state === 'confirmed').map((item) => item.label);
  const atRisk = evaluatedArtifacts
    .filter((item) => item.state === 'missing' || item.state === 'pending')
    .map((item) => item.label);
  const unverifiable = evaluatedArtifacts.filter((item) => item.state === 'unverifiable').map((item) => item.label);
  const noRepeatNeeded = evaluatedArtifacts
    .filter((item) => item.state === 'confirmed' || item.state === 'not-applicable' || item.state === 'unverifiable')
    .map((item) => item.label);

  let headline = 'Required session evidence is saved.';
  let nextStep = 'No repeat is needed.';
  if (!settled) {
    headline = 'Evidence is still settling, so completeness is not known yet.';
    nextStep = 'Wait for the deferred triage save, then refresh the evidence check.';
  } else if (missing.length > 0) {
    headline = `${missing.length} expected evidence item${missing.length === 1 ? ' is' : 's are'} not saved.`;
    nextStep = 'Review the at-risk items. Repeat only the affected stage if its evidence cannot be recovered.';
  } else if (status === 'unknown') {
    headline = 'Some completed stages predate their evidence receipts, so completeness is unknown.';
    nextStep = 'No repeat is needed unless the underlying answer itself needs review.';
  } else if (unverifiable.length > 0) {
    headline = 'Required session evidence is saved; some supporting evidence cannot be verified.';
    nextStep = 'No repeat is needed unless the underlying answer itself needs review.';
  }

  return {
    status,
    settled,
    checkedAt: now.toISOString(),
    contractVersion: EVIDENCE_CONTRACT_VERSION,
    stages,
    artifacts: evaluatedArtifacts,
    missing,
    summary: {
      headline,
      savedCount: trusted.length,
      expectedCount: expectedArtifacts.length,
      trusted,
      atRisk,
      unverifiable,
      noRepeatNeeded,
      nextStep,
    },
    identifiers: buildIdentifiers({
      conversation,
      receipts,
      runs,
      traces,
      imageParseResult,
      triageResult,
    }),
  };
}

function evaluateEvidenceStatusFromConversation(conversation, now) {
  return evaluateEvidenceCompleteness({ conversation, now }).status;
}

module.exports = {
  EVIDENCE_CONTRACT_VERSION,
  evaluateEvidenceCompleteness,
  evaluateEvidenceStatusFromConversation,
};
