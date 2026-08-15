import { useCallback, useEffect, useState } from 'react';
import {
  connectQuestrade,
  disconnectQuestrade,
  forgetLocalQuestradeConnection,
  getQuestradeConnection,
  reauthorizeQuestrade,
  retryQuestradeRevocation,
  retryQuestradeVerification,
  selectQuestradeAccount,
} from '../api/investments.js';

const INITIAL_STATE = Object.freeze({
  loading: true,
  error: '',
  data: null,
  connecting: false,
  selectingAccount: false,
  operation: '',
  completion: '',
});

export function useQuestradeConnection() {
  const [state, setState] = useState(INITIAL_STATE);

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const data = await getQuestradeConnection();
      setState((current) => ({ ...current, loading: false, error: '', data }));
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message || 'Status unavailable.' }));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const connect = useCallback(async (refreshToken) => {
    setState((current) => ({ ...current, connecting: true, completion: '', error: '' }));
    try {
      const data = await connectQuestrade(refreshToken);
      setState((current) => ({ ...current, data, connecting: false, error: '' }));
      return data;
    } catch (error) {
      setState((current) => ({ ...current, connecting: false, error: error.message || 'Questrade could not be connected.' }));
      throw error;
    }
  }, []);

  const runOperation = useCallback(async (operation, request, fallbackMessage) => {
    setState((current) => ({ ...current, operation, completion: '', error: '' }));
    try {
      const data = await request();
      setState((current) => ({
        ...current,
        data,
        operation: '',
        completion: data?.completionKind || '',
        error: '',
      }));
      return data;
    } catch (error) {
      setState((current) => ({
        ...current,
        operation: '',
        completion: '',
        error: error.message || fallbackMessage,
      }));
      throw error;
    }
  }, []);

  const reauthorize = useCallback((refreshToken) => runOperation(
    'reauthorizing',
    () => reauthorizeQuestrade(refreshToken),
    'Questrade authorization could not be renewed.',
  ), [runOperation]);

  const retryVerification = useCallback(() => runOperation(
    'verifying', retryQuestradeVerification, 'Questrade could not be checked.',
  ), [runOperation]);

  const disconnect = useCallback(() => runOperation(
    'disconnecting', disconnectQuestrade, 'Questrade access could not be fully revoked.',
  ), [runOperation]);

  const retryRevocation = useCallback(() => runOperation(
    'revoking', retryQuestradeRevocation, 'Questrade access could not be fully revoked.',
  ), [runOperation]);

  const forgetLocal = useCallback(() => runOperation(
    'forgetting', forgetLocalQuestradeConnection, 'The local Questrade connection could not be removed.',
  ), [runOperation]);

  const selectAccount = useCallback(async (accountKey) => {
    setState((current) => ({ ...current, selectingAccount: true, error: '' }));
    try {
      const data = await selectQuestradeAccount(accountKey);
      setState((current) => ({ ...current, data, selectingAccount: false, error: '' }));
      return data;
    } catch (error) {
      setState((current) => ({ ...current, selectingAccount: false, error: error.message || 'The account choice could not be saved.' }));
      throw error;
    }
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    forgetLocal,
    reauthorize,
    refresh,
    retryRevocation,
    retryVerification,
    selectAccount,
    simulated: false,
  };
}
