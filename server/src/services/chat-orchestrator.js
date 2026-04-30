const {
  getProvider,
  getAlternateProvider,
  normalizeProvider,
  isValidProvider,
} = require('./providers/registry');
const { getProviderModelId } = require('./providers/catalog');
const {
  recordSuccess,
  recordFailure,
  getProviderHealth,
} = require('./provider-health');

const VALID_MODES = new Set(['single', 'fallback', 'parallel']);

function normalizeMode(mode) {
  return VALID_MODES.has(mode) ? mode : 'single';
}

function normalizeModelOverride(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveProviderModel(providerId, modelOverride) {
  return normalizeModelOverride(modelOverride) || getProviderModelId(providerId) || '';
}

function resolvePolicy({ mode, primaryProvider, primaryModel, fallbackProvider, fallbackModel, parallelProviders }) {
  const resolvedMode = normalizeMode(mode);
  const resolvedPrimary = normalizeProvider(primaryProvider);
  const resolvedFallback = normalizeProvider(fallbackProvider || getAlternateProvider(resolvedPrimary));

  const policy = {
    mode: resolvedMode,
    primaryProvider: resolvedPrimary,
    primaryModel: normalizeModelOverride(primaryModel),
    fallbackProvider: resolvedFallback,
    fallbackModel: normalizeModelOverride(fallbackModel),
  };

  if (parallelProviders && Array.isArray(parallelProviders) && parallelProviders.length >= 2) {
    const invalid = parallelProviders.filter((p) => !isValidProvider(p));
    if (invalid.length > 0) {
      const err = new Error(
        `Invalid parallel providers: ${invalid.join(', ')}. Each provider must be a recognized provider ID.`
      );
      err.code = 'INVALID_PARALLEL_PROVIDERS';
      throw err;
    }

    const deduped = [...new Set(parallelProviders)];

    if (deduped.length < 2 || deduped.length > 4) {
      const err = new Error(
        `parallelProviders must contain between 2 and 4 unique providers (got ${deduped.length} after deduplication).`
      );
      err.code = 'PARALLEL_PROVIDER_COUNT_INVALID';
      throw err;
    }

    if (primaryProvider && isValidProvider(primaryProvider) && !deduped.includes(primaryProvider)) {
      const err = new Error(
        `primaryProvider "${primaryProvider}" is not included in parallelProviders [${deduped.join(', ')}]. ` +
        'The primary provider must be one of the parallel providers when both are specified.'
      );
      err.code = 'INVALID_PARALLEL_PROVIDERS';
      throw err;
    }

    policy.parallelProviders = deduped;
  }

  return policy;
}

function toProviderErrorMessage(provider, code, rawMessage) {
  const normalizedCode = String(code || 'PROVIDER_EXEC_FAILED').toUpperCase();
  const raw = String(rawMessage || '').toLowerCase();
  const missingRuntime =
    raw.includes('not recognized as an internal or external command')
    || raw.includes('command not found')
    || raw.includes('enoent');
  const unsupportedImageFlag =
    (raw.includes('unknown option') || raw.includes('unknown argument') || raw.includes('unrecognized option'))
    && raw.includes('--image');

  if (normalizedCode === 'TIMEOUT') {
    return `${provider} timed out`;
  }
  if (missingRuntime) {
    return `${provider} runtime unavailable`;
  }
  if (unsupportedImageFlag) {
    return `${provider} runtime does not support image attachments`;
  }
  if (normalizedCode === 'INVALID_CHAT_ADAPTER') {
    return `${provider} provider unavailable`;
  }
  if (normalizedCode === 'INTERNAL') {
    return 'Provider orchestration failed';
  }
  return `${provider} request failed`;
}

function normalizeProviderErrorDetail(rawMessage) {
  const detail = String(rawMessage || '').trim();
  if (!detail) return '';
  return detail.slice(0, 1200);
}

function normalizeProviderError(provider, err, defaultCode = 'PROVIDER_EXEC_FAILED') {
  const code = err && err.code ? err.code : defaultCode;
  const rawMessage = err && err.message ? err.message : '';
  const message = toProviderErrorMessage(provider, code, rawMessage);
  const detail = normalizeProviderErrorDetail(rawMessage);
  return { provider, code, message, detail };
}

function runAttempt({
  providerId,
  model,
  messages,
  systemPrompt,
  images,
  reasoningEffort,
  timeoutMs,
  onChunk,
  onThinkingChunk,
  onSettled,
}) {
  const provider = getProvider(providerId);
  const startedAt = Date.now();
  let settled = false;
  let cleanup = null;
  let timeoutHandle = null;
  let thinkingText = '';

  function finalize(result) {
    if (settled) return;
    settled = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    timeoutHandle = null;
    cleanup = null;
    onSettled(result);
  }

  try {
    cleanup = provider.chat({
      messages,
      systemPrompt,
      images,
      model: normalizeModelOverride(model) || undefined,
      reasoningEffort,
      timeoutMs,
      onChunk: (text) => {
        if (settled) return;
        onChunk({
          provider: providerId,
          text,
        });
      },
      onThinkingChunk: (thinking) => {
        if (settled) return;
        const chunk = typeof thinking === 'string' ? thinking : '';
        if (chunk) thinkingText += chunk;
        onThinkingChunk?.({ provider: providerId, thinking: chunk });
      },
      onDone: (fullResponse, usageMeta) => {
        if (settled) return;
        recordSuccess(providerId);
        finalize({
          ok: true,
          provider: providerId,
          model: resolveProviderModel(providerId, (usageMeta && usageMeta.model) || model),
          fullResponse: fullResponse || '',
          thinking: thinkingText,
          latencyMs: Date.now() - startedAt,
          usage: usageMeta || null,
        });
      },
      onError: (err) => {
        if (settled) return;
        const normalized = normalizeProviderError(providerId, err || {});
        recordFailure(providerId, normalized.code, normalized.message);
        finalize({
          ok: false,
          provider: providerId,
          model: resolveProviderModel(providerId, model),
          error: normalized,
          thinking: thinkingText,
          latencyMs: Date.now() - startedAt,
          usage: (err && err._usage) || null,
        });
      },
    });
  } catch (err) {
    const normalized = normalizeProviderError(providerId, err);
    recordFailure(providerId, normalized.code, normalized.message);
    finalize({
      ok: false,
      provider: providerId,
      model: resolveProviderModel(providerId, model),
      error: normalized,
      thinking: thinkingText,
      latencyMs: Date.now() - startedAt,
      usage: null,
    });
  }

  if (!settled) {
    timeoutHandle = setTimeout(() => {
      if (settled) return;
      let abortUsage = null;
      try {
        const abortData = cleanup ? cleanup() : null;
        abortUsage = abortData && abortData.usage ? abortData.usage : null;
      } catch { /* ignore */ }
      const error = normalizeProviderError(providerId, {
        code: 'TIMEOUT',
        message: `${providerId} timed out after ${timeoutMs}ms`,
      }, 'TIMEOUT');
      recordFailure(providerId, error.code, error.message);
      finalize({
        ok: false,
        provider: providerId,
        model: resolveProviderModel(providerId, model),
        error,
        thinking: thinkingText,
        latencyMs: Date.now() - startedAt,
        usage: abortUsage,
      });
    }, timeoutMs);
  }

  // Cancel function (R16): must call finalize with abort result so Promise resolves
  return () => {
    if (settled) return;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    timeoutHandle = null;
    let abortUsage = null;
    try {
      const abortData = cleanup ? cleanup() : null;
      abortUsage = abortData && abortData.usage ? abortData.usage : null;
    } catch { /* ignore */ }
    finalize({
      ok: false,
      provider: providerId,
      model: resolveProviderModel(providerId, model),
      error: { code: 'ABORT', message: `${providerId} request aborted` },
      thinking: thinkingText,
      latencyMs: Date.now() - startedAt,
      usage: abortUsage,
    });
  };
}

function buildProviderThinkingMap(results) {
  const providerThinking = {};
  for (const result of Array.isArray(results) ? results : []) {
    if (!result || !result.provider) continue;
    const thinking = typeof result.thinking === 'string' ? result.thinking : '';
    if (!thinking.trim()) continue;
    providerThinking[result.provider] = thinking;
  }
  return providerThinking;
}

function toAttempt(result) {
  const attempt = result.ok
    ? {
        provider: result.provider,
        status: 'ok',
        latencyMs: result.latencyMs,
      }
    : {
        provider: result.provider,
        status: 'error',
        latencyMs: result.latencyMs,
        errorCode: result.error.code,
        errorMessage: result.error.message,
        errorDetail: result.error.detail || '',
      };

  if (result.usage) {
    attempt.inputTokens = result.usage.inputTokens;
    attempt.outputTokens = result.usage.outputTokens;
    attempt.model = result.usage.model || result.model;
    attempt.usage = result.usage;
  } else if (result.model) {
    attempt.model = result.model;
  }

  return attempt;
}

function resolveSequentialProviders(policy) {
  const hasDistinctFallback = policy.fallbackProvider !== policy.primaryProvider;
  if (policy.mode !== 'fallback' || !hasDistinctFallback) {
    return [policy.primaryProvider];
  }

  const primaryHealth = getProviderHealth(policy.primaryProvider);
  const fallbackHealth = getProviderHealth(policy.fallbackProvider);
  const preferFallbackFirst = !primaryHealth.healthy && fallbackHealth.healthy;

  return preferFallbackFirst
    ? [policy.fallbackProvider, policy.primaryProvider]
    : [policy.primaryProvider, policy.fallbackProvider];
}

function buildUnhealthyFallbackDetail(providerHealth) {
  if (!providerHealth || providerHealth.healthy) return '';
  if (providerHealth.lastErrorMessage) return providerHealth.lastErrorMessage;
  if (providerHealth.consecutiveFailures > 0) {
    return `${providerHealth.consecutiveFailures} recent failure${providerHealth.consecutiveFailures === 1 ? '' : 's'} triggered the temporary unhealthy state.`;
  }
  return '';
}

function getPolicyModel(policy, providerId) {
  if (providerId === policy.primaryProvider) {
    return policy.primaryModel || '';
  }
  if (providerId === policy.fallbackProvider) {
    return policy.fallbackModel || '';
  }
  return '';
}

function startChatOrchestration({
  mode,
  primaryProvider,
  primaryModel,
  fallbackProvider,
  fallbackModel,
  parallelProviders,
  messages,
  systemPrompt,
  images = [],
  reasoningEffort,
  timeoutMs,
  onChunk,
  onThinkingChunk,
  onProviderError,
  onFallback,
  onDone,
  onError,
  onAbort,
}) {
  const policy = resolvePolicy({
    mode,
    primaryProvider,
    primaryModel,
    fallbackProvider,
    fallbackModel,
    parallelProviders,
  });

  let cancelled = false;
  let orchestrationSettled = false;
  const activeCleanups = new Map();
  const attempts = [];
  const allSettledResults = [];

  function getEffectiveTimeoutMs(providerId) {
    const providerMeta = getProvider(providerId);
    return Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : providerMeta.defaultTimeoutMs;
  }

  function runSingleAttempt(providerId) {
    return new Promise((resolve) => {
      const cleanup = runAttempt({
        providerId,
        model: getPolicyModel(policy, providerId),
        messages,
        systemPrompt,
        images,
        reasoningEffort,
        timeoutMs: getEffectiveTimeoutMs(providerId),
        onChunk: onChunk || (() => {}),
        onThinkingChunk: onThinkingChunk || null,
        onSettled: (result) => {
          activeCleanups.delete(providerId);
          allSettledResults.push(result);
          resolve(result);
        },
      });
      activeCleanups.set(providerId, cleanup);
    });
  }

  (async () => {
    if (policy.mode === 'parallel') {
      const providers = policy.parallelProviders && policy.parallelProviders.length >= 2
        ? policy.parallelProviders
        : (policy.fallbackProvider !== policy.primaryProvider
          ? [policy.primaryProvider, policy.fallbackProvider]
          : [policy.primaryProvider]);

      // Global parallel turn timeout: slightly longer than the longest per-provider timeout
      // to give individual providers a chance to timeout first, with a buffer for cleanup.
      const maxProviderTimeout = Math.max(...providers.map((p) => getEffectiveTimeoutMs(p)));
      const globalTimeoutMs = maxProviderTimeout + 10000;
      let globalTimeoutHandle = null;

      const providerRace = Promise.all(providers.map((providerId) => runSingleAttempt(providerId)));
      const globalTimeoutPromise = new Promise((resolve) => {
        globalTimeoutHandle = setTimeout(() => {
          // Abort any remaining active providers
          for (const [, cancelFn] of activeCleanups) {
            try { cancelFn(); } catch { /* ignore */ }
          }
          resolve('GLOBAL_TIMEOUT');
        }, globalTimeoutMs);
      });

      const raceResult = await Promise.race([providerRace, globalTimeoutPromise]);

      // Clear the global timeout if providers completed normally
      if (globalTimeoutHandle) {
        clearTimeout(globalTimeoutHandle);
        globalTimeoutHandle = null;
      }

      // Collect results: either from normal completion or from allSettledResults after global timeout
      const results = raceResult === 'GLOBAL_TIMEOUT'
        ? allSettledResults.slice()
        : raceResult;

      if (cancelled) return;

      const successful = [];
      for (const result of results) {
        attempts.push(toAttempt(result));
        if (result.ok) {
          successful.push({
            provider: result.provider,
            model: result.usage?.model || result.model || '',
            status: 'ok',
            fullResponse: result.fullResponse || '',
            thinking: result.thinking || '',
            latencyMs: result.latencyMs,
            usage: result.usage || null,
          });
        } else {
          onProviderError?.({
            provider: result.provider,
            model: result.usage?.model || result.model || '',
            code: result.error.code,
            message: result.error.message,
            detail: result.error.detail || '',
            retriable: false,
          });
        }
      }

      if (successful.length > 0) {
        const failed = results
          .filter((r) => !r.ok)
          .map((r) => ({
            provider: r.provider,
            model: r.usage?.model || r.model || '',
            status: 'error',
            errorCode: r.error.code,
            errorMessage: r.error.message,
            errorDetail: r.error.detail || '',
            thinking: r.thinking || '',
            latencyMs: r.latencyMs,
            usage: r.usage || null,
          }));
        const orderedResults = providers.map((providerId) => (
          successful.find((r) => r.provider === providerId) ||
          failed.find((r) => r.provider === providerId) ||
          {
            provider: providerId,
            status: 'error',
            errorCode: 'UNKNOWN',
            errorMessage: 'Missing result',
            errorDetail: '',
            latencyMs: 0,
          }
        ));

        orchestrationSettled = true;
        onDone?.({
          providerUsed: 'parallel',
          modelUsed: '',
          provider: policy.primaryProvider, // backward compatibility for old clients
          fallbackUsed: false,
          fallbackFrom: null,
          fullResponse: '',
          results: orderedResults,
          providerThinking: buildProviderThinkingMap(results),
          attempts,
          mode: policy.mode,
        });
        return;
      }

      const lastResult = results[results.length - 1];
      const lastError = lastResult && lastResult.error;
      orchestrationSettled = true;
      onError?.({
        code: (lastError && lastError.code) || 'PROVIDER_EXEC_FAILED',
        message: (lastError && lastError.message) || 'All provider attempts failed',
        detail: (lastError && lastError.detail) || '',
        modelUsed: lastResult?.usage?.model || lastResult?.model || '',
        attempts,
        mode: policy.mode,
        usage: lastResult ? lastResult.usage || null : null,
      });
      return;
    }

    const sequence = resolveSequentialProviders(policy);
    let fallbackFrom = null;
    for (let i = 0; i < sequence.length; i++) {
      if (cancelled) return;

      const providerId = sequence[i];
      const result = await runSingleAttempt(providerId);

      if (cancelled) return;

      if (result.ok) {
        attempts.push(toAttempt(result));
        orchestrationSettled = true;
        onDone?.({
          providerUsed: providerId,
          modelUsed: result.usage?.model || result.model || '',
          provider: providerId, // backward compatibility
          fallbackUsed: Boolean(fallbackFrom),
          fallbackFrom,
          fullResponse: result.fullResponse,
          thinking: result.thinking || '',
          providerThinking: buildProviderThinkingMap(allSettledResults),
          attempts,
          mode: policy.mode,
          usage: result.usage || null,
        });
        return;
      }

      attempts.push(toAttempt(result));

      onProviderError?.({
        provider: providerId,
        model: result.usage?.model || result.model || '',
        code: result.error.code,
        message: result.error.message,
        detail: result.error.detail || '',
        retriable: i < sequence.length - 1,
      });

      const hasNext = i < sequence.length - 1;
      if (!hasNext) {
        orchestrationSettled = true;
        onError?.({
          code: result.error.code || 'PROVIDER_EXEC_FAILED',
          message: result.error.message || 'All provider attempts failed',
          detail: result.error.detail || '',
          modelUsed: result.usage?.model || result.model || '',
          attempts,
          mode: policy.mode,
          usage: result.usage || null,
        });
        return;
      }

      const nextProvider = sequence[i + 1];
      fallbackFrom = providerId;
      onFallback?.({
        from: providerId,
        fromModel: result.usage?.model || result.model || '',
        to: nextProvider,
        toModel: resolveProviderModel(nextProvider, getPolicyModel(policy, nextProvider)),
        reason: result.error.code || 'PROVIDER_EXEC_FAILED',
        detail: result.error.detail || '',
      });
    }
  })().catch((err) => {
    if (cancelled) return;
    orchestrationSettled = true;
    const normalized = normalizeProviderError(policy.primaryProvider, err, 'INTERNAL');
    onError?.({
      code: normalized.code,
      message: normalized.message,
      detail: normalized.detail || '',
      modelUsed: resolveProviderModel(policy.primaryProvider, policy.primaryModel),
      attempts,
      mode: policy.mode,
      usage: null,
    });
  });

  return () => {
    if (cancelled) return; // idempotent — second call is a no-op
    cancelled = true;
    const cleanupFns = [...activeCleanups.values()];
    for (const cancelFn of cleanupFns) {
      try { cancelFn(); } catch { /* ignore */ }
    }
    activeCleanups.clear();
    // Only fire onAbort for genuine in-flight aborts, not post-completion cleanup
    if (!orchestrationSettled) {
      onAbort?.({ attempts: allSettledResults.map(toAttempt) });
    }
  };
}

module.exports = {
  VALID_MODES,
  normalizeMode,
  normalizeModelOverride,
  resolveProviderModel,
  resolvePolicy,
  startChatOrchestration,
};
