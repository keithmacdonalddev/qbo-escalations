export const WORKSPACE_AGENT_REQUEST_EVENT = 'qbo:workspace-agent-request';

export function dispatchWorkspaceAgentRequest({ prompt, viewContext, source = 'unknown' } = {}) {
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!normalizedPrompt || typeof window === 'undefined') return false;

  const normalizedContext = viewContext && typeof viewContext === 'object'
    ? { ...viewContext }
    : null;

  window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_REQUEST_EVENT, {
    detail: {
      prompt: normalizedPrompt,
      viewContext: normalizedContext,
      source: String(source || 'unknown'),
    },
  }));

  return true;
}
