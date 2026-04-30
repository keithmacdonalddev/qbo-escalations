import { startTransition, useCallback, useRef, useState } from 'react';

function createProcessEvent(event) {
  const now = new Date().toISOString();
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: now,
    level: 'info',
    title: '',
    message: '',
    ...event,
  };
}

export default function useChatStreamState({ initialStreamProvider = null } = {}) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [parallelStreaming, setParallelStreaming] = useState({});
  const [streamProvider, setStreamProvider] = useState(initialStreamProvider);
  const [fallbackNotice, setFallbackNotice] = useState(null);
  const [responseTime, setResponseTime] = useState(null);
  const [contextDebug, setContextDebug] = useState(null);
  const [runtimeWarnings, setRuntimeWarnings] = useState([]);
  const [triageCard, setTriageCard] = useState(null);
  const [caseIntake, setCaseIntake] = useState(null);
  const [invMatches, setInvMatches] = useState(null);
  const [processEvents, setProcessEvents] = useState([]);
  const [thinkingText, setThinkingText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingStartTime, setThinkingStartTime] = useState(null);
  const [currentTraceId, setCurrentTraceId] = useState(null);

  const abortRef = useRef(null);
  const startTimeRef = useRef(null);
  const isStreamingRef = useRef(false);
  const streamingTextRef = useRef('');
  const parallelStreamingRef = useRef({});
  const processEventsRef = useRef([]);
  const chunkStartedProvidersRef = useRef(new Set());
  const thinkingTextRef = useRef('');
  const isThinkingRef = useRef(false);
  const streamFlushFrameRef = useRef(0);
  const pendingStreamFlushRef = useRef({
    streaming: false,
    parallel: false,
    thinking: false,
  });

  const clearScheduledStreamFlush = useCallback(() => {
    if (streamFlushFrameRef.current) {
      cancelAnimationFrame(streamFlushFrameRef.current);
      streamFlushFrameRef.current = 0;
    }
    pendingStreamFlushRef.current = {
      streaming: false,
      parallel: false,
      thinking: false,
    };
  }, []);

  const scheduleStreamFlush = useCallback((kind) => {
    if (!pendingStreamFlushRef.current[kind]) {
      pendingStreamFlushRef.current = {
        ...pendingStreamFlushRef.current,
        [kind]: true,
      };
    }
    if (streamFlushFrameRef.current) return;

    streamFlushFrameRef.current = requestAnimationFrame(() => {
      streamFlushFrameRef.current = 0;
      const pending = pendingStreamFlushRef.current;
      pendingStreamFlushRef.current = {
        streaming: false,
        parallel: false,
        thinking: false,
      };

      startTransition(() => {
        if (pending.streaming) {
          setStreamingText(streamingTextRef.current);
        }
        if (pending.parallel) {
          setParallelStreaming({ ...parallelStreamingRef.current });
        }
        if (pending.thinking) {
          setThinkingText(thinkingTextRef.current);
        }
      });
    });
  }, []);

  const pushProcessEvent = useCallback((event) => {
    const normalized = createProcessEvent(event);
    setProcessEvents((prev) => {
      const next = [...prev, normalized].slice(-80);
      processEventsRef.current = next;
      return next;
    });
  }, []);

  const resetProcessEvents = useCallback((seedEvents = []) => {
    const next = Array.isArray(seedEvents) ? seedEvents.map((entry) => createProcessEvent(entry)) : [];
    processEventsRef.current = next;
    setProcessEvents(next);
  }, []);

  return {
    abortRef,
    startTimeRef,
    isStreamingRef,
    streamingTextRef,
    parallelStreamingRef,
    processEventsRef,
    chunkStartedProvidersRef,
    thinkingTextRef,
    isThinkingRef,
    streamFlushFrameRef,
    pendingStreamFlushRef,
    isStreaming,
    setIsStreaming,
    streamingText,
    setStreamingText,
    parallelStreaming,
    setParallelStreaming,
    streamProvider,
    setStreamProvider,
    fallbackNotice,
    setFallbackNotice,
    responseTime,
    setResponseTime,
    contextDebug,
    setContextDebug,
    runtimeWarnings,
    setRuntimeWarnings,
    triageCard,
    setTriageCard,
    caseIntake,
    setCaseIntake,
    invMatches,
    setInvMatches,
    processEvents,
    setProcessEvents,
    thinkingText,
    setThinkingText,
    isThinking,
    setIsThinking,
    thinkingStartTime,
    setThinkingStartTime,
    currentTraceId,
    setCurrentTraceId,
    clearScheduledStreamFlush,
    scheduleStreamFlush,
    pushProcessEvent,
    resetProcessEvents,
  };
}
