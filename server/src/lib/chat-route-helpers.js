'use strict';

const mongoose = require('mongoose');
const { logUsage } = require('./usage-writer');
const { calculateCost } = require('./pricing');

function buildUsageSubdoc(usage) {
  if (!usage) return null;
  const inputTokens = usage.inputTokens || 0;
  const outputTokens = usage.outputTokens || 0;
  const cost = calculateCost(inputTokens, outputTokens, usage.model, null);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    model: usage.model || null,
    totalCostMicros: cost.totalCostMicros,
    usageAvailable: true,
  };
}

function buildTraceStats(traceStats) {
  return {
    chunkCount: Number(traceStats?.chunkCount) || 0,
    chunkChars: Number(traceStats?.chunkChars) || 0,
    thinkingChunkCount: Number(traceStats?.thinkingChunkCount) || 0,
    providerErrors: Number(traceStats?.providerErrors) || 0,
    fallbacks: Number(traceStats?.fallbacks) || 0,
  };
}

function sumResponseChars(data) {
  if (!data || typeof data !== 'object') return 0;
  if (Array.isArray(data.results)) {
    return data.results.reduce((sum, result) => (
      sum + (typeof result?.fullResponse === 'string' ? result.fullResponse.length : 0)
    ), 0);
  }
  return typeof data.fullResponse === 'string' ? data.fullResponse.length : 0;
}

function isValidObjectId(value) {
  return typeof value === 'string' && mongoose.isValidObjectId(value);
}

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function logAttemptsUsage(attempts, opts) {
  if (!Array.isArray(attempts)) return;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    if (attempt.provider === 'regex') continue;
    const usage = attempt.usage || {};
    const status = opts.statusOverride
      || (
        attempt.status === 'ok'
          ? 'ok'
          : (attempt.errorCode === 'TIMEOUT' ? 'timeout' : (attempt.errorCode === 'ABORT' ? 'abort' : 'error'))
      );
    logUsage({
      requestId: opts.requestId,
      attemptIndex: i,
      service: opts.service,
      provider: attempt.provider,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      usageAvailable: !!attempt.usage,
      usageComplete: usage.usageComplete,
      rawUsage: usage.rawUsage,
      conversationId: opts.conversationId,
      escalationId: opts.escalationId,
      category: opts.category,
      mode: opts.mode,
      status,
      latencyMs: attempt.latencyMs,
    });
  }
}

module.exports = {
  buildTraceStats,
  buildUsageSubdoc,
  isValidObjectId,
  logAttemptsUsage,
  safeString,
  sumResponseChars,
};
