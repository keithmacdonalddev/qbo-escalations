'use strict';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function parseBooleanEnv(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return defaultValue;
}

function resolveStartupControls(env = process.env, overrides = {}) {
  return {
    providerWarmup: overrides.providerWarmup ?? !parseBooleanEnv(env.DISABLE_PROVIDER_WARMUP, false),
    workspaceScheduler: overrides.workspaceScheduler ?? !parseBooleanEnv(env.DISABLE_WORKSPACE_SCHEDULER, false),
    workspaceMonitor: overrides.workspaceMonitor ?? !parseBooleanEnv(env.DISABLE_WORKSPACE_MONITOR, false),
    imageParserStartupCheck: overrides.imageParserStartupCheck ?? !parseBooleanEnv(env.DISABLE_IMAGE_PARSER_STARTUP_CHECK, false),
    imageParserHealthCheck: overrides.imageParserHealthCheck ?? !parseBooleanEnv(env.DISABLE_IMAGE_PARSER_HEALTHCHECK, false),
    imageParserKeysMigration: overrides.imageParserKeysMigration ?? !parseBooleanEnv(env.DISABLE_IMAGE_PARSER_KEYS_MIGRATION, false),
  };
}

module.exports = {
  parseBooleanEnv,
  resolveStartupControls,
};
