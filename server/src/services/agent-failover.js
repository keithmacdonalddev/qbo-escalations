'use strict';

// Shared, use-case-agnostic backup resolution for every agent leg.
//
// PRODUCT INTENT (locked): every agent ALWAYS has a primary model + a fallback
// model and fails over automatically when its primary provider fails. The app
// must NOT reason about an agent's use case when choosing the backup — there is
// NO capability filtering (e.g. no special-casing "image-capable" backups). The
// operator picks primary + fallback per agent in the profile; the app simply
// uses what is configured, defaulting to a neutral global alternate when nothing
// is set.
//
// This module is the single home for that rule so the chat substrate, the parse
// substrate, persistence, and every per-leg call site resolve the backup the
// same way. The logic was lifted from the analyst-specific
// resolveAnalystFailoverPolicy and generalized: it is now identical for all
// agents.

const {
  getAlternateProvider,
  normalizeProvider,
} = require('./providers/registry');
const { normalizeModelOverride } = require('./chat-orchestrator');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Resolve the automatic backup provider/model for an agent, given its resolved
 * primary provider and its persisted runtime (AgentIdentity(id).runtime, or any
 * equivalent selection object). The rule is uniform and contains NO use-case /
 * capability logic:
 *
 *   backup      = runtime.fallbackProvider || getAlternateProvider(primary)
 *   if (backup === primary) backup = getAlternateProvider(primary)
 *   backupModel = runtime.fallbackProvider ? runtime.fallbackModel : ''
 *
 * So every agent always has a DISTINCT backup it can fail over to. The
 * `fromProfile` flag records whether the backup came from the operator's
 * configured fallbackProvider (vs. the neutral global alternate) so callers can
 * decide whether to carry the operator's fallback model.
 *
 * @param {string} primaryProvider  The agent's resolved primary provider id.
 * @param {object|null} runtime     Persisted runtime / selection. Only
 *                                   `fallbackProvider`, `fallbackModel`, and
 *                                   (optionally) `configured` are read.
 * @returns {{ provider: string, model: string, fromProfile: boolean }}
 */
function resolveAgentBackup(primaryProvider, runtime) {
  const primary = normalizeProvider(primaryProvider);
  const source = isPlainObject(runtime) ? runtime : {};

  // A runtime that explicitly sets configured:false is treated as "no operator
  // selection" so the neutral global alternate is used. Any other shape (no
  // `configured` key, or configured:true) lets a present fallbackProvider win.
  const configured = source.configured !== false;
  const configuredFallback = configured && source.fallbackProvider
    ? normalizeProvider(source.fallbackProvider)
    : '';

  // The backup is sourced from the profile only when the operator configured a
  // DISTINCT provider. A configured fallback that collapses to the primary is
  // not usable, so it is re-derived to the global alternate below.
  const fromProfile = Boolean(configuredFallback) && configuredFallback !== primary;

  let provider = configuredFallback || getAlternateProvider(primary);
  provider = normalizeProvider(provider);
  if (provider === primary) {
    provider = normalizeProvider(getAlternateProvider(primary));
  }

  // Only carry the operator's fallback model when the operator also supplied the
  // backup provider. A re-derived global alternate has no operator-chosen model.
  const model = fromProfile ? normalizeModelOverride(source.fallbackModel) : '';

  return { provider, model, fromProfile };
}

module.exports = {
  resolveAgentBackup,
};
