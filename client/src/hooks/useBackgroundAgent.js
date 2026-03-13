import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { sendBackgroundDevMessage } from '../api/devBackgroundClient.js';
import {
  useBackgroundConversations,
  CHANNEL_NAMES,
} from './useBackgroundConversations.js';

/**
 * Turn thresholds per channel type.
 * When a channel exceeds its limit, the next send creates a new conversation
 * with a summary of the last 3 assistant messages (~200 words).
 */
const MAX_TURNS = {
  'auto-errors': 30,
  'code-reviews': 30,
  'quality-scans': 20, // Codex channels re-send full history
};
const MIN_SEND_INTERVAL_MS = 8_000;
const RATE_LIMIT_BACKOFF_BASE_MS = 10_000;
const RATE_LIMIT_BACKOFF_MAX_MS = 120_000;
const MAX_BG_QUEUE_SIZE = 60;
const MAX_RATE_LIMIT_RETRIES = 3;

/**
 * Extract tool usage summary from background agent result.
 * Pure function — safe to call outside React lifecycle.
 *
 * @param {Array<{tool: string, input?: object, details?: object, status?: string}>} toolEvents
 * @returns {null | {toolCounts: Record<string,number>, toolSummary: string, filePaths: string[], editedFiles: string[]}}
 */
function summarizeBgTools(toolEvents) {
  if (!toolEvents || toolEvents.length === 0) return null;

  const toolCounts = {};
  const filePaths = new Set();
  const editedFiles = new Set();

  for (const evt of toolEvents) {
    const name = evt.tool || 'unknown';
    toolCounts[name] = (toolCounts[name] || 0) + 1;

    // Extract file paths from various tool input shapes
    const input = evt.input || evt.details || {};
    const path = input.file_path || input.path || input.file || input.filename;
    if (path) filePaths.add(path);

    // Track edited files specifically (Edit/Write tools only)
    if (['Edit', 'Write', 'edit', 'write', 'MultiEdit'].includes(name) && path) {
      editedFiles.add(path);
    }

    // Also check command-based tools for file references
    if (name === 'Bash' && input.command) {
      const cmdParts = (input.command || '').match(/(?:^|\s)([\w./-]+\.\w{1,5})/g);
      if (cmdParts) cmdParts.forEach(p => filePaths.add(p.trim()));
    }
  }

  const toolSummary = Object.entries(toolCounts)
    .map(([n, count]) => count > 1 ? `${n} (${count})` : n)
    .join(', ');

  return { toolCounts, toolSummary, filePaths: [...filePaths], editedFiles: [...editedFiles] };
}

/**
 * Orchestrates background work: picks the right conversation ID, sends via
 * the headless client, manages turn counts, and handles channel rotation
 * and stale-ID recovery.
 *
 * Design contract:
 * - Only ONE request at a time (foreground OR background).
 * - Callers must check foreground `isStreaming` before invoking `sendBackground`.
 * - `bgStreaming` is exposed so the mini-widget can show activity.
 *
 * Stability contract:
 * - `sendBackground` has a STABLE identity (empty useCallback deps).
 *   It reads bgConvs and log via refs so it never triggers downstream
 *   re-renders when channel state changes.
 */
export function useBackgroundAgent({ log, onSuccess } = {}) {
  const bgConvs = useBackgroundConversations();
  const [bgStreaming, setBgStreaming] = useState(false);
  const [bgQueue, setBgQueue] = useState([]);
  const [lastResults, setLastResults] = useState({});
  const [bgTransportState, setBgTransportState] = useState({
    nextAllowedAt: 0,
    cooldownReason: null,
    rateLimitStrikeCount: 0,
    lastRateLimitAt: 0,
    lastRateLimitMs: 0,
  });
  const bgStreamingRef = useRef(false);
  const bgTransportRef = useRef(bgTransportState);
  bgTransportRef.current = bgTransportState;
  const nextAllowedAtRef = useRef(0);
  const rateLimitStrikeRef = useRef(0);
  const drainTimerRef = useRef(null);

  // Ref-bridge: keeps sendBackground stable while reading latest bgConvs/log/onSuccess
  const bgConvsRef = useRef(bgConvs);
  bgConvsRef.current = bgConvs;
  const logRef = useRef(log);
  logRef.current = log;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  function scheduleDrain() {
    const now = Date.now();
    const delay = Math.max(0, nextAllowedAtRef.current - now);
    if (drainTimerRef.current) {
      clearTimeout(drainTimerRef.current);
      drainTimerRef.current = null;
    }
    drainTimerRef.current = setTimeout(() => {
      drainTimerRef.current = null;
      setBgQueue((prev) => [...prev]);
    }, Math.max(100, delay));
  }

  function enqueueQueuedSend(channel, message, options = {}) {
    return new Promise((resolve, reject) => {
      setBgQueue((prev) => {
        const entry = { channel, message, options, resolve, reject };
        const next = [...prev, entry];
        if (next.length > MAX_BG_QUEUE_SIZE) {
          const dropped = next.shift();
          dropped?.reject?.(new Error('Background queue overflow'));
          logRef.current?.({
            type: 'bg-drop',
            message: `Dropped oldest background task for ${dropped?.channel || 'unknown'} due to queue pressure`,
            severity: 'warning',
          });
        }
        return next;
      });
      scheduleDrain();
    });
  }

  /**
   * Send a background message on the given channel.
   *
   * @param {string} channel        One of CHANNEL_NAMES
   * @param {string} message        User/system message text
   * @param {object} [options]
   * @param {string} [options.provider]         Provider ID override
   * @param {object} [options.incidentMeta]     Structured monitor-incident metadata
   * @param {object} [options.incidentContext]  Structured supervisor context for the dev agent
   * @param {string} [options.reasoningEffort]  Reasoning effort override
   * @param {(chunk: object) => void} [options.onChunk]   Progress callback
   * @param {(event: object) => void} [options.onToolUse] Tool-use callback
   * @returns {Promise<{conversationId: string, assistantText: string, toolEvents: object[], usage: object|null}>}
   */
  const sendBackground = useCallback(async (channel, message, options = {}) => {
    if (!CHANNEL_NAMES.includes(channel)) {
      throw new Error(`Unknown background channel: ${channel}`);
    }

    const convs = bgConvsRef.current;
    const now = Date.now();
    if (bgStreamingRef.current || now < nextAllowedAtRef.current) {
      return enqueueQueuedSend(channel, message, options);
    }
    if (bgTransportRef.current.nextAllowedAt && now >= bgTransportRef.current.nextAllowedAt) {
      setBgTransportState((prev) => ({
        ...prev,
        nextAllowedAt: 0,
        cooldownReason: null,
      }));
    }

    // Guard: only one background request at a time
    setBgStreaming(true);
    bgStreamingRef.current = true;

    try {
      // Check turn threshold — rotate if needed
      const turns = convs.getTurns(channel);
      const maxTurns = MAX_TURNS[channel] || 30;

      if (turns >= maxTurns && convs.getConversationId(channel)) {
        // Rotation: clear old channel so a new conversation is created
        convs.clearChannel(channel);
        logRef.current?.({ type: 'bg-rotate', message: `${channel} channel rotated (${maxTurns} turns)`, channel });
      }

      let conversationId = convs.getConversationId(channel);

      const preview = message.length > 80 ? message.slice(0, 80) + '...' : message;
      logRef.current?.({ type: 'bg-send', message: `Sending to ${channel}: ${preview}`, channel, detail: message });

      const result = await sendBackgroundDevMessage({
        message,
        conversationId,
        provider: options.provider,
        channelType: channel,
        incidentMeta: options.incidentMeta,
        incidentContext: options.incidentContext,
        reasoningEffort: options.reasoningEffort,
        onChunk: options.onChunk,
        onToolUse: options.onToolUse,
      });

      // Persist the conversation ID if this was a new conversation
      if (result.conversationId && result.conversationId !== conversationId) {
        bgConvsRef.current.setConversationId(channel, result.conversationId);
      }

      // Store last result for observability
      setLastResults((prev) => ({ ...prev, [channel]: result }));

      if (result.collapsed) {
        logRef.current?.({
          type: 'bg-collapsed',
          message: `Server collapsed duplicate ${channel} report (${result.collapseReason || 'duplicate'})`,
          channel,
          severity: 'info',
          detail: result.incident || undefined,
        });
        onSuccessRef.current?.();
        rateLimitStrikeRef.current = 0;
        nextAllowedAtRef.current = Date.now() + MIN_SEND_INTERVAL_MS;
        setBgTransportState((prev) => ({
          ...prev,
          nextAllowedAt: nextAllowedAtRef.current,
          cooldownReason: 'interval',
          rateLimitStrikeCount: 0,
        }));
        return result;
      }

      // Increment turn count only when the agent actually ran
      bgConvsRef.current.incrementTurns(channel);

      // --- Rich background agent logging ---

      // 1) Tool usage summary
      const toolSummary = summarizeBgTools(result.toolEvents);
      if (toolSummary) {
        const fileNote = toolSummary.filePaths.length > 0
          ? ` — files: ${toolSummary.filePaths.map(f => f.split(/[/\\]/).slice(-2).join('/')).join(', ')}`
          : '';
        logRef.current?.({
          type: 'bg-tools',
          message: `Agent used ${result.toolEvents.length} tools: ${toolSummary.toolSummary}${fileNote}`,
          channel,
          detail: result.toolEvents
            .map(e => `[${e.status || '?'}] ${e.tool}: ${JSON.stringify(e.input || e.details || {}, null, 2)}`)
            .join('\n\n'),
        });

        // 2) Separate entry for file modifications (Edit/Write only)
        if (toolSummary.editedFiles.length > 0) {
          logRef.current?.({
            type: 'bg-files-changed',
            message: `Agent modified: ${toolSummary.editedFiles.map(f => f.split(/[/\\]/).slice(-2).join('/')).join(', ')}`,
            channel,
            detail: toolSummary.editedFiles.join('\n'),
          });
        }
      }

      // 3) Response log with preview and tool count
      const respLen = (result.assistantText || '').length;
      const toolCount = (result.toolEvents || []).length;
      logRef.current?.({
        type: 'bg-response',
        message: `Agent responded on ${channel} (${respLen} chars${toolCount ? `, ${toolCount} tools` : ''})`,
        channel,
        detail: result.assistantText || undefined,
      });

      // Notify self-check heartbeat of successful background send
      onSuccessRef.current?.();
      rateLimitStrikeRef.current = 0;
      nextAllowedAtRef.current = Date.now() + MIN_SEND_INTERVAL_MS;
      setBgTransportState((prev) => ({
        ...prev,
        nextAllowedAt: nextAllowedAtRef.current,
        cooldownReason: 'interval',
        rateLimitStrikeCount: 0,
      }));

      return result;
    } catch (err) {
      if (err?.status === 429 || err?.code === 'RATE_LIMITED') {
        const retries = Number(options._rateLimitRetries || 0);
        const retryAfterMs = Number.isFinite(err.retryAfterMs) && err.retryAfterMs > 0
          ? err.retryAfterMs
          : Math.min(RATE_LIMIT_BACKOFF_BASE_MS * Math.pow(2, rateLimitStrikeRef.current), RATE_LIMIT_BACKOFF_MAX_MS);
        rateLimitStrikeRef.current += 1;
        nextAllowedAtRef.current = Date.now() + retryAfterMs;
        setBgTransportState({
          nextAllowedAt: nextAllowedAtRef.current,
          cooldownReason: 'rate-limit',
          rateLimitStrikeCount: rateLimitStrikeRef.current,
          lastRateLimitAt: Date.now(),
          lastRateLimitMs: retryAfterMs,
        });
        logRef.current?.({
          type: 'bg-rate-limit',
          message: `Background dev agent rate-limited for ${Math.round(retryAfterMs / 1000)}s`,
          channel,
          severity: 'warning',
        });
        if (retries < MAX_RATE_LIMIT_RETRIES) {
          return enqueueQueuedSend(channel, message, {
            ...options,
            _rateLimitRetries: retries + 1,
          });
        }
      }
      // Recover from invalid persisted conversation IDs so monitors can start fresh.
      if (err.status === 404) {
        bgConvsRef.current.clearChannel(channel);
        logRef.current?.({ type: 'api-error', message: `${channel}: stale conversation (404), cleared`, channel, severity: 'error' });
        // Do NOT auto-retry here — let the caller decide
      } else if (err.status === 409 && err.code === 'CHANNEL_MISMATCH') {
        bgConvsRef.current.clearChannel(channel);
        logRef.current?.({
          type: 'api-error',
          message: `${channel}: cleared mismatched background conversation (409)`,
          channel,
          severity: 'error',
        });
      } else {
        logRef.current?.({ type: 'api-error', message: `${channel}: ${err.message || err}`, channel, severity: 'error' });
      }
      throw err;
    } finally {
      setBgStreaming(false);
      bgStreamingRef.current = false;
      scheduleDrain();
    }
  }, []); // Empty deps = stable identity forever (reads via refs)

  useEffect(() => {
    if (bgStreamingRef.current) return;
    if (bgQueue.length === 0) return;

    const now = Date.now();
    if (now < nextAllowedAtRef.current) {
      scheduleDrain();
      return;
    }

    const [next, ...rest] = bgQueue;
    if (!next) return;

    setBgQueue(rest);
    queueMicrotask(() => {
      sendBackground(next.channel, next.message, next.options)
        .then(next.resolve)
        .catch(next.reject);
    });
  }, [bgQueue, sendBackground]);

  useEffect(() => {
    return () => {
      if (drainTimerRef.current) {
        clearTimeout(drainTimerRef.current);
        drainTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!bgTransportState.nextAllowedAt) return undefined;
    const remainingMs = bgTransportState.nextAllowedAt - Date.now();
    if (remainingMs <= 0) {
      setBgTransportState((prev) => ({
        ...prev,
        nextAllowedAt: 0,
        cooldownReason: null,
      }));
      return undefined;
    }
    const timeout = setTimeout(() => {
      setBgTransportState((prev) => ({
        ...prev,
        nextAllowedAt: 0,
        cooldownReason: null,
      }));
    }, remainingMs + 50);
    return () => clearTimeout(timeout);
  }, [bgTransportState.nextAllowedAt]);

  return useMemo(() => ({
    sendBackground,
    bgStreaming,
    bgQueue,
    lastResults,
    bgTransport: {
      ...bgTransportState,
      queueSize: bgQueue.length,
      coolingDown: bgTransportState.nextAllowedAt > Date.now(),
    },
    channels: bgConvs,
  }), [sendBackground, bgStreaming, bgQueue, lastResults, bgTransportState, bgConvs]);
}
