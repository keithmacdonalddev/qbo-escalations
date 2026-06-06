import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tel, TEL } from '../lib/devTelemetry.js';
import {
  DEFAULT_AI_SETTINGS,
  deepSet,
  hasStoredAiSettings,
  persistAiSettings,
  readStoredAiSettings,
} from '../lib/aiSettingsStore.js';
import {
  hydrateAgentRuntimeFromIdentities,
  loadAiAssistantDefaultsFromServer,
  syncAiAssistantDefaultsToServer,
} from '../lib/aiAssistantPreferences.js';

export { DEFAULT_AI_SETTINGS } from '../lib/aiSettingsStore.js';

export default function useAiSettings() {
  const [aiSettings, setAiSettingsState] = useState(readStoredAiSettings);
  const aiSettingsRef = useRef(aiSettings);

  useEffect(() => {
    aiSettingsRef.current = aiSettings;
  }, [aiSettings]);

  useEffect(() => {
    let cancelled = false;

    // Seed per-agent runtime (provider / model / fallback) into localStorage
    // from the AUTHORITATIVE AgentIdentity.runtime store — the same store
    // AgentsView writes and the chat / triage / INV legs read. This replaces the
    // old seed from UserPreferences.aiAssistantDefaults.agents, which was off the
    // runtime path and could silently revert an AgentsView edit on reload. Fully
    // self-contained and swallows its own errors, so it never blocks the global
    // settings load below.
    hydrateAgentRuntimeFromIdentities().catch(() => {});

    loadAiAssistantDefaultsFromServer()
      .then((defaults) => {
        if (cancelled) return;

        if (defaults?.settings) {
          const normalized = persistAiSettings(defaults.settings);
          aiSettingsRef.current = normalized;
          setAiSettingsState(normalized);
        }

        // Back-fill the server's global AI settings from this browser's stored
        // settings the first time (server has none yet). Agent runtime is NOT
        // pushed here — its source of truth is AgentIdentity.runtime, edited via
        // AgentsView, not this preferences store.
        const serverHasSettings = Boolean(defaults?.settings);
        if (!serverHasSettings && hasStoredAiSettings()) {
          syncAiAssistantDefaultsToServer({
            settings: aiSettingsRef.current,
          }).catch(() => {});
        }
      })
      .catch(() => {
        // Local browser settings remain usable when the server preference read fails.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setAiSettings = useCallback((nextValueOrUpdater) => {
    const current = aiSettingsRef.current;
    const nextRaw = typeof nextValueOrUpdater === 'function'
      ? nextValueOrUpdater(current)
      : nextValueOrUpdater;
    const normalized = persistAiSettings(nextRaw);
    setAiSettingsState(normalized);
    return normalized;
  }, []);

  const updateAiSetting = useCallback((path, value) => {
    tel(TEL.USER_ACTION, `AI setting changed: ${path}`, { setting: path, value });
    setAiSettings((prev) => deepSet(prev, path, value));
  }, [setAiSettings]);

  const resetAiSettings = useCallback(() => {
    setAiSettings(DEFAULT_AI_SETTINGS);
  }, [setAiSettings]);

  const isAiModified = useMemo(() => (
    JSON.stringify(aiSettings) !== JSON.stringify(DEFAULT_AI_SETTINGS)
  ), [aiSettings]);

  return {
    aiSettings,
    setAiSettings,
    updateAiSetting,
    resetAiSettings,
    isAiModified,
  };
}
