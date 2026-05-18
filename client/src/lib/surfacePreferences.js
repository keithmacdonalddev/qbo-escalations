import {
  DEFAULT_PROVIDER,
  DEFAULT_REASONING_EFFORT,
  getAlternateProvider,
  normalizeProvider as normalizeCatalogProvider,
  normalizeReasoningEffort,
  resolveProviderSelection,
} from './providerCatalog.js';

export const SURFACE_DEFAULTS_APPLIED_EVENT = 'qbo-ai-defaults-applied';

function getStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function toKeyList(keys) {
  return Array.isArray(keys) ? keys.filter(Boolean) : [keys].filter(Boolean);
}

export function normalizeSurfaceModel(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function readStoredPreference(keys) {
  const storage = getStorage();
  if (!storage) return null;

  for (const key of toKeyList(keys)) {
    try {
      const value = storage.getItem(key);
      if (value) return value;
    } catch {
      // Ignore storage failures and try the next fallback key.
    }
  }

  return null;
}

export function hasStoredPreference(keys) {
  const storage = getStorage();
  if (!storage) return false;

  for (const key of toKeyList(keys)) {
    try {
      if (storage.getItem(key) !== null) return true;
    } catch {
      // Ignore storage failures and keep checking.
    }
  }

  return false;
}

export function writeStoredPreference(key, value) {
  const storage = getStorage();
  if (!storage || !key) return;

  try {
    if (value === undefined || value === null || value === '') {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, String(value));
  } catch {
    // Best-effort only.
  }
}

export function readBooleanPreference(key, defaultValue = true) {
  const storage = getStorage();
  if (!storage) return defaultValue;

  try {
    const raw = storage.getItem(key);
    return raw == null ? defaultValue : raw === 'true';
  } catch {
    return defaultValue;
  }
}

export function normalizeSurfaceProvider(provider) {
  return normalizeCatalogProvider(provider);
}

export function normalizeSurfaceMode(mode, supportedModes, defaultMode = 'single') {
  const modes = Array.isArray(supportedModes) && supportedModes.length > 0
    ? supportedModes
    : [defaultMode];
  if (modes.includes(mode)) return mode;
  return defaultMode;
}

export function resolveSurfaceMode(mode, supportedModes, defaultMode = 'single') {
  const modes = Array.isArray(supportedModes) && supportedModes.length > 0
    ? supportedModes
    : [defaultMode];
  if (modes.includes(mode)) return mode;
  if (modes.includes('fallback')) return 'fallback';
  return modes[0] || defaultMode;
}

export function normalizeSurfaceFallback(primary, fallback) {
  const normalizedPrimary = normalizeSurfaceProvider(primary);
  const normalizedFallback = normalizeSurfaceProvider(fallback);
  if (normalizedFallback === normalizedPrimary) return getAlternateProvider(normalizedPrimary);
  return normalizedFallback;
}

export function readSurfacePreferences({
  providerKeys,
  modeKeys,
  fallbackProviderKeys,
  modelKeys,
  fallbackModelKeys,
  reasoningEffortKeys,
  defaultMode = 'single',
  supportedModes = ['single', 'fallback'],
  defaultProvider = DEFAULT_PROVIDER,
  reasoningEffortFallback = DEFAULT_REASONING_EFFORT,
} = {}) {
  const primarySelection = resolveProviderSelection(
    readStoredPreference(providerKeys) || defaultProvider,
    readStoredPreference(modelKeys)
  );
  const provider = primarySelection.provider;
  const mode = normalizeSurfaceMode(readStoredPreference(modeKeys) || defaultMode, supportedModes, defaultMode);
  const fallbackSelection = resolveProviderSelection(
    readStoredPreference(fallbackProviderKeys) || getAlternateProvider(provider),
    readStoredPreference(fallbackModelKeys)
  );
  const fallbackProvider = normalizeSurfaceFallback(
    provider,
    fallbackSelection.provider
  );
  const reasoningEffort = normalizeReasoningEffort(
    readStoredPreference(reasoningEffortKeys) || reasoningEffortFallback || DEFAULT_REASONING_EFFORT
  );

  return {
    provider,
    mode,
    fallbackProvider,
    model: primarySelection.model,
    fallbackModel: fallbackProvider === fallbackSelection.provider ? fallbackSelection.model : '',
    reasoningEffort,
  };
}

export function readSurfaceSelection(surface, options = {}) {
  const {
    defaultProvider = DEFAULT_PROVIDER,
    reasoningEffortFallback = DEFAULT_REASONING_EFFORT,
  } = options;
  const primarySelection = resolveProviderSelection(
    readStoredPreference(surface?.storage?.provider) || defaultProvider,
    readStoredPreference(surface?.storage?.model)
  );
  const provider = primarySelection.provider;
  const fallbackSelection = resolveProviderSelection(
    readStoredPreference(surface?.storage?.fallbackProvider) || getAlternateProvider(provider),
    readStoredPreference(surface?.storage?.fallbackModel)
  );
  const fallbackProvider = normalizeSurfaceFallback(
    provider,
    fallbackSelection.provider
  );

  return {
    ...surface,
    hasStoredSelection: hasStoredPreference(Object.values(surface?.storage || {})),
    provider,
    mode: resolveSurfaceMode(
      readStoredPreference(surface?.storage?.mode) || surface?.defaultMode,
      surface?.supportedModes,
      surface?.defaultMode,
    ),
    fallbackProvider,
    model: primarySelection.model,
    fallbackModel: fallbackProvider === fallbackSelection.provider ? fallbackSelection.model : '',
    reasoningEffort: normalizeReasoningEffort(
      readStoredPreference(surface?.storage?.reasoningEffort) || reasoningEffortFallback || DEFAULT_REASONING_EFFORT
    ),
  };
}

export function writeSurfacePreferences(storage, payload) {
  if (!storage) return;
  writeStoredPreference(storage.provider, payload.provider);
  writeStoredPreference(storage.mode, payload.mode);
  writeStoredPreference(storage.fallbackProvider, payload.fallbackProvider);
  writeStoredPreference(storage.model, normalizeSurfaceModel(payload.model));
  writeStoredPreference(storage.fallbackModel, normalizeSurfaceModel(payload.fallbackModel));
  writeStoredPreference(storage.reasoningEffort, payload.reasoningEffort);
}

export function applySurfaceDefaults(event, surfaceId, handlers) {
  const next = event?.detail?.surfaces?.[surfaceId];
  if (!next) return;
  if (next.provider) handlers?.setProvider?.(next.provider);
  if (next.mode) handlers?.setMode?.(next.mode);
  if (next.fallbackProvider) handlers?.setFallbackProvider?.(next.fallbackProvider);
  handlers?.setModel?.(next.model || '');
  handlers?.setFallbackModel?.(next.fallbackModel || '');
  if (next.reasoningEffort) handlers?.setReasoningEffort?.(next.reasoningEffort);
}

export function bindSurfaceDefaultsApplied(surfaceId, handlers) {
  if (typeof window === 'undefined') return () => {};

  const handleDefaultsApplied = (event) => applySurfaceDefaults(event, surfaceId, handlers);
  window.addEventListener(SURFACE_DEFAULTS_APPLIED_EVENT, handleDefaultsApplied);
  return () => window.removeEventListener(SURFACE_DEFAULTS_APPLIED_EVENT, handleDefaultsApplied);
}
