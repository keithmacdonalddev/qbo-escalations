import { apiFetchJson } from './http.js';

const BASE = '/api/investments/providers/questrade';

export function getQuestradeConnection(options = {}) {
  return apiFetchJson(`${BASE}/connection`, options, 'Questrade connection status could not be loaded.');
}

export function selectQuestradeDevScenario(scenario) {
  return apiFetchJson(`${BASE}/dev-scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario }),
    noRetry: true,
  }, 'The simulated Questrade state could not be changed.');
}
