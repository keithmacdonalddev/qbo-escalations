import { useEffect, useState } from 'react';

const writeRaw = (value) => value;

function readBoolean(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function readNumber(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function readString(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function useStoredState(key, fallback, reader, writer = JSON.stringify) {
  const [value, setValue] = useState(() => reader(key, fallback));

  useEffect(() => {
    try {
      localStorage.setItem(key, writer(value));
    } catch {
      // Ignore storage failures. The UI still works with in-memory state.
    }
  }, [key, value, writer]);

  return [value, setValue];
}

export default function useShellPreferences() {
  const [sidebarHoverExpand, setSidebarHoverExpand] = useStoredState('sidebarHoverExpand', true, readBoolean);
  const [sidebarShowLabels, setSidebarShowLabels] = useStoredState('sidebarShowLabels', false, readBoolean);
  const [ledIntensity, setLedIntensity] = useStoredState('ledIntensity', 70, readNumber);
  const [ledMode, setLedMode] = useStoredState('ledMode', 'dot', readString, writeRaw);
  const [ledSpeed, setLedSpeed] = useStoredState('ledSpeed', 2, readNumber);
  const [waterfallView, setWaterfallView] = useStoredState('waterfallDefaultView', 'timeline', readString, writeRaw);
  const [flameBarEnabled, setFlameBarEnabled] = useStoredState('flameBarEnabled', true, readBoolean);
  const [networkTabEnabled, setNetworkTabEnabled] = useStoredState('networkTabEnabled', true, readBoolean);

  return {
    sidebarHoverExpand,
    setSidebarHoverExpand,
    sidebarShowLabels,
    setSidebarShowLabels,
    ledIntensity,
    setLedIntensity,
    ledMode,
    setLedMode,
    ledSpeed,
    setLedSpeed,
    waterfallView,
    setWaterfallView,
    flameBarEnabled,
    setFlameBarEnabled,
    networkTabEnabled,
    setNetworkTabEnabled,
  };
}
