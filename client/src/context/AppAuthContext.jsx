import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { loadAppSession, signInToApp, signOutOfApp } from '../api/appAuth.js';

const AppAuthContext = createContext(null);

const INITIAL_STATE = {
  loading: true,
  enabled: false,
  configured: false,
  authenticated: false,
  user: null,
  expiresAt: null,
  error: null,
};

export function AppAuthProvider({ children }) {
  const [state, setState] = useState(INITIAL_STATE);

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await loadAppSession();
      setState({
        loading: false,
        enabled: Boolean(result.enabled),
        configured: Boolean(result.configured),
        authenticated: Boolean(result.authenticated),
        user: result.user || null,
        expiresAt: result.expiresAt || null,
        error: null,
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
      user: null,
      expiresAt: null,
      error: null,
    }));
    return result;
  }, []);

  const markSignedOut = useCallback(() => {
    setState((current) => ({ ...current, authenticated: false, user: null, expiresAt: null }));
  }, []);

  const value = useMemo(() => ({ ...state, refresh, signIn, signOut, markSignedOut }), [markSignedOut, refresh, signIn, signOut, state]);
  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>;
}

export function useAppAuth() {
  const value = useContext(AppAuthContext);
  if (!value) throw new Error('useAppAuth must be used inside AppAuthProvider.');
  return value;
}
