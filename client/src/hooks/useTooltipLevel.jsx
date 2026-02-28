import { createContext, useContext, useState, useCallback, useMemo } from 'react';

const STORAGE_KEY = 'qbo-tooltip-level-v1';
const VALID_LEVELS = ['off', 'low', 'medium', 'high'];
const DEFAULT_LEVEL = 'low';

const LEVEL_RANK = { off: 0, low: 1, medium: 2, high: 3 };

const TooltipContext = createContext({ level: DEFAULT_LEVEL, setLevel: () => {} });

function readStoredLevel() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return VALID_LEVELS.includes(raw) ? raw : DEFAULT_LEVEL;
  } catch {
    return DEFAULT_LEVEL;
  }
}

export function TooltipProvider({ children }) {
  const [level, setLevelState] = useState(readStoredLevel);

  const setLevel = useCallback((newLevel) => {
    if (!VALID_LEVELS.includes(newLevel)) return;
    setLevelState(newLevel);
    try { window.localStorage.setItem(STORAGE_KEY, newLevel); } catch {}
  }, []);

  const value = useMemo(() => ({ level, setLevel }), [level, setLevel]);

  return <TooltipContext.Provider value={value}>{children}</TooltipContext.Provider>;
}

export function useTooltipLevel() {
  return useContext(TooltipContext);
}

export function shouldShowTooltip(tooltipLevel, activeLevel) {
  return LEVEL_RANK[activeLevel] >= LEVEL_RANK[tooltipLevel];
}
