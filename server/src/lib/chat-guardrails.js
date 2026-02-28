const UsageLog = require('../models/UsageLog');
const { calculateCost, microsToUsd, getRates } = require('./pricing');
const { getAlternateProvider } = require('../services/providers/registry');

const SUPPORTED_PROVIDERS = ['claude', 'chatgpt-5.3-codex-high', 'claude-sonnet-4-6', 'gpt-5-mini'];

function toMicrosFromUsd(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 1_000_000);
}

function formatBudgetMessage(prefix, projectedMicros, limitMicros) {
  return `${prefix}: projected ${microsToUsd(projectedMicros)} exceeds limit ${microsToUsd(limitMicros)}`;
}

function chooseCheapestProvider() {
  let best = SUPPORTED_PROVIDERS[0];
  let bestRate = Number.POSITIVE_INFINITY;
  for (const provider of SUPPORTED_PROVIDERS) {
    const rates = getRates('', provider);
    const inputRate = Number(rates && rates.inputNanosPerToken);
    const normalizedRate = Number.isFinite(inputRate) && inputRate > 0 ? inputRate : 999999;
    if (normalizedRate < bestRate) {
      bestRate = normalizedRate;
      best = provider;
    }
  }
  return best;
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
      { $match: { service: 'chat', createdAt: { $gte: start } } },
      { $group: { _id: null, total: { $sum: '$totalCostMicros' } } },
    ]);
    const total = out && out[0] ? Number(out[0].total) : 0;
    return Number.isFinite(total) ? Math.max(0, total) : 0;
  } catch {
    return 0;
  }
}

function buildFallbackOverride(currentPolicy) {
  const cheapest = chooseCheapestProvider();
  const mode = 'single';
  const primaryProvider = cheapest;
  const fallbackProvider = getAlternateProvider(cheapest);

  const changed = currentPolicy.mode !== mode || currentPolicy.primaryProvider !== primaryProvider;
  if (!changed) return null;

  return {
    mode,
    primaryProvider,
    fallbackProvider,
  };
}

async function evaluateChatGuardrails({
  settings,
  estimatedInputTokens,
  policy,
}) {
  const guardrails = settings.guardrails || {};
  const action = guardrails.onBudgetExceeded || 'warn';
  const primaryProvider = policy.primaryProvider || 'claude';
  const estimateCost = calculateCost(estimatedInputTokens, 0, '', primaryProvider);
  const estimatedInputCostMicros = Number(estimateCost.inputCostMicros) || 0;

  const maxRequestMicros = toMicrosFromUsd(guardrails.maxEstimatedRequestCostUsd);
  const dailyBudgetMicros = toMicrosFromUsd(guardrails.dailyBudgetUsd);
  const todaySpentMicros = dailyBudgetMicros > 0 ? await getTodayChatSpendMicros() : 0;
  const projectedDailyMicros = todaySpentMicros + estimatedInputCostMicros;

  const warnings = [];
  let blocked = false;
  let blockCode = '';
  let blockError = '';
  let policyOverride = null;

  const requestExceeded = maxRequestMicros > 0 && estimatedInputCostMicros > maxRequestMicros;
  const dailyExceeded = dailyBudgetMicros > 0 && projectedDailyMicros > dailyBudgetMicros;

  if (requestExceeded) {
    warnings.push({
      code: 'MAX_REQUEST_COST_EXCEEDED',
      message: formatBudgetMessage('Estimated request cost over limit', estimatedInputCostMicros, maxRequestMicros),
    });
  }

  if (dailyExceeded) {
    warnings.push({
      code: 'DAILY_BUDGET_EXCEEDED',
      message: formatBudgetMessage('Daily projected chat spend over limit', projectedDailyMicros, dailyBudgetMicros),
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
        message: `Guardrail fallback applied: switched to ${policyOverride.primaryProvider} in single mode`,
      });
    } else {
      warnings.push({
        code: 'GUARDRAIL_FALLBACK_NOOP',
        message: 'Guardrail fallback requested but no cheaper strategy available; continuing current policy',
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
      estimatedInputCostMicros,
      estimatedInputCostUsd: microsToUsd(estimatedInputCostMicros),
      todaySpentMicros,
      dailyBudgetMicros,
      projectedDailyMicros,
    },
  };
}

module.exports = {
  evaluateChatGuardrails,
};

