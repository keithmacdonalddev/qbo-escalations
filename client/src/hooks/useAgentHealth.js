import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAgentHealth } from '../api/agentIdentitiesApi.js';

const DEFAULT_POLL_MS = 60_000;
let cachedHealth = {};
let cachedCheckedAt = null;
let inFlight = null;

async function loadHealth(agentIds, options = {}) {
  if (inFlight && !options.forceRefresh) return inFlight;
  inFlight = getAgentHealth(agentIds, options)
    .then((data) => {
      cachedHealth = data?.agents || {};
      cachedCheckedAt = data?.checkedAt || null;
      return {
        agents: cachedHealth,
        checkedAt: cachedCheckedAt,
      };
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export default function useAgentHealth(agentIds = [], options = {}) {
  const idKey = Array.isArray(agentIds) ? agentIds.join('|') : '';
  const ids = useMemo(
    () => (Array.isArray(agentIds) ? agentIds.filter(Boolean) : []),
    [idKey]
  );
  const [agents, setAgents] = useState(cachedHealth);
  const [checkedAt, setCheckedAt] = useState(cachedCheckedAt);
  const [error, setError] = useState('');

  const refresh = useCallback(async (refreshOptions = {}) => {
    try {
      const snapshot = await loadHealth(ids, {
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
  }, [ids]);

  useEffect(() => {
    let cancelled = false;
    loadHealth(ids, { forceRefresh: options.forceRefresh === true })
      .then((snapshot) => {
        if (cancelled) return;
        setAgents(snapshot.agents || {});
        setCheckedAt(snapshot.checkedAt || null);
        setError('');
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Agent health unavailable.');
      });

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
  }, [ids, options.forceRefresh, options.pollMs, refresh]);

  return {
    agents,
    checkedAt,
    error,
    refresh,
  };
}
