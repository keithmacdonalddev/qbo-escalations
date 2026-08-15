'use strict';

const { validateQuestradeApiUrl } = require('./api-host-policy');

const TOKEN_ENDPOINT = 'https://login.questrade.com/oauth2/token';
const REVOKE_ENDPOINT = 'https://login.questrade.com/oauth2/revoke';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

function providerError(code, message, status = 502) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function readJson(response) {
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw providerError('QUESTRADE_RESPONSE_TOO_LARGE', 'Questrade returned an unexpectedly large authorization response.');
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw providerError('QUESTRADE_INVALID_RESPONSE', 'Questrade returned an unreadable authorization response.');
  }
}

function normalizeTokenResponse(payload, now = Date.now) {
  const accessToken = typeof payload?.access_token === 'string' ? payload.access_token : '';
  const refreshToken = typeof payload?.refresh_token === 'string' ? payload.refresh_token : '';
  const tokenType = typeof payload?.token_type === 'string' ? payload.token_type : '';
  const expiresIn = Number(payload?.expires_in);
  if (!accessToken || !refreshToken || !/^bearer$/i.test(tokenType) || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw providerError('QUESTRADE_INVALID_TOKEN_RESPONSE', 'Questrade returned incomplete authorization details.');
  }
  if (accessToken.length > 8192 || refreshToken.length > 8192) {
    throw providerError('QUESTRADE_INVALID_TOKEN_RESPONSE', 'Questrade returned authorization details outside the supported size.');
  }
  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresAt: new Date(now() + (expiresIn * 1000)),
    apiServer: validateQuestradeApiUrl(payload.api_server),
    scope: typeof payload.scope === 'string' ? payload.scope : '',
  };
}

function createQuestradeOAuthClient(options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  const now = options.now || Date.now;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required for Questrade authorization.');

  async function postForm(url, values, errorMessage) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(values).toString(),
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw providerError(
          response.status === 400 || response.status === 401
            ? 'QUESTRADE_AUTHORIZATION_REJECTED'
            : 'QUESTRADE_AUTHORIZATION_UNAVAILABLE',
          response.status === 400 || response.status === 401
            ? 'Questrade did not accept that authorization token. Generate a new token and try again.'
            : errorMessage,
          response.status === 400 || response.status === 401 ? 400 : 502,
        );
      }
      return response;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw providerError('QUESTRADE_AUTHORIZATION_TIMEOUT', 'Questrade did not respond in time. Try again.', 504);
      }
      if (error?.code) throw error;
      throw providerError('QUESTRADE_AUTHORIZATION_UNAVAILABLE', errorMessage);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function exchangeRefreshToken(refreshToken) {
    const response = await postForm(TOKEN_ENDPOINT, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }, 'Questrade authorization is temporarily unavailable. Try again.');
    return normalizeTokenResponse(await readJson(response), now);
  }

  async function revoke(accessToken) {
    await postForm(REVOKE_ENDPOINT, { token: accessToken }, 'Questrade could not revoke this authorization. Try again.');
    return true;
  }

  return { exchangeRefreshToken, revoke };
}

module.exports = {
  REVOKE_ENDPOINT,
  TOKEN_ENDPOINT,
  createQuestradeOAuthClient,
  normalizeTokenResponse,
};
