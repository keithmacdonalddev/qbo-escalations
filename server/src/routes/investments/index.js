'use strict';

const express = require('express');
const {
  buildQuestradeFixtureStatus,
  isQuestradeFixtureModeEnabled,
  listQuestradeScenarios,
  SCENARIO_DEFINITIONS,
} = require('../../services/investments/questrade-fixtures');
const { createCredentialKeyProvider } = require('../../services/investments/credential-key-provider');

let activeScenario = 'disconnected';

function buildLiveDisabledStatus(env = process.env) {
  const keyStatus = createCredentialKeyProvider({ env }).getStatus();
  return {
    ok: true,
    provider: 'questrade',
    mode: 'stage-1',
    liveAccessEnabled: false,
    readOnly: true,
    accountType: 'Margin',
    state: 'disconnected',
    statusLabel: 'Not connected',
    summary: 'Questrade live access is not enabled in this stage.',
    action: 'Complete the simulated acceptance test before adding a real token.',
    credentialState: keyStatus.available ? 'not-stored' : 'unavailable',
    fixtureControlsAvailable: false,
  };
}

function createInvestmentsRouter(options = {}) {
  const router = express.Router();
  const env = options.env || process.env;
  const getScenario = options.getScenario || (() => activeScenario);
  const setScenario = options.setScenario || ((value) => { activeScenario = value; });

  router.get('/providers/questrade/connection', (_req, res) => {
    if (!isQuestradeFixtureModeEnabled(env)) return res.json(buildLiveDisabledStatus(env));
    return res.json({
      ...buildQuestradeFixtureStatus(getScenario()),
      fixtureControlsAvailable: true,
      scenarios: listQuestradeScenarios(),
    });
  });

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
