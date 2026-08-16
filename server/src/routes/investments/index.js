'use strict';

const express = require('express');
const {
  buildQuestradeFixtureStatus,
  isQuestradeFixtureModeEnabled,
  listQuestradeScenarios,
  SCENARIO_DEFINITIONS,
} = require('../../services/investments/questrade-fixtures');
const { createCredentialKeyProvider } = require('../../services/investments/credential-key-provider');
const { createQuestradeConnectionService } = require('../../services/investments/questrade-connection-service');
const { createSensitiveActionIntentStore } = require('../../services/investments/sensitive-action-intent-store');
const { createSnapshotService } = require('../../services/investments/snapshot-service');
const { listSnapshotScenarios, SNAPSHOT_SCENARIOS } = require('../../services/investments/snapshot-fixtures');
const { forceInvestmentAccountReplayGap } = require('../../services/investment-account-events');

let activeScenario = 'disconnected';
let activeSnapshotScenario = 'healthy-margin-cad-usd';

function buildLiveDisabledStatus(env = process.env) {
  const keyStatus = createCredentialKeyProvider({ env }).getStatus();
  return {
    ok: true,
    provider: 'questrade',
    mode: 'live',
    liveAccessEnabled: false,
    readOnly: true,
    accountType: 'Margin',
    state: 'disconnected',
    statusLabel: 'Not connected',
    summary: 'Questrade is not connected.',
    action: keyStatus.available ? 'Connect from Questrade settings when you are ready.' : 'Secure storage must be available before connecting.',
    credentialState: keyStatus.available ? 'not-stored' : 'unavailable',
    fixtureControlsAvailable: false,
  };
}

function createInvestmentsRouter(options = {}) {
  const router = express.Router();
  const env = options.env || process.env;
  const getScenario = options.getScenario || (() => activeScenario);
  const setScenario = options.setScenario || ((value) => { activeScenario = value; });
  const getSnapshotScenario = options.getSnapshotScenario || (() => activeSnapshotScenario);
  const setSnapshotScenario = options.setSnapshotScenario || ((value) => { activeSnapshotScenario = value; });
  const connectionService = options.connectionService || createQuestradeConnectionService({ env });
  const snapshotService = options.snapshotService || createSnapshotService({ connectionService });
  const intentStore = options.intentStore || createSensitiveActionIntentStore();

  function asyncRoute(handler) {
    return (req, res) => Promise.resolve(handler(req, res)).catch((error) => {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      const safeProviderError = typeof error?.code === 'string'
        && /^(?:QUESTRADE|SNAPSHOT|INVESTMENT)_[A-Z0-9_]+$/.test(error.code);
      return res.status(status).json({
        ok: false,
        code: safeProviderError ? error.code : 'INVESTMENT_REQUEST_FAILED',
        error: safeProviderError
          ? error.message
          : 'The investment request could not be completed. Try again.',
      });
    });
  }

  function requireIntent(req, action) {
    const intent = typeof req.body?.intent === 'string' ? req.body.intent : '';
    if (!intentStore.consume(intent, action)) {
      throw Object.assign(new Error('This Questrade action expired. Start it again from Settings.'), {
        code: 'QUESTRADE_ACTION_INTENT_REQUIRED',
        status: 409,
      });
    }
  }

  router.get('/providers/questrade/connection', asyncRoute(async (_req, res) => {
    const status = await connectionService.getStatus();
    const savedPortfolioAvailable = await snapshotService.hasSavedSnapshot();
    return res.json({ ...status, savedPortfolioAvailable });
  }));

  router.get('/providers/questrade/dev-connection', (_req, res) => {
    if (!isQuestradeFixtureModeEnabled(env)) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Route not found' });
    }
    return res.json({
      ...buildQuestradeFixtureStatus(getScenario()),
      fixtureControlsAvailable: true,
      scenarios: listQuestradeScenarios(),
    });
  });

  router.post('/providers/questrade/action-intents', (req, res) => {
    const action = typeof req.body?.action === 'string' ? req.body.action.trim() : '';
    if (![
      'connect',
      'reauthorize',
      'select-account',
      'retry-verification',
      'disconnect',
      'retry-revocation',
      'forget-local',
      'run-snapshot',
      'delete-local-investment-data',
    ].includes(action)) {
      return res.status(400).json({ ok: false, code: 'INVALID_QUESTRADE_ACTION', error: 'Choose an available Questrade action.' });
    }
    return res.json({ ok: true, ...intentStore.issue(action) });
  });

  router.post('/providers/questrade/connect', asyncRoute(async (req, res) => {
    requireIntent(req, 'connect');
    const status = await connectionService.connect({ refreshToken: req.body?.refreshToken });
    return res.json(status);
  }));

  router.post('/providers/questrade/reauthorize', asyncRoute(async (req, res) => {
    requireIntent(req, 'reauthorize');
    const status = await connectionService.reauthorize({ refreshToken: req.body?.refreshToken });
    return res.json(status);
  }));

  router.post('/providers/questrade/select-account', asyncRoute(async (req, res) => {
    requireIntent(req, 'select-account');
    const status = await connectionService.selectAccount({ accountKey: req.body?.accountKey });
    return res.json(status);
  }));

  router.post('/providers/questrade/retry-verification', asyncRoute(async (req, res) => {
    requireIntent(req, 'retry-verification');
    return res.json(await connectionService.retryVerification());
  }));

  router.post('/providers/questrade/disconnect', asyncRoute(async (req, res) => {
    requireIntent(req, 'disconnect');
    return res.json(await connectionService.disconnect());
  }));

  router.post('/providers/questrade/retry-revocation', asyncRoute(async (req, res) => {
    requireIntent(req, 'retry-revocation');
    return res.json(await connectionService.retryRevocation());
  }));

  router.post('/providers/questrade/forget-local', asyncRoute(async (req, res) => {
    requireIntent(req, 'forget-local');
    if (req.body?.confirm !== 'FORGET_LOCAL_QUESTRADE') {
      throw Object.assign(new Error('Confirm that Questrade access may still need to be revoked manually before removing the local connection.'), {
        code: 'QUESTRADE_FORGET_CONFIRMATION_REQUIRED',
        status: 400,
      });
    }
    return res.json(await connectionService.forgetLocal());
  }));

  router.post('/providers/questrade/dev-scenario', (req, res) => {
    if (!isQuestradeFixtureModeEnabled(env)) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Route not found' });
    }
    const scenario = typeof req.body?.scenario === 'string' ? req.body.scenario.trim() : '';
    if (!Object.hasOwn(SCENARIO_DEFINITIONS, scenario)) {
      return res.status(400).json({
        ok: false,
        code: 'INVALID_QUESTRADE_SCENARIO',
        error: 'Choose one of the available simulated Questrade states.',
      });
    }
    setScenario(scenario);
    return res.json({
      ...buildQuestradeFixtureStatus(scenario),
      fixtureControlsAvailable: true,
      scenarios: listQuestradeScenarios(),
    });
  });

  router.get('/snapshot-workbench', asyncRoute(async (req, res) => {
    const sourceMode = req.query?.source === 'simulated' ? 'simulated' : 'live';
    if (sourceMode === 'simulated' && !isQuestradeFixtureModeEnabled(env)) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Route not found' });
    }
    const status = await snapshotService.getWorkbench({
      sourceMode,
      scenario: sourceMode === 'simulated' ? getSnapshotScenario() : '',
    });
    return res.json({
      ...status,
      ...(sourceMode === 'simulated' ? {
        scenario: getSnapshotScenario(),
        scenarios: listSnapshotScenarios(),
        developmentOnly: true,
      } : {}),
    });
  }));

  router.post('/snapshot-runs', asyncRoute(async (req, res) => {
    requireIntent(req, 'run-snapshot');
    const sourceMode = req.body?.source === 'simulated' ? 'simulated' : 'live';
    if (sourceMode === 'simulated' && !isQuestradeFixtureModeEnabled(env)) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Route not found' });
    }
    const result = await snapshotService.startSync({
      sourceMode,
      scenario: sourceMode === 'simulated' ? getSnapshotScenario() : '',
    });
    return res.status(202).json({ ok: true, reused: result.reused, run: result.run });
  }));

  router.get('/sync-runs/:runId', asyncRoute(async (req, res) => {
    const run = await snapshotService.getRun(req.params.runId);
    if (!run) return res.status(404).json({ ok: false, code: 'SNAPSHOT_RUN_NOT_FOUND', error: 'That snapshot verification is no longer available.' });
    return res.json({ ok: true, run });
  }));

  router.get('/snapshots/latest', asyncRoute(async (req, res) => {
    const accountKey = typeof req.query?.accountKey === 'string' ? req.query.accountKey.trim() : '';
    if (accountKey && !/^[A-Za-z0-9_-]{8,100}$/.test(accountKey)) {
      return res.status(400).json({ ok: false, code: 'INVALID_INVESTMENT_ACCOUNT_KEY', error: 'The investment account reference is invalid.' });
    }
    return res.json({ ok: true, snapshot: await snapshotService.getLatest(accountKey) });
  }));

  router.post('/local-data/delete', asyncRoute(async (req, res) => {
    requireIntent(req, 'delete-local-investment-data');
    if (req.body?.confirm !== 'DELETE INVESTMENT DATA') {
      return res.status(400).json({
        ok: false,
        code: 'INVESTMENT_DATA_DELETE_CONFIRMATION_REQUIRED',
        error: 'Type DELETE INVESTMENT DATA to confirm local investment-data deletion.',
      });
    }
    return res.json({ ok: true, ...(await snapshotService.deleteLocalData()) });
  }));

  router.post('/dev-snapshot-scenario', (req, res) => {
    if (!isQuestradeFixtureModeEnabled(env)) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Route not found' });
    }
    const scenario = typeof req.body?.scenario === 'string' ? req.body.scenario.trim() : '';
    if (!Object.hasOwn(SNAPSHOT_SCENARIOS, scenario)) {
      return res.status(400).json({ ok: false, code: 'INVALID_SNAPSHOT_SCENARIO', error: 'Choose an available snapshot verification case.' });
    }
    setSnapshotScenario(scenario);
    return res.json({ ok: true, scenario, scenarios: listSnapshotScenarios() });
  });

  router.post('/dev-realtime-gap', asyncRoute(async (req, res) => {
    if (!isQuestradeFixtureModeEnabled(env)) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Route not found' });
    }
    const workbench = await snapshotService.getWorkbench({ sourceMode: 'simulated', scenario: getSnapshotScenario() });
    if (!workbench.account?.accountKey) {
      return res.status(409).json({ ok: false, code: 'SNAPSHOT_ACCOUNT_NOT_READY', error: 'Run one simulated snapshot before forcing a replay gap.' });
    }
    return res.json({ ok: true, published: forceInvestmentAccountReplayGap(workbench.account.accountKey) });
  }));

  return router;
}

module.exports = { buildLiveDisabledStatus, createInvestmentsRouter };
