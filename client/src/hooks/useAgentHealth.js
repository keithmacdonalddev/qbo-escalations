// NOTE: New consumers should use `useAgent` from `../context/AgentRegistryContext.jsx`
// instead of this hook. This hook remains as the internal polling engine that
// AgentRegistryProvider builds on top of. See `client/src/context/AgentRegistryContext.jsx`.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAgentHealth } from '../api/agentIdentitiesApi.js';

const DEFAULT_POLL_MS = 60_000;

// Per-id-set cache. The previous implementation kept a single module-level
// `cachedHealth` / `inFlight` / `inFlightStream` triple shared across EVERY
// hook instance regardless of which agentIds were requested. That let a
// caller asking for `['chat']` receive another caller's in-flight promise /
// cached snapshot for `['workspace','copilot']`, so agents rendered the wrong
// (or missing) health. We now key everything by a normalized id key so each
// distinct id set gets its own cache entry and its own in-flight slots, while
// callers sharing the same id set still de-dupe their requests as before.
//
// Each entry: { health: {}, checkedAt: null|string, inFlight: Promise|null,
//               inFlightStream: Promise|null }. The streaming and batched
// paths for the SAME key intentionally share `health`/`checkedAt` so a
// streaming bootstrap still warms the cache that a later batched poll reads
// (and vice versa) — only the in-flight slots are kept separate so a stream
// and a batch for the same key can run concurrently without cancelling each
// other.
const cacheByKey = new Map();

function getEntry(idKey) {
  let entry = cacheByKey.get(idKey);
  if (!entry) {
    entry = { health: {}, checkedAt: null, inFlight: null, inFlightStream: null };
    cacheByKey.set(idKey, entry);
  }
  return entry;
}

async function loadHealth(idKey, agentIds, options = {}) {
  const entry = getEntry(idKey);
  if (entry.inFlight && !options.forceRefresh) return entry.inFlight;
  entry.inFlight = getAgentHealth(agentIds, options)
    .then((data) => {
      entry.health = data?.agents || {};
      entry.checkedAt = data?.checkedAt || null;
      return {
        agents: entry.health,
        checkedAt: entry.checkedAt,
      };
    })
    .finally(() => {
      entry.inFlight = null;
    });
  return entry.inFlight;
}

// Streaming variant. Opens the NDJSON /api/agent-identities/health/stream
// endpoint and resolves once the server's `complete` event arrives,
// invoking `onAgent(agentId, health)` as each per-agent event lands so the
// caller can render per-agent progress. The final aggregate snapshot is
// also written into the module cache so a subsequent non-streaming
// `loadHealth` call sees the fresh data. Matches the NDJSON consumer
// pattern used by updateAgentEnabledStream in agentIdentitiesApi.js.
async function loadHealthStream(idKey, agentIds, { onAgent, onError } = {}) {
  const entry = getEntry(idKey);
  if (entry.inFlightStream) return entry.inFlightStream;
  entry.inFlightStream = (async () => {
    const params = new URLSearchParams();
    const ids = Array.isArray(agentIds) ? agentIds.filter(Boolean) : [];
    if (ids.length > 0) params.set('ids', ids.join(','));
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`/api/agent-identities/health/stream${query}`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok || !res.body?.getReader) {
      // No stream — caller's fallback will handle this.
      throw Object.assign(new Error(`Agent health stream HTTP ${res.status}`), {
        code: 'AGENT_HEALTH_STREAM_HTTP',
        status: res.status,
      });
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalSnapshot = null;
    let streamError = null;

    function handleEvent(event) {
      if (!event) return;
      if (event.type === 'agent' && event.agentId) {
        if (typeof onAgent === 'function') {
          try { onAgent(event.agentId, event.health); } catch { /* ignore */ }
        }
      } else if (event.type === 'complete') {
        finalSnapshot = {
          agents: event.agents || {},
          checkedAt: event.checkedAt || null,
        };
      } else if (event.type === 'error') {
        streamError = Object.assign(new Error(event.error || 'Agent health stream failed.'), {
          code: event.code || 'AGENT_HEALTH_STREAM_FAILED',
        });
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try { handleEvent(JSON.parse(trimmed)); } catch { /* skip malformed */ }
      }
    }
    buffer += decoder.decode();
    const trimmedTail = buffer.trim();
    if (trimmedTail) {
      try { handleEvent(JSON.parse(trimmedTail)); } catch { /* skip malformed */ }
    }

    if (streamError) {
      if (typeof onError === 'function') onError(streamError);
      throw streamError;
    }
    if (!finalSnapshot) {
      throw Object.assign(new Error('Agent health stream ended before completion.'), {
        code: 'AGENT_HEALTH_STREAM_INCOMPLETE',
      });
    }
    entry.health = finalSnapshot.agents || entry.health;
    entry.checkedAt = finalSnapshot.checkedAt || entry.checkedAt;
    return {
      agents: entry.health,
      checkedAt: entry.checkedAt,
    };
  })()
    .finally(() => {
      entry.inFlightStream = null;
    });
  return entry.inFlightStream;
}

export default function useAgentHealth(agentIds = [], options = {}) {
  // Normalized cache key: filter falsy ids and sort so that the SAME set of
  // agents always maps to the same cache entry / in-flight slot regardless of
  // the order (or duplicate falsy entries) the caller passed. This is the key
  // that scopes the module cache to THIS hook's id set.
  const idKey = Array.isArray(agentIds)
    ? [...new Set(agentIds.filter(Boolean))].sort().join('|')
    : '';
  const ids = useMemo(
    () => (idKey ? idKey.split('|') : []),
    [idKey]
  );
  // Seed initial state from the matching cache entry only (never another id
  // set's data). If this id set hasn't been fetched yet, start empty.
  const seed = cacheByKey.get(idKey);
  const [agents, setAgents] = useState(seed ? seed.health : {});
  const [checkedAt, setCheckedAt] = useState(seed ? seed.checkedAt : null);
  const [error, setError] = useState('');

  const refresh = useCallback(async (refreshOptions = {}) => {
    try {
      const snapshot = await loadHealth(idKey, ids, {
        forceRefresh: refreshOptions.forceRefresh === true,
      });
      setAgents(snapshot.agents || {});
      setCheckedAt(snapshot.checkedAt || null);
      setError('');
      return snapshot;
    } catch (err) {
      setError(err?.message || 'Agent health unavailable.');
      return { agents: {}, checkedAt: null };
    }
  }, [idKey, ids]);

  useEffect(() => {
    let cancelled = false;
    // Streaming bootstrap: when the caller opts in, open the NDJSON stream
    // and dispatch a partial per-agent state update as each event arrives.
    // Falls back to the batched path on any error so a single agent never
    // wedges the bootstrap.
    if (options.stream === true && ids.length > 0) {
      loadHealthStream(idKey, ids, {
        onAgent: (agentId, health) => {
          if (cancelled) return;
          setAgents((prev) => ({ ...prev, [agentId]: health }));
        },
        onError: () => {
          // Stream-level error is handled by the fallback below; no state
          // update needed here.
        },
      })
        .then((snapshot) => {
          if (cancelled) return;
          setAgents(snapshot.agents || {});
          setCheckedAt(snapshot.checkedAt || null);
          setError('');
        })
        .catch((err) => {
          if (cancelled) return;
          // Fall back to the batched endpoint so the bootstrap still
          // resolves even if the stream endpoint is unreachable.
          loadHealth(idKey, ids, { forceRefresh: true })
            .then((snapshot) => {
              if (cancelled) return;
              setAgents(snapshot.agents || {});
              setCheckedAt(snapshot.checkedAt || null);
              setError('');
            })
            .catch(() => {
              if (!cancelled) setError(err?.message || 'Agent health unavailable.');
            });
        });
    } else {
      loadHealth(idKey, ids, { forceRefresh: options.forceRefresh === true })
        .then((snapshot) => {
          if (cancelled) return;
          setAgents(snapshot.agents || {});
          setCheckedAt(snapshot.checkedAt || null);
          setError('');
        })
        .catch((err) => {
          if (!cancelled) setError(err?.message || 'Agent health unavailable.');
        });
    }

    const pollMs = Number.isFinite(options.pollMs) && options.pollMs > 0
      ? options.pollMs
      : DEFAULT_POLL_MS;
    const id = window.setInterval(() => {
      refresh({ forceRefresh: false });
    }, pollMs);
    const onRefresh = () => {
      refresh({ forceRefresh: true });
    };
    window.addEventListener('agent-health-refresh', onRefresh);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('agent-health-refresh', onRefresh);
    };
  }, [idKey, ids, options.forceRefresh, options.pollMs, options.stream, refresh]);

  return {
    agents,
    checkedAt,
    error,
    refresh,
  };
}
