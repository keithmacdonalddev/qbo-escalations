const {
  getProvider,
  getAlternateProvider,
  normalizeProvider,
} = require('./providers/registry');
const {
  recordSuccess,
  recordFailure,
} = require('./provider-health');
const {
  parseEscalationText,
  looksLikeEscalation,
} = require('../lib/escalation-parser');
const { validateParsedEscalation } = require('../lib/parse-validation');

const VALID_PARSE_MODES = new Set(['single', 'fallback', 'parallel']);

function normalizeParseMode(mode) {
  return VALID_PARSE_MODES.has(mode) ? mode : 'single';
}

function resolveParsePolicy({ mode, primaryProvider, fallbackProvider }) {
  const resolvedMode = normalizeParseMode(mode);
  const resolvedPrimary = normalizeProvider(primaryProvider);
  const resolvedFallback = normalizeProvider(fallbackProvider || getAlternateProvider(resolvedPrimary));
  return {
    mode: resolvedMode,
    primaryProvider: resolvedPrimary,
    fallbackProvider: resolvedFallback,
  };
}

function normalizeProviderError(provider, err, defaultCode = 'PARSE_PROVIDER_FAILED') {
  return {
    provider,
    code: err && err.code ? err.code : defaultCode,
    message: err && err.message ? err.message : `${provider} parse failed`,
  };
}

async function runParseAttempt({
  providerId,
  image,
  text,
  reasoningEffort,
  timeoutMs,
  minScore,
}) {
  const provider = getProvider(providerId);
  const startedAt = Date.now();

  if (typeof provider.parseEscalation !== 'function') {
    const unsupported = normalizeProviderError(providerId, {
      code: 'UNSUPPORTED_PROVIDER_CAPABILITY',
      message: `${providerId} does not support parseEscalation`,
    }, 'UNSUPPORTED_PROVIDER_CAPABILITY');
    recordFailure(providerId, unsupported.code, unsupported.message);
    return {
      ok: false,
      provider: providerId,
      error: unsupported,
      latencyMs: Date.now() - startedAt,
      validation: null,
    };
  }

  try {
    const rawResult = await provider.parseEscalation(image || text || '', { timeoutMs, reasoningEffort });
    // Phase 2 compat: providers now return { fields, usage } wrapper
    const raw = rawResult && rawResult.fields ? rawResult.fields : rawResult;
    const providerUsage = rawResult && rawResult.usage ? rawResult.usage : null;
    const validation = validateParsedEscalation(raw, {
      sourceText: text || '',
      minScore,
    });

    if (!validation.passed) {
      const validationError = normalizeProviderError(providerId, {
        code: 'PARSE_VALIDATION_FAILED',
        message: `Validation score ${validation.score} below threshold`,
      }, 'PARSE_VALIDATION_FAILED');
      recordFailure(providerId, validationError.code, validationError.message);
      return {
        ok: false,
        provider: providerId,
        error: validationError,
        latencyMs: Date.now() - startedAt,
        validation,
        usage: providerUsage,
      };
    }

    recordSuccess(providerId);
    return {
      ok: true,
      provider: providerId,
      fields: validation.normalizedFields,
      latencyMs: Date.now() - startedAt,
      validation,
      usage: providerUsage,
    };
  } catch (err) {
    const normalized = normalizeProviderError(providerId, err);
    recordFailure(providerId, normalized.code, normalized.message);
    return {
      ok: false,
      provider: providerId,
      error: normalized,
      latencyMs: Date.now() - startedAt,
      validation: null,
      usage: (err && err._usage) || null,
    };
  }
}

function buildAttemptFromFailure(result) {
  const attempt = {
    provider: result.provider,
    status: 'error',
    latencyMs: result.latencyMs,
    errorCode: result.error.code,
    errorMessage: result.error.message,
    validationScore: result.validation ? result.validation.score : null,
    validationIssues: result.validation ? result.validation.issues : [],
  };

  if (result.usage) {
    attempt.inputTokens = result.usage.inputTokens;
    attempt.outputTokens = result.usage.outputTokens;
    attempt.model = result.usage.model;
    attempt.usage = result.usage;
  }

  return attempt;
}

function buildAttemptFromSuccess(result) {
  const attempt = {
    provider: result.provider,
    status: 'ok',
    latencyMs: result.latencyMs,
    validationScore: result.validation.score,
    validationIssues: result.validation.issues,
  };

  if (result.usage) {
    attempt.inputTokens = result.usage.inputTokens;
    attempt.outputTokens = result.usage.outputTokens;
    attempt.model = result.usage.model;
    attempt.usage = result.usage;
  }

  return attempt;
}

function toCandidateFromResult(result) {
  if (result.ok) {
    return {
      provider: result.provider,
      status: 'ok',
      latencyMs: result.latencyMs,
      validationScore: result.validation.score,
      validationIssues: result.validation.issues,
      fields: result.fields,
      usage: result.usage || null,
    };
  }
  return {
    provider: result.provider,
    status: 'error',
    latencyMs: result.latencyMs,
    errorCode: result.error.code,
    errorMessage: result.error.message,
    validationScore: result.validation ? result.validation.score : null,
    validationIssues: result.validation ? result.validation.issues : [],
    usage: result.usage || null,
  };
}

function chooseParallelWinner(successfulResults, providerOrder) {
  if (!Array.isArray(successfulResults) || successfulResults.length === 0) return null;

  return successfulResults.slice().sort((a, b) => {
    const scoreA = Number(a.validation && a.validation.score) || 0;
    const scoreB = Number(b.validation && b.validation.score) || 0;
    if (scoreA !== scoreB) return scoreB - scoreA;

    const issuesA = Array.isArray(a.validation && a.validation.issues) ? a.validation.issues.length : 0;
    const issuesB = Array.isArray(b.validation && b.validation.issues) ? b.validation.issues.length : 0;
    if (issuesA !== issuesB) return issuesA - issuesB;

    const latencyA = Number(a.latencyMs) || 0;
    const latencyB = Number(b.latencyMs) || 0;
    if (latencyA !== latencyB) return latencyA - latencyB;

    return providerOrder.indexOf(a.provider) - providerOrder.indexOf(b.provider);
  })[0];
}

function buildTerminalError(policy, attempts, lastError) {
  const err = new Error((lastError && lastError.message) || 'All parse attempts failed');
  err.code = 'PARSE_FAILED';
  err.finalErrorCode = (lastError && lastError.code) || 'PARSE_FAILED';
  err.attempts = attempts;
  err.mode = policy.mode;
  return err;
}

async function parseWithPolicy({
  image,
  text,
  mode,
  primaryProvider,
  fallbackProvider,
  reasoningEffort,
  timeoutMs,
  minScore,
  allowRegexFallback = true,
}) {
  const policy = resolveParsePolicy({ mode, primaryProvider, fallbackProvider });
  if (policy.mode === 'parallel') {
    if (policy.fallbackProvider === policy.primaryProvider) {
      policy.mode = 'single';
    }
    const providers = policy.fallbackProvider !== policy.primaryProvider
      ? [policy.primaryProvider, policy.fallbackProvider]
      : [policy.primaryProvider];
    const results = await Promise.all(providers.map(async (providerId) => {
      const providerMeta = getProvider(providerId);
      const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : providerMeta.defaultParseTimeoutMs;
      return runParseAttempt({
        providerId,
        image,
        text,
        reasoningEffort,
        timeoutMs: effectiveTimeoutMs,
        minScore,
      });
    }));

    const attempts = [];
    for (const result of results) {
      if (result.ok) attempts.push(buildAttemptFromSuccess(result));
      else attempts.push(buildAttemptFromFailure(result));
    }
    const candidates = results.map(toCandidateFromResult);
    const successful = results.filter((result) => result.ok);

    if (successful.length > 0) {
      const winner = chooseParallelWinner(successful, providers);
      return {
        fields: winner.fields,
        meta: {
          mode: policy.mode,
          providerUsed: winner.provider,
          winner: winner.provider,
          fallbackUsed: false,
          fallbackFrom: null,
          attempts,
          candidates,
          validation: {
            passed: winner.validation.passed,
            score: winner.validation.score,
            confidence: winner.validation.confidence,
            issues: winner.validation.issues,
            fieldsFound: winner.validation.fieldsFound,
          },
          usedRegexFallback: false,
        },
      };
    }

    let lastError = results[results.length - 1] ? results[results.length - 1].error : null;
    if (allowRegexFallback && text && looksLikeEscalation(text)) {
      const regexParsed = parseEscalationText(text);
      const validation = validateParsedEscalation(regexParsed, {
        sourceText: text,
        minScore,
      });

      if (!validation.passed) {
        const regexError = normalizeProviderError('regex', {
          code: 'PARSE_VALIDATION_FAILED',
          message: `Regex validation score ${validation.score} below threshold`,
        }, 'PARSE_VALIDATION_FAILED');
        attempts.push({
          provider: 'regex',
          status: 'error',
          latencyMs: 0,
          errorCode: regexError.code,
          errorMessage: regexError.message,
          validationScore: validation.score,
          validationIssues: validation.issues,
        });
        candidates.push({
          provider: 'regex',
          status: 'error',
          latencyMs: 0,
          errorCode: regexError.code,
          errorMessage: regexError.message,
          validationScore: validation.score,
          validationIssues: validation.issues,
        });
        lastError = regexError;
        const err = buildTerminalError(policy, attempts, lastError);
        err.candidates = candidates;
        throw err;
      }

      attempts.push({
        provider: 'regex',
        status: 'ok',
        latencyMs: 0,
        validationScore: validation.score,
        validationIssues: validation.issues,
      });
      candidates.push({
        provider: 'regex',
        status: 'ok',
        latencyMs: 0,
        validationScore: validation.score,
        validationIssues: validation.issues,
        fields: validation.normalizedFields,
      });
      return {
        fields: validation.normalizedFields,
        meta: {
          mode: policy.mode,
          providerUsed: 'regex',
          winner: 'regex',
          fallbackUsed: true,
          fallbackFrom: 'parallel',
          attempts,
          candidates,
          validation: {
            passed: validation.passed,
            score: validation.score,
            confidence: validation.confidence,
            issues: validation.issues,
            fieldsFound: validation.fieldsFound,
          },
          usedRegexFallback: true,
        },
      };
    }

    const err = buildTerminalError(policy, attempts, lastError);
    err.candidates = candidates;
    throw err;
  }

  const sequence = policy.mode === 'fallback' && policy.fallbackProvider !== policy.primaryProvider
    ? [policy.primaryProvider, policy.fallbackProvider]
    : [policy.primaryProvider];
  const attempts = [];
  let fallbackFrom = null;
  let lastError = null;

  for (let i = 0; i < sequence.length; i++) {
    const providerId = sequence[i];
    const providerMeta = getProvider(providerId);
    const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : providerMeta.defaultParseTimeoutMs;

    const result = await runParseAttempt({
      providerId,
      image,
      text,
      reasoningEffort,
      timeoutMs: effectiveTimeoutMs,
      minScore,
    });

    if (result.ok) {
      attempts.push(buildAttemptFromSuccess(result));

      return {
        fields: result.fields,
        meta: {
          mode: policy.mode,
          providerUsed: result.provider,
          fallbackUsed: Boolean(fallbackFrom),
          fallbackFrom,
          attempts,
          validation: {
            passed: result.validation.passed,
            score: result.validation.score,
            confidence: result.validation.confidence,
            issues: result.validation.issues,
            fieldsFound: result.validation.fieldsFound,
          },
          usedRegexFallback: false,
        },
      };
    }

    attempts.push(buildAttemptFromFailure(result));
    lastError = result.error;

    if (i < sequence.length - 1) {
      fallbackFrom = providerId;
    }
  }

  if (allowRegexFallback && text && looksLikeEscalation(text)) {
    const regexParsed = parseEscalationText(text);
    const validation = validateParsedEscalation(regexParsed, {
      sourceText: text,
      minScore,
    });

    if (!validation.passed) {
      const regexError = normalizeProviderError('regex', {
        code: 'PARSE_VALIDATION_FAILED',
        message: `Regex validation score ${validation.score} below threshold`,
      }, 'PARSE_VALIDATION_FAILED');
      attempts.push({
        provider: 'regex',
        status: 'error',
        latencyMs: 0,
        errorCode: regexError.code,
        errorMessage: regexError.message,
        validationScore: validation.score,
        validationIssues: validation.issues,
      });
      lastError = regexError;
      throw buildTerminalError(policy, attempts, lastError);
    }

    attempts.push({
      provider: 'regex',
      status: 'ok',
      latencyMs: 0,
      validationScore: validation.score,
      validationIssues: validation.issues,
    });

    return {
      fields: validation.normalizedFields,
      meta: {
        mode: policy.mode,
        providerUsed: 'regex',
        fallbackUsed: true,
        fallbackFrom: fallbackFrom || sequence[sequence.length - 1] || null,
        attempts,
        validation: {
          passed: validation.passed,
          score: validation.score,
          confidence: validation.confidence,
          issues: validation.issues,
          fieldsFound: validation.fieldsFound,
        },
        usedRegexFallback: true,
      },
    };
  }

  throw buildTerminalError(policy, attempts, lastError);
}

module.exports = {
  VALID_PARSE_MODES,
  normalizeParseMode,
  resolveParsePolicy,
  parseWithPolicy,
};
