const { getProviderIds } = require('./providers/registry');

const FAILURE_THRESHOLD = Number.parseInt(process.env.PROVIDER_FAILURE_THRESHOLD || '3', 10) || 3;
const UNHEALTHY_COOLDOWN_MS = Number.parseInt(process.env.PROVIDER_UNHEALTHY_COOLDOWN_MS || '45000', 10) || 45_000;

const providerState = new Map();

function ensure(provider) {
  if (!providerState.has(provider)) {
    providerState.set(provider, {
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastErrorCode: null,
      lastErrorMessage: '',
    });
  }
  return providerState.get(provider);
}

function recordSuccess(provider) {
  const state = ensure(provider);
  state.consecutiveFailures = 0;
  state.lastSuccessAt = new Date();
  state.lastErrorCode = null;
  state.lastErrorMessage = '';
}

function recordFailure(provider, errorCode, errorMessage) {
  const state = ensure(provider);
  state.consecutiveFailures += 1;
  state.lastFailureAt = new Date();
  state.lastErrorCode = errorCode || 'UNKNOWN';
  state.lastErrorMessage = (errorMessage || '').slice(0, 500);
}

function getProviderHealth(provider) {
  const state = ensure(provider);
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
    healthy: state.consecutiveFailures < FAILURE_THRESHOLD,
    consecutiveFailures: state.consecutiveFailures,
    failureThreshold: FAILURE_THRESHOLD,
    unhealthyCooldownMs: UNHEALTHY_COOLDOWN_MS,
    lastSuccessAt: state.lastSuccessAt,
    lastFailureAt: state.lastFailureAt,
    lastErrorCode: state.lastErrorCode,
    lastErrorMessage: state.lastErrorMessage,
  };
}

function listProviderHealth() {
  return getProviderIds().map((provider) => getProviderHealth(provider));
}

function resetProviderHealth() {
  providerState.clear();
}

module.exports = {
  recordSuccess,
  recordFailure,
  getProviderHealth,
  listProviderHealth,
  resetProviderHealth,
};
