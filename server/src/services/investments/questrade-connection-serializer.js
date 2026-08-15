'use strict';

const SAFE_FIELDS = Object.freeze([
  'provider',
  'safeAccountId',
  'accountType',
  'state',
  'lastSuccessfulSyncAt',
  'lastSnapshotId',
  'lastErrorCode',
]);

function serializeQuestradeConnection(value = {}) {
  const source = typeof value.toObject === 'function' ? value.toObject() : value;
  const safe = {};
  for (const field of SAFE_FIELDS) {
    if (source[field] !== undefined && source[field] !== null) safe[field] = source[field];
  }
  return safe;
}

module.exports = { SAFE_FIELDS, serializeQuestradeConnection };
