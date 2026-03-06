import { useState } from 'react';

export default function ErrorFallback({ error, resetErrorBoundary }) {
  const [showStack, setShowStack] = useState(false);
  const isDev = import.meta.env.DEV;

  return (
    <div className="error-fallback">
      <div className="error-fallback-card">
        <div className="error-fallback-icon">!</div>
        <h1 className="error-fallback-title">Something went wrong</h1>
        <p className="error-fallback-message">{error?.message || 'An unexpected error occurred'}</p>

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
