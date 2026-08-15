'use strict';

const SAFE_FIELDS = Object.freeze([
  'provider',
  'safeAccountId',
  'accountType',
  'state',
  'credentialState',
  'revocationState',
  'selectedAccountKey',
  'serviceHealth',
  'connectedAt',
  'lastVerifiedAt',
  'lastCheckAt',
  'localAccessStoppedAt',
  'disconnectedAt',
  'lastSuccessfulSyncAt',
  'lastSnapshotId',
  'lastErrorCode',
  'grantedScopes',
]);

function serializeQuestradeConnection(value = {}) {
  const source = typeof value.toObject === 'function' ? value.toObject() : value;
  const safe = {};
  for (const field of SAFE_FIELDS) {
    if (source[field] !== undefined && source[field] !== null) safe[field] = source[field];
  }
  if (Array.isArray(source.accounts)) {
    safe.accounts = source.accounts.map((account) => ({
      accountKey: account.accountKey,
      label: account.label,
      accountType: account.accountType,
      status: account.status || null,
      isPrimary: Boolean(account.isPrimary),
    }));
  }
  return safe;
}

module.exports = { SAFE_FIELDS, serializeQuestradeConnection };
