const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBooleanEnv, resolveStartupControls } = require('../src/lib/startup-controls');

test('parseBooleanEnv handles common truthy and falsy values', () => {
  assert.equal(parseBooleanEnv('1', false), true);
  assert.equal(parseBooleanEnv('true', false), true);
  assert.equal(parseBooleanEnv('on', false), true);
  assert.equal(parseBooleanEnv('0', true), false);
  assert.equal(parseBooleanEnv('false', true), false);
  assert.equal(parseBooleanEnv('off', true), false);
  assert.equal(parseBooleanEnv(undefined, true), true);
  assert.equal(parseBooleanEnv('', false), false);
});

test('resolveStartupControls defaults every startup task to enabled', () => {
  const controls = resolveStartupControls({});

  assert.deepEqual(controls, {
    providerWarmup: true,
    workspaceScheduler: true,
    workspaceMonitor: true,
    imageParserStartupCheck: true,
    imageParserHealthCheck: true,
    imageParserKeysMigration: true,
  });
});

test('resolveStartupControls disables tasks from env flags and honors explicit overrides', () => {
  const env = {
    DISABLE_PROVIDER_WARMUP: '1',
    DISABLE_WORKSPACE_SCHEDULER: 'true',
    DISABLE_WORKSPACE_MONITOR: 'yes',
    DISABLE_IMAGE_PARSER_STARTUP_CHECK: 'on',
    DISABLE_IMAGE_PARSER_HEALTHCHECK: '1',
    DISABLE_IMAGE_PARSER_KEYS_MIGRATION: '1',
  };

  assert.deepEqual(resolveStartupControls(env), {
    providerWarmup: false,
    workspaceScheduler: false,
    workspaceMonitor: false,
    imageParserStartupCheck: false,
    imageParserHealthCheck: false,
    imageParserKeysMigration: false,
  });

  assert.deepEqual(resolveStartupControls(env, {
    providerWarmup: true,
    workspaceMonitor: true,
  }), {
    providerWarmup: true,
    workspaceScheduler: false,
    workspaceMonitor: true,
    imageParserStartupCheck: false,
    imageParserHealthCheck: false,
    imageParserKeysMigration: false,
  });
});
