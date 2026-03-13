'use strict';

/**
 * Label Cache — in-memory cache for Gmail label ID lookups.
 *
 * Avoids hitting the Gmail API on every workspace request to resolve
 * label names (like "Travel", "Shopping") to their Gmail IDs.
 *
 * TTL: 10 minutes. Invalidated explicitly when labels are created/deleted.
 */

let _cache = null;      // Map<lowercaseName, { id, name, type }>
let _cacheTime = 0;
const TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Build a name -> label map from the Gmail API.
 * Caches for 10 minutes.
 *
 * @param {Object} gmail - The gmail service module (server/src/services/gmail.js)
 * @returns {Promise<Map<string, { id: string, name: string, type: string }>>}
 */
async function getLabelMap(gmail) {
  if (_cache && (Date.now() - _cacheTime) < TTL) {
    return _cache;
  }

  const result = await gmail.listLabels();
  if (!result || !result.ok || !Array.isArray(result.labels)) {
    // Return stale cache if available, otherwise empty map
    return _cache || new Map();
  }

  _cache = new Map();
  for (const label of result.labels) {
    // Index by lowercase name for case-insensitive lookups
    _cache.set(label.name.toLowerCase(), {
      id: label.id,
      name: label.name,
      type: label.type || 'user',
    });
  }
  _cacheTime = Date.now();

  return _cache;
}

/**
 * Look up a single label name -> Gmail label ID.
 * Returns null if the label doesn't exist in Gmail.
 *
 * @param {Object} gmail - The gmail service module
 * @param {string} labelName - The label name to look up (case-insensitive)
 * @returns {Promise<string|null>} The label ID, or null if not found
 */
async function getLabelId(gmail, labelName) {
  if (!labelName) return null;
  const map = await getLabelMap(gmail);
  const entry = map.get(labelName.toLowerCase());
  return entry ? entry.id : null;
}

/**
 * Check if a label exists in Gmail by name.
 *
 * @param {Object} gmail - The gmail service module
 * @param {string} labelName - The label name to check
 * @returns {Promise<boolean>}
 */
async function labelExists(gmail, labelName) {
  const id = await getLabelId(gmail, labelName);
  return id !== null;
}

/**
 * Invalidate the cache. Call after creating or deleting labels.
 */
function invalidate() {
  _cache = null;
  _cacheTime = 0;
}

module.exports = { getLabelMap, getLabelId, labelExists, invalidate };
