import { useState, useCallback, useRef, useMemo } from 'react';

/**
 * Background channel conversation ID registry.
 *
 * Each background channel (auto-errors, code-reviews, quality-scans) gets
 * its own persistent conversationId stored in localStorage.  IDs are created
 * on first use and reused until explicitly cleared (e.g. on rotation or 404).
 *
 * Timestamp tracking: every write records a companion `:ts` key so stale
 * entries (>7 days) can be pruned automatically on hook init.
 */

const CHANNEL_KEYS = {
  'auto-errors': 'qbo-dev-bg-auto-errors',
  'code-reviews': 'qbo-dev-bg-code-reviews',
  'quality-scans': 'qbo-dev-bg-quality-scans',
};

const TURN_KEYS = {
  'auto-errors': 'qbo-dev-bg-turns-auto-errors',
  'code-reviews': 'qbo-dev-bg-turns-code-reviews',
  'quality-scans': 'qbo-dev-bg-turns-quality-scans',
};

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function readLS(key) {
  try { return window.localStorage.getItem(key) || null; } catch { return null; }
}

function writeLS(key, value) {
  try {
    window.localStorage.setItem(key, value);
    window.localStorage.setItem(key + ':ts', String(Date.now()));
  } catch { /* quota exceeded or private browsing */ }
}

function removeLS(key) {
  try {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(key + ':ts');
  } catch { /* noop */ }
}

/**
 * Prune localStorage entries whose timestamp is older than MAX_AGE_MS.
 * Called once at module load (before any hook mounts) so stale IDs
 * don't get used as conversation references.
 */
function pruneStaleEntries() {
  const now = Date.now();
  for (const [ch, key] of Object.entries(CHANNEL_KEYS)) {
    const ts = parseInt(readLS(key + ':ts') || '0', 10);
    if (ts && now - ts > MAX_AGE_MS) {
      removeLS(key);
      removeLS(TURN_KEYS[ch]);
    }
  }
}

// Run once at module init
pruneStaleEntries();

export const CHANNEL_NAMES = Object.keys(CHANNEL_KEYS);

export function useBackgroundConversations() {
  // In-memory mirror of localStorage for reactivity
  const [channels, setChannels] = useState(() => {
    const init = {};
    for (const [ch, key] of Object.entries(CHANNEL_KEYS)) {
      init[ch] = {
        conversationId: readLS(key),
        turns: parseInt(readLS(TURN_KEYS[ch]) || '0', 10),
      };
    }
    return init;
  });

  const channelsRef = useRef(channels);
  channelsRef.current = channels;

  const getConversationId = useCallback((channel) => {
    return channelsRef.current[channel]?.conversationId || null;
  }, []);

  const getTurns = useCallback((channel) => {
    return channelsRef.current[channel]?.turns || 0;
  }, []);

  const setConversationId = useCallback((channel, id) => {
    const key = CHANNEL_KEYS[channel];
    if (!key) return;
    writeLS(key, id);
    writeLS(TURN_KEYS[channel], '0');
    setChannels((prev) => ({
      ...prev,
      [channel]: { conversationId: id, turns: 0 },
    }));
  }, []);

  const incrementTurns = useCallback((channel) => {
    const turnKey = TURN_KEYS[channel];
    if (!turnKey) return 0;
    const next = (channelsRef.current[channel]?.turns || 0) + 1;
    writeLS(turnKey, String(next));
    setChannels((prev) => ({
      ...prev,
      [channel]: { ...prev[channel], turns: next },
    }));
    return next;
  }, []);

  const clearChannel = useCallback((channel) => {
    const key = CHANNEL_KEYS[channel];
    if (!key) return;
    removeLS(key);
    removeLS(TURN_KEYS[channel]);
    setChannels((prev) => ({
      ...prev,
      [channel]: { conversationId: null, turns: 0 },
    }));
  }, []);

  const clearAll = useCallback(() => {
    for (const ch of CHANNEL_NAMES) {
      removeLS(CHANNEL_KEYS[ch]);
      removeLS(TURN_KEYS[ch]);
    }
    const empty = {};
    for (const ch of CHANNEL_NAMES) {
      empty[ch] = { conversationId: null, turns: 0 };
    }
    setChannels(empty);
  }, []);

  return useMemo(() => ({
    channels,
    getConversationId,
    getTurns,
    setConversationId,
    incrementTurns,
    clearChannel,
    clearAll,
  }), [channels, getConversationId, getTurns, setConversationId, incrementTurns, clearChannel, clearAll]);
}
