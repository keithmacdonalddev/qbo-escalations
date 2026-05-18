import { useCallback, useEffect, useMemo, useState } from 'react';
import { getProviderStrategyHealth } from '../api/agentIdentitiesApi.js';

const DEFAULT_POLL_MS = 60_000;
let cachedKey = '';
let cachedSnapshot = null;
let inFlight = null;

function stableStringify(value) {
  if (!value || typeof value !== 'object') return '{}';
  const ordered = Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = value[key];
      return acc;
    }, {});
  return JSON.stringify(ordered);
}

function mergeHealthSnapshots(previous, next) {
  if (!previous || previous.strategyKey !== next?.strategyKey) return next;
  if (!next) return previous;
  return {
    ...previous,
    ...next,
    readiness: next.readiness || previous.readiness || null,
    canary: next.canary || previous.canary || null,
    effective: {
      ...(previous.effective || {}),
      ...(next.effective || {}),
      confidence: next.effective?.confidence === 'heartbeat' && previous.effective?.confidence
        ? previous.effective.confidence
        : next.effective?.confidence || previous.effective?.confidence,
    },
  };
}

async function loadProviderStrategyHealth(strategy, key, options = {}) {
  const healthLevel = options.healthLevel || 'heartbeat';
  if (inFlight && !options.forceRefresh) return inFlight;
  inFlight = getProviderStrategyHealth(strategy, { ...options, healthLevel })
    .then((data) => {
      cachedKey = key;
      cachedSnapshot = mergeHealthSnapshots(cachedSnapshot, data ? { ...data, strategyKey: key } : null);
      return cachedSnapshot;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export default function useProviderStrategyHealth(providerStrategy = {}, options = {}) {
  const strategyKey = useMemo(() => stableStringify(providerStrategy), [providerStrategy]);
  const startupHealthLevel = options.startupHealthLevel || 'readiness';
  const pollHealthLevel = options.pollHealthLevel || 'heartbeat';
  const manualHealthLevel = options.manualHealthLevel || 'canary';
  const forceRefresh = options.forceRefresh === true;
  const pollMs = Number.isFinite(options.pollMs) && options.pollMs > 0
    ? options.pollMs
    : DEFAULT_POLL_MS;
  const [snapshot, setSnapshot] = useState(() => (cachedKey === strategyKey ? cachedSnapshot : null));
  const [error, setError] = useState('');

  const refresh = useCallback(async (refreshOptions = {}) => {
    try {
      const next = await loadProviderStrategyHealth(providerStrategy, strategyKey, {
        forceRefresh: refreshOptions.forceRefresh === true,
        healthLevel: refreshOptions.healthLevel || manualHealthLevel,
        trigger: refreshOptions.trigger || 'manual',
      });
      setSnapshot(next || null);
      setError('');
      return next;
    } catch (err) {
      setError(err?.message || 'Provider health unavailable.');
      return null;
    }
  }, [manualHealthLevel, providerStrategy, strategyKey]);

  useEffect(() => {
    let cancelled = false;
    loadProviderStrategyHealth(providerStrategy, strategyKey, {
      forceRefresh: forceRefresh || cachedKey !== strategyKey,
      healthLevel: startupHealthLevel,
      trigger: 'startup',
    })
      .then((next) => {
        if (cancelled) return;
        setSnapshot(next || null);
        setError('');
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Provider health unavailable.');
      });

    const id = window.setInterval(() => {
      refresh({
        forceRefresh: false,
        healthLevel: pollHealthLevel,
        trigger: 'poll',
      });
    }, pollMs);
    const onRefresh = () => {
      refresh({
        forceRefresh: true,
        healthLevel: manualHealthLevel,
        trigger: 'event',
      });
    };
    window.addEventListener('provider-strategy-health-refresh', onRefresh);
    window.addEventListener('agent-health-refresh', onRefresh);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('provider-strategy-health-refresh', onRefresh);
      window.removeEventListener('agent-health-refresh', onRefresh);
    };
  }, [forceRefresh, manualHealthLevel, pollHealthLevel, pollMs, providerStrategy, refresh, startupHealthLevel, strategyKey]);

  return {
    snapshot,
    error,
    refresh,
  };
}
