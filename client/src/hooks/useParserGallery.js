import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api/http.js';

const DEFAULT_LIMIT = 50;

/**
 * Hook for fetching image parser history and aggregate stats.
 *
 * Simplified: single useEffect drives all fetching. AbortController handles
 * cancellation on re-fetch or unmount. No fetchGen / mountedRef gymnastics.
 */
export default function useParserGallery() {
  const [results, setResults] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, _setFilters] = useState({ provider: '', status: '' });
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const setFilters = useCallback((patch) => {
    _setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }, []);

  // Main data fetcher — runs on mount and whenever page/filters/refreshKey change
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setLoading(true);
    setError(null);

    async function load() {
      try {
        const params = new URLSearchParams({ page: String(page), limit: String(DEFAULT_LIMIT) });
        if (filters.provider) params.set('provider', filters.provider);
        if (filters.status) params.set('status', filters.status);

        // Fetch history and stats independently so a stats failure doesn't
        // block results from rendering.
        const [historySettled, statsSettled] = await Promise.allSettled([
          apiFetch(`/api/image-parser/history?${params}`, { signal: controller.signal }).then(r => r.json()),
          apiFetch('/api/image-parser/stats', { signal: controller.signal }).then(r => r.json()),
        ]);

        if (cancelled) return;

        // Process history result
        if (historySettled.status === 'fulfilled' && historySettled.value.ok) {
          setResults(historySettled.value.results);
          setTotal(historySettled.value.total);
          setPages(historySettled.value.pages);
        } else if (historySettled.status === 'fulfilled') {
          setError(historySettled.value.error || 'Failed to fetch history');
        } else {
          const err = historySettled.reason;
          if (err?.name === 'AbortError') return;
          setError(err?.message || 'Failed to fetch history');
        }

        // Process stats result (non-critical — never blocks loading)
        if (statsSettled.status === 'fulfilled' && statsSettled.value.ok) {
          setStats(statsSettled.value.stats);
        }
      } catch (err) {
        if (cancelled || err.name === 'AbortError') return;
        setError(err.message || 'Failed to fetch data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [page, filters, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Fetch single result detail (includes parsedText)
  const loadDetail = useCallback(async (id) => {
    setDetailLoading(true);
    try {
      const res = await apiFetch(`/api/image-parser/history/${id}`);
      const data = await res.json();
      if (data.ok) {
        setDetail(data.result);
      } else {
        setDetail(null);
      }
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const clearDetail = useCallback(() => setDetail(null), []);

  return {
    results,
    stats,
    loading,
    error,
    page,
    pages,
    total,
    setPage,
    filters,
    setFilters,
    detail,
    detailLoading,
    loadDetail,
    clearDetail,
    refresh,
  };
}
