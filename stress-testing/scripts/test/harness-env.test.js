'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_HARNESS_ENV,
  applyHarnessEnv,
  assertSafeMongoUri,
  buildHarnessEnv,
  isUriSafe,
  loadServerEnv,
  resolveHarnessMongoUri,
} = require('../harness-env');

test('DEFAULT_HARNESS_ENV disables every known background behavior', () => {
  assert.equal(DEFAULT_HARNESS_ENV.DISABLE_PROVIDER_WARMUP, '1');
  assert.equal(DEFAULT_HARNESS_ENV.DISABLE_WORKSPACE_SCHEDULER, '1');
  assert.equal(DEFAULT_HARNESS_ENV.DISABLE_WORKSPACE_MONITOR, '1');
  assert.equal(DEFAULT_HARNESS_ENV.DISABLE_IMAGE_PARSER_STARTUP_CHECK, '1');
  assert.equal(DEFAULT_HARNESS_ENV.DISABLE_IMAGE_PARSER_HEALTHCHECK, '1');
  assert.equal(DEFAULT_HARNESS_ENV.DISABLE_IMAGE_PARSER_KEYS_MIGRATION, '1');
  assert.equal(DEFAULT_HARNESS_ENV.DISABLE_RUNTIME_PRUNING, '1');
  assert.equal(DEFAULT_HARNESS_ENV.RATE_LIMIT_DISABLED, '1');
  assert.equal(DEFAULT_HARNESS_ENV.HARNESS_PROVIDERS_STUBBED, '1');
  assert.equal(DEFAULT_HARNESS_ENV.HARNESS_CONNECTED_SERVICES_STUBBED, '1');
  assert.equal(DEFAULT_HARNESS_ENV.HOST, '127.0.0.1');
  assert.equal(DEFAULT_HARNESS_ENV.PORT, '0');
});

test('DEFAULT_HARNESS_ENV is frozen', () => {
  assert.throws(() => { DEFAULT_HARNESS_ENV.DISABLE_PROVIDER_WARMUP = '0'; }, TypeError);
});

test('buildHarnessEnv merges overrides on top of defaults', () => {
  const merged = buildHarnessEnv({ PORT: '5000', CUSTOM: 'yes' });
  assert.equal(merged.PORT, '5000');
  assert.equal(merged.CUSTOM, 'yes');
  assert.equal(merged.DISABLE_PROVIDER_WARMUP, '1');
});

test('applyHarnessEnv only populates undefined keys', () => {
  const env = { HOST: '0.0.0.0', PORT: undefined };
  applyHarnessEnv(env);
  assert.equal(env.HOST, '0.0.0.0');
  assert.equal(env.PORT, '0');
  assert.equal(env.DISABLE_PROVIDER_WARMUP, '1');
});

test('isUriSafe flags stress/harness/local URIs as safe and Atlas as unsafe', () => {
  assert.equal(isUriSafe('mongodb://127.0.0.1:27017/qbo-stress'), true);
  assert.equal(isUriSafe('mongodb://localhost:27017/x'), true);
  assert.equal(isUriSafe('mongodb+srv://user:pwd@cluster.mongodb.net/qbo-stress'), true);
  assert.equal(isUriSafe('mongodb+srv://user:pwd@cluster.mongodb.net/qbo-harness'), true);
  assert.equal(isUriSafe('mongodb://mongodb-memory-server'), true);
  assert.equal(isUriSafe('mongodb+srv://user:pwd@cluster.mongodb.net/qbo-escalations'), false);
  assert.equal(isUriSafe(''), false);
  assert.equal(isUriSafe(null), false);
});

test('assertSafeMongoUri accepts explicit STRESS_MONGODB_URI', () => {
  const env = { STRESS_MONGODB_URI: 'mongodb://127.0.0.1:27017/qbo-stress' };
  const result = assertSafeMongoUri(env);
  assert.equal(result.uri, 'mongodb://127.0.0.1:27017/qbo-stress');
  assert.equal(env.MONGODB_URI, 'mongodb://127.0.0.1:27017/qbo-stress');
});

test('assertSafeMongoUri rejects unsafe STRESS_MONGODB_URI', () => {
  const env = { STRESS_MONGODB_URI: 'mongodb+srv://user:pwd@cluster.mongodb.net/qbo-escalations' };
  assert.throws(() => assertSafeMongoUri(env), /does not look hermetic/);
});

test('assertSafeMongoUri rejects production-shaped MONGODB_URI when no STRESS_MONGODB_URI is set', () => {
  const env = { MONGODB_URI: 'mongodb+srv://user:pwd@cluster.mongodb.net/qbo-escalations' };
  assert.throws(() => assertSafeMongoUri(env), /Refusing to boot/);
});

test('assertSafeMongoUri accepts safe existing MONGODB_URI', () => {
  const env = { MONGODB_URI: 'mongodb://127.0.0.1:27017/qbo-stress' };
  const result = assertSafeMongoUri(env);
  assert.equal(result.uri, 'mongodb://127.0.0.1:27017/qbo-stress');
});

test('assertSafeMongoUri throws when no URI is configured', () => {
  assert.throws(() => assertSafeMongoUri({}), /No Mongo URI configured/);
});

test('assertSafeMongoUri allows unsafe URI when STRESS_MONGODB_UNSAFE_ALLOW=1 and allowOverride', () => {
  const env = {
    STRESS_MONGODB_URI: 'mongodb+srv://user:pwd@cluster.mongodb.net/qbo-escalations-stress',
    STRESS_MONGODB_UNSAFE_ALLOW: '1',
  };
  const result = assertSafeMongoUri(env, { allowOverride: true });
  assert.equal(result.override, true);
  assert.equal(result.uri, 'mongodb+srv://user:pwd@cluster.mongodb.net/qbo-escalations-stress');
  assert.equal(env.MONGODB_URI, 'mongodb+srv://user:pwd@cluster.mongodb.net/qbo-escalations-stress');
});

test('resolveHarnessMongoUri prefers STRESS_MONGODB_URI over MONGODB_URI', () => {
  assert.equal(
    resolveHarnessMongoUri({ STRESS_MONGODB_URI: 'mongodb://localhost/stress', MONGODB_URI: 'x' }),
    'mongodb://localhost/stress'
  );
  assert.equal(resolveHarnessMongoUri({ MONGODB_URI: 'x' }), 'x');
});

test('loadServerEnv populates env values from a server-style .env file without dotenv', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qbo-harness-env-'));
  const envPath = path.join(tempDir, '.env');
  fs.writeFileSync(envPath, [
    'MONGODB_URI=mongodb://127.0.0.1:27017/qbo-stress',
    'PORT=4100',
    'EMPTY=',
    'QUOTED="hello world"',
    'KEEP_ME=from-file # comment',
  ].join('\n'));

  const env = { PORT: '5000' };
  loadServerEnv(env, { envPath });

  assert.equal(env.MONGODB_URI, 'mongodb://127.0.0.1:27017/qbo-stress');
  assert.equal(env.PORT, '5000');
  assert.equal(env.EMPTY, '');
  assert.equal(env.QUOTED, 'hello world');
  assert.equal(env.KEEP_ME, 'from-file');
});
