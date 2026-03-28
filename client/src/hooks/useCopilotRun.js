import { useCallback, useEffect, useRef } from 'react';
import {
  getProviderShortLabel,
} from '../lib/providerCatalog.js';
import {
  streamAnalyzeEscalation,
  streamFindSimilar,
  streamSuggestTemplate,
  streamGenerateTemplate,
  streamImproveTemplate,
  streamExplainTrends,
  streamPlaybookCheck,
  streamSemanticSearch,
} from '../api/copilotApi.js';

function useChunkBatcher(patchSession) {
  const pendingOutputRef = useRef('');
  const pendingThinkingRef = useRef('');
  const pendingThinkingPhaseRef = useRef(null);
  const rafRef = useRef(null);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      const outputChunk = pendingOutputRef.current;
      const thinkingChunk = pendingThinkingRef.current;
      const phase = pendingThinkingPhaseRef.current;
      pendingOutputRef.current = '';
      pendingThinkingRef.current = '';
      pendingThinkingPhaseRef.current = null;
      rafRef.current = null;

      if (outputChunk || thinkingChunk) {
        patchSession((prev) => {
          const next = { ...prev };
          if (outputChunk) next.output = `${prev.output || ''}${outputChunk}`;
          if (thinkingChunk) {
            next.thinkingText = `${prev.thinkingText || ''}${thinkingChunk}`;
            next.statusText = phase === 'pass2' ? 'Summarizing...' : 'Reasoning...';
          }
          return next;
        });
      }
    });
  }, [patchSession]);

  const appendOutput = useCallback((text) => {
    pendingOutputRef.current += text;
    scheduleFlush();
  }, [scheduleFlush]);

  const appendThinking = useCallback((text, phase) => {
    pendingThinkingRef.current += text;
    if (phase) pendingThinkingPhaseRef.current = phase;
    scheduleFlush();
  }, [scheduleFlush]);

  const cancelBatcher = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingOutputRef.current = '';
    pendingThinkingRef.current = '';
    pendingThinkingPhaseRef.current = null;
  }, []);

  useEffect(() => cancelBatcher, [cancelBatcher]);

  return { appendOutput, appendThinking, cancelBatcher };
}

export default function useCopilotRun({
  escalationId = null,
  query = '',
  mode,
  streaming,
  provider,
  providerMode,
  fallbackProvider,
  reasoningEffort,
  needsQuery,
  patchSession,
  setController,
  abortSession,
}) {
  const { appendOutput, appendThinking, cancelBatcher } = useChunkBatcher(patchSession);

  const handleRun = useCallback(() => {
    if (streaming) return;
    if (needsQuery && !query.trim()) return;

    patchSession({
      output: '',
      thinkingText: '',
      error: '',
      statusText: '',
      streaming: true,
      usage: null,
    });

    let streamFn;
    if (mode === 'analyze') streamFn = (handlers, options) => streamAnalyzeEscalation(escalationId, handlers, options);
    else if (mode === 'similar') streamFn = (handlers, options) => streamFindSimilar(escalationId, handlers, options);
    else if (mode === 'template') streamFn = (handlers, options) => streamSuggestTemplate(escalationId, handlers, options);
    else if (mode === 'generate') streamFn = (handlers, options) => streamGenerateTemplate('general', query.trim(), handlers, options);
    else if (mode === 'improve') streamFn = (handlers, options) => streamImproveTemplate(query.trim(), handlers, options);
    else if (mode === 'trends') streamFn = (handlers, options) => streamExplainTrends(handlers, options);
    else if (mode === 'playbook') streamFn = (handlers, options) => streamPlaybookCheck(handlers, options);
    else streamFn = (handlers, options) => streamSemanticSearch(query.trim(), handlers, options);

    const { abort } = streamFn({
      onStart: (data) => {
        patchSession({
          statusText:
          `Running with ${getProviderShortLabel(data?.primaryProvider || provider)}`
          + (data?.fallbackProvider ? ` + ${getProviderShortLabel(data.fallbackProvider)}` : ''),
        });
      },
      onStatus: (data) => {
        patchSession({ statusText: data?.message || '' });
      },
      onThinking: (data) => {
        appendThinking(data?.thinking || '', data?.phase);
      },
      onChunk: (data) => {
        appendOutput(data.text || '');
      },
      onProviderError: (data) => {
        patchSession({ statusText: data?.message || 'Provider attempt failed' });
      },
      onFallback: (data) => {
        patchSession({
          statusText: `Switched from ${getProviderShortLabel(data?.from || provider)} to ${getProviderShortLabel(data?.to || fallbackProvider)}`,
        });
      },
      onDone: (data) => {
        setController(null);
        patchSession((prev) => ({
          ...prev,
          output: prev.output || data.fullResponse || '',
          statusText: `Completed with ${getProviderShortLabel(data?.providerUsed || data?.provider || provider)}`,
          streaming: false,
          usage: data?.usage || null,
        }));
      },
      onError: (msg) => {
        setController(null);
        patchSession({
          error: typeof msg === 'string' ? msg : (msg?.message || 'Copilot request failed'),
          statusText: '',
          streaming: false,
        });
      },
    }, {
      provider,
      mode: providerMode,
      fallbackProvider: providerMode === 'fallback' ? fallbackProvider : undefined,
      reasoningEffort,
    });

    setController(abort);
  }, [
    streaming,
    needsQuery,
    query,
    mode,
    escalationId,
    provider,
    providerMode,
    fallbackProvider,
    reasoningEffort,
    patchSession,
    setController,
    appendOutput,
    appendThinking,
  ]);

  function handleStop() {
    cancelBatcher();
    abortSession();
    setController(null);
    patchSession({
      streaming: false,
      statusText: '',
    });
  }

  return {
    handleRun,
    handleStop,
  };
}
