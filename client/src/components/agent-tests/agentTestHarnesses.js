import { apiFetch, apiFetchJson } from '../../api/http.js';
import { recordAgentHarnessRun } from '../../api/agentIdentitiesApi.js';
import { runKnowledgeAgentHarness } from '../../api/knowledgeApi.js';
import { consumeSSEStream } from '../../api/sse.js';
import {
  buildPipelineRuntimePayload,
  readPipelineProfileRuntimeStates,
} from '../chat-v5/pipelineRuntime.js';

function cleanText(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function rawText(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function normalizeHarnessError(error, fallback = 'Agent test failed.') {
  if (!error) return { message: fallback };
  if (error.name === 'AbortError') {
    return {
      code: 'ABORTED',
      message: 'Agent test was cancelled.',
      aborted: true,
    };
  }
  return {
    code: cleanText(error.code) || cleanText(error.name) || 'TEST_FAILED',
    message: cleanText(error.message || error.error) || fallback,
    status: Number.isInteger(error.status) ? error.status : undefined,
    detail: cleanText(error.detail),
  };
}

function parserResultId(result) {
  return cleanText(result?.savedTestResultId || result?.savedTestResult?.id);
}

function triageResultId(result) {
  return cleanText(result?.savedTestResultId || result?.savedTestResult?.id);
}

function stageEventMessage(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return cleanText(data?.displayMessage || data?.message || payload?.kind || payload?.event || 'Stage event');
}

function emitClientEvent(onStageEvent, kind, data = {}) {
  onStageEvent?.({
    kind,
    ts: new Date().toISOString(),
    data,
  });
}

async function readTestResponse(res, { onStageEvent, stageLabel }) {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/event-stream')) {
    let completed = null;
    let errorPayload = null;
    await consumeSSEStream(res, (eventType, payload) => {
      if (eventType === 'stage_event') {
        onStageEvent?.(payload);
      } else if (eventType === 'test_complete') {
        completed = payload;
      } else if (eventType === 'error') {
        errorPayload = payload;
      }
    });
    return completed || {
      ok: false,
      error: errorPayload?.error || errorPayload?.message || `${stageLabel} stream ended without a result.`,
      code: errorPayload?.code,
    };
  }
  return res.json().catch(() => ({ ok: false, error: res.statusText }));
}

async function runImageParserFixtureTest({
  signal,
  onStageEvent,
  fixtureName = '',
  provider = '',
  model = '',
  retest = false,
  excludeFixtureName = '',
} = {}) {
  const runtime = await readPipelineProfileRuntimeStates();
  if (signal?.aborted) {
    throw new DOMException('Agent test was cancelled.', 'AbortError');
  }

  const baseParserRuntime = runtime?.parser || runtime?.['escalation-template-parser'] || {};
  const parserRuntime = {
    ...baseParserRuntime,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
  };
  const runtimeForRun = {
    ...runtime,
    parser: parserRuntime,
  };
  emitClientEvent(onStageEvent, 'parser.client_request_started', {
    provider: parserRuntime.provider || '',
    model: parserRuntime.model || '',
    fixtureName,
    retest,
    testRun: true,
    status: 'sent',
    surfaceToUser: true,
    displayMessage: retest ? 'Parser retest request sent to server' : 'Parser test request sent to server',
  });

  const res = await apiFetch('/api/pipeline-tests/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      stage: 'parser',
      runtime: buildPipelineRuntimePayload(runtimeForRun),
      fixtureName,
      retest,
      excludeFixtureName,
    }),
    signal,
    timeout: 180_000,
    noRetry: true,
  });

  const data = await readTestResponse(res, { onStageEvent, stageLabel: 'Parser test' });

  if (!res.ok || !data?.ok) {
    throw normalizeHarnessError(data || { message: `Image Parser test failed (HTTP ${res.status})` });
  }

  const providerPackageId = cleanText(data?.providerTrace?.providerPackageId);
  if (providerPackageId) {
    emitClientEvent(onStageEvent, 'parser.provider_content_received_client', {
      provider: data.providerUsed || parserRuntime.provider || '',
      providerPackageId,
      testRun: true,
      status: 'received',
      surfaceToUser: true,
      displayMessage: `Provider package ${providerPackageId} received by client`,
    });
  }
  emitClientEvent(onStageEvent, 'parser.client_result_received', {
    provider: data.providerUsed || parserRuntime.provider || '',
    model: data.modelUsed || data.usage?.model || parserRuntime.model || '',
    providerPackageId: providerPackageId || null,
    textLength: cleanText(data.text || data.transcription).length,
    elapsedMs: data.elapsedMs ?? 0,
    testRun: true,
    status: 'complete',
    displayMessage: 'Parser test result received',
  });

  return data;
}

async function retestImageParserFixtureTest(result, options = {}) {
  const fixtureName = cleanText(result?.imageFixture?.name || result?.savedTestResult?.fixture?.name || result?.caseIntake?.parseMeta?.imageFixture?.name);
  return runImageParserFixtureTest({
    ...options,
    fixtureName,
    excludeFixtureName: '',
    provider: cleanText(result?.providerUsed || result?.savedTestResult?.provider),
    model: cleanText(result?.modelUsed || result?.usage?.model || result?.savedTestResult?.model),
    retest: true,
  });
}

async function runTriageFixtureTest({ signal, onStageEvent, request } = {}) {
  const runtime = await readPipelineProfileRuntimeStates();
  if (signal?.aborted) {
    throw new DOMException('Agent test was cancelled.', 'AbortError');
  }

  // A specific approved case can be selected from the triage test assets list.
  // When `caseId` is present we run exactly that real, operator-approved case;
  // otherwise the server picks one at random from the same real pool. The id
  // rides along on the modal request, so the modal's "New Test" button re-runs
  // the same case automatically.
  const caseId = typeof request?.caseId === 'string' ? request.caseId.trim() : '';

  const triageRuntime = runtime?.triage || runtime?.['triage-agent'] || {};
  emitClientEvent(onStageEvent, 'triage.client_request_started', {
    provider: triageRuntime.provider || '',
    model: triageRuntime.model || '',
    caseId: caseId || null,
    testRun: true,
    status: 'sent',
    surfaceToUser: true,
    displayMessage: caseId
      ? `Triage test request sent to server (case ${caseId})`
      : 'Triage test request sent to server (random approved case)',
  });

  const res = await apiFetch('/api/triage-tests/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      stage: 'triage',
      ...(caseId ? { caseId } : {}),
      runtime: buildPipelineRuntimePayload(runtime),
    }),
    signal,
    timeout: 180_000,
    noRetry: true,
  });

  const data = await readTestResponse(res, { onStageEvent, stageLabel: 'Triage test' });
  if (!res.ok || !data?.ok) {
    throw normalizeHarnessError(data || { message: `Triage Agent test failed (HTTP ${res.status})` });
  }

  emitClientEvent(onStageEvent, 'triage.client_result_received', {
    provider: data.providerUsed || triageRuntime.provider || '',
    model: data.modelUsed || triageRuntime.model || '',
    severity: data.triageCard?.severity || '',
    category: data.triageCard?.category || '',
    confidence: data.triageCard?.confidence || '',
    elapsedMs: data.elapsedMs ?? 0,
    testRun: true,
    status: 'complete',
    displayMessage: 'Triage test result received',
  });

  return data;
}

async function recordImageParserFixtureTest(result, status) {
  const resultId = parserResultId(result);
  if (!resultId) {
    throw new Error('Parser test completed but no saved test-result id was returned.');
  }
  const body = await apiFetchJson(`/api/pipeline-tests/parser-results/${encodeURIComponent(resultId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status,
      operatorNote: status === 'fail'
        ? 'Operator marked this parser test result as incorrect from the shared agent test modal.'
        : 'Operator marked this parser test result as correct from the shared agent test modal.',
    }),
    noRetry: true,
  }, 'Failed to record parser test result');
  return body?.result || null;
}

async function programmaticCheckImageParserFixtureTest(result, options = {}) {
  const resultId = parserResultId(result);
  if (!resultId) {
    throw new Error('Parser test completed but no saved test-result id was returned.');
  }
  return apiFetchJson(`/api/pipeline-tests/parser-results/${encodeURIComponent(resultId)}/programmatic-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewer: 'programmatic-check',
      manualReviewAfterCheck: Boolean(options.manualReviewAfterCheck),
      recordMode: options.manualReviewAfterCheck ? 'manual-on-fail' : 'programmatic',
    }),
    noRetry: true,
  }, 'Failed to run parser output check');
}

async function saveImageParserConfirmedOutput(result) {
  const resultId = parserResultId(result);
  if (!resultId) {
    throw new Error('Parser test completed but no saved test-result id was returned.');
  }
  return apiFetchJson(`/api/pipeline-tests/parser-results/${encodeURIComponent(resultId)}/confirmed-output`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expectedText: rawText(result?.text),
      operatorNote: 'Saved from the shared agent test modal.',
    }),
    noRetry: true,
  }, 'Failed to save confirmed parser output');
}

async function getImageParserConfirmedOutput(result) {
  const resultId = parserResultId(result);
  if (!resultId) {
    throw new Error('Parser test completed but no saved test-result id was returned.');
  }
  return apiFetchJson(
    `/api/pipeline-tests/parser-results/${encodeURIComponent(resultId)}/confirmed-output`,
    { noRetry: true },
    'Failed to load confirmed parser output'
  );
}

async function recordTriageFixtureTest(result, status) {
  const resultId = triageResultId(result);
  if (!resultId) {
    throw new Error('Triage test completed but no saved test-result id was returned.');
  }
  const body = await apiFetchJson(`/api/triage-tests/results/${encodeURIComponent(resultId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status,
      operatorNote: status === 'fail'
        ? 'Operator marked this triage test result as incorrect from the shared agent test modal.'
        : 'Operator marked this triage test result as correct from the shared agent test modal.',
    }),
    noRetry: true,
  }, 'Failed to record triage test result');
  return body?.result || null;
}

async function runKnowledgebaseAgentDraftTest({ signal, onStageEvent, request } = {}) {
  if (signal?.aborted) {
    throw new DOMException('Agent test was cancelled.', 'AbortError');
  }
  emitClientEvent(onStageEvent, 'knowledgebase.client_request_started', {
    escalationId: cleanText(request?.escalationId || request?.caseId),
    testRun: true,
    status: 'sent',
    surfaceToUser: true,
    displayMessage: 'Knowledge Base Agent draft harness request sent to server',
  });

  const data = await runKnowledgeAgentHarness({
    escalationId: cleanText(request?.escalationId || request?.caseId),
  });

  if (!data || data.ok === false) {
    throw normalizeHarnessError(data || { message: 'Knowledge Base Agent harness failed.' });
  }

  emitClientEvent(onStageEvent, 'knowledgebase.client_result_received', {
    escalationId: data.fixture?.escalationId || '',
    caseNumber: data.fixture?.caseNumber || '',
    status: data.status || '',
    testRun: true,
    displayMessage: 'Knowledge Base Agent draft harness result received',
  });
  return data;
}

async function recordKnowledgebaseAgentDraftTest(result, status) {
  return recordAgentHarnessRun('knowledgebase-agent', {
    status,
    summary: result?.summary || `Knowledge Base draft harness ${status}.`,
    completedAt: new Date().toISOString(),
    cases: (Array.isArray(result?.checks) ? result.checks : []).map((check) => ({
      id: check.id || check.label,
      title: check.label || check.id || 'Harness check',
      status: check.passed ? 'pass' : check.optional ? 'warn' : 'fail',
      expected: check.optional ? 'Optional draft field is useful when source data has it.' : 'Required draft field should be present.',
      actual: check.detail || '',
    })),
    metadata: {
      fixture: result?.fixture || null,
      draft: result?.draft || null,
      harnessStatus: result?.status || '',
    },
  });
}

function objectRows(fields = {}) {
  if (!fields || typeof fields !== 'object') return [];
  return Object.entries(fields)
    .filter(([key]) => key)
    .map(([key, value]) => ({
      key,
      label: key.replace(/([A-Z])/g, ' $1').replace(/[_-]+/g, ' ').trim(),
      value: Array.isArray(value) ? value.join(', ') : cleanText(value),
    }));
}

function parserValidationPills(result) {
  const canonical = result?.parseMeta?.canonicalTemplate || null;
  const pills = [];
  const promptVersion = cleanText(result?.promptVersion || result?.savedTestResult?.promptVersion);
  const promptId = cleanText(result?.promptId || result?.savedTestResult?.promptId);
  const promptSha = cleanText(result?.promptSha256 || result?.savedTestResult?.promptSha256);
  if (promptVersion || promptId) {
    const label = promptVersion
      ? `Prompt ${promptVersion}${promptSha ? ` · ${promptSha.slice(0, 8)}` : ''}`
      : `Prompt ${promptId}${promptSha ? ` · ${promptSha.slice(0, 8)}` : ''}`;
    pills.push({ tone: 'neutral', text: label });
  }
  if (canonical && typeof canonical === 'object') {
    if (canonical.passed === true) pills.push({ tone: 'pass', text: '9-label contract passed' });
    if (canonical.passed === false) pills.push({ tone: 'fail', text: '9-label contract failed' });
  }
  return pills;
}

function savedStatePills(result) {
  if (!result) return [];
  const resultId = parserResultId(result) || triageResultId(result);
  if (result?.saveStatus === 'saved' || resultId) {
    return [{ tone: 'neutral', text: 'Saved as pending review' }];
  }
  if (result?.saveStatus === 'not-saved') {
    return [{ tone: 'warn', text: cleanText(result.saveReason) || 'Completed without a saved result' }];
  }
  return [];
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeImageParserSavedResult(savedResult) {
  const source = isPlainObject(savedResult?.savedTestResult) ? savedResult.savedTestResult : (savedResult || {});
  const id = cleanText(source.id || source._id || savedResult?.id || savedResult?._id);
  const fixture = source.fixture || savedResult?.fixture || null;
  const elapsedMs = Number(source.elapsedMs ?? savedResult?.elapsedMs);
  const parsedText = rawText(source.parsedText ?? source.text ?? savedResult?.parsedText ?? savedResult?.text);
  return {
    ok: true,
    stage: 'parser',
    testRun: true,
    alert: 'Saved test result opened.',
    saveStatus: 'saved',
    imageFixture: fixture,
    savedTestResultId: id,
    savedTestResult: {
      ...source,
      id,
    },
    providerUsed: cleanText(source.provider || savedResult?.provider),
    modelUsed: cleanText(source.model || savedResult?.model || source.usage?.model),
    promptId: cleanText(source.promptId || savedResult?.promptId || 'escalation-template-parser'),
    promptVersion: cleanText(source.promptVersion || savedResult?.promptVersion),
    promptSha256: cleanText(source.promptSha256 || savedResult?.promptSha256),
    promptLength: Number(source.promptLength || savedResult?.promptLength || 0),
    elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : 0,
    reasoningEffort: cleanText(source.reasoningEffort || savedResult?.reasoningEffort),
    usage: source.usage || savedResult?.usage || null,
    apiCost: source.apiCost || savedResult?.apiCost || null,
    text: parsedText,
    parseFields: isPlainObject(source.parseFields) ? source.parseFields : {},
    parseMeta: source.parseMeta || savedResult?.parseMeta || null,
    providerTrace: source.providerTrace || savedResult?.providerTrace || null,
    caseIntake: {
      parseMeta: {
        imageFixture: fixture,
      },
    },
  };
}

function triageSeverityTone(severity) {
  const normalized = cleanText(severity).toUpperCase();
  if (/^P?1$/.test(normalized) || normalized === 'CRITICAL') return 'fail';
  if (/^P?2$/.test(normalized) || normalized === 'HIGH') return 'warn';
  if (/^P?3$/.test(normalized) || normalized === 'MEDIUM') return 'info';
  if (/^P?4$/.test(normalized) || normalized === 'LOW') return 'pass';
  return 'neutral';
}

function triageRows(result) {
  const card = result?.triageCard || {};
  const rows = [
    ['severity', 'Severity', card.severity],
    ['category', 'Category', card.category],
    ['confidence', 'Confidence', card.confidence],
    ['read', 'Read', card.read],
    ['action', 'Action', card.action],
    ['missingInfo', 'Missing Info', Array.isArray(card.missingInfo) ? card.missingInfo.join(', ') : ''],
  ];
  return rows
    .map(([key, label, value]) => ({ key, label, value: cleanText(value) }))
    .filter((row) => row.value);
}

// Splits the triage card into a compact metadata strip (severity / category /
// confidence as inline key-value pairs) and the long-form prose blocks (read /
// action / missing info) so the modal can render them as one tight row plus
// full-width stacked sections instead of a uniform two-column grid.
function triageResultLayout(result) {
  const card = result?.triageCard || {};
  const meta = [
    { key: 'severity', label: 'Severity', value: cleanText(card.severity), tone: triageSeverityTone(card.severity) },
    { key: 'category', label: 'Category', value: cleanText(card.category) },
    { key: 'confidence', label: 'Confidence', value: cleanText(card.confidence) },
  ].filter((field) => field.value);

  const blocks = [
    { key: 'read', label: 'Read', value: cleanText(card.read) },
    { key: 'action', label: 'Action', value: cleanText(card.action) },
    {
      key: 'missingInfo',
      label: 'Missing Info',
      value: Array.isArray(card.missingInfo)
        ? cleanText(card.missingInfo.filter(Boolean).join('\n'))
        : cleanText(card.missingInfo),
    },
  ].filter((block) => block.value);

  if (!meta.length && !blocks.length) return null;
  return { meta, blocks, status: savedStatePills(result) };
}

function knowledgebaseResultLayout(result) {
  const draft = result?.draft || {};
  const checks = Array.isArray(result?.checks) ? result.checks : [];
  const meta = [
    { key: 'status', label: 'Status', value: cleanText(result?.status), tone: result?.status === 'fail' ? 'fail' : result?.status === 'warn' ? 'warn' : 'pass' },
    { key: 'case', label: 'Case', value: cleanText(result?.fixture?.caseNumber || result?.fixture?.escalationId) },
    { key: 'category', label: 'Category', value: cleanText(result?.fixture?.category || draft.category) },
  ].filter((field) => field.value);
  const blocks = [
    { key: 'title', label: 'Title / Subject', value: cleanText(draft.title) },
    { key: 'customerGoal', label: 'Customer Goal', value: cleanText(draft.customerGoal) },
    { key: 'reportedProblem', label: 'Reported Problem', value: cleanText(draft.reportedProblem) },
    { key: 'evidenceFromCase', label: 'Evidence From Case', value: cleanText(draft.evidenceFromCase) },
    { key: 'troubleshootingTried', label: 'Troubleshooting Already Tried', value: cleanText(draft.troubleshootingTried) },
    { key: 'finalOutcome', label: 'Final Outcome', value: cleanText(draft.finalOutcome) },
    { key: 'invEscalationStatus', label: 'INV / Escalation Status', value: cleanText(draft.invEscalationStatus) },
    {
      key: 'checks',
      label: 'Harness Checks',
      value: checks.map((check) => `${check.passed ? 'PASS' : check.optional ? 'WARN' : 'FAIL'} ${check.label}`).join('\n'),
    },
  ].filter((block) => block.value);

  return { meta, blocks, status: [{ tone: result?.ok ? 'pass' : 'fail', text: result?.ok ? 'Draft contract passed' : 'Draft contract failed' }] };
}

export const AGENT_TEST_HARNESSES = Object.freeze({
  'escalation-template-parser': {
    id: 'image-parser-fixture',
    agentId: 'escalation-template-parser',
    agentLabel: 'Escalation Image Parser',
    stageKey: 'parser',
    title: 'Image Parser Test',
    description: 'Random saved image fixture parsed through the configured image parser runtime.',
    runLabel: 'Running parser fixture',
    retestLabel: 'Retesting parser with a new image',
    resultLabel: 'Parser Output',
    run: runImageParserFixtureTest,
    retestResult: retestImageParserFixtureTest,
    recordResult: recordImageParserFixtureTest,
    programmaticCheckResult: programmaticCheckImageParserFixtureTest,
    saveConfirmedOutput: saveImageParserConfirmedOutput,
    getConfirmedOutput: getImageParserConfirmedOutput,
    normalizeSavedResult: normalizeImageParserSavedResult,
    canRecordResult: (result) => Boolean(parserResultId(result)),
    canProgrammaticCheck: (result) => Boolean(parserResultId(result)),
    canSaveConfirmedOutput: (result) => Boolean(parserResultId(result) && result?.imageFixture?.name),
    canRetestResult: (result) => Boolean(result),
    savedResultId: parserResultId,
    getFixture: (result) => result?.imageFixture || result?.caseIntake?.parseMeta?.imageFixture || null,
    getValidationPills: (result) => [...parserValidationPills(result), ...savedStatePills(result)],
    getResultRows: () => [],
    getOutputText: (result) => rawText(result?.text),
    outputTextLabel: 'Parser Output',
    primaryTextOutput: true,
    emptyResultLabel: 'No parser output returned.',
    passNote: 'Record the final parser decision.',
    stageEventMessage,
  },
  'triage-agent': {
    id: 'triage-approved-case',
    agentId: 'triage-agent',
    agentLabel: 'Triage Agent',
    stageKey: 'triage',
    title: 'Triage Agent Test',
    description: 'A real, operator-approved escalation case classified through the configured triage runtime.',
    runLabel: 'Running triage case',
    resultLabel: 'Triage Output',
    run: runTriageFixtureTest,
    recordResult: recordTriageFixtureTest,
    canRecordResult: (result) => Boolean(triageResultId(result)),
    savedResultId: triageResultId,
    getFixture: (result) => result?.fixture || null,
    getValidationPills: savedStatePills,
    getResultRows: triageRows,
    getResultLayout: triageResultLayout,
    getRawText: (result) => cleanText(result?.parserText),
    rawTextLabel: 'Fixture parser text',
    emptyResultLabel: 'No triage card returned.',
    passNote: 'Record the final triage decision.',
    stageEventMessage,
  },
  'knowledgebase-agent': {
    id: 'knowledgebase-qbo-draft',
    agentId: 'knowledgebase-agent',
    agentLabel: 'Knowledge Base Agent',
    stageKey: 'knowledgebase',
    title: 'Knowledge Base Agent Draft Harness',
    description: 'A finalized QBO Canada escalation is converted into a KB review draft and checked for required draft fields.',
    runLabel: 'Running KB draft harness',
    resultLabel: 'KB Draft Output',
    run: runKnowledgebaseAgentDraftTest,
    recordResult: recordKnowledgebaseAgentDraftTest,
    canRecordResult: (result) => Boolean(result?.checks),
    savedResultId: (result) => cleanText(result?.fixture?.escalationId),
    getFixture: (result) => result?.fixture || null,
    getValidationPills: (result) => [{ tone: result?.ok ? 'pass' : 'fail', text: result?.ok ? 'Required draft fields present' : 'Required draft fields missing' }],
    getResultRows: () => [],
    getResultLayout: knowledgebaseResultLayout,
    getOutputText: (result) => JSON.stringify(result?.draft || {}, null, 2),
    outputTextLabel: 'Draft JSON',
    primaryTextOutput: false,
    emptyResultLabel: 'No KB draft returned.',
    passNote: 'Record whether this KB draft harness output is acceptable.',
    stageEventMessage,
  },
});

export function getAgentTestHarness(agentId) {
  return AGENT_TEST_HARNESSES[cleanText(agentId)] || null;
}

export function isAgentTestSupported(agentId) {
  return Boolean(getAgentTestHarness(agentId));
}

export { normalizeHarnessError };
