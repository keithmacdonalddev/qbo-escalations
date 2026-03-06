import { useState, useRef, useCallback, useEffect } from 'react';

const PRIORITIES = { urgent: 0, critical: 1, high: 2, medium: 3, low: 4 };
const TOTAL_LIMIT = 8;
const FOREGROUND_RESERVE = 4;
const WINDOW_MS = 60_000;
const MAX_QUEUE_SIZE = 20;
const IDLE_DELAY_MS = 120_000;       // 2 minutes idle before scan
const IDLE_COOLDOWN_MS = 600_000;    // max 1 idle scan per 10 minutes
const BACKOFF_BASE_MS = 10_000;
const BACKOFF_MAX_MS = 120_000;
const BUDGET_RETRY_MS = 5_000;

/**
 * Non-preemptive task queue for the dev agent. Manages foreground and
 * background requests through a single priority queue with rate-limit
 * budget tracking.
 *
 * Design contract:
 * - Only ONE request executes at a time (non-preemptive).
 * - User messages queue at `urgent` (always processed first).
 * - Background budget: TOTAL_LIMIT - FOREGROUND_RESERVE per window.
 * - 429 errors trigger exponential backoff (10s base, 2min max).
 * - Idle scans fire after 2min idle, max 1 per 10min.
 * - Queue capped at MAX_QUEUE_SIZE; lowest-priority oldest evicted.
 *
 * @param {object} params
 * @param {boolean} params.isStreaming     Foreground streaming state
 * @param {boolean} params.bgStreaming     Background streaming state
 * @param {Function} params.sendBackground Background send (returns Promise)
 * @param {Function} params.sendMessage    Foreground send (void, SSE-based)
 */
export function useDevTaskQueue({ enabled = true, isStreaming, bgStreaming, sendBackground, sendMessage, log, emergencyActive }) {
  const [queue, setQueue] = useState([]);
  const [paused, setPaused] = useState(false);
  const requestLogRef = useRef([]);
  const processingRef = useRef(false);
  const idleTimerRef = useRef(null);
  const retryTimerRef = useRef(null);

  // Ref-bridge: keeps enqueue and process-loop stable while reading latest values
  const logRef = useRef(log);
  logRef.current = log;
  const sendBackgroundRef = useRef(sendBackground);
  sendBackgroundRef.current = sendBackground;
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;

  // --- Rate budget helpers ---

  function pruneLog() {
    const cutoff = Date.now() - WINDOW_MS;
    requestLogRef.current = requestLogRef.current.filter(r => r.timestamp > cutoff);
  }

  function logRequest(type) {
    requestLogRef.current.push({ timestamp: Date.now(), type });
    pruneLog();
  }

  function countInWindow(type) {
    pruneLog();
    if (!type) return requestLogRef.current.length;
    return requestLogRef.current.filter(r => r.type === type).length;
  }

  function canSendBackground() {
    const totalRecent = countInWindow();
    const bgUsed = countInWindow('bg');
    const bgBudget = TOTAL_LIMIT - FOREGROUND_RESERVE;
    return bgUsed < bgBudget && totalRecent < TOTAL_LIMIT;
  }

  function canSendForeground() {
    return countInWindow() < TOTAL_LIMIT;
  }

  // --- Enqueue ---

  const enqueue = useCallback((task) => {
    const taskType = task.type || 'task';
    const taskPriority = task.priority || 'low';
    logRef.current?.({ type: taskType === 'idle-scan' ? 'idle-scan' : 'task-queued', message: `Queued: ${taskType} (${taskPriority} priority)`, detail: task.id });
    setQueue(prev => {
      const entry = {
        ...task,
        id: task.id || `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        enqueuedAt: Date.now(),
        retries: task.retries || 0,
      };
      const next = [...prev, entry];
      // Sort by priority (lower number = higher priority), then by enqueue time
      next.sort((a, b) => {
        const pa = PRIORITIES[a.priority] ?? 4;
        const pb = PRIORITIES[b.priority] ?? 4;
        return pa !== pb ? pa - pb : a.enqueuedAt - b.enqueuedAt;
      });
      // Evict lowest-priority oldest if over max
      while (next.length > MAX_QUEUE_SIZE) {
        next.pop();
      }
      return next;
    });
  }, []); // Empty deps = stable identity forever (reads log via logRef)

  // --- Remove a queued task by ID ---

  const dequeue = useCallback((taskId) => {
    setQueue(prev => prev.filter(t => t.id !== taskId));
  }, []);

  // --- Clear the entire queue ---

  const clearQueue = useCallback(() => {
    setQueue([]);
  }, []);

  // --- Process queue when idle ---

  useEffect(() => {
    try {
      if (!enabled || paused) return;
      if (isStreaming || bgStreaming || processingRef.current) return;
      if (queue.length === 0) return;

      const task = queue[0];
      if (!task) return;

      // Check rate budget
      const isUrgent = task.priority === 'urgent' || task.type === 'user-message';
      if (isUrgent) {
        if (!canSendForeground()) {
          scheduleRetry();
          return;
        }
      } else {
        if (!canSendBackground()) {
          scheduleRetry();
          return;
        }
      }

      processingRef.current = true;
      setQueue(prev => prev.slice(1));
      logRef.current?.({ type: 'task-started', message: `Processing: ${task.type || 'task'}`, detail: task.id });

      const run = async () => {
        try {
          if (isUrgent) {
            logRequest('fg');
            sendMessageRef.current?.(task.message, task.images || [], task.providerOverride);
          } else {
            logRequest('bg');
            await sendBackgroundRef.current?.(task.channel || 'quality-scans', task.message, task.options || {});
          }
          logRef.current?.({ type: 'task-completed', message: `Completed: ${task.type || 'task'}`, detail: task.id });
        } catch (err) {
          if (err?.status === 429 || err?.code === 'RATE_LIMITED') {
            const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, task.retries || 0), BACKOFF_MAX_MS);
            setTimeout(() => {
              enqueue({ ...task, retries: (task.retries || 0) + 1 });
            }, delay);
          }
        } finally {
          processingRef.current = false;
        }
      };

      run();
    } catch (err) {
      console.error('[DevAgent] useDevTaskQueue process failed:', err);
      processingRef.current = false;
    }
  }, [enabled, queue, isStreaming, bgStreaming, paused, enqueue]); // sendBackground/sendMessage/log accessed via refs

  // --- Emergency mode: drop low and medium priority tasks ---

  useEffect(() => {
    if (!emergencyActive) return;
    setQueue(prev => {
      const filtered = prev.filter(t =>
        t.priority === 'urgent' || t.priority === 'critical'
      );
      if (filtered.length < prev.length) {
        const dropped = prev.length - filtered.length;
        logRef.current?.({
          type: 'emergency',
          message: `Emergency triage: dropped ${dropped} low/medium priority tasks`,
          severity: 'warning',
        });
      }
      return filtered;
    });
  }, [emergencyActive]);

  // --- Budget retry scheduler ---

  function scheduleRetry() {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
    }
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      // Trigger re-evaluation by touching queue
      setQueue(q => [...q]);
    }, BUDGET_RETRY_MS);
  }

  // Clean up retry timer on unmount
  useEffect(() => {
    return () => {
      try { if (retryTimerRef.current) clearTimeout(retryTimerRef.current); } catch {}
    };
  }, []);

  // --- Idle scan ---

  useEffect(() => {
    try {
      if (!enabled || queue.length > 0 || isStreaming || bgStreaming || paused) {
        if (idleTimerRef.current) {
          clearTimeout(idleTimerRef.current);
          idleTimerRef.current = null;
        }
        return;
      }

      idleTimerRef.current = setTimeout(() => {
        try {
          const lastBg = requestLogRef.current
            .filter(r => r.type === 'bg')
            .slice(-1)[0];
          if (lastBg && Date.now() - lastBg.timestamp < IDLE_COOLDOWN_MS) return;

          enqueue({
            id: `idle-scan-${Date.now()}`,
            priority: 'low',
            channel: 'quality-scans',
            type: 'idle-scan',
            message: `[IDLE-SCAN] Proactive quality check.

Review the most recently modified files in the project. Look for:
- Console.log statements that should be removed
- Obvious bugs or edge cases
- Missing error handling at system boundaries

Report what you find. Fix anything clearly wrong.`,
          });
        } catch (err) {
          console.error('[DevAgent] idle scan callback failed:', err);
        }
      }, IDLE_DELAY_MS);
    } catch (err) {
      console.error('[DevAgent] useDevTaskQueue idle setup failed:', err);
    }

    return () => {
      try {
        if (idleTimerRef.current) {
          clearTimeout(idleTimerRef.current);
          idleTimerRef.current = null;
        }
      } catch {}
    };
  }, [enabled, queue, isStreaming, bgStreaming, paused, enqueue]);

  // --- Public API ---

  return {
    queue,
    enqueue,
    dequeue,
    clearQueue,
    paused,
    setPaused,
    queueDepth: queue.length,
    processing: processingRef.current,
    canSendBackground: canSendBackground(),
    canSendForeground: canSendForeground(),
    rateBudget: {
      total: TOTAL_LIMIT,
      foregroundReserve: FOREGROUND_RESERVE,
      backgroundBudget: TOTAL_LIMIT - FOREGROUND_RESERVE,
      bgUsed: countInWindow('bg'),
      fgUsed: countInWindow('fg'),
      totalUsed: countInWindow(),
      windowMs: WINDOW_MS,
    },
  };
}
