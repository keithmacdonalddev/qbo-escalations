'use strict';

const SCENARIO_DEFINITIONS = Object.freeze({
  disconnected: {
    state: 'disconnected',
    statusLabel: 'Not connected',
    summary: 'Questrade is not connected.',
    action: 'Live access is off, and no token or portfolio data is saved.',
    credentialState: 'not-stored',
  },
  'healthy-margin': {
    state: 'connected',
    statusLabel: 'Connected',
    summary: 'The simulated Margin account is connected and its last saved snapshot is available.',
    action: 'Review the safe account label and simulated status. No financial values are loaded in Stage 1.',
    credentialState: 'ready',
    safeAccountId: 'margin-demo-01',
    lastSuccessfulSyncAt: '2026-08-14T18:30:00.000Z',
    lastSnapshotId: 'snapshot-demo-001',
  },
  'token-expired': {
    state: 'reauthorization-required',
    statusLabel: 'Reauthorization required',
    summary: 'The simulated refresh attempt failed, so saved data remains visible but live access is paused.',
    action: 'A future live version will ask you for a new token in Questrade Settings.',
    credentialState: 'expired',
    safeAccountId: 'margin-demo-01',
    lastSuccessfulSyncAt: '2026-08-14T17:45:00.000Z',
    lastSnapshotId: 'snapshot-demo-001',
    previousSnapshotAvailable: true,
  },
  'malicious-api-server': {
    state: 'blocked',
    statusLabel: 'Unsafe server blocked',
    summary: 'The simulated Questrade response named an unapproved server. The app refused to send credentials.',
    action: 'No action is needed. This is the expected security response.',
    credentialState: 'protected',
    securityCode: 'QUESTRADE_API_HOST_BLOCKED',
  },
  locked: {
    state: 'locked',
    statusLabel: 'Credential locked',
    summary: 'The simulated Windows credential key cannot be unlocked by the current Windows user.',
    action: 'A future live setup will provide a repair action without exposing the token.',
    credentialState: 'locked',
  },
  'key-store-unavailable': {
    state: 'unavailable',
    statusLabel: 'Credential protection unavailable',
    summary: 'The simulated computer cannot provide a supported local credential key store.',
    action: 'Live connection stays disabled until credential encryption is available.',
    credentialState: 'unavailable',
  },
  'service-unavailable': {
    state: 'degraded',
    statusLabel: 'Questrade unavailable',
    summary: 'The simulated service is unavailable. The last complete saved snapshot remains available.',
    action: 'Wait and retry later; the app will not replace good saved data with a partial result.',
    credentialState: 'ready',
    safeAccountId: 'margin-demo-01',
    lastSuccessfulSyncAt: '2026-08-14T17:45:00.000Z',
    lastSnapshotId: 'snapshot-demo-001',
    previousSnapshotAvailable: true,
  },
});

function isQuestradeFixtureModeEnabled(env = process.env) {
  return env.NODE_ENV !== 'production' && env.QUESTRADE_DEV_FIXTURES !== '0';
}

function listQuestradeScenarios() {
  return Object.entries(SCENARIO_DEFINITIONS).map(([id, fixture]) => ({ id, label: fixture.statusLabel }));
}

function buildQuestradeFixtureStatus(scenario = 'disconnected') {
  const selected = SCENARIO_DEFINITIONS[scenario] ? scenario : 'disconnected';
  return {
    ok: true,
    provider: 'questrade',
    mode: 'simulated',
    liveAccessEnabled: false,
    readOnly: true,
    accountType: 'Margin',
    scenario: selected,
    ...SCENARIO_DEFINITIONS[selected],
  };
}

module.exports = {
  SCENARIO_DEFINITIONS,
  buildQuestradeFixtureStatus,
  isQuestradeFixtureModeEnabled,
  listQuestradeScenarios,
};
