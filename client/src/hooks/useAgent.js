// useAgent
//
// The single read API every status indicator should use to learn about one
// agent's reachability. Migration target for AppHeader (Step 3), AgentsView
// (Step 4), PipelineSidebar (Step 5), the save-time recheck (Step 6), and the
// boot overlay (Step 7).
//
// Why this hook exists:
//   Today, multiple surfaces read agent status from different places — the
//   chat page reads a hardcoded table, AppHeader reads useAgentHealth, and
//   nothing else reads anything. That divergence is exactly the bug the
//   user is fixing. This hook is the shared lookup so every surface agrees.
//
// Returned shape:
//   {
//     profile: object|null,        // the AgentIdentity record or null if unknown
//     health: {                    // always present, never undefined
//       status: 'online' | 'offline' | 'disabled' | 'unknown',
//       diagnostic: string|null,   // specific failure detail (e.g. "connection refused at 127.0.0.1:1234")
//       checkedAt: string|null,    // ISO timestamp of last health check
//     },
//     enabled: boolean|null,       // null until first health snapshot lands
//     refresh: () => Promise<void> // forced recheck of just this agent
//   }
//
// Unknown agentIds:
//   When called with an agentId that isn't in the registry (e.g. an agent
//   added to MongoDB after boot, or a typo), this returns a neutral fallback
//   with health.status === 'unknown'. Consumers should treat 'unknown' as a
//   gray "checking..." dot, not as an error. Within one 60-second poll cycle
//   the registry detects new agents and the entry will populate.

import { useCallback, useMemo } from 'react';
import { useAgentRegistry, UNKNOWN_HEALTH } from '../context/AgentRegistryContext.jsx';

export default function useAgent(agentId) {
  const registry = useAgentRegistry();
  const entry = agentId ? registry.agents?.[agentId] : null;

  const refresh = useCallback(() => {
    if (!agentId) return Promise.resolve();
    return registry.refreshOne(agentId);
  }, [agentId, registry]);

  return useMemo(() => {
    if (!entry) {
      return {
        profile: null,
        health: UNKNOWN_HEALTH,
        enabled: null,
        refresh,
      };
    }
    return {
      profile: entry.profile || null,
      health: entry.health || UNKNOWN_HEALTH,
      enabled: typeof entry.enabled === 'boolean' ? entry.enabled : null,
      refresh,
    };
  }, [entry, refresh]);
}
