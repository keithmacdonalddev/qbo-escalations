// AgentRegistryContext
//
// A single source of truth for "which agents exist and what is each agent's
// current reachability status." Mounted once at the root of the app in App.jsx.
//
// Why this exists:
//   Today the chat-page status dots in AgentsView.jsx read from a hardcoded
//   table called AGENT_OPERATION_META, not from real provider reachability
//   checks. AppHeader.jsx is the only surface that uses real health data via
//   useAgentHealth. We are migrating every status surface (header, AgentsView,
//   PipelineSidebar, banners, toasts, profile-edit recheck) to one shared
//   provider so the agent profile is the only authoritative selector and every
//   indicator on screen agrees with every other indicator.
//
// What this file delivers in Step 2 of the rollout:
//   - The AgentRegistryProvider component, mounted at the root in App.jsx.
//   - The useAgentRegistry hook for the registry-aware consumer hook
//     (useAgent) to read internal state.
//   - A safe default context value so that any component that mounts BEFORE
//     the provider (or outside the provider in tests) does not crash.
//
// What is intentionally NOT in this step:
//   - No UI yet reads from useAgent — AppHeader continues to use useAgentHealth
//     directly until Step 3 of the rollout plan.
//   - No boot overlay, no banner, no toast wiring, no recovery polling. Those
//     are later rollout steps. This step only wires the registry into the tree.
//
// How polling works here:
//   The provider does NOT re-implement health polling. It reuses the existing
//   useAgentHealth hook (the "polling engine") and joins its output with the
//   list of agents fetched from GET /api/agent-identities/. That keeps the
//   60-second poll, the 30-second cache, and the agent-health-refresh custom
//   event behavior unchanged. Future rollout steps may layer accelerated
//   polling on top of this; today's job is just to expose what's already there
//   through a stable context shape.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { listAgentIdentities, getAgentHealth } from '../api/agentIdentitiesApi.js';
import useAgentHealth from '../hooks/useAgentHealth.js';

// Neutral fallback used both as React's default context value and as the
// "this agentId isn't in the registry yet" return from useAgent. We return
// this shape (status: 'unknown') instead of undefined so consumers never have
// to null-check the deep path. A still-checking dot can render as gray.
const UNKNOWN_HEALTH = Object.freeze({
  status: 'unknown',
  diagnostic: null,
  checkedAt: null,
});

const DEFAULT_CTX = Object.freeze({
  bootstrapping: true,
  agents: Object.freeze({}),
  // These are no-op promises so that any consumer that calls them before the
  // provider mounts (e.g. during a Storybook snapshot or in a unit test) does
  // not throw.
  refreshAll: async () => {},
  refreshOne: async () => null,
});

const AgentRegistryContext = createContext(DEFAULT_CTX);

/**
 * AgentRegistryProvider
 *
 * Mounts inside the existing top-level providers (WorkspaceMonitorProvider,
 * MotionConfig, Profiler) and OUTSIDE every route. Children render exactly as
 * before — nothing in this step gates render on `bootstrapping`. The flag is
 * exposed for the future boot-overlay step (Step 7) to consume.
 *
 * Internally:
 *   - On mount, fetch the agent list from GET /api/agent-identities/.
 *   - Mount useAgentHealth() (the existing polling engine) for the same set of
 *     agent ids — it handles the periodic /api/agent-identities/health calls.
 *   - Join the two streams (profile list + health map) into a single map keyed
 *     by agentId, exposed via context.
 *
 * Forced-refresh behavior:
 *   - refreshAll() runs the polling engine's refresh with forceRefresh: true,
 *     and ALSO dispatches the existing `agent-health-refresh` custom event
 *     for any other useAgentHealth subscribers in the tree. The event is a
 *     belt-and-suspenders move — useAgentHealth already listens for it, so
 *     any future surface that stays on the old hook will still see the refresh.
 *   - refreshOne(agentId) bypasses the in-hook cache and calls the health
 *     endpoint directly with refresh=1 for just that agent. The response then
 *     merges into the current health snapshot. This keeps the single-agent
 *     refresh fast and avoids stomping on the global cache.
 *
 *     refreshOne resolves to the fresh single-agent health payload
 *     ({ status, diagnostic|message, checkedAt, ... }) so a caller awaiting
 *     it can read the result directly without depending on React's render
 *     scheduling. On request failure it resolves to a synthesized offline
 *     snapshot describing the error. Resolves to null only when called with
 *     no agentId (defensive guard).
 */
export function AgentRegistryProvider({ children }) {
  const [profilesById, setProfilesById] = useState({});
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState('');
  // localHealth is a per-agent override map used by refreshOne so a forced
  // single-agent refresh shows up immediately without waiting for the global
  // poll. The poll's snapshot is the base; localHealth wins on the merge.
  const [localHealth, setLocalHealth] = useState({});
  const [localCheckedAt, setLocalCheckedAt] = useState(null);

  // List of agent ids (stable string array) feeds the polling engine.
  const agentIds = useMemo(() => Object.keys(profilesById), [profilesById]);

  // The polling engine. It fetches /api/agent-identities/health for these
  // ids, caches for 30s in-module, polls every 60s, listens for the
  // `agent-health-refresh` custom event, and exposes the latest snapshot.
  //
  // `stream: true` opts into the NDJSON /health/stream endpoint for the
  // initial bootstrap so per-agent reachability results land one-at-a-time
  // and AgentBootOverlay can fill its per-agent progress bars as each
  // check settles, instead of waiting for the whole batch to resolve.
  const {
    agents: polledHealth,
    checkedAt: polledCheckedAt,
    refresh: pollingRefresh,
  } = useAgentHealth(agentIds, { stream: true });

  // Initial load of agent profiles. Runs once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listAgentIdentities();
        if (cancelled) return;
        const byId = {};
        for (const agent of Array.isArray(list) ? list : []) {
          if (agent?.agentId) {
            byId[agent.agentId] = agent;
          }
        }
        setProfilesById(byId);
        setProfilesError('');
      } catch (err) {
        if (!cancelled) {
          setProfilesError(err?.message || 'Failed to load agents.');
        }
      } finally {
        if (!cancelled) setProfilesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ────────────────────────────────────────────────────────────────────────
  // Periodic profile-list refetch (AC#16).
  //
  // The initial-load effect above runs once on mount, so without this effect
  // any agent record added to MongoDB after boot would be invisible to every
  // consumer of the registry until a full page refresh. The 60s health poll
  // inside useAgentHealth re-fetches only the *health* probe — it does NOT
  // re-fetch the *profile list* — so a new custom agent never enters the
  // `agentIds` array, never gets polled, and never surfaces via useAgent.
  //
  // Fix: re-fetch the profile list every 60 seconds and merge any new agents
  // into `profilesById`. We only swap the map when the id set has changed
  // (or top-level fields differ) so consumers that depend on the agents
  // memo don't re-run on every tick. Failures fall through silently — we
  // keep the last known good list rather than blanking the registry on a
  // transient network blip.
  //
  // See cto-review finding M2.
  // ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const PROFILE_REFETCH_MS = 60_000;
    let cancelled = false;
    const id = window.setInterval(async () => {
      try {
        const list = await listAgentIdentities();
        if (cancelled) return;
        const byId = {};
        for (const agent of Array.isArray(list) ? list : []) {
          if (agent?.agentId) {
            byId[agent.agentId] = agent;
          }
        }
        setProfilesById((prev) => {
          // Cheap-but-correct equality check: same id set AND same
          // updatedAt timestamp per agent. If anything changed, swap.
          const prevKeys = Object.keys(prev).sort().join('|');
          const nextKeys = Object.keys(byId).sort().join('|');
          if (prevKeys !== nextKeys) return byId;
          for (const agentId of Object.keys(byId)) {
            if (prev[agentId]?.updatedAt !== byId[agentId]?.updatedAt) {
              return byId;
            }
          }
          return prev;
        });
        // Clear any sticky profilesError now that a refetch succeeded.
        setProfilesError((prevErr) => (prevErr ? '' : prevErr));
      } catch {
        // Swallow — keep the last good list. A persistent failure shows up
        // on the next surface that needs the profile list (e.g. AgentsView's
        // own load), not as a registry-level error.
      }
    }, PROFILE_REFETCH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Build the unified agents map for context. profile + health + enabled,
  // keyed by agentId. Consumers (via useAgent) read this map.
  const agents = useMemo(() => {
    const merged = {};
    for (const agentId of Object.keys(profilesById)) {
      const profile = profilesById[agentId];
      // Polled health from useAgentHealth (shape: status/message/checkedAt/...).
      // Local health from refreshOne (forced single-agent refresh) wins so a
      // just-saved profile shows its fresh result immediately.
      const polled = polledHealth?.[agentId] || null;
      const local = localHealth?.[agentId] || null;
      const source = local || polled || null;

      const checkedAt = source?.checkedAt
        || localCheckedAt
        || polledCheckedAt
        || null;

      // Diagnostic falls back to message for compatibility with the existing
      // health-service response, which uses `message` for the human-readable
      // detail. Step 1 of the rollout sharpened these to per-agent specifics.
      const diagnostic = source
        ? (source.diagnostic ?? source.message ?? null)
        : null;

      const health = source
        ? {
            status: source.status || 'unknown',
            diagnostic,
            checkedAt,
          }
        : UNKNOWN_HEALTH;

      merged[agentId] = {
        profile,
        health,
        // Prefer the live `enabled` from the health snapshot (the source of
        // truth for runtime state). Fall back to the profile's stored value
        // until the first health snapshot lands. Null means "not yet known."
        enabled: source && typeof source.enabled === 'boolean'
          ? source.enabled
          : (typeof profile?.enabled === 'boolean' ? profile.enabled : null),
      };
    }
    return merged;
  }, [profilesById, polledHealth, localHealth, polledCheckedAt, localCheckedAt]);

  // bootstrapping: true until the profile list has loaded AND the polling
  // engine has produced its first checkedAt. The boot-overlay step (Step 7)
  // will use this flag to gate route rendering; today it is just exposed.
  const bootstrapping = profilesLoading || (agentIds.length > 0 && !polledCheckedAt);

  const refreshAll = useCallback(async () => {
    // Tell the polling engine to skip its cache and fetch fresh. Also fire
    // the legacy custom event so any other useAgentHealth subscriber in the
    // tree (e.g. AppHeader before Step 3 migrates it) refreshes too.
    try {
      window.dispatchEvent(new Event('agent-health-refresh'));
    } catch {
      // Older browsers / non-DOM test environments — safe to ignore.
    }
    await pollingRefresh({ forceRefresh: true });
  }, [pollingRefresh]);

  const refreshOne = useCallback(async (agentId) => {
    if (!agentId) return null;
    try {
      const data = await getAgentHealth([agentId], { forceRefresh: true });
      const single = data?.agents?.[agentId] || null;
      if (single) {
        setLocalHealth((prev) => ({ ...prev, [agentId]: single }));
      }
      if (data?.checkedAt) {
        setLocalCheckedAt(data.checkedAt);
      }
      // Return the just-fetched payload so callers (e.g. AgentsView's save-time
      // recheck) can read the fresh status without waiting for React to flush
      // the setLocalHealth state update and recompute the merged `agents` map.
      // Without this return, a caller reading `agentRegistry.agents[id].health`
      // immediately after `await refreshOne(id)` reads the PRE-refresh snapshot
      // (closure-captured from the render that scheduled the call), leading
      // to "Saved · Provider responding at Nms" pills that contradict the
      // actual recheck result. See cto-review finding H1.
      return single;
    } catch (err) {
      // Surface the failure on the agent's local health entry so a consumer
      // displaying the inline save-recheck result can read it. We mark the
      // agent offline with the error message rather than swallowing.
      const offlineSnapshot = {
        status: 'offline',
        diagnostic: err?.message || 'Health check failed.',
        message: err?.message || 'Health check failed.',
        checkedAt: new Date().toISOString(),
      };
      setLocalHealth((prev) => ({
        ...prev,
        [agentId]: offlineSnapshot,
      }));
      // Same rationale as the success branch: return the synthesized offline
      // snapshot so the caller observes the failure without depending on
      // React's render scheduling.
      return offlineSnapshot;
    }
  }, []);

  // ────────────────────────────────────────────────────────────────────────
  // Recovery polling (AC#12 from the bootstrap plan).
  //
  // Goal: when an agent is offline, we want to notice it has come back
  // within ~15s rather than waiting up to 60s for the next normal poll.
  //
  // Mechanism: for every agentId currently in `offline` status, run a 15s
  // ticker that calls refreshOne(agentId). refreshOne bypasses the in-hook
  // cache (forceRefresh=true) so each tick actually re-checks the provider.
  // When the agent's status flips away from `offline` (online / disabled /
  // unknown), we clear that agent's ticker. Tickers are tracked PER AGENT
  // in a ref-held Map so multiple agents going offline don't interfere
  // with each other.
  //
  // What this does NOT change:
  //   - The base 60s poll inside useAgentHealth still runs. The 15s ticker
  //     is purely additive — it doesn't try to disable, replace, or
  //     reschedule the base poll.
  //   - The context's public API is unchanged. Recovery polling is an
  //     internal behavior of the provider; consumers see nothing new on
  //     the context value.
  //
  // Cleanup contract:
  //   - When an agent leaves offline → its ticker is cleared.
  //   - When an agent disappears from the registry → its ticker is cleared.
  //   - When the provider unmounts → all tickers are cleared.
  const RECOVERY_POLL_INTERVAL_MS = 15_000;
  const recoveryTickersRef = useRef(new Map()); // agentId → setInterval handle

  useEffect(() => {
    const tickers = recoveryTickersRef.current;
    const currentlyOffline = new Set();
    for (const agentId of Object.keys(agents)) {
      if (agents[agentId]?.health?.status === 'offline') {
        currentlyOffline.add(agentId);
      }
    }

    // Start tickers for newly-offline agents.
    for (const agentId of currentlyOffline) {
      if (tickers.has(agentId)) continue;
      const handle = window.setInterval(() => {
        // refreshOne is stable across renders (memoized below) but we read
        // the latest reference via closure since this effect re-runs whenever
        // the `agents` map changes — which captures fresh refreshOne too.
        try {
          const maybePromise = refreshOne(agentId);
          if (maybePromise && typeof maybePromise.then === 'function') {
            // refreshOne already records errors as a local offline state,
            // so we don't need to do anything with a rejection here. Swallow
            // to keep unhandled-rejection noise out of the console.
            maybePromise.catch(() => {});
          }
        } catch {
          // Defensive — refreshOne shouldn't throw synchronously, but if a
          // future change makes it do so we don't want the ticker to die.
        }
      }, RECOVERY_POLL_INTERVAL_MS);
      tickers.set(agentId, handle);
    }

    // Clear tickers for agents that recovered, were disabled, or vanished
    // from the registry.
    for (const agentId of Array.from(tickers.keys())) {
      if (!currentlyOffline.has(agentId)) {
        window.clearInterval(tickers.get(agentId));
        tickers.delete(agentId);
      }
    }
  }, [agents, refreshOne]);

  // Provider-unmount cleanup. Runs once on mount, returns the teardown that
  // clears every still-active ticker. Separate from the per-agent effect
  // above so we don't accidentally tear down healthy tickers on every render.
  useEffect(() => {
    const tickers = recoveryTickersRef.current;
    return () => {
      for (const handle of tickers.values()) {
        window.clearInterval(handle);
      }
      tickers.clear();
    };
  }, []);

  const value = useMemo(() => ({
    bootstrapping,
    agents,
    refreshAll,
    refreshOne,
    // Surface the profile-list load error so a future consumer (the boot
    // overlay) can render a "Server unreachable" state without re-fetching.
    profilesError,
  }), [bootstrapping, agents, refreshAll, refreshOne, profilesError]);

  return (
    <AgentRegistryContext.Provider value={value}>
      {children}
    </AgentRegistryContext.Provider>
  );
}

/**
 * useAgentRegistry — internal accessor used by the useAgent hook. Exported in
 * case a future surface needs the whole registry (e.g. a "list all agents"
 * settings page). Most consumers should use useAgent(id) instead.
 */
export function useAgentRegistry() {
  return useContext(AgentRegistryContext) || DEFAULT_CTX;
}

// Re-exported so useAgent can share the exact same frozen object instead of
// constructing a fresh one each call (keeps reference equality stable across
// renders for memo-heavy consumers).
export { UNKNOWN_HEALTH };

export default AgentRegistryContext;
