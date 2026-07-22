'use strict';

const RETENTION_KEYS = Object.freeze({
  IMAGE_PARSE_RESULT: 'image-parse-result',
  TRIAGE_RESULT: 'triage-result',
  PROVIDER_CALL_PACKAGE: 'provider-call-package',
});

const RETENTION_POLICIES = Object.freeze({
  [RETENTION_KEYS.IMAGE_PARSE_RESULT]: Object.freeze({
    envName: 'IMAGE_PARSE_RESULT_TTL_DAYS',
    defaultDays: 90,
  }),
  [RETENTION_KEYS.TRIAGE_RESULT]: Object.freeze({
    envName: 'TRIAGE_RESULT_TTL_DAYS',
    defaultDays: 30,
  }),
  [RETENTION_KEYS.PROVIDER_CALL_PACKAGE]: Object.freeze({
    envName: 'PROVIDER_CALL_PACKAGE_TTL_DAYS',
    defaultDays: 30,
  }),
});

function resolveRetentionDays(key, env = process.env) {
  const policy = RETENTION_POLICIES[key];
  if (!policy) throw new Error(`Unknown retention policy: ${key}`);
  const configured = Number.parseInt(env?.[policy.envName], 10);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : policy.defaultDays;
}

function resolveRetentionMs(key, env = process.env) {
  return resolveRetentionDays(key, env) * 24 * 60 * 60 * 1000;
}

module.exports = {
  RETENTION_KEYS,
  resolveRetentionDays,
  resolveRetentionMs,
};
