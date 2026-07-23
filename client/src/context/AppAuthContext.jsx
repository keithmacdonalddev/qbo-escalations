import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  beginTicketSnitchSignIn,
  consumeTicketSnitchAuthReturn,
  loadAppSession,
  signInToApp,
  signOutOfApp,
} from '../api/appAuth.js';

const AppAuthContext = createContext(null);

const INITIAL_STATE = {
  loading: true,
  enabled: false,
  configured: false,
  authenticated: false,
  mode: 'disabled',
  identityProvider: null,
  user: null,
  expiresAt: null,
  error: null,
};

export function AppAuthProvider({ children }) {
  const [state, setState] = useState(INITIAL_STATE);

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const authReturn = consumeTicketSnitchAuthReturn();
      const result = await loadAppSession();
      setState({
        loading: false,
        enabled: Boolean(result.enabled),
        configured: Boolean(result.configured),
        authenticated: Boolean(result.authenticated),
        mode: result.mode || 'disabled',
        identityProvider: result.identityProvider || null,
        user: result.user || null,
        expiresAt: result.expiresAt || null,
        error: authReturn?.result === 'error'
          ? Object.assign(new Error('Ticket Snitch sign-in was not completed. Try again.'), {
            code: authReturn.code || 'TICKET_SNITCH_SIGN_IN_FAILED',
            requestId: authReturn.requestId || '',
          })
          : null,
      });
      return result;
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error }));
      throw error;
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const signIn = useCallback(async (password) => {
    const result = await signInToApp(password);
    setState({
      loading: false,
      enabled: true,
      configured: true,
      authenticated: true,
      mode: result.mode || 'password',
      identityProvider: result.identityProvider || 'password',
      user: result.user,
      expiresAt: result.expiresAt || null,
      error: null,
    });
    return result;
  }, []);

  const signOut = useCallback(async () => {
    const result = await signOutOfApp();
    setState((current) => ({
      ...current,
      loading: false,
      authenticated: false,
      identityProvider: null,
      user: null,
      expiresAt: null,
      error: null,
    }));
    return result;
  }, []);

  const markSignedOut = useCallback(() => {
    setState((current) => ({ ...current, authenticated: false, identityProvider: null, user: null, expiresAt: null }));
  }, []);

  const beginSignIn = useCallback((returnTo = '/') => {
    beginTicketSnitchSignIn(returnTo);
  }, []);

  const value = useMemo(() => ({ ...state, beginSignIn, refresh, signIn, signOut, markSignedOut }), [beginSignIn, markSignedOut, refresh, signIn, signOut, state]);
  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>;
}

export function useAppAuth() {
  const value = useContext(AppAuthContext);
  if (!value) throw new Error('useAppAuth must be used inside AppAuthProvider.');
  return value;
}
