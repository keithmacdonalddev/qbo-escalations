import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api/http.js';
import { applyProviderManagementSnapshot } from '../lib/providerCatalog.js';

const ProviderCatalogContext = createContext(null);

export function ProviderCatalogProvider({ children }) {
  const [catalog, setCatalog] = useState(null);
  const [keys, setKeys] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);

  const applyResponse = useCallback((data) => {
    if (!data?.catalog) return data;
    applyProviderManagementSnapshot(data.catalog);
    setCatalog(data.catalog);
    setKeys(data.keys || {});
    setVersion((current) => current + 1);
    setError('');
    return data;
  }, []);

  const request = useCallback(async (path = '', options = {}) => {
    const response = await apiFetch(`/api/ai-management${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      const requestError = new Error(data.error || 'AI management request failed.');
      requestError.code = data.code || 'AI_MANAGEMENT_FAILED';
      requestError.detail = data.detail || '';
      throw requestError;
    }
    return applyResponse(data);
  }, [applyResponse]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      return await request('');
    } catch (loadError) {
      setError(loadError.message || 'Could not load the AI catalog.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      request('').catch(() => {});
    };
    const interval = window.setInterval(refresh, 5 * 60 * 1000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [request]);

  const value = useMemo(() => ({
    catalog,
    keys,
    loading,
    error,
    version,
    request,
    reload,
  }), [catalog, keys, loading, error, version, request, reload]);

  return (
    <ProviderCatalogContext.Provider value={value}>
      {children}
    </ProviderCatalogContext.Provider>
  );
}

export function useProviderCatalog() {
  const value = useContext(ProviderCatalogContext);
  if (!value) {
    throw new Error('useProviderCatalog must be used inside ProviderCatalogProvider.');
  }
  return value;
}
