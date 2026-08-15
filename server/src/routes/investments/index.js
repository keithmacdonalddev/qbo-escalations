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

let activeScenario = 'disconnected';

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
  const connectionService = options.connectionService || createQuestradeConnectionService({ env });
  const intentStore = options.intentStore || createSensitiveActionIntentStore();

  function asyncRoute(handler) {
    return (req, res) => Promise.resolve(handler(req, res)).catch((error) => {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      const safeProviderError = typeof error?.code === 'string' && /^QUESTRADE_[A-Z0-9_]+$/.test(error.code);
      return res.status(status).json({
        ok: false,
        code: safeProviderError ? error.code : 'QUESTRADE_CONNECTION_FAILED',
        error: safeProviderError
          ? error.message
          : 'The Questrade connection could not be updated. Try again.',
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
    return res.json(status);
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

  return router;
}

module.exports = { buildLiveDisabledStatus, createInvestmentsRouter };
