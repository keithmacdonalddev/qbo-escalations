'use strict';

const { assertReadOnlyQuestradeAdapter } = require('./adapter-contract');
const { validateQuestradeApiUrl } = require('./api-host-policy');

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

function providerError(code, message, status = 502) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function createLiveQuestradeAdapter(options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  const apiServer = validateQuestradeApiUrl(options.apiServer);
  const accessToken = typeof options.accessToken === 'string' ? options.accessToken : '';
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const now = options.now || (() => new Date());
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required for Questrade reads.');
  if (!accessToken) throw new Error('A Questrade access token is required.');

  async function request(pathname, query = {}) {
    const url = new URL(`${apiServer}/${pathname.replace(/^\/+/, '')}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        const rejected = response.status === 401;
        const permissionMissing = response.status === 403;
        throw providerError(
          rejected
            ? 'QUESTRADE_AUTHORIZATION_REQUIRED'
            : permissionMissing
              ? 'QUESTRADE_PERMISSION_REQUIRED'
              : response.status === 429
                ? 'QUESTRADE_RATE_LIMITED'
                : 'QUESTRADE_READ_FAILED',
          rejected
            ? 'Questrade authorization needs to be renewed.'
            : permissionMissing
              ? 'Questrade did not grant the required read-only account permission.'
            : response.status === 429
              ? 'Questrade is receiving too many requests. Try again after the limit resets.'
              : 'Questrade could not verify this account service.',
          rejected ? 401 : response.status === 429 ? 429 : 502,
        );
      }
      const length = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
        throw providerError('QUESTRADE_RESPONSE_TOO_LARGE', 'Questrade returned more data than this verification step accepts.');
      }
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
        throw providerError('QUESTRADE_RESPONSE_TOO_LARGE', 'Questrade returned more data than this verification step accepts.');
      }
      try {
        return text ? JSON.parse(text) : {};
      } catch {
        throw providerError('QUESTRADE_INVALID_RESPONSE', 'Questrade returned an unreadable account response.');
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw providerError('QUESTRADE_READ_TIMEOUT', 'Questrade did not respond in time.', 504);
      if (error?.code) throw error;
      throw providerError('QUESTRADE_OFFLINE', 'Questrade could not be reached for this account check.');
    } finally {
      clearTimeout(timeout);
    }
  }

  function accountPath(accountNumber, suffix) {
    const normalized = String(accountNumber || '').trim();
    if (!normalized || normalized.length > 64 || !/^[A-Za-z0-9-]+$/.test(normalized)) {
      throw providerError('QUESTRADE_INVALID_ACCOUNT', 'Questrade returned an unsupported account identifier.', 400);
    }
    return `accounts/${encodeURIComponent(normalized)}/${suffix}`;
  }

  const adapter = {
    async getAccounts() {
      const payload = await request('accounts');
      if (!Array.isArray(payload.accounts)) throw providerError('QUESTRADE_INVALID_RESPONSE', 'Questrade did not return an account list.');
      return payload.accounts;
    },
    getBalances: (accountNumber) => request(accountPath(accountNumber, 'balances')),
    getPositions: (accountNumber) => request(accountPath(accountNumber, 'positions')),
    getOrders: (accountNumber) => request(accountPath(accountNumber, 'orders')),
    getExecutions(accountNumber) {
      const end = now();
      const start = new Date(end.getTime() - (24 * 60 * 60 * 1000));
      return request(accountPath(accountNumber, 'executions'), {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      });
    },
  };

  return assertReadOnlyQuestradeAdapter(adapter);
}

module.exports = { createLiveQuestradeAdapter };
