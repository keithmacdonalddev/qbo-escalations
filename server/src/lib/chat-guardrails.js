const UsageLog = require('../models/UsageLog');
const { calculateCost, microsToUsd } = require('./pricing');
const { getAlternateProvider } = require('../services/providers/registry');
const { getDefaultProvider } = require('../services/providers/registry');

const DEFAULT_EXPECTED_OUTPUT_TOKENS = 2000;
const DEFAULT_MAX_TOOL_ROUNDS = 4;

function toMicrosFromUsd(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 1_000_000);
}

function formatBudgetMessage(prefix, projectedMicros, limitMicros) {
  return `${prefix}: projected ${microsToUsd(projectedMicros)} exceeds limit ${microsToUsd(limitMicros)}`;
}

async function getTodayChatSpendMicros() {
  const now = new Date();
  const start = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0, 0, 0, 0
  ));

  try {
    const out = await UsageLog.aggregate([
      { $match: { createdAt: { $gte: start } } },
      { $group: { _id: null, total: { $sum: '$totalCostMicros' } } },
    ]);
    const total = out && out[0] ? Number(out[0].total) : 0;
    return Number.isFinite(total) ? Math.max(0, total) : 0;
  } catch {
    return 0;
  }
}

function buildFallbackOverride(currentPolicy) {
  const approved = currentPolicy?.costEligibleFallback;
  if (!approved || approved.eligible !== true || !approved.provider) return null;
  const mode = 'single';
  const primaryProvider = approved.provider;
  const fallbackProvider = approved.fallbackProvider || getAlternateProvider(primaryProvider);

  const changed = currentPolicy.mode !== mode || currentPolicy.primaryProvider !== primaryProvider;
  if (!changed) return null;

  return {
    mode,
    primaryProvider,
    primaryModel: approved.model || '',
    fallbackProvider,
    authority: {
      source: approved.source || 'agent-evaluation-contract',
      runId: approved.runId || '',
      eligible: true,
    },
  };
}

async function evaluateChatGuardrails({
  settings,
  estimatedInputTokens,
  expectedOutputTokens = DEFAULT_EXPECTED_OUTPUT_TOKENS,
  maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS,
  policy,
}) {
  const guardrails = settings.guardrails || {};
  const action = guardrails.onBudgetExceeded || 'warn';
  const primaryProvider = policy.primaryProvider || getDefaultProvider();
  const primaryModel = policy.primaryModel || '';
  const perAttemptCost = calculateCost(estimatedInputTokens, expectedOutputTokens, primaryModel, primaryProvider);
  const attemptsPerRound = policy.mode === 'parallel'
    ? Math.max(1, Array.isArray(policy.parallelProviders) ? policy.parallelProviders.length : 2)
    : (policy.fallbackProvider && policy.fallbackProvider !== primaryProvider ? 2 : 1);
  const boundedToolRounds = Number.isFinite(Number(maxToolRounds)) && Number(maxToolRounds) > 0
    ? Math.min(8, Math.floor(Number(maxToolRounds)))
    : DEFAULT_MAX_TOOL_ROUNDS;
  const estimatedAttemptCount = attemptsPerRound * boundedToolRounds;
  const estimatedInputCostMicros = (Number(perAttemptCost.inputCostMicros) || 0) * estimatedAttemptCount;
  const estimatedOutputCostMicros = (Number(perAttemptCost.outputCostMicros) || 0) * estimatedAttemptCount;
  const estimatedRequestCostMicros = (Number(perAttemptCost.totalCostMicros) || 0) * estimatedAttemptCount;

  const maxRequestMicros = toMicrosFromUsd(guardrails.maxEstimatedRequestCostUsd);
  const dailyBudgetMicros = toMicrosFromUsd(guardrails.dailyBudgetUsd);
  const todaySpentMicros = dailyBudgetMicros > 0 ? await getTodayChatSpendMicros() : 0;
  const projectedDailyMicros = todaySpentMicros + estimatedRequestCostMicros;

  const warnings = [];
  let blocked = false;
  let blockCode = '';
  let blockError = '';
  let policyOverride = null;

  const requestExceeded = maxRequestMicros > 0 && estimatedRequestCostMicros > maxRequestMicros;
  const dailyExceeded = dailyBudgetMicros > 0 && projectedDailyMicros > dailyBudgetMicros;

  if (requestExceeded) {
    warnings.push({
      code: 'MAX_REQUEST_COST_EXCEEDED',
      message: formatBudgetMessage('Estimated request cost over limit', estimatedRequestCostMicros, maxRequestMicros),
    });
  }

  if (dailyExceeded) {
    warnings.push({
      code: 'DAILY_BUDGET_EXCEEDED',
      message: formatBudgetMessage('Daily projected agent spend over limit', projectedDailyMicros, dailyBudgetMicros),
    });
  }

  if ((requestExceeded || dailyExceeded) && action === 'block') {
    blocked = true;
    blockCode = requestExceeded ? 'MAX_REQUEST_COST_EXCEEDED' : 'DAILY_BUDGET_EXCEEDED';
    blockError = warnings[0] ? warnings[0].message : 'Budget guardrail blocked request';
  } else if ((requestExceeded || dailyExceeded) && action === 'fallback') {
    policyOverride = buildFallbackOverride(policy);
    if (policyOverride) {
      warnings.push({
        code: 'GUARDRAIL_FALLBACK_APPLIED',
        message: `Guardrail fallback applied from current evaluation evidence: switched to ${policyOverride.primaryProvider} in single mode`,
      });
    } else {
      warnings.push({
        code: 'GUARDRAIL_FALLBACK_NOT_AUTHORIZED',
        message: 'Guardrail fallback requested, but no current quality-approved cost fallback is bound to this agent and workflow; continuing the current policy.',
      });
    }
  }

  return {
    blocked,
    blockCode,
    blockError,
    warnings,
    policyOverride,
    costEstimate: {
      estimatedInputTokens,
      expectedOutputTokens,
      estimatedAttemptCount,
      attemptsPerRound,
      maxToolRounds: boundedToolRounds,
      estimatedInputCostMicros,
      estimatedOutputCostMicros,
      estimatedRequestCostMicros,
      estimatedRequestCostUsd: microsToUsd(estimatedRequestCostMicros),
      estimatedInputCostUsd: microsToUsd(estimatedInputCostMicros),
      rateFound: perAttemptCost.rateFound === true,
      model: primaryModel,
      provider: primaryProvider,
      todaySpentMicros,
      dailyBudgetMicros,
      projectedDailyMicros,
    },
  };
}

module.exports = {
  evaluateChatGuardrails,
};

