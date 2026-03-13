import { useState, useEffect } from 'react';

const HMR_TRANSIENT_ERRORS = [
  'Should have a queue',
  'Rendered fewer hooks than expected',
  'Rendered more hooks than expected',
  'is not defined',
];

function isHmrTransientError(error) {
  const msg = error?.message || '';
  return import.meta.env.DEV && HMR_TRANSIENT_ERRORS.some(p => msg.includes(p));
}

export default function ErrorFallback({ error, resetErrorBoundary }) {
  const [showStack, setShowStack] = useState(false);
  const isDev = import.meta.env.DEV;

  // Auto-reload for HMR hook mismatch errors — these are transient and
  // only fixable via full page reload (react-refresh can't reconcile them).
  // Use 300ms delay (fast enough to prevent cascading re-render crashes)
  // and sessionStorage guard to prevent infinite reload loops.
  useEffect(() => {
    if (isHmrTransientError(error)) {
      const key = 'qbo-hmr-reload';
      const last = Number(sessionStorage.getItem(key) || 0);
      const now = Date.now();
      // If we reloaded less than 3s ago, don't reload again (break the loop)
      if (now - last < 3000) return;
      sessionStorage.setItem(key, String(now));
      const tid = setTimeout(() => location.reload(), 300);
      return () => clearTimeout(tid);
    }
  }, [error]);

  return (
    <div className="error-fallback">
      <div className="error-fallback-card">
        <div className="error-fallback-icon">!</div>
        <h1 className="error-fallback-title">Something went wrong</h1>
        <p className="error-fallback-message">{error?.message || 'An unexpected error occurred'}</p>

        {isHmrTransientError(error) && (
          <p style={{ fontSize: 13, color: 'var(--accent, #6366f1)', marginTop: 8, fontWeight: 600 }}>
            Transient HMR error detected — auto-reloading...
          </p>
        )}

        {isDev && error?.stack && (
          <>
            <button
              className="error-fallback-toggle"
              onClick={() => setShowStack(s => !s)}
              type="button"
            >
              {showStack ? 'Hide' : 'Show'} stack trace
            </button>
            {showStack && (
              <pre className="error-fallback-stack">{error.stack}</pre>
            )}
          </>
        )}

        {isDev && (
          <p style={{
            fontSize: 13, color: '#888', marginTop: 12, marginBottom: 4,
            lineHeight: 1.5, textAlign: 'center',
          }}>
            The dev agent has been notified and is investigating.
            Use the chat widget in the bottom-right corner to communicate with it.
          </p>
        )}

        <div className="error-fallback-actions">
          <button
            className="error-fallback-btn error-fallback-btn--primary"
            onClick={() => location.reload()}
            type="button"
          >
            Reload page
          </button>
          <button
            className="error-fallback-btn error-fallback-btn--secondary"
            onClick={resetErrorBoundary}
            type="button"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
