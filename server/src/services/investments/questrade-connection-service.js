'use strict';

const crypto = require('node:crypto');

const { decryptField, encryptField } = require('../../lib/field-encryption');
const { createCredentialKeyProvider } = require('./credential-key-provider');
const { publishInvestmentAccountEvent } = require('../investment-account-events');
const { createQuestradeConnectionRepository } = require('./questrade-connection-repository');
const { createLiveQuestradeAdapter } = require('./providers/questrade/live-adapter');
const { createQuestradeOAuthClient } = require('./providers/questrade/oauth-client');

const SERVICE_NAMES = Object.freeze(['accounts', 'balances', 'positions', 'orders', 'executions']);
const CREDENTIAL_FIELDS = Object.freeze(['accessToken', 'refreshToken', 'tokenExpiresAt', 'apiServer']);
const AUTHORIZATION_ERROR_CODES = new Set([
  'QUESTRADE_AUTHORIZATION_REJECTED',
  'QUESTRADE_AUTHORIZATION_REQUIRED',
  'QUESTRADE_PERMISSION_REQUIRED',
]);
const OFFLINE_ERROR_CODES = new Set([
  'QUESTRADE_AUTHORIZATION_TIMEOUT',
  'QUESTRADE_OFFLINE',
  'QUESTRADE_READ_TIMEOUT',
]);

function serviceError(code, message, status = 500) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeManualToken(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  if (!token || token.length > 8192 || /\s/.test(token)) {
    throw serviceError('INVALID_QUESTRADE_TOKEN', 'Paste the complete Questrade authorization token without spaces.', 400);
  }
  return token;
}

function safeAccountType(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= 40 ? text : 'Investment';
}

function normalizeScopes(value) {
  const text = typeof value === 'string' ? value : '';
  return [...new Set(text.split(/[\s,]+/).map((scope) => scope.trim()).filter((scope) => /^[A-Za-z0-9._:-]{1,80}$/.test(scope)))];
}

function emptyServiceHealth() {
  return Object.fromEntries(SERVICE_NAMES.map((name) => [name, 'not-checked']));
}

function projectAccount(account = {}) {
  return {
    accountKey: account.accountKey,
    label: account.label,
    accountType: account.accountType,
    status: account.status || null,
    isPrimary: Boolean(account.isPrimary),
  };
}

function statusLabelForState(state) {
  return {
    connected: 'Connected',
    partial: 'Needs attention',
    verifying: 'Verifying',
    'account-selection-required': 'Choose account',
    'reauthorization-required': 'Authorization required',
    'verification-failed': 'Could not verify',
    offline: 'Questrade unavailable',
    'rate-limited': 'Try again later',
    disconnecting: 'Disconnecting',
    'revocation-pending': 'Revocation pending',
    locked: 'Credential locked',
    unavailable: 'Unavailable',
  }[state] || 'Not connected';
}

function projectStatus(record, keyStatus, extras = {}) {
  const secureStorageReady = Boolean(keyStatus?.available);
  const state = record?.state || (secureStorageReady ? 'disconnected' : 'unavailable');
  const credentialState = record?.credentialState || (secureStorageReady ? 'not-stored' : 'unavailable');
  const accounts = Array.isArray(record?.accounts) ? record.accounts.map(projectAccount) : [];
  const liveAccessEnabled = credentialState === 'stored'
    && !['disconnected', 'disconnecting', 'revocation-pending'].includes(state);
  return {
    ok: true,
    provider: 'questrade',
    mode: 'live',
    liveAccessEnabled,
    readOnly: true,
    accountType: record?.accountType || 'Margin',
    state,
    statusLabel: statusLabelForState(state),
    credentialState,
    revocationState: record?.revocationState || 'not-requested',
    secureStorageReady,
    fixtureControlsAvailable: false,
    accounts,
    selectedAccountKey: record?.selectedAccountKey || null,
    serviceHealth: Object.fromEntries(SERVICE_NAMES.map((name) => [name, record?.serviceHealth?.[name] || 'not-checked'])),
    grantedScopes: Array.isArray(record?.grantedScopes) ? record.grantedScopes : [],
    connectedAt: record?.connectedAt || null,
    lastVerifiedAt: record?.lastVerifiedAt || null,
    lastCheckAt: record?.lastCheckAt || null,
    disconnectedAt: record?.disconnectedAt || null,
    lastSuccessfulSyncAt: record?.lastSuccessfulSyncAt || null,
    previousSnapshotAvailable: Boolean(record?.lastSnapshotId || record?.lastSuccessfulSyncAt),
    lastErrorCode: record?.lastErrorCode || null,
    canDisconnect: Boolean(record && !['not-stored', 'unavailable'].includes(credentialState)),
    canRetryVerification: Boolean(record?.selectedAccountKey && credentialState === 'stored'),
    canForgetLocal: state === 'revocation-pending',
    ...extras,
  };
}

function existingAccountsByNumber(accounts, key) {
  const lookup = new Map();
  for (const account of Array.isArray(accounts) ? accounts : []) {
    try {
      const number = decryptField(account.accountNumber, key);
      if (number) lookup.set(number, account);
    } catch {
      // A stale or unreadable account identity must never block a fresh safe connection.
    }
  }
  return lookup;
}

function normalizeAccounts(accounts, key, randomUUID, existingAccounts = []) {
  const usable = accounts.filter((account) => account && typeof account.number === 'string' && account.number.trim());
  if (usable.length === 0) throw serviceError('QUESTRADE_NO_ACCOUNTS', 'Questrade did not return an account that can be connected.', 422);
  const previous = existingAccountsByNumber(existingAccounts, key);
  const typeCounts = usable.reduce((counts, account) => {
    const type = safeAccountType(account.type);
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
  const typeIndexes = {};
  return usable.map((account) => {
    const accountNumber = account.number.trim();
    const prior = previous.get(accountNumber);
    const accountType = safeAccountType(account.type);
    typeIndexes[accountType] = (typeIndexes[accountType] || 0) + 1;
    const label = typeCounts[accountType] > 1
      ? `${accountType} account ${typeIndexes[accountType]}`
      : `${accountType} account`;
    return {
      accountKey: prior?.accountKey || randomUUID(),
      label,
      accountType,
      status: typeof account.status === 'string' ? account.status.slice(0, 40) : null,
      isPrimary: Boolean(account.isPrimary),
      accountNumber: encryptField(accountNumber, key),
    };
  });
}

function stateForError(error) {
  if (AUTHORIZATION_ERROR_CODES.has(error?.code)) return 'reauthorization-required';
  if (error?.code === 'QUESTRADE_RATE_LIMITED') return 'rate-limited';
  if (OFFLINE_ERROR_CODES.has(error?.code)) return 'offline';
  return 'verification-failed';
}

function serviceHealthForError(error) {
  if (error?.code === 'QUESTRADE_PERMISSION_REQUIRED') return 'permission-required';
  if (AUTHORIZATION_ERROR_CODES.has(error?.code)) return 'authorization-required';
  if (error?.code === 'QUESTRADE_RATE_LIMITED') return 'rate-limited';
  if (OFFLINE_ERROR_CODES.has(error?.code)) return 'offline';
  return 'unavailable';
}

function createQuestradeConnectionService(options = {}) {
  const env = options.env || process.env;
  const keyProvider = options.keyProvider || createCredentialKeyProvider({ env });
  const repository = options.repository || createQuestradeConnectionRepository();
  const oauthClient = options.oauthClient || createQuestradeOAuthClient(options.oauthOptions);
  const adapterFactory = options.adapterFactory || createLiveQuestradeAdapter;
  const publishEvent = options.publishEvent || publishInvestmentAccountEvent;
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const now = options.now || (() => new Date());
  let refreshInFlight = null;

  async function recordAudit(action, outcome, code = null) {
    if (typeof repository.appendAudit !== 'function') return;
    try {
      await repository.appendAudit({ eventId: randomUUID(), action, outcome, code, at: now() });
    } catch {
      // Audit summaries are best-effort and never contain credentials or provider payloads.
    }
  }

  async function checkProtectedStorage() {
    if (typeof keyProvider.checkReady === 'function') return keyProvider.checkReady();
    const status = keyProvider.getStatus();
    if (!status.available) return status;
    try {
      await keyProvider.ensureKey();
      return { ...status, verified: true };
    } catch {
      return { ...status, available: false, verified: false };
    }
  }

  async function getStatus() {
    const keyStatus = await checkProtectedStorage();
    const record = await repository.find();
    return projectStatus(record, keyStatus);
  }

  async function loadProtectedKey() {
    try {
      return await keyProvider.loadKey();
    } catch {
      await repository.update({
        state: 'locked',
        credentialState: 'locked',
        lastErrorCode: 'QUESTRADE_CREDENTIAL_LOCKED',
      });
      throw serviceError(
        'QUESTRADE_CREDENTIAL_LOCKED',
        'The saved Questrade credential cannot be opened for the current Windows user.',
        503,
      );
    }
  }

  async function saveCredential(token, key, changes = {}) {
    return repository.update({
      accessToken: encryptField(token.accessToken, key),
      refreshToken: encryptField(token.refreshToken, key),
      tokenExpiresAt: token.expiresAt,
      apiServer: token.apiServer,
      grantedScopes: normalizeScopes(token.scope),
      credentialState: 'stored',
      revocationState: 'not-requested',
      localAccessStoppedAt: null,
      disconnectedAt: null,
      ...changes,
    });
  }

  async function markFailure(error, fallbackState) {
    const state = fallbackState || stateForError(error);
    const changes = {
      state,
      lastCheckAt: now(),
      lastErrorCode: error?.code || 'QUESTRADE_VERIFICATION_FAILED',
    };
    if (state === 'reauthorization-required') changes.credentialState = 'renewal-required';
    const updated = await repository.update(changes);
    if (state === 'reauthorization-required') {
      const accountKey = updated?.selectedAccountKey || updated?.safeAccountId;
      if (accountKey) publishEvent({ accountKey, eventType: 'reauthorization-required', eventTime: changes.lastCheckAt, snapshotId: null });
    }
    return state;
  }

  async function verifyAccount({ account, accessToken, apiServer, key }) {
    const accountNumber = decryptField(account.accountNumber, key);
    const adapter = adapterFactory({ accessToken, apiServer });
    const checks = await Promise.allSettled([
      adapter.getBalances(accountNumber),
      adapter.getPositions(accountNumber),
      adapter.getOrders(accountNumber),
      adapter.getExecutions(accountNumber),
    ]);
    const serviceHealth = { accounts: 'available' };
    ['balances', 'positions', 'orders', 'executions'].forEach((name, index) => {
      serviceHealth[name] = checks[index].status === 'fulfilled'
        ? 'available'
        : serviceHealthForError(checks[index].reason);
    });
    const failures = checks.filter((check) => check.status === 'rejected').map((check) => check.reason);
    const successes = checks.length - failures.length;
    const authorizationFailure = failures.find((error) => AUTHORIZATION_ERROR_CODES.has(error?.code));
    const firstFailure = authorizationFailure || failures[0];
    const checkedAt = now();
    const state = failures.length === 0
      ? 'connected'
      : authorizationFailure
        ? 'reauthorization-required'
        : successes > 0
          ? 'partial'
          : stateForError(firstFailure);
    const changes = {
      state,
      safeAccountId: account.accountKey,
      selectedAccountKey: account.accountKey,
      accountType: account.accountType,
      serviceHealth,
      lastCheckAt: checkedAt,
      lastErrorCode: firstFailure?.code || null,
    };
    if (state === 'connected') {
      changes.connectedAt = checkedAt;
      changes.lastVerifiedAt = checkedAt;
      changes.credentialState = 'stored';
    } else if (state === 'reauthorization-required') {
      changes.credentialState = 'renewal-required';
    }
    const updated = await repository.update(changes);
    if (state === 'reauthorization-required') {
      publishEvent({ accountKey: account.accountKey, eventType: 'reauthorization-required', eventTime: checkedAt, snapshotId: null });
    }
    await recordAudit('verify-services', state === 'connected' ? 'completed' : state, firstFailure?.code || null);
    return updated;
  }

  async function refreshStoredCredential() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const key = await loadProtectedKey();
      const current = await repository.find({ includeSecrets: true });
      if (!current?.refreshToken) {
        throw serviceError('QUESTRADE_NOT_CONNECTED', 'Connect Questrade before checking the account.', 409);
      }
      let rotated;
      try {
        rotated = await oauthClient.exchangeRefreshToken(decryptField(current.refreshToken, key));
      } catch (error) {
        if (AUTHORIZATION_ERROR_CODES.has(error?.code)) {
          await markFailure({ ...error, code: 'QUESTRADE_AUTHORIZATION_REQUIRED' }, 'reauthorization-required');
          throw serviceError('QUESTRADE_AUTHORIZATION_REQUIRED', 'Questrade authorization needs to be renewed.', 401);
        }
        throw error;
      }
      try {
        const saved = await saveCredential(rotated, key);
        await recordAudit('refresh-credential', 'completed');
        return { accessToken: rotated.accessToken, apiServer: rotated.apiServer, key, record: saved };
      } catch {
        try {
          const updated = await repository.update({
            state: 'reauthorization-required',
            credentialState: 'renewal-required',
            lastErrorCode: 'QUESTRADE_ROTATED_TOKEN_NOT_SAVED',
          });
          const accountKey = updated?.selectedAccountKey || updated?.safeAccountId;
          if (accountKey) publishEvent({ accountKey, eventType: 'reauthorization-required', eventTime: now(), snapshotId: null });
        } catch {
          // The provider already rotated the token; the safest truthful recovery is reauthorization.
        }
        await recordAudit('refresh-credential', 'save-failed', 'QUESTRADE_ROTATED_TOKEN_NOT_SAVED');
        throw serviceError(
          'QUESTRADE_ROTATED_TOKEN_NOT_SAVED',
          'Questrade renewed the authorization, but the replacement credential could not be saved. Generate a new token before trying again.',
          500,
        );
      }
    })().finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  }

  async function getAuthorizedSession() {
    const record = await repository.find({ includeSecrets: true });
    if (!record || record.credentialState !== 'stored' || !record.accessToken || !record.refreshToken) {
      if (record?.state === 'reauthorization-required') {
        throw serviceError('QUESTRADE_AUTHORIZATION_REQUIRED', 'Questrade authorization needs to be renewed.', 401);
      }
      throw serviceError('QUESTRADE_NOT_CONNECTED', 'Connect Questrade before checking the account.', 409);
    }
    const expiresAt = new Date(record.tokenExpiresAt || 0).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= now().getTime() + 30_000) {
      return refreshStoredCredential();
    }
    const key = await loadProtectedKey();
    try {
      return {
        accessToken: decryptField(record.accessToken, key),
        apiServer: record.apiServer,
        key,
        record,
      };
    } catch {
      await repository.update({ state: 'locked', credentialState: 'locked', lastErrorCode: 'QUESTRADE_CREDENTIAL_LOCKED' });
      throw serviceError('QUESTRADE_CREDENTIAL_LOCKED', 'The saved Questrade credential cannot be opened for the current Windows user.', 503);
    }
  }

  async function getSnapshotSource() {
    const session = await getAuthorizedSession();
    const accounts = Array.isArray(session.record?.accounts) ? session.record.accounts : [];
    const account = accounts.find((candidate) => candidate.accountKey === session.record.selectedAccountKey)
      || (accounts.length === 1 ? accounts[0] : null);
    if (!account) {
      throw serviceError('QUESTRADE_ACCOUNT_SELECTION_REQUIRED', 'Choose the Questrade account before running a portfolio verification.', 409);
    }
    const accountNumber = decryptField(account.accountNumber, session.key);
    const adapter = adapterFactory({ accessToken: session.accessToken, apiServer: session.apiServer });
    return {
      provider: 'questrade',
      sourceMode: 'live',
      sourceRef: account.accountKey,
      accountType: account.accountType,
      label: account.label,
      observedAt: now(),
      async getAccount() {
        return { accountType: account.accountType, label: account.label };
      },
      getBalances: () => adapter.getBalances(accountNumber),
      getPositions: () => adapter.getPositions(accountNumber),
    };
  }

  async function getSnapshotReadiness() {
    const status = await getStatus();
    if (status.credentialState !== 'stored' || !status.liveAccessEnabled) {
      throw serviceError(
        status.state === 'reauthorization-required' ? 'QUESTRADE_AUTHORIZATION_REQUIRED' : 'QUESTRADE_NOT_CONNECTED',
        status.state === 'reauthorization-required'
          ? 'Renew Questrade authorization before running a live portfolio verification.'
          : 'Connect Questrade before running a live portfolio verification.',
        409,
      );
    }
    const accounts = Array.isArray(status.accounts) ? status.accounts : [];
    const account = accounts.find((candidate) => candidate.accountKey === status.selectedAccountKey)
      || (accounts.length === 1 ? accounts[0] : null);
    if (!account) throw serviceError('QUESTRADE_ACCOUNT_SELECTION_REQUIRED', 'Choose the Questrade account before running a portfolio verification.', 409);
    return {
      provider: 'questrade',
      sourceMode: 'live',
      sourceRef: account.accountKey,
      accountType: account.accountType,
      label: account.label,
    };
  }

  async function connectInternal({ refreshToken, reauthorize = false }) {
    const manualToken = normalizeManualToken(refreshToken);
    const keyStatus = await checkProtectedStorage();
    if (!keyStatus.available) {
      throw serviceError('QUESTRADE_SECURE_STORAGE_UNAVAILABLE', 'Secure storage is not ready, so the app did not accept the token.', 503);
    }
    let key;
    try {
      key = await keyProvider.ensureKey();
    } catch {
      throw serviceError('QUESTRADE_SECURE_STORAGE_UNAVAILABLE', 'Secure storage is not ready, so the app did not accept the token.', 503);
    }
    const previous = await repository.find({ includeSecrets: true });
    const token = await oauthClient.exchangeRefreshToken(manualToken);

    try {
      await saveCredential(token, key, {
        state: 'verifying',
        serviceHealth: emptyServiceHealth(),
        lastCheckAt: now(),
        lastErrorCode: null,
      });
    } catch {
      await recordAudit(reauthorize ? 'reauthorize' : 'connect', 'save-failed', 'QUESTRADE_ROTATED_TOKEN_NOT_SAVED');
      throw serviceError(
        'QUESTRADE_ROTATED_TOKEN_NOT_SAVED',
        'Questrade accepted the token, but the replacement credential could not be saved. Generate a new token before trying again.',
        500,
      );
    }

    try {
      const adapter = adapterFactory({ accessToken: token.accessToken, apiServer: token.apiServer });
      const accounts = normalizeAccounts(await adapter.getAccounts(), key, randomUUID, previous?.accounts);
      const selectionRequired = accounts.length > 1;
      const saved = await repository.update({
        accounts,
        state: selectionRequired ? 'account-selection-required' : 'verifying',
        selectedAccountKey: selectionRequired ? null : accounts[0].accountKey,
        safeAccountId: selectionRequired ? null : accounts[0].accountKey,
        accountType: selectionRequired ? 'Margin' : accounts[0].accountType,
        serviceHealth: { accounts: 'available', balances: 'not-checked', positions: 'not-checked', orders: 'not-checked', executions: 'not-checked' },
      });
      if (selectionRequired) {
        await recordAudit(reauthorize ? 'reauthorize' : 'connect', 'account-selection-required');
        return projectStatus(saved, keyStatus);
      }
      const verified = await verifyAccount({ account: accounts[0], accessToken: token.accessToken, apiServer: token.apiServer, key });
      await recordAudit(reauthorize ? 'reauthorize' : 'connect', verified.state, verified.lastErrorCode);
      return projectStatus(verified, keyStatus);
    } catch (error) {
      await markFailure(error);
      await recordAudit(reauthorize ? 'reauthorize' : 'connect', stateForError(error), error?.code || null);
      return projectStatus(await repository.find(), keyStatus);
    }
  }

  async function connect({ refreshToken }) {
    return connectInternal({ refreshToken, reauthorize: false });
  }

  async function reauthorize({ refreshToken }) {
    return connectInternal({ refreshToken, reauthorize: true });
  }

  async function selectAccount({ accountKey }) {
    if (typeof accountKey !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(accountKey)) {
      throw serviceError('INVALID_QUESTRADE_ACCOUNT_SELECTION', 'Choose one of the available Questrade accounts.', 400);
    }
    const session = await getAuthorizedSession();
    const account = session.record?.accounts?.find((candidate) => candidate.accountKey === accountKey);
    if (!account) throw serviceError('INVALID_QUESTRADE_ACCOUNT_SELECTION', 'That Questrade account is no longer available. Refresh and choose again.', 409);
    const verified = await verifyAccount({ account, accessToken: session.accessToken, apiServer: session.apiServer, key: session.key });
    await recordAudit('select-account', verified.state, verified.lastErrorCode);
    return projectStatus(verified, keyProvider.getStatus());
  }

  async function retryVerification() {
    const session = await getAuthorizedSession();
    const accounts = Array.isArray(session.record?.accounts) ? session.record.accounts : [];
    const account = accounts.find((candidate) => candidate.accountKey === session.record.selectedAccountKey)
      || (accounts.length === 1 ? accounts[0] : null);
    if (!account) {
      const updated = await repository.update({ state: 'account-selection-required', selectedAccountKey: null });
      return projectStatus(updated, keyProvider.getStatus());
    }
    const verified = await verifyAccount({ account, accessToken: session.accessToken, apiServer: session.apiServer, key: session.key });
    return projectStatus(verified, keyProvider.getStatus());
  }

  async function revokeStoredAuthorization({ retry = false } = {}) {
    const keyStatus = keyProvider.getStatus();
    const record = await repository.find({ includeSecrets: true });
    if (!record || (record.state === 'disconnected' && !record.accessToken)) {
      return projectStatus(record, keyStatus, { completionKind: 'already-disconnected' });
    }
    const stoppedAt = now();
    const pending = await repository.update({
      state: 'revocation-pending',
      credentialState: 'revocation-pending',
      revocationState: 'pending',
      localAccessStoppedAt: stoppedAt,
      lastErrorCode: null,
    });
    if (!record.accessToken) {
      const updated = await repository.update({ lastErrorCode: 'QUESTRADE_REVOCATION_UNCONFIRMED' });
      await recordAudit(retry ? 'retry-revocation' : 'disconnect', 'pending', 'QUESTRADE_REVOCATION_UNCONFIRMED');
      return projectStatus(updated || pending, keyStatus);
    }

    let accessToken;
    try {
      const key = await loadProtectedKey();
      accessToken = decryptField(record.accessToken, key);
    } catch {
      const updated = await repository.update({
        state: 'revocation-pending',
        credentialState: 'revocation-pending',
        revocationState: 'pending',
        lastErrorCode: 'QUESTRADE_CREDENTIAL_LOCKED',
      });
      await recordAudit(retry ? 'retry-revocation' : 'disconnect', 'pending', 'QUESTRADE_CREDENTIAL_LOCKED');
      return projectStatus(updated, keyStatus);
    }

    try {
      await oauthClient.revoke(accessToken);
      const disconnectedAt = now();
      const updated = await repository.update({
        state: 'disconnected',
        credentialState: 'not-stored',
        revocationState: 'confirmed',
        serviceHealth: emptyServiceHealth(),
        disconnectedAt,
        localAccessStoppedAt: disconnectedAt,
        lastErrorCode: null,
      }, { unset: CREDENTIAL_FIELDS });
      await recordAudit(retry ? 'retry-revocation' : 'disconnect', 'completed');
      return projectStatus(updated, keyStatus, { completionKind: 'disconnected' });
    } catch (error) {
      const updated = await repository.update({
        state: 'revocation-pending',
        credentialState: 'revocation-pending',
        revocationState: 'pending',
        lastErrorCode: error?.code || 'QUESTRADE_REVOCATION_UNCONFIRMED',
      });
      await recordAudit(retry ? 'retry-revocation' : 'disconnect', 'pending', error?.code || 'QUESTRADE_REVOCATION_UNCONFIRMED');
      return projectStatus(updated, keyStatus);
    }
  }

  async function disconnect() {
    return revokeStoredAuthorization({ retry: false });
  }

  async function retryRevocation() {
    return revokeStoredAuthorization({ retry: true });
  }

  async function forgetLocal() {
    const record = await repository.find();
    if (!record || record.state === 'disconnected') {
      return projectStatus(null, keyProvider.getStatus(), { completionKind: 'already-forgotten' });
    }
    if (record.state !== 'revocation-pending') {
      throw serviceError(
        'QUESTRADE_FORGET_NOT_AVAILABLE',
        'Disconnect Questrade first. Local removal is available only when remote revocation cannot be confirmed.',
        409,
      );
    }
    await repository.remove();
    return projectStatus(null, keyProvider.getStatus(), {
      completionKind: 'forgot-local',
      revocationState: 'unconfirmed',
      manualRevocationRequired: true,
    });
  }

  return {
    connect,
    disconnect,
    forgetLocal,
    getSnapshotReadiness,
    getSnapshotSource,
    getStatus,
    reauthorize,
    retryRevocation,
    retryVerification,
    selectAccount,
  };
}

module.exports = {
  CREDENTIAL_FIELDS,
  SERVICE_NAMES,
  createQuestradeConnectionService,
  normalizeManualToken,
  projectStatus,
};
