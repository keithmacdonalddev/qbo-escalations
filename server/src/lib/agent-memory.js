'use strict';

const DevAgentLog = require('../models/DevAgentLog');

// ---------------------------------------------------------------------------
// In-memory cache — avoids hitting MongoDB on every request
// ---------------------------------------------------------------------------
let cachedEntries = null;
let cacheExpiry = 0;
const CACHE_TTL = 60_000; // 60s

// Synchronous in-memory set: recently agent-touched file paths with TTL
const recentAgentFiles = new Map(); // path -> expiry timestamp

// Character budget for memory section in system prompt
const MEMORY_CHAR_CAP = 6000;

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Persist an agent action to the DevAgentLog collection.
 * Async fire-and-forget — mirrors the usage-writer pattern.
 * Invalidates the in-memory cache so the next retrieval picks it up.
 *
 * @param {Object} entry - Fields matching DevAgentLog schema
 */
async function logAgentAction(entry) {
  try {
    await DevAgentLog.create(entry);
    cachedEntries = null; // invalidate cache
  } catch (err) {
    console.error('[agent-memory] Failed to log action:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Retrieve
// ---------------------------------------------------------------------------

/**
 * Retrieve the most relevant memory entries for a given query.
 * Uses keyword matching + recency boost. Results are cached for CACHE_TTL.
 *
 * @param {string} query - The user message or context to match against
 * @param {Object} [options]
 * @param {number} [options.topK=10] - Max entries to return
 * @returns {Promise<Object[]>}
 */
async function retrieveRelevantMemory(query, options = {}) {
  const { topK = 10 } = options;

  // Check cache
  if (cachedEntries && Date.now() < cacheExpiry) {
    return scoreAndRank(cachedEntries, query, topK);
  }

  // Fetch last 100 entries (covers ~2 weeks of moderate activity)
  const entries = await DevAgentLog.find({})
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  cachedEntries = entries;
  cacheExpiry = Date.now() + CACHE_TTL;

  return scoreAndRank(entries, query, topK);
}

/**
 * Score entries against query terms with recency boost.
 * Returns top-K entries sorted by descending score.
 */
function scoreAndRank(entries, query, topK) {
  if (!entries || entries.length === 0) return [];

  const queryTerms = (query || '').toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (queryTerms.length === 0) {
    // No meaningful query terms — return most recent entries
    return entries.slice(0, topK);
  }

  return entries
    .map(entry => {
      let score = 0;
      const text = `${entry.summary} ${entry.detail} ${entry.resolution} ${(entry.filesAffected || []).join(' ')} ${entry.type} ${entry.category}`.toLowerCase();

      for (const term of queryTerms) {
        if (text.includes(term)) score += 1;
      }

      // Pinned boost: always surface persistent memories
      if (entry.pinned) score += 3;

      // Recency boost: last hour +2, last day +1
      const ageMs = Date.now() - new Date(entry.createdAt).getTime();
      if (ageMs < 3_600_000) score += 2;
      else if (ageMs < 86_400_000) score += 1;

      return { ...entry, _score: score };
    })
    .filter(e => e._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, topK);
}

// ---------------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------------

/**
 * Format memory entries into text for the system prompt.
 * Enforces the MEMORY_CHAR_CAP to stay within token budgets.
 * Does NOT add its own section header — the caller (dev-context-builder)
 * wraps the output in an AGENT MEMORY section.
 *
 * @param {Object[]} entries
 * @returns {string} - Empty string if no entries
 */
function formatMemoryForPrompt(entries) {
  if (!entries || entries.length === 0) return '';

  let output = '';

  for (const e of entries) {
    const pin = e.pinned ? '[PIN] ' : '';
    const age = formatAge(e.createdAt);
    const files = (e.filesAffected || []).slice(0, 3).join(', ');
    const resolution = e.resolution ? ` -> ${e.resolution}` : '';
    const line = `${pin}[${age}] ${e.type.toUpperCase()}: ${e.summary}${files ? ` | ${files}` : ''}${resolution}`;
    const separator = output ? '\n' : '';

    if (output.length + separator.length + line.length > MEMORY_CHAR_CAP) break;
    output += separator + line;
  }

  return output;
}

/**
 * Human-readable relative time.
 */
function formatAge(date) {
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Stats / health
// ---------------------------------------------------------------------------

/**
 * Aggregated counts by type — for future health/analytics endpoint.
 */
function getMemoryStats() {
  return DevAgentLog.aggregate([
    { $group: { _id: '$type', count: { $sum: 1 } } },
  ]);
}

// ---------------------------------------------------------------------------
// Recent agent files (in-memory, 60s TTL)
// ---------------------------------------------------------------------------

/**
 * Register file paths the agent touched in the current response.
 */
function addToRecentAgentFiles(paths) {
  const expiry = Date.now() + 60_000;
  for (const p of paths) {
    if (p) recentAgentFiles.set(p, expiry);
  }
}

/**
 * Get currently-active agent file paths (expired entries pruned).
 */
function getRecentAgentFiles() {
  const now = Date.now();
  for (const [filePath, expiry] of recentAgentFiles) {
    if (expiry < now) recentAgentFiles.delete(filePath);
  }
  return new Set(recentAgentFiles.keys());
}

module.exports = {
  logAgentAction,
  retrieveRelevantMemory,
  formatMemoryForPrompt,
  getMemoryStats,
  addToRecentAgentFiles,
  getRecentAgentFiles,
};
