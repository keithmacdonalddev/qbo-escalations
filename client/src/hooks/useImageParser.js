import { useState, useCallback } from 'react';
import { apiFetch } from '../api/http.js';

const IMAGE_PARSER_PROVIDER_KEY = 'qbo-image-parser-provider';
const IMAGE_PARSER_MODEL_KEY = 'qbo-image-parser-model';

function readStoredConfig() {
  try {
    return {
      provider: localStorage.getItem(IMAGE_PARSER_PROVIDER_KEY) || '',
      model: localStorage.getItem(IMAGE_PARSER_MODEL_KEY) || '',
    };
  } catch {
    return { provider: '', model: '' };
  }
}

export default function useImageParser() {
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyMeta, setHistoryMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [historyLoading, setHistoryLoading] = useState(false);

  const parse = useCallback(async (imageBase64, overrides = {}) => {
    setParsing(true);
    setError(null);
    setResult(null);
    try {
      const config = readStoredConfig();
      const provider = overrides.provider || config.provider;
      const model = overrides.model || config.model;

      if (!provider) throw new Error('No image parser provider configured');

      const res = await apiFetch('/api/image-parser/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: imageBase64,
          provider,
          model: model || undefined,
          timeoutMs: overrides.timeoutMs,
        }),
        timeout: 210_000,  // 210s — local models (LM Studio) can take up to 180s
        noRetry: true,     // never retry vision inference (wastes tokens + time)
      });

      const data = await res.json().catch(() => ({ ok: false, error: res.statusText }));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Parse failed (HTTP ${res.status})`);
      }

      setResult(data);
      return data;
    } catch (err) {
      const message = err.message || 'Parse failed';
      setError(message);
      return null;
    } finally {
      setParsing(false);
    }
  }, []);

  const checkAvailability = useCallback(async () => {
    try {
      const res = await apiFetch('/api/image-parser/status');
      const data = await res.json().catch(() => ({ ok: false, providers: {} }));
      return data;
    } catch {
      return { ok: false, providers: {} };
    }
  }, []);

  const fetchHistory = useCallback(async (page = 1, filters = {}) => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (filters.provider) params.set('provider', filters.provider);
      if (filters.status) params.set('status', filters.status);

      const res = await apiFetch(`/api/image-parser/history?${params}`);
      const data = await res.json().catch(() => ({ ok: false, results: [] }));
      if (data.ok) {
        setHistory(data.results || []);
        setHistoryMeta({ total: data.total || 0, page: data.page || 1, pages: data.pages || 1 });
      }
      return data;
    } catch {
      return { ok: false, results: [] };
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const fetchHistoryItem = useCallback(async (id) => {
    try {
      const res = await apiFetch(`/api/image-parser/history/${id}`);
      const data = await res.json().catch(() => ({ ok: false }));
      return data.ok ? data.result : null;
    } catch {
      return null;
    }
  }, []);

  return {
    parse, parsing, result, error, checkAvailability,
    history, historyMeta, historyLoading, fetchHistory, fetchHistoryItem,
  };
}
