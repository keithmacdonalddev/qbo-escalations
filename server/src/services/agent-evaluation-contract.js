'use strict';

const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const AgentIdentity = require('../models/AgentIdentity');
const {
  getAgentPromptDefinition,
  getPromptSha256,
  getRenderedAgentPrompt,
} = require('../lib/agent-prompt-store');
const {
  OUTPUT_CONTRACT_VERSION,
  validateEvaluationChecks,
} = require('../lib/agent-output-contract');
const { getProviderModelId } = require('./providers/catalog');
const { DEFAULT_PROFILES, mergeAgentProfile } = require('./room-agents/agent-profiles');

const EVALUATION_CONTRACT_VERSION = 'agent-evaluation-v1';
const BEHAVIOR_CONTRACT_VERSION = 'agent-behavior-v1';
const TOOL_AUTHORITY_CONTRACT_VERSION = 'shared-agent-tool-authority-v1';
const CONTEXT_TRUST_CONTRACT_VERSION = 'agent-context-trust-v1';
const DEFAULT_EVALUATION_MAX_AGE_DAYS = 30;
// Only the internal recordTrustedAgentHarnessRun path can set trusted=true;
// public harness routes always remain diagnostic. The server recomputes the
// current behavior binding and an evidence digest before authorizing fallback.
const SERVER_EVALUATION_AUTHORITY_IMPLEMENTED = true;
const SERVER_EVALUATION_AUTHORITY_VERSION = 'server-agent-evaluator-v1';

const BEHAVIOR_SOURCE_FILES = Object.freeze([
  ['sharedToolCatalog', require.resolve('./shared-agent-tools')],
  ['sharedToolLoop', require.resolve('./agent-tool-loop')],
  ['chatContextBuilder', require.resolve('../lib/chat-context-builder')],
  ['chatRequestAssembly', require.resolve('../routes/chat/send')],
  ['chatOrchestrator', require.resolve('./chat-orchestrator')],
  ['agentIdentityOverlay', require.resolve('./agent-identity-service')],
  ['agentProfiles', require.resolve('./room-agents/agent-profiles')],
  ['agentOutputContract', require.resolve('../lib/agent-output-contract')],
  ['providerRegistry', require.resolve('./providers/registry')],
  ['providerCatalog', require.resolve('./providers/catalog')],
  ['imageParser', require.resolve('./image-parser')],
  ['triageAgent', require.resolve('./triage')],
  ['knowledgebaseAgent', require.resolve('./knowledgebase-agent-context-service')],
  ['knownIssueAgent', require.resolve('./known-issue-search-agent')],
  ['roomAgentRuntime', require.resolve('./room-agent-runtime')],
  ['workspaceContext', require.resolve('./workspace-context-builder')],
]);

const PROMPT_BY_AGENT = Object.freeze({
  chat: 'chat-core',
  workspace: 'workspace-action',
  copilot: 'copilot-agent',
  'image-analyst': 'escalation-template-parser',
  'escalation-template-parser': 'escalation-template-parser',
  'follow-up-chat-parser': 'follow-up-chat-parser',
  'triage-agent': 'triage-agent',
  'known-issue-search-agent': 'known-issue-search-agent',
  'knowledgebase-agent': 'knowledgebase-agent',
});

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function canonicalize(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    const next = value[key];
    if (next !== undefined && key !== '_id' && key !== '__v') result[key] = canonicalize(next);
    return result;
  }, {});
}

function hashValue(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function hashBehaviorSourceFiles() {
  return BEHAVIOR_SOURCE_FILES.reduce((result, [name, filePath]) => {
    try {
      result.hashes[name] = createHash('sha256').update(readFileSync(filePath)).digest('hex');
    } catch (error) {
      result.failures.push({ name, code: safeString(error?.code) || 'READ_FAILED' });
    }
    return result;
  }, { hashes: {}, failures: [] });
}

function normalizeIdentityConfig(identityConfig = {}, agentId = '') {
  const source = typeof identityConfig?.toObject === 'function'
    ? identityConfig.toObject({ depopulate: true })
    : identityConfig;
  return canonicalize({
    enabled: source?.enabled !== false,
    profile: DEFAULT_PROFILES[agentId]
      ? mergeAgentProfile(agentId, source?.profile || {})
      : (source?.profile || {}),
    runtime: source?.runtime || {},
    workspacePolicy: source?.workspacePolicy || {},
    custom: {
      isCustom: source?.custom?.isCustom === true,
      registryStatus: safeString(source?.custom?.registryStatus),
      promptId: safeString(source?.custom?.promptId),
      metadata: source?.custom?.metadata || {},
    },
  });
}

function normalizeModel(provider, model) {
  return safeString(model) || getProviderModelId(provider) || '';
}

function resolvePromptId(agentId, suppliedPromptId = '') {
  const explicit = safeString(suppliedPromptId);
  if (explicit && getAgentPromptDefinition(explicit)) return explicit;
  const mapped = PROMPT_BY_AGENT[agentId];
  if (mapped && getAgentPromptDefinition(mapped)) return mapped;
  const custom = `custom-${agentId}`;
  return getAgentPromptDefinition(custom) ? custom : '';
}

function resolveCurrentPromptContract(agentId, suppliedPromptId = '') {
  const promptId = resolvePromptId(agentId, suppliedPromptId);
  if (!promptId) return { promptId: '', promptHash: '', promptAvailable: false };
  const prompt = getRenderedAgentPrompt(promptId);
  return {
    promptId,
    promptHash: getPromptSha256(prompt),
    promptAvailable: true,
  };
}

function resolveCurrentBehaviorContract(agentId, suppliedPromptId = '', identityConfig = {}) {
  const prompt = resolveCurrentPromptContract(agentId, suppliedPromptId);
  const agentConfig = normalizeIdentityConfig(identityConfig, agentId);
  const behaviorSources = hashBehaviorSourceFiles();
  const manifest = {
    version: BEHAVIOR_CONTRACT_VERSION,
    agentId: safeString(agentId),
    promptId: prompt.promptId,
    promptHash: prompt.promptHash,
    agentConfigHash: hashValue(agentConfig),
    toolAuthorityVersion: TOOL_AUTHORITY_CONTRACT_VERSION,
    outputContractVersion: OUTPUT_CONTRACT_VERSION,
    evaluationContractVersion: EVALUATION_CONTRACT_VERSION,
    contextTrustVersion: CONTEXT_TRUST_CONTRACT_VERSION,
    sourceHashes: behaviorSources.hashes,
    sourceHashFailures: behaviorSources.failures,
  };
  return {
    ...manifest,
    hash: hashValue(manifest),
    promptAvailable: prompt.promptAvailable,
    sourcesAvailable: behaviorSources.failures.length === 0,
  };
}

function resolveMaxAgeMs() {
  const parsed = Number.parseFloat(process.env.AGENT_EVALUATION_MAX_AGE_DAYS || '');
  const days = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EVALUATION_MAX_AGE_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

function normalizeCases(cases = []) {
  return (Array.isArray(cases) ? cases : []).map((item) => ({
    caseId: safeString(item?.caseId || item?.id),
    status: safeString(item?.status).toLowerCase(),
  }));
}

function assessEvaluationContract({
  agentId,
  runStatus,
  cases,
  metadata,
  trusted = false,
  identityConfig = {},
  now = new Date(),
} = {}) {
  const contract = metadata?.evaluationContract && typeof metadata.evaluationContract === 'object'
    ? metadata.evaluationContract
    : {};
  const normalizedCases = normalizeCases(cases);
  const currentBehavior = resolveCurrentBehaviorContract(agentId, contract.promptId, identityConfig);
  const currentPrompt = currentBehavior;
  const checks = validateEvaluationChecks(contract.checks);
  const evaluatedAt = contract.evaluatedAt ? new Date(contract.evaluatedAt) : null;
  const serverNow = new Date(now);
  const expiresAt = evaluatedAt && !Number.isNaN(evaluatedAt.getTime())
    ? new Date(evaluatedAt.getTime() + resolveMaxAgeMs())
    : null;
  const issues = [];

  if (!SERVER_EVALUATION_AUTHORITY_IMPLEMENTED) {
    issues.push({
      code: 'EVALUATION_AUTHORITY_NOT_IMPLEMENTED',
      message: 'Harness evidence is retained for review, but no canonical server-owned evaluator currently authorizes automatic fallback.',
    });
  } else if (!trusted) {
    issues.push({ code: 'EVALUATION_NOT_SERVER_TRUSTED', message: 'Manual harness evidence cannot authorize automatic fallback.' });
  }
  if (safeString(runStatus).toLowerCase() !== 'pass') issues.push({ code: 'HARNESS_RUN_NOT_PASSED', message: 'Harness run status is not pass.' });
  if (normalizedCases.length === 0) issues.push({ code: 'HARNESS_CASES_EMPTY', message: 'At least one explicit case is required.' });
  if (normalizedCases.some((item) => item.status !== 'pass')) {
    issues.push({ code: 'HARNESS_CASE_NOT_PASSED', message: 'Every harness case must explicitly pass.' });
  }
  if (safeString(contract.version) !== EVALUATION_CONTRACT_VERSION) {
    issues.push({ code: 'EVALUATION_CONTRACT_VERSION_INVALID', message: `Expected ${EVALUATION_CONTRACT_VERSION}.` });
  }
  if (safeString(contract.agentId) !== agentId) issues.push({ code: 'EVALUATION_AGENT_MISMATCH', message: 'Evaluation agent does not match.' });
  if (!safeString(contract.useCase)) issues.push({ code: 'EVALUATION_USE_CASE_MISSING', message: 'Evaluation useCase is required.' });
  if (safeString(contract.targetRole) !== 'fallback') issues.push({ code: 'EVALUATION_TARGET_INVALID', message: 'Fallback evaluations must use targetRole=fallback.' });
  if (!safeString(contract.provider)) issues.push({ code: 'EVALUATION_PROVIDER_MISSING', message: 'Evaluation provider is required.' });
  if (!safeString(contract.model)) issues.push({ code: 'EVALUATION_MODEL_MISSING', message: 'Evaluation model is required.' });
  if (!safeString(contract.suiteId) || !safeString(contract.suiteVersion)) {
    issues.push({ code: 'EVALUATION_SUITE_MISSING', message: 'suiteId and suiteVersion are required.' });
  }
  if (!currentPrompt.promptAvailable) issues.push({ code: 'EVALUATION_PROMPT_UNAVAILABLE', message: 'Current prompt could not be resolved.' });
  if (!currentBehavior.sourcesAvailable) issues.push({ code: 'EVALUATION_BEHAVIOR_SOURCES_UNAVAILABLE', message: 'One or more behavior-contract sources could not be hashed.' });
  if (safeString(contract.promptId) !== currentPrompt.promptId) issues.push({ code: 'EVALUATION_PROMPT_ID_MISMATCH', message: 'Prompt id is not current.' });
  if (safeString(contract.promptHash) !== currentPrompt.promptHash) issues.push({ code: 'EVALUATION_PROMPT_HASH_STALE', message: 'Prompt hash does not match the current prompt.' });
  if (safeString(contract.behaviorContractVersion) !== BEHAVIOR_CONTRACT_VERSION) {
    issues.push({ code: 'BEHAVIOR_CONTRACT_VERSION_INVALID', message: `Expected ${BEHAVIOR_CONTRACT_VERSION}.` });
  }
  if (safeString(contract.behaviorHash) !== currentBehavior.hash) {
    issues.push({ code: 'EVALUATION_BEHAVIOR_HASH_STALE', message: 'Evaluation does not match the current agent behavior contract.' });
  }
  if (!evaluatedAt || Number.isNaN(evaluatedAt.getTime())) issues.push({ code: 'EVALUATION_TIME_MISSING', message: 'evaluatedAt is required.' });
  if (evaluatedAt && !Number.isNaN(evaluatedAt.getTime()) && evaluatedAt.getTime() > serverNow.getTime()) {
    issues.push({ code: 'EVALUATION_TIME_IN_FUTURE', message: 'evaluatedAt cannot be later than server time.' });
  }
  if (expiresAt && expiresAt.getTime() <= serverNow.getTime()) issues.push({ code: 'EVALUATION_EXPIRED', message: 'Evaluation is no longer current.' });
  issues.push(...checks.issues);
  const trustedByServer = SERVER_EVALUATION_AUTHORITY_IMPLEMENTED && trusted === true;
  const evidenceId = trustedByServer ? hashValue({
    authorityVersion: SERVER_EVALUATION_AUTHORITY_VERSION,
    agentId,
    runStatus: safeString(runStatus).toLowerCase(),
    cases: normalizedCases,
    contract,
    behaviorHash: currentBehavior.hash,
    checks: checks.checks,
    evaluatedAt: evaluatedAt?.toISOString() || '',
  }) : '';

  return {
    version: EVALUATION_CONTRACT_VERSION,
    authorityVersion: trustedByServer ? SERVER_EVALUATION_AUTHORITY_VERSION : '',
    evidenceId,
    trusted: trustedByServer,
    eligible: issues.length === 0,
    agentId,
    useCase: safeString(contract.useCase),
    targetRole: safeString(contract.targetRole),
    provider: safeString(contract.provider),
    model: safeString(contract.model),
    promptId: currentPrompt.promptId,
    promptHash: currentPrompt.promptHash,
    behaviorContractVersion: BEHAVIOR_CONTRACT_VERSION,
    behaviorHash: currentBehavior.hash,
    behaviorManifest: currentBehavior,
    suiteId: safeString(contract.suiteId),
    suiteVersion: safeString(contract.suiteVersion),
    evaluatedAt,
    expiresAt,
    checks: checks.checks,
    issues,
  };
}

async function getFallbackEligibility({
  agentId,
  useCase,
  provider,
  model,
  promptId = '',
  now = new Date(),
  identityDoc = null,
} = {}) {
  const normalizedAgentId = safeString(agentId);
  const normalizedProvider = safeString(provider);
  const normalizedModel = normalizeModel(normalizedProvider, model);
  if (!normalizedAgentId) {
    return { eligible: false, reason: 'agent_context_missing', provider: normalizedProvider, model: normalizedModel };
  }
  if (!normalizedProvider || !normalizedModel) {
    return { eligible: false, reason: 'fallback_identity_incomplete', provider: normalizedProvider, model: normalizedModel, agentId: normalizedAgentId };
  }

  if (!SERVER_EVALUATION_AUTHORITY_IMPLEMENTED) {
    return {
      eligible: false,
      reason: 'server_evaluation_authority_not_implemented',
      agentId: normalizedAgentId,
      useCase: safeString(useCase),
      provider: normalizedProvider,
      model: normalizedModel,
    };
  }

  const doc = identityDoc || await AgentIdentity.findOne({ agentId: normalizedAgentId })
    .select('agentId enabled profile runtime workspacePolicy custom harness.runs')
    .lean();
  const currentBehavior = resolveCurrentBehaviorContract(normalizedAgentId, promptId, doc || {});
  const currentPrompt = currentBehavior;
  if (!currentBehavior.promptAvailable) {
    return { eligible: false, reason: 'current_prompt_unavailable', provider: normalizedProvider, model: normalizedModel, agentId: normalizedAgentId };
  }
  if (!currentBehavior.sourcesAvailable) {
    return { eligible: false, reason: 'behavior_sources_unavailable', provider: normalizedProvider, model: normalizedModel, agentId: normalizedAgentId };
  }

  const runs = Array.isArray(doc?.harness?.runs) ? doc.harness.runs : [];
  const expectedUseCase = safeString(useCase);
  const relevantRuns = runs.filter((run) => {
    const binding = run?.metadata?.evaluationBinding;
    if (!binding) return false;
    if (safeString(binding.agentId) !== normalizedAgentId) return false;
    if (safeString(binding.useCase) !== expectedUseCase) return false;
    if (safeString(binding.provider) !== normalizedProvider) return false;
    if (safeString(binding.model) !== normalizedModel) return false;
    if (safeString(binding.promptId) !== currentPrompt.promptId) return false;
    if (safeString(binding.promptHash) !== currentPrompt.promptHash) return false;
    if (safeString(binding.behaviorContractVersion) !== BEHAVIOR_CONTRACT_VERSION) return false;
    if (safeString(binding.behaviorHash) !== currentBehavior.hash) return false;
    if (safeString(binding.authorityVersion) !== SERVER_EVALUATION_AUTHORITY_VERSION) return false;
    if (!/^[a-f0-9]{64}$/.test(safeString(binding.evidenceId))) return false;
    const reassessed = assessEvaluationContract({
      agentId: normalizedAgentId,
      runStatus: run.status,
      cases: run.cases,
      metadata: run.metadata,
      trusted: true,
      identityConfig: doc || {},
      now,
    });
    if (!reassessed.eligible || reassessed.evidenceId !== binding.evidenceId) return false;
    return true;
  });
  const latestRelevant = relevantRuns
    .slice()
    .sort((left, right) => new Date(right.completedAt || right.createdAt || 0) - new Date(left.completedAt || left.createdAt || 0))[0];
  const latestBinding = latestRelevant?.metadata?.evaluationBinding;
  const latestExpiry = latestBinding?.expiresAt ? new Date(latestBinding.expiresAt) : null;
  const matching = latestRelevant
    && latestRelevant.status === 'pass'
    && latestBinding?.eligible === true
    && latestBinding?.trusted === true
    && latestExpiry
    && !Number.isNaN(latestExpiry.getTime())
    && latestExpiry.getTime() > new Date(now).getTime()
    ? latestRelevant
    : null;

  if (!matching) {
    return {
      eligible: false,
      reason: runs.length > 0 ? 'no_current_matching_evaluation' : 'no_evaluation_evidence',
      agentId: normalizedAgentId,
      useCase: expectedUseCase,
      provider: normalizedProvider,
      model: normalizedModel,
      promptId: currentPrompt.promptId,
      promptHash: currentPrompt.promptHash,
      behaviorContractVersion: BEHAVIOR_CONTRACT_VERSION,
      behaviorHash: currentBehavior.hash,
      evaluatedRunCount: runs.length,
    };
  }

  const binding = matching.metadata.evaluationBinding;
  return {
    eligible: true,
    reason: 'current_evaluation_passed',
    agentId: normalizedAgentId,
    useCase: expectedUseCase,
    provider: normalizedProvider,
    model: normalizedModel,
    promptId: currentPrompt.promptId,
    promptHash: currentPrompt.promptHash,
    behaviorContractVersion: BEHAVIOR_CONTRACT_VERSION,
    behaviorHash: currentBehavior.hash,
    runId: matching.runId,
    suiteId: binding.suiteId,
    suiteVersion: binding.suiteVersion,
    evaluatedAt: binding.evaluatedAt,
    expiresAt: binding.expiresAt,
  };
}

module.exports = {
  BEHAVIOR_CONTRACT_VERSION,
  CONTEXT_TRUST_CONTRACT_VERSION,
  DEFAULT_EVALUATION_MAX_AGE_DAYS,
  EVALUATION_CONTRACT_VERSION,
  PROMPT_BY_AGENT,
  TOOL_AUTHORITY_CONTRACT_VERSION,
  SERVER_EVALUATION_AUTHORITY_IMPLEMENTED,
  SERVER_EVALUATION_AUTHORITY_VERSION,
  assessEvaluationContract,
  getFallbackEligibility,
  normalizeModel,
  resolveCurrentPromptContract,
  resolveCurrentBehaviorContract,
  resolvePromptId,
};
