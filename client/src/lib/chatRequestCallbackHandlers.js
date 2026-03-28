import { normalizeError } from '../utils/normalizeError.js';
import {
  getAlternateProvider,
  normalizeProvider as normalizeCatalogProvider,
} from './providerCatalog.js';

export function normalizeProvider(provider) {
  return normalizeCatalogProvider(provider);
}

export function normalizeFallback(primary, fallback) {
  const normalizedPrimary = normalizeProvider(primary);
  const normalizedFallback = normalizeProvider(fallback);
  if (normalizedFallback === normalizedPrimary) return getAlternateProvider(normalizedPrimary);
  return normalizedFallback;
}

export function createRequestTerminalHandlers({
  clearScheduledStreamFlush,
  finalizeSuccess,
  pushProcessEvent,
  selectedFallbackForRequest,
  selectedModeForRequest,
  selectedProviderForRequest,
  selectedRoleLabel,
  selectedSuccessCode,
  selectedSuccessMessage,
  selectedSuccessTitle,
  setFallbackNotice,
  setStreamProvider,
  setStreamingText,
  streamingTextRef,
}) {
  return {
    onProviderError: (data) => {
      const normalized = normalizeError(data);
      pushProcessEvent({
        level: 'error',
        title: 'Provider attempt failed',
        message: normalized.message,
        code: normalized.code,
        detail: normalized.detail || '',
        provider: normalizeProvider(data?.provider || selectedProviderForRequest),
        retriable: Boolean(data?.retriable),
      });
    },
    onFallback: (data) => {
      const nextProvider = normalizeProvider(data.to || selectedFallbackForRequest);
      const fromProvider = normalizeProvider(data.from || selectedProviderForRequest);
      setFallbackNotice({
        from: fromProvider,
        to: nextProvider,
        reason: data.reason || 'PROVIDER_ERROR',
        at: Date.now(),
      });
      setStreamProvider(nextProvider);
      clearScheduledStreamFlush();
      streamingTextRef.current = '';
      setStreamingText('');
      pushProcessEvent({
        level: 'warning',
        title: 'Fallback engaged',
        message: `${fromProvider} failed; switched to ${nextProvider}.`,
        code: data.reason || 'PROVIDER_ERROR',
        from: fromProvider,
        to: nextProvider,
      });
    },
    onDone: (data) => {
      finalizeSuccess(
        data,
        selectedModeForRequest,
        selectedProviderForRequest,
        selectedRoleLabel,
        selectedSuccessCode,
        selectedSuccessTitle,
        selectedSuccessMessage,
      );
    },
  };
}
