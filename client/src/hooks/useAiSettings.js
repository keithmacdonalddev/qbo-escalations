import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tel, TEL } from '../lib/devTelemetry.js';
import {
  DEFAULT_AI_SETTINGS,
  deepSet,
  persistAiSettings,
  readStoredAiSettings,
} from '../lib/aiSettingsStore.js';

export { DEFAULT_AI_SETTINGS } from '../lib/aiSettingsStore.js';

export default function useAiSettings() {
  const [aiSettings, setAiSettingsState] = useState(readStoredAiSettings);
  const aiSettingsRef = useRef(aiSettings);

  useEffect(() => {
    aiSettingsRef.current = aiSettings;
  }, [aiSettings]);

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
