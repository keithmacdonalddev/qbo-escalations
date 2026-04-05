import { apiFetchJson } from './http.js';

const BASE = '/api/agent-prompts';

export async function listAgentPrompts() {
  const data = await apiFetchJson(BASE, {}, 'Failed to load agent prompts');
  return data.prompts;
}

export async function getAgentPrompt(id) {
  const data = await apiFetchJson(`${BASE}/${encodeURIComponent(id)}`, {}, 'Failed to load agent prompt');
  return data;
}

export async function updateAgentPrompt(id, content, label) {
  const body = { content };
  if (label) body.label = label;
  const data = await apiFetchJson(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 'Failed to save agent prompt');
  return data.prompt;
}

export async function listAgentPromptVersions(id) {
  const data = await apiFetchJson(`${BASE}/${encodeURIComponent(id)}/versions`, {}, 'Failed to load agent prompt history');
  return data.versions;
}

export async function getAgentPromptVersion(id, ts) {
  const data = await apiFetchJson(`${BASE}/${encodeURIComponent(id)}/versions/${ts}`, {}, 'Failed to load agent prompt version');
  return data.content;
}

export async function restoreAgentPromptVersion(id, ts) {
  await apiFetchJson(`${BASE}/${encodeURIComponent(id)}/restore/${ts}`, {
    method: 'POST',
  }, 'Failed to restore agent prompt version');
}
