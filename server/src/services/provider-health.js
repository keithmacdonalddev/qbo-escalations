const { getProviderIds } = require('./providers/registry');

const FAILURE_THRESHOLD = Number.parseInt(process.env.PROVIDER_FAILURE_THRESHOLD || '3', 10) || 3;
const UNHEALTHY_COOLDOWN_MS = Number.parseInt(process.env.PROVIDER_UNHEALTHY_COOLDOWN_MS || '45000', 10) || 45_000;

const providerState = new Map();

const NON_HEALTH_FAILURE_CODES = new Set([
  'ABORT',
  'ABORT_ERR',
  'CLIENT_DISCONNECTED',
  'INVALID_MODEL',
  'INVALID_REQUEST',
  'POLICY_BLOCKED',
  'PROVIDER_PACKAGE_CAPTURE_FAILED',
  'VALIDATION_ERROR',
]);

function normalizeScope(scope = {}) {
  return {
    model: typeof scope?.model === 'string' ? scope.model.trim() : '',
    useCase: typeof scope?.useCase === 'string' ? scope.useCase.trim() : '',
  };
}

function stateKey(provider, scope = {}) {
  const normalized = normalizeScope(scope);
  return `${provider}::${normalized.model || '*'}::${normalized.useCase || '*'}`;
}

function ensure(provider, scope = {}) {
  const key = stateKey(provider, scope);
  if (!providerState.has(key)) {
    providerState.set(key, {
      provider,
      scope: normalizeScope(scope),
      consecutiveFailures: 0,
      diagnosticFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastErrorCode: null,
      lastErrorMessage: '',
    });
  }
  return providerState.get(key);
}

function recordSuccess(provider, scope = {}) {
  const state = ensure(provider, scope);
  state.consecutiveFailures = 0;
  state.lastSuccessAt = new Date();
  state.lastErrorCode = null;
  state.lastErrorMessage = '';
}

function recordFailure(provider, errorCode, errorMessage, scope = {}) {
  const state = ensure(provider, scope);
  const code = String(errorCode || 'UNKNOWN').toUpperCase();
  const affectsAvailability = !NON_HEALTH_FAILURE_CODES.has(code);
  if (affectsAvailability) state.consecutiveFailures += 1;
  else state.diagnosticFailures += 1;
  state.lastFailureAt = new Date();
  state.lastErrorCode = code;
  state.lastErrorMessage = (errorMessage || '').slice(0, 500);
  return { affectsAvailability };
}

function getProviderHealth(provider, scope = {}) {
  const normalizedScope = normalizeScope(scope);
  const state = ensure(provider, normalizedScope);
  const now = Date.now();
  const lastFailureMs = state.lastFailureAt ? state.lastFailureAt.getTime() : 0;
  const cooldownElapsed = state.consecutiveFailures >= FAILURE_THRESHOLD
    ? (now - lastFailureMs) >= UNHEALTHY_COOLDOWN_MS
    : false;

  // Half-open style recovery: once cooldown elapses, allow attempts again.
  if (cooldownElapsed && state.consecutiveFailures >= FAILURE_THRESHOLD) {
    state.consecutiveFailures = FAILURE_THRESHOLD - 1;
  }

  return {
    provider,
    model: normalizedScope.model,
    useCase: normalizedScope.useCase,
    healthy: state.consecutiveFailures < FAILURE_THRESHOLD,
    consecutiveFailures: state.consecutiveFailures,
    diagnosticFailures: state.diagnosticFailures,
    failureThreshold: FAILURE_THRESHOLD,
    unhealthyCooldownMs: UNHEALTHY_COOLDOWN_MS,
    lastSuccessAt: state.lastSuccessAt,
    lastFailureAt: state.lastFailureAt,
    lastErrorCode: state.lastErrorCode,
    lastErrorMessage: state.lastErrorMessage,
  };
}

function listProviderHealth() {
  return getProviderIds().map((provider) => {
    const states = [...providerState.values()].filter((state) => state.provider === provider);
    const scopes = states.length > 0
      ? states.map((state) => getProviderHealth(provider, state.scope))
      : [getProviderHealth(provider)];
    const availabilityScopes = scopes.filter((entry) => (
      entry.lastSuccessAt || entry.lastFailureAt || entry.consecutiveFailures > 0
    ));
    const observedScopes = availabilityScopes.length > 0 ? availabilityScopes : scopes;
    const latestFailure = observedScopes
      .filter((entry) => entry.lastFailureAt)
      .sort((a, b) => new Date(b.lastFailureAt).getTime() - new Date(a.lastFailureAt).getTime())[0] || null;
    const latestSuccess = observedScopes
      .filter((entry) => entry.lastSuccessAt)
      .sort((a, b) => new Date(b.lastSuccessAt).getTime() - new Date(a.lastSuccessAt).getTime())[0] || null;

    return {
      provider,
      model: '',
      useCase: '',
      healthy: observedScopes.every((entry) => entry.healthy),
      consecutiveFailures: Math.max(0, ...observedScopes.map((entry) => entry.consecutiveFailures)),
      diagnosticFailures: observedScopes.reduce((sum, entry) => sum + entry.diagnosticFailures, 0),
      failureThreshold: FAILURE_THRESHOLD,
      unhealthyCooldownMs: UNHEALTHY_COOLDOWN_MS,
      lastSuccessAt: latestSuccess?.lastSuccessAt || null,
      lastFailureAt: latestFailure?.lastFailureAt || null,
      lastErrorCode: latestFailure?.lastErrorCode || null,
      lastErrorMessage: latestFailure?.lastErrorMessage || '',
      aggregation: 'all-observed-model-use-case-scopes',
      observedScopeCount: observedScopes.length,
      scopes,
    };
  });
}

function resetProviderHealth() {
  providerState.clear();
}

module.exports = {
  NON_HEALTH_FAILURE_CODES,
  recordSuccess,
  recordFailure,
  getProviderHealth,
  listProviderHealth,
  resetProviderHealth,
};
