'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_HARNESS_ENV = Object.freeze({
  DISABLE_PROVIDER_WARMUP: '1',
  DISABLE_WORKSPACE_SCHEDULER: '1',
  DISABLE_WORKSPACE_MONITOR: '1',
  DISABLE_IMAGE_PARSER_STARTUP_CHECK: '1',
  DISABLE_IMAGE_PARSER_HEALTHCHECK: '1',
  DISABLE_IMAGE_PARSER_KEYS_MIGRATION: '1',
  DISABLE_RUNTIME_PRUNING: '1',
  RATE_LIMIT_DISABLED: '1',
  HARNESS_PROVIDERS_STUBBED: '1',
  HARNESS_CONNECTED_SERVICES_STUBBED: '1',
  HOST: '127.0.0.1',
  PORT: '0',
});

const SAFE_URI_MARKERS = [
  /mongodb-memory-server/i,
  /stress/i,
  /harness/i,
  /\/127\.0\.0\.1(?::|\/|$)/,
  /\/localhost(?::|\/|$)/,
];

function buildHarnessEnv(overrides = {}) {
  return {
    ...DEFAULT_HARNESS_ENV,
    ...overrides,
  };
}

function applyHarnessEnv(targetEnv = process.env, overrides = {}) {
  const harnessEnv = buildHarnessEnv(overrides);
  for (const [key, value] of Object.entries(harnessEnv)) {
    if (targetEnv[key] === undefined) {
      targetEnv[key] = value;
    }
  }
  return harnessEnv;
}

function isUriSafe(uri) {
  if (typeof uri !== 'string' || !uri.trim()) return false;
  return SAFE_URI_MARKERS.some((re) => re.test(uri));
}

function resolveHarnessMongoUri(targetEnv = process.env) {
  const explicit = targetEnv.STRESS_MONGODB_URI;
  if (typeof explicit === 'string' && explicit.trim()) {
    return explicit.trim();
  }
  return targetEnv.MONGODB_URI;
}

function assertSafeMongoUri(targetEnv = process.env, { allowOverride = false } = {}) {
  if (allowOverride && targetEnv.STRESS_MONGODB_UNSAFE_ALLOW === '1') {
    const unsafeUri = resolveHarnessMongoUri(targetEnv);
    if (typeof unsafeUri !== 'string' || !unsafeUri.trim()) {
      throw new Error(
        '[harness] STRESS_MONGODB_UNSAFE_ALLOW=1 is set but no Mongo URI is configured. '
        + 'Set STRESS_MONGODB_URI or MONGODB_URI before booting the harness.'
      );
    }
    targetEnv.MONGODB_URI = unsafeUri.trim();
    return { uri: unsafeUri.trim(), override: true };
  }

  const stressUri = targetEnv.STRESS_MONGODB_URI;
  if (typeof stressUri === 'string' && stressUri.trim()) {
    if (!isUriSafe(stressUri)) {
      throw new Error(
        '[harness] STRESS_MONGODB_URI does not look hermetic. It must contain one of: '
        + '"stress", "harness", "mongodb-memory-server", or point at 127.0.0.1/localhost. '
        + 'Set STRESS_MONGODB_UNSAFE_ALLOW=1 to bypass this check at your own risk.'
      );
    }
    targetEnv.MONGODB_URI = stressUri.trim();
    return { uri: stressUri.trim(), override: false };
  }

  const liveUri = targetEnv.MONGODB_URI;
  if (!liveUri || !liveUri.trim()) {
    throw new Error(
      '[harness] No Mongo URI configured. Set STRESS_MONGODB_URI in your environment '
      + 'before booting the harness.'
    );
  }

  if (!isUriSafe(liveUri)) {
    throw new Error(
      '[harness] MONGODB_URI points at a non-hermetic target and no STRESS_MONGODB_URI '
      + 'is set. Refusing to boot to protect production data. '
      + 'Set STRESS_MONGODB_URI to a stress/harness/local URI, or set '
      + 'STRESS_MONGODB_UNSAFE_ALLOW=1 to bypass this check at your own risk.'
    );
  }

  return { uri: liveUri, override: false };
}

function decodeQuotedEnvValue(raw, quote) {
  const body = raw.slice(1, -1);
  if (quote === '\'') return body;

  return body.replace(/\\([\\'"nrtt])/g, (_match, escaped) => {
    switch (escaped) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      default:
        return escaped;
    }
  });
}

function parseEnvAssignment(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const exported = trimmed.startsWith('export ')
    ? trimmed.slice('export '.length).trim()
    : trimmed;
  const match = exported.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) return null;

  const key = match[1];
  let value = match[2] || '';

  if (!value) {
    return { key, value: '' };
  }

  const quote = value[0];
  if ((quote === '"' || quote === '\'') && value.endsWith(quote) && value.length >= 2) {
    return { key, value: decodeQuotedEnvValue(value, quote) };
  }

  value = value.replace(/\s+#.*$/, '').trim();
  return { key, value };
}

function loadServerEnv(targetEnv = process.env, options = {}) {
  const envPath = options.envPath || path.join(__dirname, '..', '..', 'server', '.env');
  try {
    const source = fs.readFileSync(envPath, 'utf8');
    for (const line of source.split(/\r?\n/)) {
      const assignment = parseEnvAssignment(line);
      if (!assignment) continue;
      if (targetEnv[assignment.key] === undefined) {
        targetEnv[assignment.key] = assignment.value;
      }
    }
  } catch {
    // Ignore missing or unreadable env files; callers may provide env directly.
  }
  return targetEnv;
}

module.exports = {
  DEFAULT_HARNESS_ENV,
  SAFE_URI_MARKERS,
  applyHarnessEnv,
  assertSafeMongoUri,
  buildHarnessEnv,
  isUriSafe,
  loadServerEnv,
  resolveHarnessMongoUri,
};
