import { useCallback, useEffect, useState } from 'react';
import { apiFetchJson } from '../api/http.js';

let cachedProviderStatus = null;
let inFlightProviderStatus = null;
let providerStatusGeneration = 0;
export const PROVIDER_KEY_STATUS_CHANGED_EVENT = 'qbo-provider-key-status-changed';

export function clearProviderKeyStatusCache() {
  providerStatusGeneration += 1;
  cachedProviderStatus = null;
  inFlightProviderStatus = null;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PROVIDER_KEY_STATUS_CHANGED_EVENT));
  }
}

async function loadProviderStatus({ forceRefresh = false } = {}) {
  if (cachedProviderStatus && !forceRefresh) return cachedProviderStatus;
  if (inFlightProviderStatus && !forceRefresh) return inFlightProviderStatus;

  const suffix = forceRefresh ? '?refresh=1' : '';
  const generation = providerStatusGeneration;
  inFlightProviderStatus = apiFetchJson(
    `/api/image-parser/status${suffix}`,
    {},
    'Failed to load provider key status'
  )
    .then((data) => {
      const next = data?.providers || {};
      if (generation === providerStatusGeneration) {
        cachedProviderStatus = next;
      }
      return next;
    })
    .catch(() => {
      if (generation === providerStatusGeneration) {
        cachedProviderStatus = cachedProviderStatus || {};
      }
      return cachedProviderStatus;
    })
    .finally(() => {
      inFlightProviderStatus = null;
    });

  return inFlightProviderStatus;
}

export default function useProviderKeyStatus({ forceRefresh = false } = {}) {
  const [providerStatus, setProviderStatus] = useState(cachedProviderStatus || {});
  const [loaded, setLoaded] = useState(Boolean(cachedProviderStatus));

  const refreshProviderStatus = useCallback(async (options = {}) => {
    const next = await loadProviderStatus({
      forceRefresh: options.forceRefresh === true,
    });
    setProviderStatus(next || {});
    setLoaded(true);
    return next || {};
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadProviderStatus({ forceRefresh })
      .then((next) => {
        if (cancelled) return;
        setProviderStatus(next || {});
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [forceRefresh]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleProviderKeyStatusChanged = () => {
      refreshProviderStatus({ forceRefresh: true });
    };
    window.addEventListener(PROVIDER_KEY_STATUS_CHANGED_EVENT, handleProviderKeyStatusChanged);
    return () => {
      window.removeEventListener(PROVIDER_KEY_STATUS_CHANGED_EVENT, handleProviderKeyStatusChanged);
    };
  }, [refreshProviderStatus]);

  return {
    providerStatus,
    loaded,
    refreshProviderStatus,
  };
}
