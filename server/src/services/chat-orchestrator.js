const {
  getProvider,
  getAlternateProvider,
  normalizeProvider,
} = require('./providers/registry');
const {
  recordSuccess,
  recordFailure,
  getProviderHealth,
} = require('./provider-health');

const VALID_MODES = new Set(['single', 'fallback', 'parallel']);

function normalizeMode(mode) {
  return VALID_MODES.has(mode) ? mode : 'single';
}

function resolvePolicy({ mode, primaryProvider, fallbackProvider }) {
  const resolvedMode = normalizeMode(mode);
  const resolvedPrimary = normalizeProvider(primaryProvider);
  const resolvedFallback = normalizeProvider(fallbackProvider || getAlternateProvider(resolvedPrimary));

  return {
    mode: resolvedMode,
    primaryProvider: resolvedPrimary,
    fallbackProvider: resolvedFallback,
  };
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
  messages,
  systemPrompt,
  images,
  timeoutMs,
  onChunk,
  onSettled,
}) {
  const provider = getProvider(providerId);
  const startedAt = Date.now();
  let settled = false;
  let cleanup = null;
  let timeoutHandle = null;

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
      onChunk: (text) => {
        if (settled) return;
        onChunk({
          provider: providerId,
          text,
        });
      },
      onDone: (fullResponse, usageMeta) => {
        if (settled) return;
        recordSuccess(providerId);
        finalize({
          ok: true,
          provider: providerId,
          fullResponse: fullResponse || '',
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
          error: normalized,
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
      error: normalized,
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
        error,
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
      error: { code: 'ABORT', message: `${providerId} request aborted` },
      latencyMs: Date.now() - startedAt,
      usage: abortUsage,
    });
  };
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
    attempt.model = result.usage.model;
    attempt.usage = result.usage;
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

function startChatOrchestration({
  mode,
  primaryProvider,
  fallbackProvider,
  messages,
  systemPrompt,
  images = [],
  timeoutMs,
  onChunk,
  onProviderError,
  onFallback,
  onDone,
  onError,
  onAbort,
}) {
  const policy = resolvePolicy({ mode, primaryProvider, fallbackProvider });

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
        messages,
        systemPrompt,
        images,
        timeoutMs: getEffectiveTimeoutMs(providerId),
        onChunk: onChunk || (() => {}),
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
      const providers = policy.fallbackProvider !== policy.primaryProvider
        ? [policy.primaryProvider, policy.fallbackProvider]
        : [policy.primaryProvider];

      const results = await Promise.all(providers.map((providerId) => runSingleAttempt(providerId)));
      if (cancelled) return;

      const successful = [];
      for (const result of results) {
        attempts.push(toAttempt(result));
        if (result.ok) {
          successful.push({
            provider: result.provider,
            status: 'ok',
            fullResponse: result.fullResponse || '',
            latencyMs: result.latencyMs,
            usage: result.usage || null,
          });
        } else {
          onProviderError?.({
            provider: result.provider,
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
            status: 'error',
            errorCode: r.error.code,
            errorMessage: r.error.message,
            errorDetail: r.error.detail || '',
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
          provider: policy.primaryProvider, // backward compatibility for old clients
          fallbackUsed: false,
          fallbackFrom: null,
          fullResponse: '',
          results: orderedResults,
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
          provider: providerId, // backward compatibility
          fallbackUsed: Boolean(fallbackFrom),
          fallbackFrom,
          fullResponse: result.fullResponse,
          attempts,
          mode: policy.mode,
          usage: result.usage || null,
        });
        return;
      }

      attempts.push(toAttempt(result));

      onProviderError?.({
        provider: providerId,
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
        to: nextProvider,
        reason: result.error.code || 'PROVIDER_EXEC_FAILED',
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
  resolvePolicy,
  startChatOrchestration,
};
