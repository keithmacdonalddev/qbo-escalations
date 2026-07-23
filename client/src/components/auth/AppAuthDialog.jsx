import { useEffect, useRef, useState } from 'react';
import { useAppAuth } from '../../context/AppAuthContext.jsx';
import './AppAuthDialog.css';

function authErrorMessage(error) {
  if (error?.code === 'QBO_AUTH_INVALID_CREDENTIALS') return 'That password is incorrect. Try again.';
  if (error?.code === 'RATE_LIMITED') return 'Too many sign-in attempts. Wait for the retry time, then try again.';
  return error?.message || 'QBO sign-in could not be completed.';
}

export default function AppAuthDialog({ open, onClose, onSignedIn }) {
  const auth = useAppAuth();
  const dialogRef = useRef(null);
  const passwordRef = useRef(null);
  const priorFocusRef = useRef(null);
  const submittingRef = useRef(false);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    priorFocusRef.current = document.activeElement;
    setError(null);
    const frame = requestAnimationFrame(() => {
      if (auth.authenticated) dialogRef.current?.focus();
      else passwordRef.current?.focus();
    });
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !submittingRef.current) onClose();
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      priorFocusRef.current?.focus?.();
    };
  }, [auth.authenticated, onClose, open]);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  if (!open) return null;

  const handleSignIn = async (event) => {
    event.preventDefault();
    if (!password) {
      setError({ message: 'Enter your QBO password.' });
      passwordRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await auth.signIn(password);
      setPassword('');
      onSignedIn?.();
    } catch (nextError) {
      setError(nextError);
      passwordRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await auth.signOut();
      onClose();
    } catch (nextError) {
      setError(nextError);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetrySession = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await auth.refresh();
    } catch (nextError) {
      setError(nextError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app-auth-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
      <section ref={dialogRef} className="app-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="app-auth-title" tabIndex={-1}>
        <header>
          <div>
            <h2 id="app-auth-title">{auth.authenticated ? 'QBO account' : 'Sign in to QBO Escalations'}</h2>
            <p>{auth.authenticated ? 'This server session supplies trusted identity for reports.' : 'Sign in before sending problems, feature requests, or feedback.'}</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Close QBO account dialog">×</button>
        </header>

        {auth.loading ? (
          <div className="app-auth-state" role="status">Checking your QBO session…</div>
        ) : auth.error ? (
          <div className="app-auth-state is-error" role="alert">
            <strong>The QBO sign-in server could not be reached.</strong>
            <span>{authErrorMessage(error || auth.error)}</span>
            {(error || auth.error)?.requestId ? <small>Request ID: {(error || auth.error).requestId}</small> : null}
            <div className="app-auth-actions">
              <button type="button" className="app-auth-secondary" onClick={onClose} disabled={submitting}>Close</button>
              <button type="button" className="app-auth-primary" onClick={handleRetrySession} disabled={submitting}>{submitting ? 'Retrying…' : 'Retry'}</button>
            </div>
          </div>
        ) : !auth.enabled ? (
          <div className="app-auth-state is-warning" role="status">
            <strong>QBO sign-in is not enabled on this server.</strong>
            <span>The server administrator must enable signed-in reporting before reports can be submitted.</span>
          </div>
        ) : !auth.configured ? (
          <div className="app-auth-state is-error" role="alert">
            <strong>QBO sign-in needs configuration.</strong>
            <span>The account profile or password hash is missing or invalid. No password was accepted.</span>
          </div>
        ) : auth.authenticated ? (
          <div className="app-auth-account">
            <span className="app-auth-avatar" aria-hidden="true">{auth.user?.displayName?.trim()?.charAt(0)?.toUpperCase() || 'Q'}</span>
            <div><strong>{auth.user?.displayName}</strong>{auth.user?.email ? <span>{auth.user.email}</span> : null}</div>
            {error ? <div className="app-auth-error" role="alert">{authErrorMessage(error)}</div> : null}
            <div className="app-auth-actions">
              <button type="button" className="app-auth-secondary" onClick={onClose}>Close</button>
              <button type="button" className="app-auth-secondary" onClick={handleSignOut} disabled={submitting}>{submitting ? 'Signing out…' : 'Sign out'}</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSignIn} noValidate>
            <label htmlFor="qbo-auth-password">Password</label>
            <input
              ref={passwordRef}
              id="qbo-auth-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => { setPassword(event.target.value); setError(null); }}
              disabled={submitting}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'qbo-auth-error' : 'qbo-auth-help'}
            />
            <small id="qbo-auth-help">This password is checked by the QBO server and is never sent to Ticket Snitch.</small>
            {error ? (
              <div id="qbo-auth-error" className="app-auth-error" role="alert">
                <span>{authErrorMessage(error)}</span>
                {error.requestId ? <small>Request ID: {error.requestId}</small> : null}
              </div>
            ) : null}
            <div className="app-auth-actions">
              <button type="button" className="app-auth-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
              <button type="submit" className="app-auth-primary" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
