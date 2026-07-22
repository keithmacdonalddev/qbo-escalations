'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const mongoose = require('mongoose');

const { connect, disconnect } = require('./_mongo-helper');
const AiTrace = require('../src/models/AiTrace');
const Conversation = require('../src/models/Conversation');
const ImageParseResult = require('../src/models/ImageParseResult');
const KnowledgeCandidate = require('../src/models/KnowledgeCandidate');
const RecoveryOperation = require('../src/models/RecoveryOperation');
const TriageResult = require('../src/models/TriageResult');
const { parseEscalationText } = require('../src/lib/escalation-parser');
const { compareTriageCards } = require('../src/lib/triage-recovery-compare');
const { saveConversationLenient } = require('../src/routes/chat/shared');

const TRIAGE_PATH = require.resolve('../src/services/triage');
const AGENT_IDENTITY_PATH = require.resolve('../src/services/agent-identity-service');
const CHAT_CONVERSATION_SERVICE_PATH = require.resolve('../src/services/chat-conversation-service');
const RECOVERY_SERVICE_PATH = require.resolve('../src/services/evidence-recovery-service');
const RECOVERY_ROUTE_PATH = require.resolve('../src/routes/chat/recovery');
const CONVERSATIONS_ROUTE_PATH = require.resolve('../src/routes/chat/conversations');

const realTriageService = require(TRIAGE_PATH);
const realAgentIdentityService = require(AGENT_IDENTITY_PATH);
const realChatConversationService = require(CHAT_CONVERSATION_SERVICE_PATH);

const CANONICAL_TEMPLATE = [
  'COID/MID: 12345 / 67890',
  'CASE: CS-2026-002099',
  'CLIENT/CONTACT: Recovery Client',
  'CX IS ATTEMPTING TO: submit a payroll tax payment',
  'EXPECTED OUTCOME: the payment posts once',
  'ACTUAL OUTCOME: the payment remains pending',
  'KB/TOOLS USED: Help Panel and payroll reports',
  'TRIED TEST ACCOUNT: no',
  'TS STEPS: reproduced the pending payment and checked the audit log',
].join('\n');

const PARSE_FIELDS = parseEscalationText(CANONICAL_TEMPLATE);

const ORIGINAL_CARD = {
  agent: 'Recovery Agent',
  client: 'Recovery Client',
  severity: 'P2',
  category: 'payroll',
  confidence: 'high',
  read: 'Payroll tax payment remains pending.',
  action: 'Verify the payment status, then escalate to Payroll Support.',
  missingInfo: ['Exact tax period'],
  source: 'triage-agent',
  fallback: { used: false },
  validation: { passed: true, issues: [] },
};

const DIFFERENT_CARD = {
  ...ORIGINAL_CARD,
  severity: 'P1',
  confidence: 'medium',
  read: 'Multiple payroll tax payments may be blocked.',
  missingInfo: ['Exact tax period', 'Number of affected companies'],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function withTimeout(promise, message, timeoutMs = 4_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const providerStub = {
  calls: [],
  mode: 'success',
  card: clone(ORIGINAL_CARD),
  fallbackCalls: 0,
  repairCalls: 0,
  boundaryGate: null,
  entered: null,
  settled: null,
};

const DEFAULT_RUNTIME = {
  provider: 'lm-studio',
  model: 'recovery-test-model',
  fallbackProvider: '',
  fallbackModel: '',
  reasoningEffort: 'high',
  serviceTier: '',
};

let runtimeDefaultsStub = clone(DEFAULT_RUNTIME);
const evidenceStub = { failOnceAfterRecoveryWrite: false };

function resetProviderStub() {
  providerStub.calls = [];
  providerStub.mode = 'success';
  providerStub.card = clone(ORIGINAL_CARD);
  providerStub.fallbackCalls = 0;
  providerStub.repairCalls = 0;
  providerStub.boundaryGate = null;
  providerStub.entered = null;
  providerStub.settled = null;
  runtimeDefaultsStub = clone(DEFAULT_RUNTIME);
  evidenceStub.failOnceAfterRecoveryWrite = false;
}

function abortError() {
  const error = new Error('Recovery provider handoff was cancelled.');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

async function mockRunTriage(text, options = {}) {
  try {
    if (providerStub.boundaryGate) {
      providerStub.entered?.resolve();
      await providerStub.boundaryGate.promise;
    }
    if (options.signal?.aborted) throw abortError();

    options.eventBus?.emit('triage.agent_handoff_to_provider', {
      provider: options.provider,
      model: options.model,
    });
    providerStub.calls.push({
      kind: 'primary',
      provider: options.provider,
      model: options.model,
    });

    const parseFields = parseEscalationText(text);
    const failoverSucceeded = providerStub.mode === 'failover-success';
    const actualProvider = failoverSucceeded ? 'openai' : options.provider;
    const actualModel = failoverSucceeded ? 'gpt-5.5' : options.model;
    if (failoverSucceeded) {
      options.eventBus?.emit('triage.provider_failover', {
        from: options.provider,
        to: actualProvider,
      });
      providerStub.calls.push({ kind: 'backup', provider: actualProvider, model: actualModel });
    }
    const packageId = `recovery-package-${new mongoose.Types.ObjectId()}`;
    const recoveryOperationId = options.triageMeta?.recoveryOperationId || '';

    if (providerStub.mode === 'degraded') {
      providerStub.fallbackCalls += 1;
      const card = {
        ...clone(providerStub.card),
        source: 'rule-fallback',
        fallback: {
          used: true,
          reason: 'Stubbed provider error forced deterministic fallback.',
        },
      };
      const saved = await TriageResult.create({
        source: 'evidence-recovery',
        runId: options.runId,
        status: 'degraded',
        severity: { raw: '', validated: card.severity, displayed: card.severity },
        category: card.category,
        rawOutput: '',
        card,
        validationIssues: [{ code: 'PROVIDER_FAILED', message: 'Stubbed provider failure.' }],
        fallbackUsed: true,
        fallbackReason: card.fallback.reason,
        failureStage: 'provider-call',
        errorCode: 'PROVIDER_FAILED',
        providerPackageId: packageId,
        provider: options.provider,
        model: options.model,
        latencyMs: 5,
        triageMeta: {
          source: 'fallback',
          providerUsed: options.provider,
          model: options.model,
          providerPackageId: packageId,
          fallbackUsed: true,
          recoveryOperationId,
        },
        parserText: text,
        parseFields,
      });
      await options.onPersistResult?.({ ok: true, id: String(saved._id), error: '' });
      return {
        ok: true,
        status: 'degraded',
        card,
        rawOutput: '',
        triageMeta: {
          source: 'fallback',
          providerUsed: options.provider,
          model: options.model,
          providerPackageId: packageId,
          resultId: String(saved._id),
          recoveryOperationId,
        },
        elapsedMs: 5,
        providerUsed: options.provider,
        modelUsed: options.model,
        fallbackUsed: true,
        savedResult: { id: String(saved._id) },
      };
    }

    const card = clone(providerStub.card);
    const rawOutput = JSON.stringify(card);
    const saved = await TriageResult.create({
      source: 'evidence-recovery',
      runId: options.runId,
      status: 'success',
      severity: { raw: card.severity, validated: card.severity, displayed: card.severity },
      category: card.category,
      rawOutput,
      card,
      validationIssues: [],
      fallbackUsed: failoverSucceeded,
      providerPackageId: packageId,
      provider: actualProvider,
      model: actualModel,
      latencyMs: 5,
      triageMeta: {
        source: 'agent',
        providerUsed: actualProvider,
        model: actualModel,
        providerPackageId: packageId,
        validation: { passed: true, issues: [] },
        recoveryOperationId,
      },
      parserText: text,
      parseFields,
    });
    await options.onPersistResult?.({ ok: true, id: String(saved._id), error: '' });
    return {
      ok: true,
      status: 'success',
      card,
      rawOutput,
      triageMeta: {
        source: 'agent',
        providerUsed: actualProvider,
        model: actualModel,
        providerPackageId: packageId,
        resultId: String(saved._id),
        validation: { passed: true, issues: [] },
        recoveryOperationId,
      },
      elapsedMs: 5,
      providerUsed: actualProvider,
      modelUsed: actualModel,
      fallbackUsed: failoverSucceeded,
      fallbackFrom: failoverSucceeded ? options.provider : '',
      savedResult: { id: String(saved._id) },
    };
  } finally {
    providerStub.settled?.resolve();
  }
}

function installDependencyStubs() {
  require.cache[TRIAGE_PATH].exports = {
    ...realTriageService,
    peekPreflightCache: () => null,
    runTriage: mockRunTriage,
  };
  require.cache[AGENT_IDENTITY_PATH].exports = {
    ...realAgentIdentityService,
    listAgentRuntimeDefaults: async () => ({
      'triage-agent': {
        runtime: clone(runtimeDefaultsStub),
      },
    }),
  };
  require.cache[CHAT_CONVERSATION_SERVICE_PATH].exports = {
    ...realChatConversationService,
    async getConversationEvidence(conversationId) {
      if (evidenceStub.failOnceAfterRecoveryWrite) {
        const appliedReceipt = await Conversation.exists({
          _id: conversationId,
          'caseIntake.evidence.receipts.triage.recoveryOperationId': { $exists: true, $ne: '' },
        });
        if (appliedReceipt) {
          evidenceStub.failOnceAfterRecoveryWrite = false;
          throw new Error('Simulated post-write evidence recheck failure.');
        }
      }
      return realChatConversationService.getConversationEvidence(conversationId);
    },
  };
}

function clearRecoveryModuleState() {
  delete require.cache[RECOVERY_SERVICE_PATH];
  delete require.cache[RECOVERY_ROUTE_PATH];
  delete require.cache[CONVERSATIONS_ROUTE_PATH];
}

function buildApp() {
  clearRecoveryModuleState();
  installDependencyStubs();
  const conversationsRouter = require(CONVERSATIONS_ROUTE_PATH);
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationsRouter);
  return app;
}

function makeRun(phase, provider, overrides = {}) {
  const now = Date.now();
  return {
    id: `${phase}-${new mongoose.Types.ObjectId()}`,
    agentId: phase === 'triage' ? 'triage-agent' : `${phase}-agent`,
    agentName: phase === 'triage' ? 'Triage Agent' : `${phase} agent`,
    phase,
    status: 'completed',
    provider,
    model: 'test-model',
    traceId: '',
    startedAt: new Date(now - 2_000),
    completedAt: new Date(now - 1_000),
    durationMs: 1_000,
    events: [{ kind: 'llm.thinking', data: { delta: `${phase} reasoning` } }],
    eventCount: 1,
    detail: {},
    ...overrides,
  };
}

async function seedConversation({
  state = 'repersist',
  canonicalTemplate = CANONICAL_TEMPLATE,
  parseFields = null,
  priorCard = null,
  failedOriginalRun = false,
  parserHistoryMissing = false,
  sourceStatus = 'success',
  sourceProvider = 'llm-gateway',
  sourceProviderPackageId = 'source-provider-package',
  sourceFallbackUsed = false,
  sourceMetaSource = null,
  sourceExpiresAt = null,
} = {}) {
  const now = new Date();
  const suffix = new mongoose.Types.ObjectId().toString();
  const resolvedParseFields = parseFields || (
    canonicalTemplate.trim() ? parseEscalationText(canonicalTemplate) : clone(PARSE_FIELDS)
  );

  if (state === 'legacy') {
    const conversation = await Conversation.create({
      title: 'Legacy evidence session',
      provider: 'claude',
      messages: [{ role: 'user', content: 'Legacy escalation' }],
      caseIntake: {
        status: 'analyst-complete',
        canonicalTemplate,
        parseFields: resolvedParseFields,
        runs: [makeRun('analyst', 'claude')],
      },
    });
    return { conversation, sourceResult: null };
  }

  const createSourceResult = state === 'repersist' || state === 'healthy';
  const standaloneRunId = `standalone-triage-${suffix}`;
  let sourceResult = null;
  if (createSourceResult) {
    sourceResult = await TriageResult.create({
      source: 'triage-harness',
      runId: standaloneRunId,
      status: sourceStatus,
      severity: {
        raw: ORIGINAL_CARD.severity,
        validated: ORIGINAL_CARD.severity,
        displayed: ORIGINAL_CARD.severity,
      },
      category: ORIGINAL_CARD.category,
      rawOutput: JSON.stringify(ORIGINAL_CARD),
      card: clone(ORIGINAL_CARD),
      validationIssues: sourceStatus === 'success' ? [] : [{ code: 'DEGRADED_SOURCE' }],
      fallbackUsed: sourceFallbackUsed,
      fallbackReason: sourceFallbackUsed ? 'Original provider evidence was degraded.' : '',
      providerPackageId: sourceProviderPackageId,
      provider: sourceProvider,
      model: 'source-test-model',
      latencyMs: 250,
      triageMeta: {
        source: sourceMetaSource || (sourceFallbackUsed ? 'fallback' : 'agent'),
        providerUsed: sourceProvider,
        model: 'source-test-model',
        providerPackageId: sourceProviderPackageId,
        validation: { passed: sourceStatus === 'success', issues: [] },
      },
      parserText: canonicalTemplate,
      parseFields: resolvedParseFields,
      ...(sourceExpiresAt ? { expiresAt: sourceExpiresAt } : {}),
    });
  }

  const parserResultId = new mongoose.Types.ObjectId();
  const traceId = new mongoose.Types.ObjectId();
  const requestId = `request-${suffix}`;
  const triageCard = state === 'healthy' ? clone(ORIGINAL_CARD) : clone(priorCard);
  const originalRunId = `original-triage-run-${suffix}`;
  const triageRun = makeRun('triage', sourceProvider, {
    id: originalRunId,
    status: failedOriginalRun ? 'failed' : 'completed',
    summary: failedOriginalRun
      ? 'The triage result was produced, but the conversation save failed.'
      : 'Triage result produced before the deferred conversation save.',
    detail: {
      code: failedOriginalRun ? 'TRIAGE_CONVERSATION_SAVE_FAILED' : '',
      message: failedOriginalRun ? 'Conversation save failed after triage completed.' : '',
      providerPackageId: sourceProviderPackageId,
      savedResultId: sourceResult ? String(sourceResult._id) : '',
      standaloneRunId,
    },
  });
  const triageReceipt = state === 'healthy'
    ? {
        planned: true,
        attempted: true,
        completed: true,
        failed: false,
        cardSaved: true,
        resultSaveOk: true,
        saveFailureReported: false,
        savedResultId: String(sourceResult._id),
        standaloneRunId,
        providerPackageId: sourceProviderPackageId,
        provider: sourceProvider,
        recordedAt: now,
      }
    : {
        planned: true,
        attempted: true,
        completed: !failedOriginalRun,
        failed: failedOriginalRun,
        cardSaved: Boolean(triageCard),
        resultSaveOk: false,
        saveFailureReported: true,
        savedResultId: sourceResult ? String(sourceResult._id) : '',
        standaloneRunId,
        providerPackageId: sourceProviderPackageId,
        provider: sourceProvider,
        ...(failedOriginalRun ? {
          errorCode: 'TRIAGE_CONVERSATION_SAVE_FAILED',
          errorMessage: 'Conversation save failed after triage completed.',
        } : {}),
        recordedAt: now,
      };

  const caseIntake = {
    status: 'analyst-complete',
    updatedAt: now,
    canonicalTemplate,
    parseFields: resolvedParseFields,
    knownIssueSearchResult: { ok: true, status: 'no_reasonable_match' },
    triageCard,
    runs: [
      makeRun('parse-template', 'openai'),
      makeRun('known-issue-search', 'claude'),
      triageRun,
      makeRun('analyst', 'claude', { traceId: String(traceId) }),
    ],
    evidence: {
      contractVersion: 1,
      updatedAt: new Date(now.getTime() - 60_000),
      receipts: {
        parser: {
          attempted: true,
          completed: true,
          contentProduced: true,
          canonicalTemplateSaved: true,
          parsedFieldsSaved: true,
          historySaveOk: !parserHistoryMissing,
          resultId: parserHistoryMissing ? '' : String(parserResultId),
          providerPackageId: `parser-package-${suffix}`,
          provider: 'openai',
          recordedAt: now,
        },
        inv: {
          attempted: true,
          completed: true,
          resultSaved: true,
          provider: 'claude',
          packageCaptureEnabled: true,
          recordedAt: now,
        },
        triage: triageReceipt,
        analyst: {
          attempted: true,
          completed: true,
          contentProduced: true,
          messageSaved: true,
          thinkingCaptured: true,
          traceSaveOk: true,
          traceId: String(traceId),
          requestId,
          provider: 'claude',
          packageCaptureEnabled: true,
          completedAt: now,
          recordedAt: now,
        },
      },
    },
  };

  const conversation = await Conversation.create({
    title: `Recovery ${state} session`,
    provider: 'claude',
    messages: [
      { role: 'user', content: 'Review this escalation.', traceRequestId: requestId },
      { role: 'assistant', content: 'Analyst answer', thinking: 'Analyst reasoning', traceRequestId: requestId },
    ],
    caseIntake,
  });

  if (!parserHistoryMissing) {
    await ImageParseResult.create({
      _id: parserResultId,
      provider: 'openai',
      model: 'parser-test-model',
      status: 'ok',
      role: 'escalation',
      parsedText: canonicalTemplate,
    });
  }
  await AiTrace.create({
    _id: traceId,
    requestId,
    service: 'chat',
    route: '/api/chat',
    status: 'ok',
    conversationId: conversation._id,
  });

  return {
    conversation,
    sourceResult,
    originalRunId,
    originalReceipt: clone(triageReceipt),
  };
}

async function getRecoveryOptions(app, conversationId) {
  const response = await supertest(app)
    .get(`/api/conversations/${conversationId}/evidence/recovery`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.ok, true);
  return response.body.recovery;
}

function triagePlan(recovery) {
  return recovery.options.find((option) => option.targetStage === 'triage');
}

async function confirmPlan(app, conversationId, recovery, plan, idempotencyKey) {
  return supertest(app)
    .post(`/api/conversations/${conversationId}/evidence/recovery`)
    .send({
      action: plan.planId,
      evidenceFingerprint: recovery.evidenceFingerprint,
      idempotencyKey,
    });
}

async function createPlanAttempt({
  seeded,
  recovery,
  plan,
  status,
  attemptNumber = 1,
  idempotencyKey = `prior-${new mongoose.Types.ObjectId()}`,
  overrides = {},
}) {
  const operationId = `recovery-${new mongoose.Types.ObjectId()}`;
  const active = ['confirmed', 'running', 'cancel-requested', 'awaiting-acceptance'].includes(status);
  return RecoveryOperation.create({
    operationId,
    idempotencyKey,
    planId: plan.planId,
    attemptNumber,
    dedupeKey: `${plan.planId}:${attemptNumber}`,
    ...(active ? { activePlanId: plan.planId } : {}),
    conversationId: seeded.conversation._id,
    targetStage: 'triage',
    strategy: plan.strategy,
    status,
    evidenceFingerprint: clone(recovery.evidenceFingerprint),
    missingCodes: clone(plan.artifactCodes || []),
    inputSnapshot: {
      canonicalTemplate: CANONICAL_TEMPLATE,
      canonicalTemplateSha256: 'a'.repeat(64),
      parseFieldsSha256: 'b'.repeat(64),
      sourceRecordIds: {},
    },
    runtimeSnapshot: clone(plan.runtimeSnapshot || {}),
    ...overrides,
  });
}

async function waitForOperation(app, conversationId, operationId, expectedStatuses, timeoutMs = 5_000) {
  const wanted = new Set(Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses]);
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const response = await supertest(app)
      .get(`/api/conversations/${conversationId}/evidence/recovery/${operationId}`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    last = response.body.operation;
    if (wanted.has(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Recovery operation did not reach ${[...wanted].join('/')} (last status: ${last?.status || 'none'}).`);
}

async function getEvidence(app, conversationId) {
  const response = await supertest(app).get(`/api/conversations/${conversationId}/evidence`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.evidence;
}

let app;

test.before(async () => {
  await connect();
  await RecoveryOperation.init();
});

test.beforeEach(async () => {
  resetProviderStub();
  await Promise.all([
    AiTrace.deleteMany({}),
    Conversation.deleteMany({}),
    ImageParseResult.deleteMany({}),
    KnowledgeCandidate.deleteMany({}),
    RecoveryOperation.deleteMany({}),
    TriageResult.deleteMany({}),
  ]);
  app = buildApp();
});

test.after(async () => {
  require.cache[TRIAGE_PATH].exports = realTriageService;
  require.cache[AGENT_IDENTITY_PATH].exports = realAgentIdentityService;
  require.cache[CHAT_CONVERSATION_SERVICE_PATH].exports = realChatConversationService;
  clearRecoveryModuleState();
  await disconnect();
});

test('saveConversationLenient primary path saves a current valid conversation normally', async () => {
  const conversation = await Conversation.create({
    title: 'Before current save',
    provider: 'claude',
    messages: [],
  });
  const loaded = await Conversation.findById(conversation._id);
  const loadedVersion = loaded.__v;
  loaded.title = 'Saved by current chat';

  assert.equal(loaded.validateSync(), undefined);
  await saveConversationLenient(loaded);

  const persisted = await Conversation.findById(conversation._id).lean();
  assert.equal(persisted.title, 'Saved by current chat');
  assert.equal(persisted.__v, loadedVersion);
});

test('saveConversationLenient primary path rejects a stale valid conversation without clobbering recovery', async () => {
  const conversation = await Conversation.create({
    title: 'Before recovery commit',
    provider: 'claude',
    messages: [],
    caseIntake: {
      status: 'analyst-complete',
      runs: [],
      followUps: [],
      recoveryMarker: 'initial',
    },
  });
  const stale = await Conversation.findById(conversation._id);
  const loadedVersion = stale.__v;
  stale.title = 'Stale chat save';
  stale.caseIntake = {
    ...clone(stale.caseIntake),
    recoveryMarker: 'stale-chat-save',
  };
  assert.equal(stale.validateSync(), undefined);

  const recoveryWrite = await Conversation.updateOne(
    { _id: conversation._id, __v: loadedVersion },
    {
      $set: {
        title: 'Committed recovery',
        'caseIntake.recoveryMarker': 'committed-recovery',
      },
      $inc: { __v: 1 },
    }
  );
  assert.equal(recoveryWrite.matchedCount, 1);

  await assert.rejects(
    saveConversationLenient(stale),
    (error) => {
      assert.equal(error.code, 'CONVERSATION_WRITE_CONFLICT');
      assert.equal(error.status, 409);
      return true;
    }
  );

  const persisted = await Conversation.findById(conversation._id).lean();
  assert.equal(persisted.title, 'Committed recovery');
  assert.equal(persisted.caseIntake.recoveryMarker, 'committed-recovery');
  assert.equal(persisted.__v, loadedVersion + 1);
});

test('triage comparison: identical cards are not meaningful and each scalar decision change is meaningful', () => {
  assert.deepEqual(compareTriageCards(ORIGINAL_CARD, clone(ORIGINAL_CARD)), {
    meaningfullyDifferent: false,
    differences: [],
    plainSummary: [],
  });

  const changes = {
    severity: 'P1',
    category: 'payments',
    agent: 'Different Agent',
    client: 'Different Client',
    confidence: 'medium',
  };
  for (const [field, value] of Object.entries(changes)) {
    const result = compareTriageCards(ORIGINAL_CARD, { ...ORIGINAL_CARD, [field]: value });
    assert.equal(result.meaningfullyDifferent, true, `${field} must be meaningful`);
    assert.ok(result.differences.some((difference) => difference.field === field));
    assert.ok(result.plainSummary.length > 0);
    assert.ok(result.plainSummary.every((summary) => typeof summary === 'string' && summary.trim().length > 0));
  }
});

test('triage comparison: punctuation-only text changes are ignored but missing-info membership changes are meaningful', () => {
  const punctuationOnly = compareTriageCards(ORIGINAL_CARD, {
    ...ORIGINAL_CARD,
    read: '  PAYROLL tax payment remains pending!!! ',
    action: 'Verify the payment status -- then escalate to Payroll Support...',
  });
  assert.equal(punctuationOnly.meaningfullyDifferent, false);
  assert.deepEqual(punctuationOnly.plainSummary, []);

  const membershipChange = compareTriageCards(ORIGINAL_CARD, {
    ...ORIGINAL_CARD,
    missingInfo: ['Exact tax period', 'Affected company ID'],
  });
  assert.equal(membershipChange.meaningfullyDifferent, true);
  assert.ok(membershipChange.differences.some((difference) => difference.field === 'missingInfo'));
  assert.ok(membershipChange.plainSummary.every((summary) => summary.trim().length > 0));
});

test('repersist recovers matching saved triage evidence with zero provider calls', async () => {
  const seeded = await seedConversation({ state: 'repersist' });
  const before = await getEvidence(app, seeded.conversation._id);
  assert.equal(before.status, 'incomplete');
  assert.ok(before.missing.some((artifact) => artifact.code === 'TRIAGE_CARD'));
  assert.ok(before.missing.some((artifact) => artifact.code === 'TRIAGE_RESULT'));

  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);
  assert.equal(plan.strategy, 'repersist');
  const triageRowsBefore = await TriageResult.countDocuments({});

  const confirmation = await confirmPlan(
    app,
    seeded.conversation._id,
    recovery,
    plan,
    'repersist-once'
  );
  assert.equal(confirmation.status, 202, JSON.stringify(confirmation.body));
  const operation = await waitForOperation(
    app,
    seeded.conversation._id,
    confirmation.body.operation.operationId,
    'succeeded'
  );

  assert.equal(providerStub.calls.length, 0);
  assert.equal(await TriageResult.countDocuments({}), triageRowsBefore);
  const after = await getEvidence(app, seeded.conversation._id);
  for (const code of operation.missingCodes) {
    assert.equal(after.artifacts.find((artifact) => artifact.code === code)?.state, 'confirmed');
  }
  assert.equal(after.artifacts.find((artifact) => artifact.code === 'TRIAGE_CARD').state, 'confirmed');
  assert.equal(after.artifacts.find((artifact) => artifact.code === 'TRIAGE_RESULT').state, 'confirmed');
});

test('repersist parks a meaningfully different visible card but auto-commits an identical card', async () => {
  const differentSeed = await seedConversation({ state: 'repersist', priorCard: DIFFERENT_CARD });
  const differentRecovery = await getRecoveryOptions(app, differentSeed.conversation._id);
  const differentPlan = triagePlan(differentRecovery);
  assert.equal(differentPlan.strategy, 'repersist');
  assert.equal(differentPlan.acceptanceRequired, true);
  assert.equal(differentPlan.comparison.meaningfullyDifferent, true);

  const differentConfirmation = await confirmPlan(
    app,
    differentSeed.conversation._id,
    differentRecovery,
    differentPlan,
    'repersist-different-card'
  );
  const awaiting = await waitForOperation(
    app,
    differentSeed.conversation._id,
    differentConfirmation.body.operation.operationId,
    'awaiting-acceptance'
  );
  assert.equal(providerStub.calls.length, 0);
  assert.equal(awaiting.candidateResult.comparison.meaningfullyDifferent, true);
  assert.equal(
    new Date(awaiting.acceptExpiresAt).getTime(),
    new Date(differentSeed.sourceResult.expiresAt).getTime()
  );
  const unchanged = await Conversation.findById(differentSeed.conversation._id).lean();
  assert.deepEqual(clone(unchanged.caseIntake.triageCard), clone(DIFFERENT_CARD));

  const identicalSeed = await seedConversation({ state: 'repersist', priorCard: ORIGINAL_CARD });
  const identicalRecovery = await getRecoveryOptions(app, identicalSeed.conversation._id);
  const identicalPlan = triagePlan(identicalRecovery);
  assert.equal(identicalPlan.strategy, 'repersist');
  assert.equal(identicalPlan.acceptanceRequired, false);
  const identicalConfirmation = await confirmPlan(
    app,
    identicalSeed.conversation._id,
    identicalRecovery,
    identicalPlan,
    'repersist-identical-card'
  );
  await waitForOperation(
    app,
    identicalSeed.conversation._id,
    identicalConfirmation.body.operation.operationId,
    'succeeded'
  );
  assert.equal(providerStub.calls.length, 0);
});

test('confirmed triage-only rerun makes exactly one provider call with no fallback or repair call', async () => {
  const seeded = await seedConversation({ state: 'rerun' });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);
  assert.equal(plan.strategy, 'rerun-stage');
  assert.equal(providerStub.calls.length, 0);

  const confirmation = await confirmPlan(app, seeded.conversation._id, recovery, plan, 'rerun-once');
  assert.equal(confirmation.status, 202, JSON.stringify(confirmation.body));
  await waitForOperation(
    app,
    seeded.conversation._id,
    confirmation.body.operation.operationId,
    'succeeded'
  );

  assert.deepEqual(providerStub.calls.map((call) => call.kind), ['primary']);
  assert.equal(providerStub.fallbackCalls, 0);
  assert.equal(providerStub.repairCalls, 0);
  assert.equal(await TriageResult.countDocuments({ source: 'evidence-recovery' }), 1);
});

test('validated provider failover succeeds with honest actual-provider provenance and remains repersist-eligible', async () => {
  providerStub.mode = 'failover-success';
  const rerunSeed = await seedConversation({ state: 'rerun' });
  const rerunRecovery = await getRecoveryOptions(app, rerunSeed.conversation._id);
  const rerunConfirmation = await confirmPlan(
    app,
    rerunSeed.conversation._id,
    rerunRecovery,
    triagePlan(rerunRecovery),
    'successful-provider-failover'
  );
  const rerunOperation = await waitForOperation(
    app,
    rerunSeed.conversation._id,
    rerunConfirmation.body.operation.operationId,
    'succeeded'
  );
  assert.deepEqual(providerStub.calls.map((call) => call.kind), ['primary', 'backup']);
  assert.equal(rerunOperation.runtimeSnapshot.provider, 'lm-studio');
  assert.equal(rerunOperation.runtimeSnapshot.actualProvider, 'openai');
  assert.equal(rerunOperation.runtimeSnapshot.actualModel, 'gpt-5.5');
  assert.equal(rerunOperation.runtimeSnapshot.failoverUsed, true);
  assert.equal(rerunOperation.runtimeSnapshot.failoverFrom, 'lm-studio');
  assert.equal(rerunOperation.attempts[0].provider, 'openai');
  assert.equal(rerunOperation.attempts[0].failoverUsed, true);
  const rerunConversation = await Conversation.findById(rerunSeed.conversation._id).lean();
  assert.equal(rerunConversation.caseIntake.runs[0].provider, 'openai');
  assert.equal(rerunConversation.caseIntake.evidence.receipts.triage.provider, 'openai');

  providerStub.mode = 'success';
  const repersistSeed = await seedConversation({
    state: 'repersist',
    sourceProvider: 'openai',
    sourceFallbackUsed: true,
    sourceMetaSource: 'agent',
  });
  const repersistRecovery = await getRecoveryOptions(app, repersistSeed.conversation._id);
  assert.equal(triagePlan(repersistRecovery).strategy, 'repersist');
  const repersistConfirmation = await confirmPlan(
    app,
    repersistSeed.conversation._id,
    repersistRecovery,
    triagePlan(repersistRecovery),
    'repersist-successful-failover'
  );
  const repersistOperation = await waitForOperation(
    app,
    repersistSeed.conversation._id,
    repersistConfirmation.body.operation.operationId,
    'succeeded'
  );
  assert.equal(repersistOperation.runtimeSnapshot.actualProvider, 'openai');
  assert.equal(repersistOperation.attempts[0].provider, 'openai');
});

test('concurrent confirmations dedupe same idempotency key and same plan to one operation/write/provider call', async () => {
  const seeded = await seedConversation({ state: 'rerun' });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);

  const confirmations = await Promise.all([
    confirmPlan(app, seeded.conversation._id, recovery, plan, 'concurrent-key'),
    confirmPlan(app, seeded.conversation._id, recovery, plan, 'concurrent-key'),
    confirmPlan(app, seeded.conversation._id, recovery, plan, 'same-dedupe-different-request-key'),
  ]);
  assert.ok(confirmations.every((response) => [200, 202].includes(response.status)));
  assert.equal(confirmations.filter((response) => response.body.created === true).length, 1);
  const operationIds = new Set(confirmations.map((response) => response.body.operation.operationId));
  assert.equal(operationIds.size, 1);

  const [operationId] = operationIds;
  await waitForOperation(app, seeded.conversation._id, operationId, 'succeeded');
  assert.equal(await RecoveryOperation.countDocuments({}), 1);
  assert.equal(providerStub.calls.length, 1);
  assert.equal(await TriageResult.countDocuments({ source: 'evidence-recovery' }), 1);
  const saved = await Conversation.findById(seeded.conversation._id).lean();
  assert.equal(saved.caseIntake.runs.filter((run) => run.recoveryOperationId === operationId).length, 1);
});

test('retrying a completed confirmation with the same idempotency key returns the durable operation', async () => {
  // The spec requires retry-safe confirmation even when the first response was
  // lost and recovery completed before the retry reached the server.
  const seeded = await seedConversation({ state: 'rerun' });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);
  const requestBody = {
    action: plan.planId,
    evidenceFingerprint: recovery.evidenceFingerprint,
    idempotencyKey: 'terminal-retry-key',
  };

  const first = await supertest(app)
    .post(`/api/conversations/${seeded.conversation._id}/evidence/recovery`)
    .send(requestBody);
  assert.equal(first.status, 202, JSON.stringify(first.body));
  await waitForOperation(app, seeded.conversation._id, first.body.operation.operationId, 'succeeded');

  const retry = await supertest(app)
    .post(`/api/conversations/${seeded.conversation._id}/evidence/recovery`)
    .send(requestBody);
  assert.equal(retry.status, 200, 'same-key terminal retry must reattach instead of failing on changed evidence');
  assert.equal(retry.body.operation.operationId, first.body.operation.operationId);
  assert.equal(retry.body.created, false);
  assert.equal(await RecoveryOperation.countDocuments({}), 1);
  assert.equal(providerStub.calls.length, 1);
});

test('already-complete evidence has no recovery offer and POST cannot overwrite it', async () => {
  const seeded = await seedConversation({ state: 'healthy' });
  const before = await Conversation.findById(seeded.conversation._id).lean();
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  assert.equal(recovery.evidenceStatus, 'complete');
  assert.deepEqual(recovery.options, []);

  const attempt = await supertest(app)
    .post(`/api/conversations/${seeded.conversation._id}/evidence/recovery`)
    .send({
      action: 'rerun-stage',
      evidenceFingerprint: recovery.evidenceFingerprint,
      idempotencyKey: 'must-not-overwrite',
    });
  assert.equal(attempt.status, 409);
  assert.equal(attempt.body.code, 'RECOVERY_PLAN_UNAVAILABLE');
  assert.equal(providerStub.calls.length, 0);
  assert.equal(await RecoveryOperation.countDocuments({}), 0);
  const after = await Conversation.findById(seeded.conversation._id).lean();
  assert.deepEqual(clone(after.caseIntake), clone(before.caseIntake));
});

test('successful recovery preserves original failure and links the new run and receipt back to it', async () => {
  const seeded = await seedConversation({ state: 'repersist', failedOriginalRun: true });
  await Conversation.collection.updateOne(
    { _id: seeded.conversation._id, 'caseIntake.runs.id': seeded.originalRunId },
    {
      $set: {
        'caseIntake.runs.$.detail.rawPayload': { prompt: 'do not expose this prompt', apiKey: 'secret-run-key' },
        'caseIntake.evidence.receipts.triage.rawPayload': { token: 'secret-receipt-token' },
        'caseIntake.evidence.receipts.triage.prompt': 'do not expose this receipt prompt',
      },
    }
  );
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);
  assert.equal(plan.strategy, 'repersist');
  const confirmation = await confirmPlan(app, seeded.conversation._id, recovery, plan, 'preserve-provenance');
  assert.equal(confirmation.status, 202, JSON.stringify(confirmation.body));
  const operationId = confirmation.body.operation.operationId;
  const publicOperation = await waitForOperation(app, seeded.conversation._id, operationId, 'succeeded');
  assert.equal(publicOperation.originalEvidence.failureCode, 'TRIAGE_CONVERSATION_SAVE_FAILED');
  assert.equal(publicOperation.originalEvidence.failedRun.id, seeded.originalRunId);
  assert.equal(publicOperation.originalEvidence.failedRun.summary, 'The triage result was produced, but the conversation save failed.');
  assert.equal(publicOperation.originalEvidence.receipt.errorCode, 'TRIAGE_CONVERSATION_SAVE_FAILED');
  assert.equal(publicOperation.originalEvidence.resultId, String(seeded.sourceResult._id));
  assert.equal(JSON.stringify(publicOperation.originalEvidence).includes('do not expose'), false);
  assert.equal(JSON.stringify(publicOperation.originalEvidence).includes('secret-run-key'), false);
  assert.equal(JSON.stringify(publicOperation.originalEvidence).includes('secret-receipt-token'), false);

  const historyResponse = await supertest(app)
    .get(`/api/conversations/${seeded.conversation._id}/evidence/recovery/history`);
  assert.equal(historyResponse.status, 200, JSON.stringify(historyResponse.body));
  assert.equal(historyResponse.body.operations.length, 1);
  assert.equal(historyResponse.body.operations[0].operationId, operationId);
  assert.equal(historyResponse.body.operations[0].originalEvidence.failedRun.id, seeded.originalRunId);
  assert.equal(historyResponse.body.operations[0].status, 'succeeded');
  assert.equal(JSON.stringify(historyResponse.body).includes('do not expose'), false);
  assert.equal(JSON.stringify(historyResponse.body).includes('secret-run-key'), false);
  assert.equal(JSON.stringify(historyResponse.body).includes('secret-receipt-token'), false);
  const activeAttempt = await createPlanAttempt({
    seeded,
    recovery,
    plan,
    status: 'running',
    attemptNumber: 2,
    idempotencyKey: 'history-active-attempt',
  });
  const historyWithActive = await supertest(app)
    .get(`/api/conversations/${seeded.conversation._id}/evidence/recovery/history`);
  assert.equal(historyWithActive.status, 200, JSON.stringify(historyWithActive.body));
  assert.deepEqual(
    historyWithActive.body.operations.map((item) => item.operationId),
    [operationId, activeAttempt.operationId]
  );
  assert.deepEqual(historyWithActive.body.operations.map((item) => item.status), ['succeeded', 'running']);

  const operation = await RecoveryOperation.findOne({ operationId }).lean();
  assert.equal(operation.originalEvidence.failedRun.id, seeded.originalRunId);
  assert.equal(operation.originalEvidence.failedRun.status, 'failed');
  assert.equal(operation.originalEvidence.receipt.errorCode, 'TRIAGE_CONVERSATION_SAVE_FAILED');
  assert.equal(operation.originalEvidence.failureCode, 'TRIAGE_CONVERSATION_SAVE_FAILED');

  const conversation = await Conversation.findById(seeded.conversation._id).lean();
  const recoveredRun = conversation.caseIntake.runs.find((run) => run.recoveryOperationId === operationId);
  const originalRun = conversation.caseIntake.runs.find((run) => run.id === seeded.originalRunId);
  assert.ok(originalRun, 'the original failed run remains reviewable');
  assert.equal(originalRun.status, 'failed');
  assert.equal(recoveredRun.recoversRunId, seeded.originalRunId);
  assert.equal(recoveredRun.detail.recoveryOperationId, operationId);
  assert.equal(recoveredRun.detail.recoversRunId, seeded.originalRunId);
  assert.equal(conversation.caseIntake.evidence.receipts.triage.recoveryOperationId, operationId);
  assert.equal(conversation.caseIntake.evidence.receipts.triage.recoversRunId, seeded.originalRunId);
  const recoveredReceipt = conversation.caseIntake.evidence.receipts.triage;
  assert.equal(recoveredReceipt.failed, false);
  assert.equal(recoveredReceipt.status, 'completed');
  assert.equal(recoveredReceipt.errorCode, '');
  assert.equal(recoveredReceipt.errorMessage, '');
  assert.equal(recoveredReceipt.error, null);
  assert.equal(recoveredReceipt.resultSaveOk, true);
  assert.equal((await getEvidence(app, seeded.conversation._id)).status, 'complete');
});

test('empty canonical input produces manual review and server-side recovery refusal', async () => {
  const seeded = await seedConversation({ state: 'rerun', canonicalTemplate: '' });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);
  assert.equal(plan.strategy, 'manual-review');
  assert.match(plan.reason, /canonical escalation template is empty/i);

  const confirmation = await confirmPlan(app, seeded.conversation._id, recovery, plan, 'empty-input');
  assert.equal(confirmation.status, 409);
  assert.equal(confirmation.body.code, 'RECOVERY_NOT_AUTOMATABLE');
  assert.equal(providerStub.calls.length, 0);
  assert.equal(await RecoveryOperation.countDocuments({}), 0);
});

test('parse fields that disagree with deterministic re-parse produce manual review and refusal', async () => {
  const seeded = await seedConversation({
    state: 'rerun',
    parseFields: { ...clone(PARSE_FIELDS), caseNumber: 'DIFFERENT-CASE' },
  });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);
  assert.equal(plan.strategy, 'manual-review');
  assert.match(plan.reason, /deterministic re-parse does not agree/i);

  const confirmation = await confirmPlan(app, seeded.conversation._id, recovery, plan, 'mismatched-input');
  assert.equal(confirmation.status, 409);
  assert.equal(confirmation.body.code, 'RECOVERY_NOT_AUTOMATABLE');
  assert.equal(providerStub.calls.length, 0);
});

test('expired matching TriageResult is not repersisted and safely falls through to rerun', async () => {
  const seeded = await seedConversation({
    state: 'repersist',
    sourceExpiresAt: new Date(Date.now() - 60_000),
  });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);
  assert.equal(plan.strategy, 'rerun-stage');
  assert.equal(plan.aiCallNeeded, true);
  assert.equal(providerStub.calls.length, 0);
});

test('degraded source with missing/unsupported provider evidence is never offered for repersist', async () => {
  // A readable row is not sufficient evidence that its card is safe to adopt:
  // this source is degraded fallback output from an unsupported provider and
  // has no provider-package identifier. Verified input still permits a rerun.
  const seeded = await seedConversation({
    state: 'repersist',
    sourceStatus: 'degraded',
    sourceProvider: 'unsupported-legacy-provider',
    sourceProviderPackageId: '',
    sourceFallbackUsed: true,
  });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);
  assert.equal(plan.strategy, 'rerun-stage', 'unsafe degraded/provider-unproven source must fall through to rerun');
  assert.equal(plan.aiCallNeeded, true);
});

test('meaningfully different rerun waits for acceptance, commits shown hashes, and resolves repeats/conflicts safely', async () => {
  providerStub.card = clone(DIFFERENT_CARD);
  const seeded = await seedConversation({ state: 'rerun', priorCard: ORIGINAL_CARD });
  const knowledgeCandidate = await KnowledgeCandidate.create({
    escalationId: new mongoose.Types.ObjectId(),
    conversationId: seeded.conversation._id,
    title: 'Existing recovery knowledge draft',
  });
  const before = await Conversation.findById(seeded.conversation._id).lean();
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);
  const confirmation = await confirmPlan(app, seeded.conversation._id, recovery, plan, 'different-candidate');
  assert.equal(confirmation.status, 202, JSON.stringify(confirmation.body));
  const operationId = confirmation.body.operation.operationId;
  const awaiting = await waitForOperation(app, seeded.conversation._id, operationId, 'awaiting-acceptance');
  assert.equal(providerStub.calls.length, 1);
  assert.equal(awaiting.candidateResult.comparison.meaningfullyDifferent, true);
  assert.ok(awaiting.candidateResult.comparison.plainSummary.length > 0);

  const parkedConversation = await Conversation.findById(seeded.conversation._id).lean();
  assert.deepEqual(clone(parkedConversation.caseIntake), clone(before.caseIntake));

  const hashes = {
    candidateSha256: awaiting.candidateResult.comparison.candidateSha256,
    previousSha256: awaiting.candidateResult.comparison.previousSha256,
  };
  const accepted = await supertest(app)
    .post(`/api/conversations/${seeded.conversation._id}/evidence/recovery/${operationId}/accept`)
    .send(hashes);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.operation.status, 'succeeded');
  assert.equal(accepted.body.idempotent, false);
  assert.equal(accepted.body.operation.knowledgeDraftNeedsReview.recoveryOperationId, operationId);
  assert.match(accepted.body.operation.knowledgeDraftNeedsReview.reason, /review this knowledge draft/i);
  const committed = await Conversation.findById(seeded.conversation._id).lean();
  assert.equal(committed.caseIntake.triageCard.severity, DIFFERENT_CARD.severity);
  assert.equal(committed.caseIntake.triageCard.read, DIFFERENT_CARD.read);
  const markedCandidate = await KnowledgeCandidate.findById(knowledgeCandidate._id).lean();
  assert.equal(markedCandidate.needsReviewAfterRecovery.recoveryOperationId, operationId);
  assert.ok(markedCandidate.needsReviewAfterRecovery.markedAt);
  assert.match(markedCandidate.needsReviewAfterRecovery.reason, /changed the triage card meaningfully/i);

  const repeated = await supertest(app)
    .post(`/api/conversations/${seeded.conversation._id}/evidence/recovery/${operationId}/accept`)
    .send(hashes);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.idempotent, true);
  assert.equal(repeated.body.operation.status, 'succeeded');

  const conflict = await supertest(app)
    .post(`/api/conversations/${seeded.conversation._id}/evidence/recovery/${operationId}/accept`)
    .send({ ...hashes, candidateSha256: '0'.repeat(64) });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'RECOVERY_ALREADY_DECIDED');
});

test('equivalent recovery commits do not mark an existing knowledge draft for review', async () => {
  const seeded = await seedConversation({ state: 'rerun', priorCard: ORIGINAL_CARD });
  const knowledgeCandidate = await KnowledgeCandidate.create({
    escalationId: new mongoose.Types.ObjectId(),
    conversationId: seeded.conversation._id,
    title: 'Equivalent recovery knowledge draft',
  });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const confirmation = await confirmPlan(
    app,
    seeded.conversation._id,
    recovery,
    triagePlan(recovery),
    'equivalent-card-no-knowledge-marker'
  );
  const operation = await waitForOperation(
    app,
    seeded.conversation._id,
    confirmation.body.operation.operationId,
    'succeeded'
  );
  assert.equal(operation.knowledgeDraftNeedsReview, null);
  const unchangedCandidate = await KnowledgeCandidate.findById(knowledgeCandidate._id).lean();
  assert.equal(unchangedCandidate.needsReviewAfterRecovery, null);
});

test('accepting after the parked source expires moves the operation to manual review', async () => {
  providerStub.card = clone(DIFFERENT_CARD);
  const seeded = await seedConversation({ state: 'rerun', priorCard: ORIGINAL_CARD });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const confirmation = await confirmPlan(app, seeded.conversation._id, recovery, triagePlan(recovery), 'expired-acceptance');
  const operationId = confirmation.body.operation.operationId;
  const awaiting = await waitForOperation(app, seeded.conversation._id, operationId, 'awaiting-acceptance');
  assert.ok(awaiting.acceptExpiresAt);
  const expiredAt = new Date(Date.now() - 60_000);
  await Promise.all([
    TriageResult.updateOne(
      { _id: awaiting.candidateResult.triageResultId },
      { $set: { expiresAt: expiredAt } }
    ),
    RecoveryOperation.updateOne({ operationId }, { $set: { acceptExpiresAt: expiredAt } }),
  ]);

  const response = await supertest(app)
    .post(`/api/conversations/${seeded.conversation._id}/evidence/recovery/${operationId}/accept`)
    .send({
      candidateSha256: awaiting.candidateResult.comparison.candidateSha256,
      previousSha256: awaiting.candidateResult.comparison.previousSha256,
    });
  assert.equal(response.status, 409, JSON.stringify(response.body));
  assert.equal(response.body.code, 'RECOVERY_CANDIDATE_EXPIRED');
  assert.match(response.body.error, /expired.*manual review/i);
  const manual = await waitForOperation(app, seeded.conversation._id, operationId, 'manual-review');
  assert.equal(manual.errorCode, 'RECOVERY_CANDIDATE_EXPIRED');
  const unchanged = await Conversation.findById(seeded.conversation._id).lean();
  assert.deepEqual(clone(unchanged.caseIntake.triageCard), clone(ORIGINAL_CARD));
});

test('two racing accepts cannot let the loser hide the winning executor from cancellation', async () => {
  providerStub.card = clone(DIFFERENT_CARD);
  const seeded = await seedConversation({ state: 'rerun', priorCard: ORIGINAL_CARD });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const confirmation = await confirmPlan(app, seeded.conversation._id, recovery, triagePlan(recovery), 'accept-cancel-race');
  const operationId = confirmation.body.operation.operationId;
  const awaiting = await waitForOperation(app, seeded.conversation._id, operationId, 'awaiting-acceptance');
  const hashes = {
    candidateSha256: awaiting.candidateResult.comparison.candidateSha256,
    previousSha256: awaiting.candidateResult.comparison.previousSha256,
  };

  const claimsEntered = deferred();
  const releaseClaims = deferred();
  const commitEntered = deferred();
  const releaseCommit = deferred();
  const realFindOneAndUpdate = RecoveryOperation.findOneAndUpdate;
  const realConversationUpdateOne = Conversation.updateOne;
  let claimCount = 0;
  let blockedCommit = false;
  let acceptRequests = [];

  RecoveryOperation.findOneAndUpdate = function guardedFindOneAndUpdate(filter, update, options) {
    const query = realFindOneAndUpdate.call(this, filter, update, options);
    if (filter?.status !== 'awaiting-acceptance') return query;
    return {
      lean: async () => {
        claimCount += 1;
        if (claimCount === 2) claimsEntered.resolve();
        await releaseClaims.promise;
        return query.lean();
      },
    };
  };
  Conversation.updateOne = async function guardedConversationUpdate(filter, update, options) {
    if (!blockedCommit && update?.$set?.['caseIntake.triageCard']) {
      blockedCommit = true;
      commitEntered.resolve();
      await releaseCommit.promise;
    }
    return realConversationUpdateOne.call(this, filter, update, options);
  };

  try {
    acceptRequests = [
      supertest(app)
        .post(`/api/conversations/${seeded.conversation._id}/evidence/recovery/${operationId}/accept`)
        .send(hashes)
        .then((response) => response),
      supertest(app)
        .post(`/api/conversations/${seeded.conversation._id}/evidence/recovery/${operationId}/accept`)
        .send(hashes)
        .then((response) => response),
    ];
    await withTimeout(claimsEntered.promise, 'Both accept requests did not reach the database claim.');
    releaseClaims.resolve();
    await withTimeout(commitEntered.promise, 'The winning accept did not reach the guarded conversation write.');
    const loser = await withTimeout(Promise.race(acceptRequests), 'The losing accept did not resolve.');
    assert.equal(loser.status, 409, JSON.stringify(loser.body));
    assert.equal(loser.body.code, 'RECOVERY_ALREADY_DECIDED');

    const cancellation = await supertest(app)
      .post(`/api/conversations/${seeded.conversation._id}/evidence/recovery/${operationId}/cancel`)
      .send({});
    assert.equal(cancellation.status, 200, JSON.stringify(cancellation.body));
    assert.equal(cancellation.body.alreadyCompleted, true);
    assert.equal(cancellation.body.cancellationAcknowledged, undefined);

    releaseCommit.resolve();
    const responses = await Promise.all(acceptRequests);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const completed = await waitForOperation(app, seeded.conversation._id, operationId, 'succeeded');
    assert.equal(completed.status, 'succeeded');
    const conversation = await Conversation.findById(seeded.conversation._id).lean();
    assert.equal(conversation.caseIntake.triageCard.severity, DIFFERENT_CARD.severity);
    assert.equal(conversation.caseIntake.runs.filter((run) => run.recoveryOperationId === operationId).length, 1);
  } finally {
    releaseClaims.resolve();
    releaseCommit.resolve();
    RecoveryOperation.findOneAndUpdate = realFindOneAndUpdate;
    Conversation.updateOne = realConversationUpdateOne;
    await Promise.allSettled(acceptRequests);
  }
});

test('degraded fallback after provider error fails recovery without adopting it or changing workflow evidence', async () => {
  providerStub.mode = 'degraded';
  const seeded = await seedConversation({ state: 'rerun' });
  const before = await Conversation.findById(seeded.conversation._id).lean();
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);
  const confirmation = await confirmPlan(app, seeded.conversation._id, recovery, plan, 'degraded-must-fail');
  assert.equal(confirmation.status, 202, JSON.stringify(confirmation.body));
  const operation = await waitForOperation(
    app,
    seeded.conversation._id,
    confirmation.body.operation.operationId,
    'failed'
  );
  assert.equal(operation.errorCode, 'RECOVERY_TRIAGE_DEGRADED');
  assert.equal(providerStub.calls.length, 1);
  assert.equal(providerStub.fallbackCalls, 1);

  const fallbackRow = await TriageResult.findOne({ source: 'evidence-recovery' }).lean();
  assert.equal(fallbackRow.status, 'degraded');
  assert.equal(fallbackRow.card.fallback.used, true);
  const after = await Conversation.findById(seeded.conversation._id).lean();
  assert.deepEqual(clone(after.caseIntake), clone(before.caseIntake));
  assert.deepEqual(clone(after.messages), clone(before.messages));
  assert.equal(after.caseIntake.triageCard, null);

  const evidence = await getEvidence(app, seeded.conversation._id);
  assert.equal(evidence.status, 'incomplete');
  assert.ok(evidence.missing.some((artifact) => ['TRIAGE_CARD', 'TRIAGE_RESULT'].includes(artifact.code)));
});

test('post-recovery Phase 1 status is complete only when all evidence is present and stays incomplete after partial recovery', async () => {
  const completeSeed = await seedConversation({ state: 'repersist', sourceProvider: 'llm-gateway' });
  const completeRecovery = await getRecoveryOptions(app, completeSeed.conversation._id);
  const completeConfirmation = await confirmPlan(
    app,
    completeSeed.conversation._id,
    completeRecovery,
    triagePlan(completeRecovery),
    'complete-after-recovery'
  );
  const completeOperation = await waitForOperation(
    app,
    completeSeed.conversation._id,
    completeConfirmation.body.operation.operationId,
    'succeeded'
  );
  assert.equal(completeOperation.postRecoveryEvidence.status, 'complete');
  assert.deepEqual(completeOperation.postRecoveryEvidence.remainingMissingCodes, []);
  assert.equal((await getEvidence(app, completeSeed.conversation._id)).status, 'complete');

  const partialSeed = await seedConversation({
    state: 'repersist',
    sourceProvider: 'llm-gateway',
    parserHistoryMissing: true,
  });
  const partialRecovery = await getRecoveryOptions(app, partialSeed.conversation._id);
  const partialConfirmation = await confirmPlan(
    app,
    partialSeed.conversation._id,
    partialRecovery,
    triagePlan(partialRecovery),
    'partial-after-recovery'
  );
  const partialOperation = await waitForOperation(
    app,
    partialSeed.conversation._id,
    partialConfirmation.body.operation.operationId,
    'succeeded'
  );
  assert.equal(partialOperation.postRecoveryEvidence.status, 'incomplete');
  assert.ok(partialOperation.postRecoveryEvidence.remainingMissingCodes.includes('IMAGE_PARSE_RESULT'));
  const partialEvidence = await getEvidence(app, partialSeed.conversation._id);
  assert.equal(partialEvidence.status, 'incomplete');
  assert.ok(partialEvidence.missing.some((artifact) => artifact.code === 'IMAGE_PARSE_RESULT'));
  assert.equal(providerStub.calls.length, 0);
});

test('legacy receipt-less session receives no recovery offer and POST is refused', async () => {
  const seeded = await seedConversation({ state: 'legacy' });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  assert.equal(recovery.evidenceStatus, 'unknown');
  assert.deepEqual(recovery.options, []);

  const attempt = await supertest(app)
    .post(`/api/conversations/${seeded.conversation._id}/evidence/recovery`)
    .send({
      action: 'rerun-stage',
      evidenceFingerprint: recovery.evidenceFingerprint,
      idempotencyKey: 'legacy-must-refuse',
    });
  assert.equal(attempt.status, 409);
  assert.equal(attempt.body.code, 'RECOVERY_PLAN_UNAVAILABLE');
  assert.equal(providerStub.calls.length, 0);
  assert.equal(await RecoveryOperation.countDocuments({}), 0);
});

test('stale evidence fingerprint returns EVIDENCE_CHANGED without creating an operation', async () => {
  const seeded = await seedConversation({ state: 'rerun' });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);
  await Conversation.updateOne(
    { _id: seeded.conversation._id },
    { $set: { 'caseIntake.evidence.updatedAt': new Date(Date.now() + 60_000) } }
  );

  const confirmation = await confirmPlan(app, seeded.conversation._id, recovery, plan, 'stale-fingerprint');
  assert.equal(confirmation.status, 409);
  assert.equal(confirmation.body.code, 'EVIDENCE_CHANGED');
  assert.equal(providerStub.calls.length, 0);
  assert.equal(await RecoveryOperation.countDocuments({}), 0);
});

test('cancel before provider handoff makes zero provider calls; cancel after success reports succeeded honestly', async () => {
  providerStub.boundaryGate = deferred();
  providerStub.entered = deferred();
  providerStub.settled = deferred();
  const seeded = await seedConversation({ state: 'rerun' });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const confirmation = await confirmPlan(app, seeded.conversation._id, recovery, triagePlan(recovery), 'cancel-before-call');
  assert.equal(confirmation.status, 202, JSON.stringify(confirmation.body));
  const operationId = confirmation.body.operation.operationId;
  await withTimeout(providerStub.entered.promise, 'Recovery did not reach the pre-provider boundary.');

  const cancelled = await supertest(app)
    .post(`/api/conversations/${seeded.conversation._id}/evidence/recovery/${operationId}/cancel`)
    .send({});
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  providerStub.boundaryGate.resolve();
  await withTimeout(providerStub.settled.promise, 'Cancelled provider stub did not settle.');
  const cancelledOperation = await waitForOperation(app, seeded.conversation._id, operationId, 'cancelled');
  assert.equal(cancelledOperation.status, 'cancelled');
  assert.equal(providerStub.calls.length, 0);
  const unchanged = await Conversation.findById(seeded.conversation._id).lean();
  assert.equal(unchanged.caseIntake.triageCard, null);

  providerStub.boundaryGate = null;
  providerStub.entered = null;
  providerStub.settled = null;
  const completedSeed = await seedConversation({ state: 'rerun' });
  const completedRecovery = await getRecoveryOptions(app, completedSeed.conversation._id);
  const completedConfirmation = await confirmPlan(
    app,
    completedSeed.conversation._id,
    completedRecovery,
    triagePlan(completedRecovery),
    'finish-before-cancel'
  );
  const completedOperationId = completedConfirmation.body.operation.operationId;
  await waitForOperation(app, completedSeed.conversation._id, completedOperationId, 'succeeded');
  const cancelAfter = await supertest(app)
    .post(`/api/conversations/${completedSeed.conversation._id}/evidence/recovery/${completedOperationId}/cancel`)
    .send({});
  assert.equal(cancelAfter.status, 200);
  assert.equal(cancelAfter.body.alreadyCompleted, true);
  assert.equal(cancelAfter.body.operation.status, 'succeeded');
  assert.equal(providerStub.calls.length, 1);
});

test('cancel-requested operations remain visible in the active operation list', async () => {
  const conversation = await Conversation.create({
    title: 'Active cancellation',
    provider: 'claude',
    messages: [],
  });
  const operationId = `cancel-requested-${new mongoose.Types.ObjectId()}`;
  await RecoveryOperation.create({
    operationId,
    idempotencyKey: `idempotency-${operationId}`,
    dedupeKey: `dedupe-${operationId}`,
    conversationId: conversation._id,
    targetStage: 'triage',
    strategy: 'rerun-stage',
    status: 'cancel-requested',
    evidenceFingerprint: { contractVersion: 1, evidenceUpdatedAt: '', missingCodes: ['TRIAGE_CARD'] },
    inputSnapshot: {
      canonicalTemplate: CANONICAL_TEMPLATE,
      canonicalTemplateSha256: 'a'.repeat(64),
      parseFieldsSha256: 'b'.repeat(64),
      sourceRecordIds: {},
    },
    heartbeatAt: new Date(),
    cancellationRequestedAt: new Date(),
  });

  const response = await supertest(app).get('/api/conversations/recovery/active');
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const active = response.body.operations.find((operation) => operation.operationId === operationId);
  assert.ok(active);
  assert.equal(active.status, 'cancel-requested');
});

test('stale polling does not interrupt a live local recovery executor', async () => {
  providerStub.boundaryGate = deferred();
  providerStub.entered = deferred();
  providerStub.settled = deferred();
  const seeded = await seedConversation({ state: 'rerun' });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const confirmation = await confirmPlan(app, seeded.conversation._id, recovery, triagePlan(recovery), 'live-stale-poll');
  const operationId = confirmation.body.operation.operationId;
  await withTimeout(providerStub.entered.promise, 'Recovery did not reach the live executor boundary.');
  await RecoveryOperation.updateOne(
    { operationId },
    { $set: { heartbeatAt: new Date(Date.now() - 10 * 60 * 1000) } }
  );

  const polled = await supertest(app)
    .get(`/api/conversations/${seeded.conversation._id}/evidence/recovery/${operationId}`);
  assert.equal(polled.status, 200, JSON.stringify(polled.body));
  assert.equal(polled.body.operation.status, 'running');

  const cancellation = await supertest(app)
    .post(`/api/conversations/${seeded.conversation._id}/evidence/recovery/${operationId}/cancel`)
    .send({});
  assert.equal(cancellation.status, 200, JSON.stringify(cancellation.body));
  providerStub.boundaryGate.resolve();
  await withTimeout(providerStub.settled.promise, 'Cancelled live executor did not settle.');
  await waitForOperation(app, seeded.conversation._id, operationId, 'cancelled');
});

test('GET recovery options uses only cached/no-cost readiness signals and never calls a provider', async () => {
  const seeded = await seedConversation({ state: 'rerun' });
  const triageRowsBefore = await TriageResult.countDocuments({});
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);

  assert.equal(plan.strategy, 'rerun-stage');
  assert.equal(plan.aiCallNeeded, true);
  assert.equal(plan.group, 'provider-call');
  assert.equal(plan.costEstimate.amountKnown, false);
  assert.equal(plan.costEstimate.amount, null);
  assert.match(plan.costEstimate.message, /cost amount is unknown/i);
  assert.equal(plan.readiness.provider, 'lm-studio');
  assert.equal(plan.readiness.cachedPreflight, null);
  assert.match(plan.readiness.label, /live readiness has not been checked/i);
  assert.equal(providerStub.calls.length, 0);
  assert.equal(await TriageResult.countDocuments({}), triageRowsBefore);
  assert.equal(await RecoveryOperation.countDocuments({}), 0);
});

test('recovery options are returned as one ordered grouped summary', async () => {
  const noCostSeed = await seedConversation({ state: 'repersist', parserHistoryMissing: true });
  const noCostRecovery = await getRecoveryOptions(app, noCostSeed.conversation._id);
  assert.deepEqual(noCostRecovery.groups.map((group) => group.id), ['no-cost', 'human-review']);
  assert.deepEqual(noCostRecovery.options.map((option) => option.group), ['no-cost', 'human-review']);
  assert.match(noCostRecovery.recommendedOrderNote, /no-cost recoveries first/i);

  const providerSeed = await seedConversation({ state: 'rerun', parserHistoryMissing: true });
  const providerRecovery = await getRecoveryOptions(app, providerSeed.conversation._id);
  assert.deepEqual(providerRecovery.groups.map((group) => group.id), ['provider-call', 'human-review']);
  assert.deepEqual(providerRecovery.options.map((option) => option.group), ['provider-call', 'human-review']);
});

test('runtime defaults changed after review return RECOVERY_PLAN_CHANGED without creating or calling', async () => {
  const seeded = await seedConversation({ state: 'rerun' });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const reviewedPlan = triagePlan(recovery);
  runtimeDefaultsStub = {
    ...runtimeDefaultsStub,
    provider: 'llm-gateway',
    model: 'changed-after-review-model',
    reasoningEffort: 'medium',
    serviceTier: 'priority',
  };

  const confirmation = await confirmPlan(
    app,
    seeded.conversation._id,
    recovery,
    reviewedPlan,
    'runtime-changed-after-review'
  );
  assert.equal(confirmation.status, 409, JSON.stringify(confirmation.body));
  assert.equal(confirmation.body.code, 'RECOVERY_PLAN_CHANGED');
  assert.match(confirmation.body.error, /review/i);
  assert.equal(await RecoveryOperation.countDocuments({}), 0);
  assert.equal(providerStub.calls.length, 0);
});

test('recovery execution keeps the reviewed runtime snapshot when live defaults change mid-flight', async () => {
  providerStub.boundaryGate = deferred();
  providerStub.entered = deferred();
  providerStub.settled = deferred();
  const seeded = await seedConversation({ state: 'rerun' });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);
  const reviewedRuntime = clone(plan.runtimeSnapshot);

  const confirmation = await confirmPlan(
    app,
    seeded.conversation._id,
    recovery,
    plan,
    'stored-runtime-snapshot'
  );
  assert.equal(confirmation.status, 202, JSON.stringify(confirmation.body));
  await withTimeout(providerStub.entered.promise, 'Recovery did not reach the provider boundary.');
  runtimeDefaultsStub = {
    ...runtimeDefaultsStub,
    provider: 'llm-gateway',
    model: 'live-defaults-changed-mid-flight',
    fallbackProvider: 'openai',
    fallbackModel: 'gpt-5.5',
  };
  providerStub.boundaryGate.resolve();
  await withTimeout(providerStub.settled.promise, 'Recovery provider stub did not settle.');
  const operation = await waitForOperation(
    app,
    seeded.conversation._id,
    confirmation.body.operation.operationId,
    'succeeded'
  );

  assert.equal(providerStub.calls.length, 1);
  assert.equal(providerStub.calls[0].provider, reviewedRuntime.provider);
  assert.equal(providerStub.calls[0].model, reviewedRuntime.model);
  assert.equal(operation.runtimeSnapshot.provider, reviewedRuntime.provider);
  assert.equal(operation.runtimeSnapshot.model, reviewedRuntime.model);
});

test('confirmation refuses a reviewed provider that server-side readiness knows is unsupported', async () => {
  runtimeDefaultsStub = {
    ...runtimeDefaultsStub,
    provider: 'unsupported-recovery-provider',
    model: 'unsupported-model',
  };
  const seeded = await seedConversation({ state: 'rerun' });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);
  assert.match(plan.readiness.label, /not supported/i);

  const confirmation = await confirmPlan(
    app,
    seeded.conversation._id,
    recovery,
    plan,
    'unsupported-readiness'
  );
  assert.equal(confirmation.status, 409, JSON.stringify(confirmation.body));
  assert.equal(confirmation.body.code, 'RECOVERY_PROVIDER_NOT_READY');
  assert.match(confirmation.body.error, /not supported/i);
  assert.equal(await RecoveryOperation.countDocuments({}), 0);
  assert.equal(providerStub.calls.length, 0);
});

test('post-write evidence recheck failure records an honest succeeded-unverified write-applied result', async () => {
  const seeded = await seedConversation({ state: 'rerun' });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);
  evidenceStub.failOnceAfterRecoveryWrite = true;

  const confirmation = await confirmPlan(
    app,
    seeded.conversation._id,
    recovery,
    plan,
    'write-applied-recheck-fails'
  );
  const operation = await waitForOperation(
    app,
    seeded.conversation._id,
    confirmation.body.operation.operationId,
    'succeeded-unverified'
  );
  assert.equal(operation.conversationWriteApplied, true);
  assert.ok(operation.commitStartedAt);
  assert.ok(operation.commitCompletedAt);
  assert.equal(operation.errorCode, 'RECOVERY_WRITE_APPLIED_VERIFICATION_INCOMPLETE');
  assert.match(operation.errorMessage, /write was applied/i);
  assert.ok(operation.acceptedResult?.acceptedSha256);
  const conversation = await Conversation.findById(seeded.conversation._id).lean();
  assert.equal(
    conversation.caseIntake.evidence.receipts.triage.recoveryOperationId,
    operation.operationId
  );

  const retry = await confirmPlan(
    app,
    seeded.conversation._id,
    recovery,
    plan,
    'write-applied-must-not-rerun'
  );
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.created, false);
  assert.equal(retry.body.operation.operationId, operation.operationId);
  assert.equal(providerStub.calls.length, 1);
});

test('stale reconciliation recognizes a matching conversation receipt as an applied write', async () => {
  const seeded = await seedConversation({ state: 'rerun' });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);
  const old = new Date(Date.now() - 10 * 60 * 1000);
  const operation = await createPlanAttempt({
    seeded,
    recovery,
    plan,
    status: 'running',
    idempotencyKey: 'receipt-reconciliation',
    overrides: {
      executorId: 'stale-executor',
      heartbeatAt: old,
      commitStartedAt: old,
      attempts: [{ attempt: 1, strategy: 'rerun-stage', status: 'running', startedAt: old }],
    },
  });
  await Conversation.updateOne(
    { _id: seeded.conversation._id },
    {
      $set: {
        'caseIntake.evidence.receipts.triage.recoveryOperationId': operation.operationId,
        'caseIntake.evidence.receipts.triage.completedAt': old,
      },
    }
  );

  const reconciled = await waitForOperation(
    app,
    seeded.conversation._id,
    operation.operationId,
    'succeeded-unverified'
  );
  assert.equal(reconciled.conversationWriteApplied, true);
  assert.equal(reconciled.errorCode, 'RECOVERY_WRITE_APPLIED_VERIFICATION_INCOMPLETE');
  assert.match(reconciled.errorMessage, /write was applied/i);
  const durable = await RecoveryOperation.findOne({ operationId: operation.operationId }).lean();
  assert.equal(durable.activePlanId, undefined);
  assert.equal(durable.attempts[0].status, 'succeeded-unverified');
});

test('failed, cancelled, and interrupted plans allow one fresh numbered retry while the old key reattaches', async () => {
  for (const status of ['failed', 'cancelled', 'interrupted']) {
    const seeded = await seedConversation({ state: 'rerun' });
    const recovery = await getRecoveryOptions(app, seeded.conversation._id);
    const plan = triagePlan(recovery);
    const oldKey = `terminal-${status}-old-key`;
    const prior = await createPlanAttempt({ seeded, recovery, plan, status, idempotencyKey: oldKey });
    const callsBefore = providerStub.calls.length;

    const sameKey = await confirmPlan(app, seeded.conversation._id, recovery, plan, oldKey);
    assert.equal(sameKey.status, 200, JSON.stringify(sameKey.body));
    assert.equal(sameKey.body.operation.operationId, prior.operationId);
    assert.equal(sameKey.body.created, false);
    assert.equal(providerStub.calls.length, callsBefore);

    const fresh = await confirmPlan(
      app,
      seeded.conversation._id,
      recovery,
      plan,
      `terminal-${status}-fresh-key`
    );
    assert.equal(fresh.status, 202, JSON.stringify(fresh.body));
    assert.notEqual(fresh.body.operation.operationId, prior.operationId);
    assert.equal(fresh.body.operation.attemptNumber, 2);
    await waitForOperation(app, seeded.conversation._id, fresh.body.operation.operationId, 'succeeded');
    assert.equal(providerStub.calls.length, callsBefore + 1);
  }
});

test('succeeded, awaiting-acceptance, and manual-review plans remain attached and do not rerun', async () => {
  for (const status of ['succeeded', 'awaiting-acceptance', 'manual-review']) {
    const seeded = await seedConversation({ state: 'rerun' });
    const recovery = await getRecoveryOptions(app, seeded.conversation._id);
    const plan = triagePlan(recovery);
    const prior = await createPlanAttempt({ seeded, recovery, plan, status });
    const callsBefore = providerStub.calls.length;

    const confirmation = await confirmPlan(
      app,
      seeded.conversation._id,
      recovery,
      plan,
      `blocked-${status}-fresh-key`
    );
    assert.equal(confirmation.status, 200, JSON.stringify(confirmation.body));
    assert.equal(confirmation.body.created, false);
    assert.equal(confirmation.body.operation.operationId, prior.operationId);
    assert.equal(confirmation.body.operation.status, status);
    assert.equal(providerStub.calls.length, callsBefore);
  }
});

test('concurrent fresh retries after failure create only one active attempt and one provider call', async () => {
  const seeded = await seedConversation({ state: 'rerun' });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);
  await createPlanAttempt({ seeded, recovery, plan, status: 'failed' });

  const confirmations = await Promise.all([
    confirmPlan(app, seeded.conversation._id, recovery, plan, 'retry-race-a'),
    confirmPlan(app, seeded.conversation._id, recovery, plan, 'retry-race-b'),
    confirmPlan(app, seeded.conversation._id, recovery, plan, 'retry-race-c'),
  ]);
  assert.ok(confirmations.every((response) => [200, 202].includes(response.status)));
  assert.equal(confirmations.filter((response) => response.body.created === true).length, 1);
  const operationIds = new Set(confirmations.map((response) => response.body.operation.operationId));
  assert.equal(operationIds.size, 1);
  const [operationId] = operationIds;
  await waitForOperation(app, seeded.conversation._id, operationId, 'succeeded');
  assert.equal(await RecoveryOperation.countDocuments({ planId: plan.planId }), 2);
  assert.equal(await RecoveryOperation.countDocuments({ activePlanId: plan.planId }), 0);
  assert.equal(providerStub.calls.length, 1);
});

test('stale confirmed operation becomes interrupted and is not auto-resumed', async () => {
  const seeded = await seedConversation({ state: 'rerun' });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);
  const operation = await createPlanAttempt({
    seeded,
    recovery,
    plan,
    status: 'confirmed',
    idempotencyKey: 'orphaned-confirmed',
  });
  const old = new Date(Date.now() - 10 * 60 * 1000);
  await RecoveryOperation.collection.updateOne(
    { operationId: operation.operationId },
    { $set: { heartbeatAt: null, createdAt: old, updatedAt: old } }
  );

  const interrupted = await waitForOperation(
    app,
    seeded.conversation._id,
    operation.operationId,
    'interrupted'
  );
  assert.equal(interrupted.errorCode, 'RECOVERY_INTERRUPTED');
  assert.match(interrupted.errorMessage, /did not start/i);
  assert.equal(providerStub.calls.length, 0);
  const durable = await RecoveryOperation.findOne({ operationId: operation.operationId }).lean();
  assert.equal(durable.activePlanId, undefined);
});

test('executor-start rejection is durably recorded instead of being discarded', async () => {
  const seeded = await seedConversation({ state: 'rerun' });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const plan = triagePlan(recovery);
  const realFindOne = RecoveryOperation.findOne;
  let injected = false;
  RecoveryOperation.findOne = function failExecutorStart(filter, ...args) {
    if (!injected && filter?.operationId && filter?.status === 'confirmed') {
      injected = true;
      return { lean: async () => { throw new Error('Simulated executor-start failure.'); } };
    }
    return realFindOne.call(this, filter, ...args);
  };
  try {
    const confirmation = await confirmPlan(
      app,
      seeded.conversation._id,
      recovery,
      plan,
      'executor-start-error'
    );
    assert.equal(confirmation.status, 202, JSON.stringify(confirmation.body));
    const failed = await waitForOperation(
      app,
      seeded.conversation._id,
      confirmation.body.operation.operationId,
      'failed'
    );
    assert.equal(injected, true);
    assert.equal(failed.errorCode, 'RECOVERY_FAILED');
    assert.match(failed.errorMessage, /server or database error/i);
    assert.equal(providerStub.calls.length, 0);
  } finally {
    RecoveryOperation.findOne = realFindOne;
  }
});

test('operation status is durable across repeated polls and a fresh service/router load', async () => {
  providerStub.card = clone(DIFFERENT_CARD);
  const seeded = await seedConversation({ state: 'rerun', priorCard: ORIGINAL_CARD });
  const recovery = await getRecoveryOptions(app, seeded.conversation._id);
  const confirmation = await confirmPlan(app, seeded.conversation._id, recovery, triagePlan(recovery), 'durable-poll');
  const operationId = confirmation.body.operation.operationId;
  const first = await waitForOperation(app, seeded.conversation._id, operationId, 'awaiting-acceptance');
  const second = await waitForOperation(app, seeded.conversation._id, operationId, 'awaiting-acceptance');
  assert.equal(second.operationId, first.operationId);
  assert.equal(second.status, first.status);
  assert.deepEqual(second.candidateResult.comparison, first.candidateResult.comparison);

  // Reloading these CommonJS modules creates a new empty in-process registry,
  // which simulates a browser/server attachment refresh while Mongo stays live.
  const refreshedApp = buildApp();
  const afterRefresh = await waitForOperation(
    refreshedApp,
    seeded.conversation._id,
    operationId,
    'awaiting-acceptance'
  );
  assert.equal(afterRefresh.operationId, first.operationId);
  assert.equal(afterRefresh.status, first.status);
  assert.deepEqual(afterRefresh.candidateResult.comparison, first.candidateResult.comparison);
  const durable = await RecoveryOperation.findOne({ operationId }).lean();
  assert.equal(durable.status, 'awaiting-acceptance');
});
