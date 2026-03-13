'use strict';

const WorkspaceMemory = require('../models/WorkspaceMemory');

// ---------------------------------------------------------------------------
// Workspace Memory Service
//
// Persistent fact store for the workspace agent. Memories survive across
// sessions so the agent can recall trips, preferences, patterns, and facts
// without the user repeating themselves.
//
// Features:
//   - Sliding-window retrieval (relevance-filtered, capped at 15 / ~2000 chars)
//   - Confidence decay for stale patterns (hourly, non-blocking)
//   - Near-duplicate merge on save (same value across different key prefixes)
// ---------------------------------------------------------------------------

const MAX_MEMORIES = 15;
const MAX_CHARS = 2000;
const MAX_SEARCH_TERMS = 12;

// ---------------------------------------------------------------------------
// Query Alias Map — expands keywords for semantic memory retrieval.
// When a user asks "when do I fly", the word "fly" expands to also search
// flight, airport, airline, route, etc. — catching memories keyed differently.
// ---------------------------------------------------------------------------
const QUERY_ALIASES = {
  fly: ['flight', 'airport', 'airline', 'route', 'boarding', 'terminal', 'departure'],
  flight: ['fly', 'airport', 'airline', 'route', 'boarding', 'departure'],
  hotel: ['stay', 'check-in', 'checkout', 'room', 'accommodation', 'lodge', 'airbnb'],
  car: ['rental', 'pickup', 'vehicle', 'budget', 'hertz', 'enterprise'],
  trip: ['travel', 'flight', 'hotel', 'car', 'vacation', 'route', 'booking', 'itinerary'],
  travel: ['trip', 'flight', 'hotel', 'car', 'vacation', 'route', 'itinerary'],
  money: ['payment', 'amount', 'receipt', 'invoice', 'charge', 'fee', 'cost', 'price'],
  pay: ['payment', 'amount', 'receipt', 'invoice', 'charge', 'fee'],
  payment: ['pay', 'amount', 'receipt', 'invoice', 'charge', 'fee', 'cost'],
  work: ['meeting', 'shift', 'schedule', 'escalation', 'foundever'],
  eat: ['food', 'restaurant', 'dinner', 'lunch', 'breakfast', 'reservation'],
  food: ['eat', 'restaurant', 'dinner', 'lunch', 'breakfast', 'reservation'],
  meeting: ['work', 'calendar', 'schedule', 'call', 'zoom', 'teams'],
  book: ['booking', 'reservation', 'confirmation', 'itinerary'],
  booking: ['book', 'reservation', 'confirmation', 'itinerary', 'trip'],
  address: ['location', 'place', 'directions', 'map'],
  time: ['schedule', 'clock', 'hour', 'when', 'departure', 'arrival'],
  schedule: ['time', 'calendar', 'shift', 'meeting', 'appointment'],
};

// ---------------------------------------------------------------------------
// Confidence Decay — runs at most once per hour, non-blocking
// ---------------------------------------------------------------------------

let _lastDecayRun = 0;
const DECAY_INTERVAL_MS = 3600000; // 1 hour

/**
 * Reduce confidence on stale pattern memories and prune dead ones.
 * Patterns not updated in 7+ days lose 0.05 confidence per decay tick.
 * Patterns at or below 0.1 confidence are deleted outright.
 */
async function decayPatternConfidence() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

  // Decay: reduce confidence by 0.05 for stale patterns
  await WorkspaceMemory.updateMany(
    {
      type: 'pattern',
      confidence: { $gt: 0.1 },
      updatedAt: { $lt: sevenDaysAgo },
    },
    { $inc: { confidence: -0.05 } },
  );

  // Prune: delete patterns that have decayed below the threshold
  await WorkspaceMemory.deleteMany({
    type: 'pattern',
    confidence: { $lte: 0.1 },
  });
}

// ---------------------------------------------------------------------------
// Save with near-duplicate merge
// ---------------------------------------------------------------------------

/**
 * Save (upsert) a memory by key.
 *
 * Before upserting, checks for an existing memory whose key shares the same
 * value suffix (e.g. saving "confirmation:MGVCZJ" when "email-conf:MGVCZJ"
 * already exists). If found, merges into the existing record instead of
 * creating a near-duplicate.
 *
 * @param {Object} opts
 * @param {string} opts.type - 'trip' | 'preference' | 'pattern' | 'fact' | 'alert'
 * @param {string} opts.key - Unique identifier (e.g. 'trip:MGVCZJ', 'pref:seat-window')
 * @param {string} opts.content - Human-readable description of the fact
 * @param {Object} [opts.metadata] - Structured data (dates, IDs, amounts)
 * @param {string} [opts.source] - Where this was learned (email ID, event ID, user statement)
 * @param {number} [opts.confidence] - 0-1 confidence score
 * @param {string|Date} [opts.expiresAt] - Auto-cleanup date (ISO string or Date)
 * @returns {Promise<Object>} The saved memory document
 */
async function saveMemory({ type, key, content, metadata, source, confidence, expiresAt }) {
  if (!type || !key || !content) {
    return { ok: false, code: 'MISSING_FIELD', error: 'type, key, and content are required' };
  }

  // --- Near-duplicate merge ---
  // Extract the value part after the first colon (e.g. "MGVCZJ" from "confirmation:MGVCZJ")
  const colonIdx = key.indexOf(':');
  const valuePart = colonIdx >= 0 ? key.slice(colonIdx + 1) : null;

  if (valuePart && valuePart.length >= 4) {
    try {
      const escapedValue = valuePart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const existing = await WorkspaceMemory.findOne({
        key: { $regex: new RegExp(`:${escapedValue}$`, 'i'), $ne: key },
      });

      if (existing) {
        // Merge: keep the richer (longer) content, merge metadata, update source
        if (content.length > (existing.content || '').length) {
          existing.content = content;
        }
        if (metadata) {
          existing.metadata = { ...(existing.metadata || {}), ...metadata };
        }
        if (source) existing.source = source;
        existing.updatedAt = new Date();
        await existing.save();
        return { ok: true, memory: existing.toObject(), merged: true };
      }
    } catch {
      // Merge check is best-effort — fall through to normal upsert
    }
  }

  // --- Normal upsert ---
  const data = { type, content };
  if (metadata !== undefined) data.metadata = metadata;
  if (source !== undefined) data.source = source;
  if (confidence !== undefined) data.confidence = confidence;
  if (expiresAt !== undefined) {
    data.expiresAt = expiresAt ? new Date(expiresAt) : null;
  }

  const doc = await WorkspaceMemory.upsertFact(key, data);
  return { ok: true, memory: doc };
}

// ---------------------------------------------------------------------------
// Relevance-based retrieval
// ---------------------------------------------------------------------------

/**
 * Find memories relevant to the given prompt.
 * Uses keyword matching: splits prompt into significant words and searches.
 * @param {string} prompt - User prompt or search query
 * @param {number} [limit=10] - Max results to return
 * @returns {Promise<Object[]>} Array of memory documents, sorted by relevance
 */
async function getRelevantMemories(prompt, limit = 10) {
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    // Return most recent memories if no query
    return WorkspaceMemory.findRelevant('', limit);
  }

  // Extract significant keywords (skip stop words, keep words 3+ chars)
  const stopWords = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can',
    'her', 'was', 'one', 'our', 'out', 'has', 'have', 'had', 'with',
    'this', 'that', 'from', 'they', 'been', 'said', 'will', 'each',
    'which', 'their', 'what', 'about', 'would', 'make', 'like',
    'just', 'over', 'such', 'take', 'other', 'than', 'then', 'very',
    'when', 'come', 'could', 'them', 'some', 'these', 'does', 'into',
  ]);

  const words = prompt.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));

  if (words.length === 0) {
    return WorkspaceMemory.findRelevant('', limit);
  }

  // Expand keywords using alias map for semantic coverage.
  // "fly" -> also search "flight", "airport", "airline", "route", etc.
  const expanded = new Set(words);
  for (const word of words) {
    const aliases = QUERY_ALIASES[word];
    if (aliases) {
      for (const alias of aliases) {
        expanded.add(alias);
        if (expanded.size >= MAX_SEARCH_TERMS) break;
      }
    }
    if (expanded.size >= MAX_SEARCH_TERMS) break;
  }

  // Use the expanded terms (up to MAX_SEARCH_TERMS) for the text search
  const searchQuery = [...expanded].slice(0, MAX_SEARCH_TERMS).join(' ');
  return WorkspaceMemory.findRelevant(searchQuery, limit);
}

// ---------------------------------------------------------------------------
// Sliding-window memory context builder
// ---------------------------------------------------------------------------

/**
 * Build a formatted string of relevant memories for injection into the
 * workspace agent's system prompt context.
 *
 * Improvements over the original:
 *   - Accepts an optional prompt for relevance filtering
 *   - Hard cap at 15 memories
 *   - Hard cap at ~2000 characters (~500 tokens)
 *   - Prioritizes: trips > preferences > recent facts/patterns/alerts
 *   - Triggers hourly confidence decay (fire-and-forget)
 *
 * @param {string} [prompt=''] - Current user prompt for relevance scoring
 * @returns {Promise<string>} Formatted memory context block
 */
async function buildMemoryContext(prompt = '') {
  // Trigger decay check (non-blocking, max once per hour)
  if (Date.now() - _lastDecayRun > DECAY_INTERVAL_MS) {
    _lastDecayRun = Date.now();
    decayPatternConfidence().catch(() => {});
  }

  // Step 1: Try relevance-based retrieval if we have a prompt
  let memories = [];
  if (prompt && typeof prompt === 'string' && prompt.trim()) {
    try {
      memories = await getRelevantMemories(prompt, MAX_MEMORIES);
    } catch {
      memories = [];
    }
  }

  // Step 2: If not enough relevant results, pad with recent important ones
  // Priority order: trip, preference, pattern, fact, alert
  if (memories.length < 5) {
    try {
      const all = await WorkspaceMemory.find({
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      })
        .sort({ type: 1, updatedAt: -1 })
        .limit(MAX_MEMORIES * 2) // fetch extra so we can dedupe and still hit cap
        .lean();

      const existingKeys = new Set(memories.map((m) => m.key));
      for (const mem of all) {
        if (existingKeys.has(mem.key)) continue;
        memories.push(mem);
        existingKeys.add(mem.key);
        if (memories.length >= MAX_MEMORIES) break;
      }
    } catch {
      // best effort
    }
  }

  // Hard cap
  if (memories.length > MAX_MEMORIES) {
    memories = memories.slice(0, MAX_MEMORIES);
  }

  if (memories.length === 0) return '';

  // Group by type (preserving priority order)
  const groups = {};
  for (const mem of memories) {
    if (!groups[mem.type]) groups[mem.type] = [];
    groups[mem.type].push(mem);
  }

  const typeLabels = {
    trip: 'Active Trips',
    preference: 'User Preferences',
    pattern: 'Observed Patterns',
    fact: 'Known Facts',
    alert: 'Saved Alerts',
  };

  const lines = [];
  let charCount = 0;
  let truncatedCount = 0;

  for (const [type, label] of Object.entries(typeLabels)) {
    const items = groups[type];
    if (!items || items.length === 0) continue;

    const headerLine = `**${label}:**`;
    if (charCount + headerLine.length > MAX_CHARS) {
      truncatedCount += items.length;
      continue;
    }
    lines.push(headerLine);
    charCount += headerLine.length;

    for (const item of items) {
      const meta = item.metadata && Object.keys(item.metadata).length > 0
        ? ` [${JSON.stringify(item.metadata)}]`
        : '';
      const expires = item.expiresAt
        ? ` (expires: ${new Date(item.expiresAt).toISOString().split('T')[0]})`
        : '';
      const conf = item.confidence < 1.0 ? ` (confidence: ${item.confidence})` : '';
      const line = `- [${item.key}] ${item.content}${meta}${expires}${conf}`;

      if (charCount + line.length > MAX_CHARS) {
        truncatedCount++;
        continue;
      }
      lines.push(line);
      charCount += line.length;
    }
    lines.push('');
    charCount += 1;
  }

  if (truncatedCount > 0) {
    lines.push(`... and ${truncatedCount} more memories (ask to recall specific topics)`);
  }

  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Typed accessors
// ---------------------------------------------------------------------------

/**
 * Get all active trip memories (not expired).
 * @returns {Promise<Object[]>}
 */
async function getTripMemories() {
  return WorkspaceMemory.getByType('trip');
}

/**
 * Get all preference memories.
 * @returns {Promise<Object[]>}
 */
async function getPreferences() {
  return WorkspaceMemory.getByType('preference');
}

/**
 * Get memories by type.
 * @param {string} type - Memory type
 * @returns {Promise<Object[]>}
 */
async function getByType(type) {
  return WorkspaceMemory.getByType(type);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Delete memories past their expiresAt date.
 * Note: MongoDB TTL index handles this automatically, but this provides
 * an explicit cleanup for immediate use.
 * @returns {Promise<{ok: boolean, deletedCount: number}>}
 */
async function cleanupExpired() {
  const result = await WorkspaceMemory.deleteMany({
    expiresAt: { $ne: null, $lt: new Date() },
  });
  return { ok: true, deletedCount: result.deletedCount || 0 };
}

/**
 * Delete a specific memory by key.
 * @param {string} key - Memory key to delete
 * @returns {Promise<{ok: boolean, deleted: boolean}>}
 */
async function deleteMemory(key) {
  const result = await WorkspaceMemory.deleteOne({ key });
  return { ok: true, deleted: result.deletedCount > 0 };
}

module.exports = {
  saveMemory,
  getRelevantMemories,
  getTripMemories,
  getPreferences,
  getByType,
  cleanupExpired,
  buildMemoryContext,
  deleteMemory,
  decayPatternConfidence,
};
