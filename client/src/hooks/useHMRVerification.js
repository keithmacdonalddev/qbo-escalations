import { useEffect, useRef } from 'react';

/**
 * Hooks into Vite's HMR system to detect when modules are updated,
 * full reloads are triggered, or HMR errors occur.
 *
 * Feeds updated file paths to the error resolution tracker so it can
 * detect when an agent-edited file has been hot-replaced by Vite,
 * confirming the fix was applied without a manual refresh.
 *
 * @param {object} opts
 * @param {Function} opts.log         Activity log function
 * @param {Function} opts.onHMRUpdate Called with array of updated file paths
 */
export function useHMRVerification({ log, onHMRUpdate }) {
  const logRef = useRef(log);
  logRef.current = log;
  const onHMRUpdateRef = useRef(onHMRUpdate);
  onHMRUpdateRef.current = onHMRUpdate;

  useEffect(() => {
    if (!import.meta.hot) return; // Not in dev mode

    function handleBeforeUpdate(data) {
      const updatedPaths = (data.updates || []).map(
        u => u.path || u.acceptedPath
      ).filter(Boolean);

      if (updatedPaths.length === 0) return;

      logRef.current?.({
        type: 'hmr-update',
        message: `HMR: ${updatedPaths.length} module(s) updated`,
        severity: 'info',
        detail: updatedPaths.join(', '),
      });

      onHMRUpdateRef.current?.(updatedPaths);
    }

    function handleBeforeFullReload() {
      logRef.current?.({
        type: 'hmr-reload',
        message: 'HMR: Full page reload triggered',
        severity: 'warning',
      });
    }

    function handleError(data) {
      logRef.current?.({
        type: 'hmr-error',
        message: `HMR error: ${data.err?.message || data.message || 'unknown'}`,
        severity: 'error',
        detail: data.err?.stack || null,
      });
    }

    import.meta.hot.on('vite:beforeUpdate', handleBeforeUpdate);
    import.meta.hot.on('vite:beforeFullReload', handleBeforeFullReload);
    import.meta.hot.on('vite:error', handleError);

    // Vite HMR listeners are cleaned up automatically on module dispose
  }, []);
}
