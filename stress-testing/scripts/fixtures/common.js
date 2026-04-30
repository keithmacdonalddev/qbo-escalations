'use strict';

const { startHarnessServer } = require('../harness-runner-utils');

const SAMPLE_IMAGE_DATA_URL = 'data:image/png;base64,'
  + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3Z8UkAAAAASUVORK5CYII=';

async function runWithHarness(context, execute) {
  const ownHarness = !context.baseUrl;
  const harness = ownHarness ? await startHarnessServer() : context;

  try {
    return await execute(harness);
  } finally {
    if (ownHarness && harness && typeof harness.stop === 'function') {
      await harness.stop();
    }
  }
}

module.exports = {
  SAMPLE_IMAGE_DATA_URL,
  runWithHarness,
};
