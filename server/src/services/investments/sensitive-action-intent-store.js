'use strict';

const crypto = require('node:crypto');

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_INTENTS = 32;

function createSensitiveActionIntentStore(options = {}) {
  const now = options.now || Date.now;
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
  const maxIntents = options.maxIntents || DEFAULT_MAX_INTENTS;
  const intents = new Map();

  function prune() {
    const current = now();
    for (const [token, record] of intents) {
      if (record.expiresAt <= current) intents.delete(token);
    }
    while (intents.size >= maxIntents) intents.delete(intents.keys().next().value);
  }

  function issue(action) {
    if (typeof action !== 'string' || !action) throw new Error('A sensitive action name is required.');
    prune();
    const intent = randomBytes(24).toString('base64url');
    const expiresAt = now() + ttlMs;
    intents.set(intent, { action, expiresAt });
    return { intent, action, expiresAt: new Date(expiresAt).toISOString() };
  }

  function consume(intent, action) {
    prune();
    const record = typeof intent === 'string' ? intents.get(intent) : null;
    if (!record) return false;
    intents.delete(intent);
    return record.action === action && record.expiresAt > now();
  }

  return { consume, issue };
}

module.exports = { DEFAULT_TTL_MS, createSensitiveActionIntentStore };
