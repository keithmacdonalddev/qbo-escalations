'use strict';

const path = require('path');
const fs = require('fs');
const { getAgentProfile } = require('./agent-profiles');

const agents = new Map();

// Auto-register all *-agent-def.js files in this directory
const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('-agent-def.js'));
for (const file of files) {
  const def = require(path.join(dir, file));
  if (!def || typeof def.id !== 'string' || !def.id) {
    console.warn('[room-agents/registry] Skipping %s — missing or invalid "id"', file);
    continue;
  }
  if (typeof def.preferredProvider !== 'string' || !def.preferredProvider) {
    console.warn('[room-agents/registry] Skipping %s (id=%s) — missing "preferredProvider"', file, def.id);
    continue;
  }
  if (agents.has(def.id)) {
    console.warn('[room-agents/registry] Duplicate agent id "%s" in %s — skipping', def.id, file);
    continue;
  }
  def.profile = getAgentProfile(def.id);
  agents.set(def.id, def);
}

console.log('[room-agents/registry] Loaded %d agent(s): %s', agents.size, [...agents.keys()].join(', '));

/**
 * Get a single agent definition by ID.
 */
function getAgent(id) {
  return agents.get(id) || null;
}

/**
 * Get all public (non-internal) agent definitions.
 */
function getAllAgents() {
  const result = [];
  for (const agent of agents.values()) {
    if (!agent.internal) result.push(agent);
  }
  return result;
}

/**
 * Get all public agent IDs.
 */
function getAgentIds() {
  const ids = [];
  for (const agent of agents.values()) {
    if (!agent.internal) ids.push(agent.id);
  }
  return ids;
}

/**
 * Determine which agents should respond to a message.
 *
 * @param {string} message - The user's message text
 * @param {string[]} mentions - Parsed @mention agent IDs
 * @param {Object} roomState - Room document (activeAgents, settings)
 * @returns {Object[]} Ordered array of agent definitions
 */
function getAgentsForMessage(message, mentions, roomState) {
  const activeIds = new Set(roomState.activeAgents || []);
  const mode = roomState.settings?.orchestrationMode || 'auto';

  // If explicit @mentions, return only those agents (validated against registry + active)
  if (Array.isArray(mentions) && mentions.length > 0) {
    const mentioned = [];
    for (const id of mentions) {
      const agent = agents.get(id);
      if (agent && !agent.internal && activeIds.has(id)) {
        mentioned.push(agent);
      }
    }
    if (mentioned.length > 0) {
      return mentioned.sort((a, b) => (a.priority || 100) - (b.priority || 100));
    }
    // Fall through to default behavior if no valid mentions matched
  }

  // mentioned-only mode with no valid mentions — empty (caller should show helpful error)
  if (mode === 'mentioned-only') {
    return [];
  }

  // 'all' mode — return all active agents
  if (mode === 'all') {
    const all = [];
    for (const id of activeIds) {
      const agent = agents.get(id);
      if (agent && !agent.internal) all.push(agent);
    }
    return all.sort((a, b) => (a.priority || 100) - (b.priority || 100));
  }

  // 'auto' mode — let the Router Agent decide (caller handles this)
  // Return all active agents as candidates; the orchestrator will invoke the Router Agent to filter
  const candidates = [];
  for (const id of activeIds) {
    const agent = agents.get(id);
    if (agent && !agent.internal) candidates.push(agent);
  }
  return candidates.sort((a, b) => (a.priority || 100) - (b.priority || 100));
}

module.exports = {
  getAgent,
  getAllAgents,
  getAgentIds,
  getAgentsForMessage,
};
