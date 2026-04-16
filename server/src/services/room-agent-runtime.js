'use strict';

const { normalizeModelOverride } = require('./chat-orchestrator');
const {
  getDefaultProvider,
  getAlternateProvider,
  getProviderLabel,
  getProviderModelId,
  isAllowedEffort,
  normalizeProvider,
} = require('./providers/registry');
const { DEFAULT_CHAT_RUNTIME_SETTINGS } = require('../lib/chat-settings');
const { DEFAULT_PROFILES } = require('./room-agents/agent-profiles');

const FALLBACK_ROOM_AGENT_PROVIDERS = Object.freeze({
  chat: 'claude-opus-4-6',
  workspace: 'claude-opus-4-6',
  copilot: 'claude-opus-4-6',
  'image-analyst': 'claude-sonnet-4-6',
});

function normalizeRoomAgentRuntimeSelections(rawSelections = {}) {
  const result = {};
  if (!rawSelections || typeof rawSelections !== 'object') return result;

  for (const [agentId, raw] of Object.entries(rawSelections)) {
    if (!DEFAULT_PROFILES[agentId] || !raw || typeof raw !== 'object') continue;

    const fallbackPreferredProvider = FALLBACK_ROOM_AGENT_PROVIDERS[agentId] || getDefaultProvider();
    const primaryProvider = raw.provider
      ? normalizeProvider(raw.provider)
      : fallbackPreferredProvider;
    const mode = raw.mode === 'fallback' ? 'fallback' : 'single';
    const primaryModel = normalizeModelOverride(raw.model || raw.primaryModel || '');
    const fallbackProvider = mode === 'fallback'
      ? normalizeProvider(raw.fallbackProvider || getAlternateProvider(primaryProvider))
      : getAlternateProvider(primaryProvider);
    const fallbackModel = normalizeModelOverride(raw.fallbackModel || '');
    const requestedEffort = typeof raw.reasoningEffort === 'string'
      ? raw.reasoningEffort.trim().toLowerCase()
      : '';
    const defaultEffort = DEFAULT_CHAT_RUNTIME_SETTINGS.providerStrategy.reasoningEffort || 'high';
    const reasoningEffort = requestedEffort && isAllowedEffort(primaryProvider, requestedEffort)
      ? requestedEffort
      : defaultEffort;

    result[agentId] = {
      mode,
      primaryProvider,
      primaryModel,
      fallbackProvider,
      fallbackModel,
      reasoningEffort,
    };
  }

  return result;
}

function resolveAgentRuntimePolicy(agent, selections = {}) {
  const agentKey = agent?.id || agent?.agentId || '';
  const fallbackPreferredProvider = normalizeProvider(
    agent?.preferredProvider
      || FALLBACK_ROOM_AGENT_PROVIDERS[agentKey]
      || getDefaultProvider()
  );
  const selection = selections?.[agentKey] || null;
  const primaryProvider = selection?.primaryProvider || fallbackPreferredProvider;
  const primaryModel = selection?.primaryModel || '';
  const mode = selection?.mode === 'fallback' ? 'fallback' : 'single';
  const fallbackProvider = mode === 'fallback'
    ? (selection?.fallbackProvider || getAlternateProvider(primaryProvider))
    : getAlternateProvider(primaryProvider);
  const fallbackModel = mode === 'fallback' ? (selection?.fallbackModel || '') : '';
  const requestedEffort = selection?.reasoningEffort || '';
  const defaultEffort = DEFAULT_CHAT_RUNTIME_SETTINGS.providerStrategy.reasoningEffort || 'high';
  const reasoningEffort = requestedEffort && isAllowedEffort(primaryProvider, requestedEffort)
    ? requestedEffort
    : defaultEffort;

  return {
    mode,
    primaryProvider,
    primaryModel,
    fallbackProvider,
    fallbackModel,
    reasoningEffort,
    reportedModel: primaryModel || getProviderModelId(primaryProvider) || '',
    providerLabel: getProviderLabel(primaryProvider),
  };
}

function buildRoomRuntimeContext(currentAgentId, activeAgentIds = [], selections = {}) {
  const activeList = Array.isArray(activeAgentIds) && activeAgentIds.length > 0
    ? activeAgentIds
    : Object.keys(selections || {});
  if (activeList.length === 0) return '';

  const lines = [
    '## Current Runtime',
    'Use this section as the live source of truth for which provider/model each room agent is currently configured to use.',
    'If the user asks what model you or another agent is using, answer from this section instead of guessing from stale defaults, history, or memory.',
    '',
  ];

  for (const agentId of activeList) {
    const profile = DEFAULT_PROFILES[agentId];
    if (!profile) continue;
    const policy = resolveAgentRuntimePolicy(profile, selections);
    const label = profile.displayName || agentId;
    const marker = agentId === currentAgentId ? ' (you)' : '';
    const parts = [
      `- ${label}${marker}:`,
      policy.providerLabel || policy.primaryProvider,
      policy.reportedModel ? `model ${policy.reportedModel}` : '',
      policy.mode === 'fallback' && policy.fallbackProvider
        ? `fallback ${getProviderLabel(policy.fallbackProvider)}${policy.fallbackModel ? ` / ${policy.fallbackModel}` : ''}`
        : '',
      policy.reasoningEffort ? `effort ${policy.reasoningEffort}` : '',
    ].filter(Boolean);
    lines.push(parts.join(' | '));
  }

  return lines.join('\n').trim();
}

module.exports = {
  buildRoomRuntimeContext,
  normalizeRoomAgentRuntimeSelections,
  resolveAgentRuntimePolicy,
};
