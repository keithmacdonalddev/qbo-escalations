'use strict';

const { applyHarnessEnv, assertSafeMongoUri, loadServerEnv } = require('./harness-env');
const { installDefaultProviderStubs } = require('./harness-provider-stubs');
const { installDefaultConnectedServiceStubs } = require('./harness-service-stubs');

// Load server/.env so MONGODB_URI (etc.) is populated before the safety check
// runs. Harness env defaults still win over anything the server .env sets, but
// only for keys the shell hasn't already overridden.
loadServerEnv(process.env);
applyHarnessEnv(process.env);

try {
  assertSafeMongoUri(process.env, { allowOverride: true });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

if (process.env.HARNESS_PROVIDERS_STUBBED === '1'
    && process.env.HARNESS_PROVIDERS_NO_DEFAULT_STUBS !== '1') {
  installDefaultProviderStubs();
}

if (process.env.HARNESS_CONNECTED_SERVICES_STUBBED === '1'
    && process.env.HARNESS_CONNECTED_SERVICES_NO_DEFAULT_STUBS !== '1') {
  installDefaultConnectedServiceStubs();
}

const { start } = require('../../server/src/index');

start({
  exitProcess: true,
  installSignalHandlers: true,
}).then(({ host, port, startupControls }) => {
  console.log(`[stress-testing] Harness server ready on http://${host}:${port}`);
  console.log(`[stress-testing] Startup controls: ${JSON.stringify(startupControls)}`);
}).catch((err) => {
  console.error('[stress-testing] Harness bootstrap failed:');
  console.error(err?.stack || err);
  process.exit(1);
});
