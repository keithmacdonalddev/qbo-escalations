import { useState, useCallback, useRef, useMemo } from 'react';
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
  const bgStreamingRef = useRef(false);

  // Ref-bridge: keeps sendBackground stable while reading latest bgConvs/log/onSuccess
  const bgConvsRef = useRef(bgConvs);
  bgConvsRef.current = bgConvs;
  const logRef = useRef(log);
  logRef.current = log;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  /**
   * Send a background message on the given channel.
   *
   * @param {string} channel        One of CHANNEL_NAMES
   * @param {string} message        User/system message text
   * @param {object} [options]
   * @param {string} [options.provider]         Provider ID override
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

    // Guard: only one background request at a time
    if (bgStreamingRef.current) {
      // Queue it
      return new Promise((resolve, reject) => {
        setBgQueue((prev) => [...prev, { channel, message, options, resolve, reject }]);
      });
    }

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
        reasoningEffort: options.reasoningEffort,
        onChunk: options.onChunk,
        onToolUse: options.onToolUse,
      });

      // Persist the conversation ID if this was a new conversation
      if (result.conversationId && result.conversationId !== conversationId) {
        bgConvsRef.current.setConversationId(channel, result.conversationId);
      }

      // Increment turn count
      bgConvsRef.current.incrementTurns(channel);

      // Store last result for observability
      setLastResults((prev) => ({ ...prev, [channel]: result }));

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

      return result;
    } catch (err) {
      // Stale ID recovery: 404 means the conversation was deleted or expired
      if (err.status === 404) {
        bgConvsRef.current.clearChannel(channel);
        logRef.current?.({ type: 'api-error', message: `${channel}: stale conversation (404), cleared`, channel, severity: 'error' });
        // Do NOT auto-retry here — let the caller decide
      } else {
        logRef.current?.({ type: 'api-error', message: `${channel}: ${err.message || err}`, channel, severity: 'error' });
      }
      throw err;
    } finally {
      setBgStreaming(false);
      bgStreamingRef.current = false;

      // Drain queue: process next queued item
      setBgQueue((prev) => {
        if (prev.length === 0) return prev;
        const [next, ...rest] = prev;
        // Schedule next send asynchronously to avoid setState-during-render
        queueMicrotask(() => {
          sendBackground(next.channel, next.message, next.options)
            .then(next.resolve)
            .catch(next.reject);
        });
        return rest;
      });
    }
  }, []); // Empty deps = stable identity forever (reads via refs)

  return useMemo(() => ({
    sendBackground,
    bgStreaming,
    bgQueue,
    lastResults,
    channels: bgConvs,
  }), [sendBackground, bgStreaming, bgQueue, lastResults, bgConvs]);
}
