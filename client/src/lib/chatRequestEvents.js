import { normalizeProvider as normalizeCatalogProvider } from './providerCatalog.js';

function buildQueueMessage({ isRetry, selectedProvider, selectedMode, selectedFallback, imageCount }) {
  const action = isRetry ? 'Retrying with' : 'Dispatching to';
  const suffix = selectedMode === 'fallback'
    ? ` with fallback ${selectedFallback}`
    : selectedMode === 'parallel'
      ? ` and parallel ${selectedFallback}`
      : '';
  const imageSuffix = imageCount > 0
    ? ` (${imageCount} image${imageCount === 1 ? '' : 's'} attached)`
    : '';
  return `${action} ${selectedProvider}${suffix}.${imageSuffix}`;
}

export function buildRequestSeedEvent({ isRetry, selectedProvider, selectedMode, selectedFallback, imageCount }) {
  return {
    level: 'info',
    title: isRetry ? 'Retry queued' : 'Request queued',
    message: buildQueueMessage({
      isRetry,
      selectedProvider,
      selectedMode,
      selectedFallback,
      imageCount,
    }),
    code: isRetry ? 'RETRY_QUEUED' : 'REQUEST_QUEUED',
    mode: selectedMode,
    provider: selectedProvider,
    fallbackProvider: selectedMode === 'single' ? null : selectedFallback,
    imageCount,
  };
}

export function mapLocalStageEventToProcessEvent(stageEvent) {
  if (!stageEvent || typeof stageEvent !== 'object') return null;
  const durationText = Number.isFinite(stageEvent.durationMs)
    ? ` in ${stageEvent.durationMs}ms`
    : '';

  if (stageEvent.stage === 'serialize' && stageEvent.phase === 'start') {
    return {
      level: 'info',
      title: 'Preparing request',
      message: 'Serializing the outgoing request body before upload.',
      code: 'REQUEST_SERIALIZE_START',
    };
  }

  if (stageEvent.stage === 'serialize' && stageEvent.phase === 'done') {
    return {
      level: 'info',
      title: 'Request ready',
      message: `Request body serialization finished${durationText}.`,
      code: 'REQUEST_SERIALIZE_DONE',
      durationMs: stageEvent.durationMs || 0,
    };
  }

  if (stageEvent.stage === 'response' && stageEvent.phase === 'headers') {
    return {
      level: 'info',
      title: 'Response started',
      message: `Server response headers arrived${durationText}.`,
      code: 'RESPONSE_HEADERS',
      durationMs: stageEvent.durationMs || 0,
      status: stageEvent.status || 0,
    };
  }

  return null;
}

export function buildParallelResultBatch({
  data,
  parallelStreamingByProvider,
  selectedMode,
  selectedProvider,
  providerThinking,
  startedAtMs,
}) {
  const elapsed = startedAtMs ? Date.now() - startedAtMs : null;
  if (selectedMode !== 'parallel' || !Array.isArray(data.results)) {
    return {
      handled: false,
      elapsed,
      messages: [],
      processEvents: [],
    };
  }

  const messages = data.results
    .filter((result) => result.status === 'ok')
    .map((result) => ({
      role: 'assistant',
      content: result.fullResponse || parallelStreamingByProvider[result.provider] || '',
      thinking: result.thinking || '',
      provider: normalizeCatalogProvider(result.provider || selectedProvider),
      mode: 'parallel',
      fallbackFrom: null,
      attemptMeta: {
        attempts: data.attempts || [],
        parallel: true,
        turnId: data.turnId || null,
        ...(providerThinking ? { providerThinking } : {}),
      },
      timestamp: new Date().toISOString(),
      responseTimeMs: elapsed,
      usage: result.usage || null,
    }));

  const processEvents = data.results
    .filter((result) => result.status === 'error')
    .map((failed) => ({
      level: 'error',
      title: 'Parallel provider failed',
      message: failed.errorMessage || `${failed.provider} failed`,
      code: failed.errorCode || 'PROVIDER_EXEC_FAILED',
      detail: failed.errorDetail || '',
      provider: failed.provider,
    }));

  return {
    handled: true,
    elapsed,
    messages,
    processEvents,
  };
}
