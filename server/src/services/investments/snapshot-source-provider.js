'use strict';

const { createFixtureSnapshotSource } = require('./snapshot-fixtures');

function createSnapshotSourceProvider(options = {}) {
  const connectionService = options.connectionService;

  async function getSource({ sourceMode, scenario }) {
    if (sourceMode === 'simulated') return createFixtureSnapshotSource(scenario);
    if (sourceMode !== 'live') {
      throw Object.assign(new Error('Choose the live account or safe simulation.'), { code: 'INVALID_SNAPSHOT_SOURCE', status: 400 });
    }
    if (!connectionService || typeof connectionService.getSnapshotSource !== 'function') {
      throw Object.assign(new Error('Questrade is not ready for portfolio verification.'), { code: 'QUESTRADE_NOT_CONNECTED', status: 409 });
    }
    return connectionService.getSnapshotSource();
  }

  async function inspectSource({ sourceMode, scenario }) {
    if (sourceMode === 'simulated') {
      const source = createFixtureSnapshotSource(scenario);
      return {
        provider: source.provider,
        sourceMode: source.sourceMode,
        sourceRef: source.sourceRef,
        accountType: source.accountType,
        label: source.label,
      };
    }
    if (sourceMode !== 'live') {
      throw Object.assign(new Error('Choose the live account or safe simulation.'), { code: 'INVALID_SNAPSHOT_SOURCE', status: 400 });
    }
    if (!connectionService || typeof connectionService.getSnapshotReadiness !== 'function') {
      throw Object.assign(new Error('Questrade is not ready for portfolio verification.'), { code: 'QUESTRADE_NOT_CONNECTED', status: 409 });
    }
    return connectionService.getSnapshotReadiness();
  }

  return { getSource, inspectSource };
}

module.exports = { createSnapshotSourceProvider };
