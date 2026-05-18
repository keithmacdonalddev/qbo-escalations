import { useEffect, useState } from 'react';

export function useRunningTimer(startedAt, isRunning, finishedAt, tickMs = 100) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isRunning) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [isRunning, tickMs]);

  if (!startedAt) return '0.0s';
  const end = isRunning ? now : (finishedAt || now);
  const elapsed = Math.max(0, end - startedAt);
  return `${(elapsed / 1000).toFixed(1)}s`;
}
