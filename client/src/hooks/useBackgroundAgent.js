import { useState, useCallback, useRef } from 'react';
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
 * Orchestrates background work: picks the right conversation ID, sends via
 * the headless client, manages turn counts, and handles channel rotation
 * and stale-ID recovery.
 *
 * Design contract:
 * - Only ONE request at a time (foreground OR background).
 * - Callers must check foreground `isStreaming` before invoking `sendBackground`.
 * - `bgStreaming` is exposed so the mini-widget can show activity.
 */
export function useBackgroundAgent() {
  const bgConvs = useBackgroundConversations();
  const [bgStreaming, setBgStreaming] = useState(false);
  const [bgQueue, setBgQueue] = useState([]);
  const [lastResults, setLastResults] = useState({});
  const bgStreamingRef = useRef(false);

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
      const turns = bgConvs.getTurns(channel);
      const maxTurns = MAX_TURNS[channel] || 30;

      if (turns >= maxTurns && bgConvs.getConversationId(channel)) {
        // Rotation: clear old channel so a new conversation is created
        bgConvs.clearChannel(channel);
      }

      let conversationId = bgConvs.getConversationId(channel);

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
        bgConvs.setConversationId(channel, result.conversationId);
      }

      // Increment turn count
      bgConvs.incrementTurns(channel);

      // Store last result for observability
      setLastResults((prev) => ({ ...prev, [channel]: result }));

      return result;
    } catch (err) {
      // Stale ID recovery: 404 means the conversation was deleted or expired
      if (err.status === 404) {
        bgConvs.clearChannel(channel);
        // Do NOT auto-retry here — let the caller decide
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
  }, [bgConvs]);

  return {
    sendBackground,
    bgStreaming,
    bgQueue,
    lastResults,
    channels: bgConvs,
  };
}
