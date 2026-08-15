import { apiFetchJson } from './http.js';

const BASE = '/api/investments/providers/questrade';

export function getQuestradeConnection(options = {}) {
  const { simulated = false, ...requestOptions } = options;
  return apiFetchJson(`${BASE}/${simulated ? 'dev-connection' : 'connection'}`, requestOptions, 'Questrade connection status could not be loaded.');
}

export function createQuestradeActionIntent(action) {
  return apiFetchJson(`${BASE}/action-intents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
    noRetry: true,
  }, 'The Questrade action could not be started.');
}

export async function connectQuestrade(refreshToken) {
  const { intent } = await createQuestradeActionIntent('connect');
  return apiFetchJson(`${BASE}/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent, refreshToken }),
    noRetry: true,
  }, 'Questrade could not be connected.');
}

async function runQuestradeAction(action, path, body = {}, fallbackMessage) {
  const { intent } = await createQuestradeActionIntent(action);
  return apiFetchJson(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent, ...body }),
    noRetry: true,
  }, fallbackMessage);
}

export function reauthorizeQuestrade(refreshToken) {
  return runQuestradeAction(
    'reauthorize',
    'reauthorize',
    { refreshToken },
    'Questrade authorization could not be renewed.',
  );
}

export async function selectQuestradeAccount(accountKey) {
  const { intent } = await createQuestradeActionIntent('select-account');
  return apiFetchJson(`${BASE}/select-account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent, accountKey }),
    noRetry: true,
  }, 'The Questrade account choice could not be saved.');
}

export function retryQuestradeVerification() {
  return runQuestradeAction(
    'retry-verification',
    'retry-verification',
    {},
    'Questrade could not be checked.',
  );
}

export function disconnectQuestrade() {
  return runQuestradeAction(
    'disconnect',
    'disconnect',
    {},
    'Questrade access could not be fully revoked.',
  );
}

export function retryQuestradeRevocation() {
  return runQuestradeAction(
    'retry-revocation',
    'retry-revocation',
    {},
    'Questrade access could not be fully revoked.',
  );
}

export function forgetLocalQuestradeConnection() {
  return runQuestradeAction(
    'forget-local',
    'forget-local',
    { confirm: 'FORGET_LOCAL_QUESTRADE' },
    'The local Questrade connection could not be removed.',
  );
}

export function selectQuestradeDevScenario(scenario) {
  return apiFetchJson(`${BASE}/dev-scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario }),
    noRetry: true,
  }, 'The simulated Questrade state could not be changed.');
}
