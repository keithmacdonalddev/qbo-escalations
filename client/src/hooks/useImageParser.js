import { useState, useCallback } from 'react';
import { apiFetch } from '../api/http.js';
import { consumeSSEStream } from '../api/sse.js';
import { resolveImageParserSelection } from '../lib/imageParserCatalog.js';
import { summarizeProviderPackageCaptureFailure } from '../lib/imageParserValidation.js';

const IMAGE_PARSER_PROVIDER_KEY = 'qbo-image-parser-provider';
const IMAGE_PARSER_MODEL_KEY = 'qbo-image-parser-model';
const IMAGE_PARSER_REASONING_EFFORT_KEY = 'qbo-image-parser-reasoning-effort';
// The standalone Image Parser panel persists its backup alongside its primary
// under the same `qbo-image-parser-*` prefix (the image-parser agent runtime).
// Reading it here lets every parse from this hook fail over (Wave 2).
const IMAGE_PARSER_FALLBACK_PROVIDER_KEY = 'qbo-image-parser-fallback-provider';
const IMAGE_PARSER_FALLBACK_MODEL_KEY = 'qbo-image-parser-fallback-model';

function readStoredConfig() {
  try {
    const selection = resolveImageParserSelection(
      localStorage.getItem(IMAGE_PARSER_PROVIDER_KEY) || '',
      localStorage.getItem(IMAGE_PARSER_MODEL_KEY) || ''
    );
    return {
      provider: selection.provider,
      model: selection.model,
      reasoningEffort: localStorage.getItem(IMAGE_PARSER_REASONING_EFFORT_KEY) || '',
      fallbackProvider: localStorage.getItem(IMAGE_PARSER_FALLBACK_PROVIDER_KEY) || '',
      fallbackModel: localStorage.getItem(IMAGE_PARSER_FALLBACK_MODEL_KEY) || '',
    };
  } catch {
    return { provider: '', model: '', reasoningEffort: '', fallbackProvider: '', fallbackModel: '' };
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
    const wantsStream = typeof overrides.onStageEvent === 'function';
    let sawFailureStageEvent = false;
    try {
      const config = readStoredConfig();
      const provider = overrides.provider || config.provider;
      const model = overrides.model || config.model;
      const reasoningEffort = overrides.reasoningEffort || config.reasoningEffort;
      // Wave 2 universal failover: forward the operator's configured backup so
      // the parser can fail over on a primary-provider failure. The caller (the
      // parser popup) sources these from the selected parser agent's runtime; the
      // server defaults to the neutral global alternate when none is provided.
      const fallbackProvider = overrides.fallbackProvider || config.fallbackProvider || '';
      const fallbackModel = overrides.fallbackModel || config.fallbackModel || '';

      if (!provider) throw new Error('No image parser provider configured');

      const res = await apiFetch('/api/image-parser/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(wantsStream ? { Accept: 'text/event-stream' } : {}),
        },
        body: JSON.stringify({
          image: imageBase64,
          provider,
          model: model || undefined,
          reasoningEffort: reasoningEffort || undefined,
          fallbackProvider: fallbackProvider || undefined,
          fallbackModel: fallbackModel || undefined,
          // Always signal failover intent so the server attempts a backup on a
          // primary failure (defaulting to the neutral global alternate when no
          // explicit fallback is configured). Failover is always on for the
          // Image Parser (Wave 2).
          agentRuntime: { provider, fallbackProvider, fallbackModel, configured: true },
          promptId: overrides.promptId || overrides.parserPromptId || undefined,
          timeoutMs: overrides.timeoutMs,
        }),
        timeout: 210_000,  // 210s — local models (LM Studio) can take up to 180s
        noRetry: true,     // never retry vision inference (wastes tokens + time)
      });

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      const isSse = wantsStream && contentType.includes('text/event-stream');
      let data;
      if (isSse) {
        // The /parse SSE route delivers every terminal outcome — success AND
        // failure — as a single `parse_complete` frame ({ ok:false, code, error }
        // on failure). It never emits a top-level `error` frame (bus.emit('error')
        // is sent as a `stage_event` with kind:'error'). So `parse_complete` is
        // the sole terminal; the only fallback is a stream that closed early.
        let completed = null;
        await consumeSSEStream(res, (eventType, payload) => {
          if (eventType === 'stage_event') {
            if (
              payload?.kind === 'error'
              || /fail|error|timeout/i.test(String(payload?.data?.status || ''))
            ) {
              sawFailureStageEvent = true;
            }
            try { overrides.onStageEvent(payload); } catch { /* noop */ }
          } else if (eventType === 'parse_complete') {
            completed = payload;
          }
        });
        data = completed || {
          ok: false,
          error: 'Parse stream ended without a result.',
          code: 'STREAM_INCOMPLETE',
        };
      } else {
        data = await res.json().catch(() => ({ ok: false, error: res.statusText }));
      }
      if (!res.ok || !data.ok) {
        throw Object.assign(new Error(data.error || `Parse failed (HTTP ${res.status})`), {
          code: data.code || 'PARSE_FAILED',
          detail: data.detail || '',
          status: res.status,
          statusText: res.statusText || '',
          providerTrace: data.providerTrace || null,
          stageEventAlreadyEmitted: sawFailureStageEvent,
        });
      }

      setResult(data);
      return data;
    } catch (err) {
      const captureFailure = summarizeProviderPackageCaptureFailure(err);
      const message = captureFailure?.message || err.message || 'Parse failed';
      if (wantsStream && !err.stageEventAlreadyEmitted) {
        try {
          overrides.onStageEvent({
            stageId: 'parser',
            runId: '',
            ts: Date.now(),
            seq: 0,
            kind: 'error',
            category: 'run',
            source: 'client',
            data: {
              code: err.code || 'PARSE_FAILED',
              message,
              detail: err.detail || '',
              status: 'error',
              statusCode: err.status || null,
              providerPackageId: err.providerTrace?.providerPackageId || null,
              providerHarness: err.providerTrace?.providerHarness || null,
              captureMode: err.captureMode || err.providerTrace?.captureMode || null,
              surfaceToUser: true,
              displayMessage: message,
            },
          });
        } catch { /* noop */ }
      }
      setError(message);
      return null;
    } finally {
      setParsing(false);
    }
  }, []);

  const checkAvailability = useCallback(async (options = {}) => {
    try {
      const forceRefresh = options.forceRefresh === true;
      const url = forceRefresh
        ? '/api/image-parser/status?refresh=1'
        : '/api/image-parser/status';
      const res = await apiFetch(url);
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
