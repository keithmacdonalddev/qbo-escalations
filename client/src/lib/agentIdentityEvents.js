export const AGENT_PROFILE_UPDATED_EVENT = 'agent-profile-updated';

export function dispatchAgentProfileUpdated(agent) {
  if (typeof window === 'undefined' || !agent?.agentId) return;

  window.dispatchEvent(new CustomEvent(AGENT_PROFILE_UPDATED_EVENT, {
    detail: {
      agentId: agent.agentId,
      agent,
    },
  }));
}
