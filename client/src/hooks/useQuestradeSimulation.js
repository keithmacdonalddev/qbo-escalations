import { useCallback, useEffect, useState } from 'react';
import { getQuestradeConnection, selectQuestradeDevScenario } from '../api/investments.js';

const INITIAL_STATE = Object.freeze({
  loading: true,
  error: '',
  data: null,
  changingScenario: false,
  connecting: false,
  selectingAccount: false,
  operation: '',
  completion: '',
});

export function useQuestradeSimulation() {
  const [state, setState] = useState(INITIAL_STATE);

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const data = await getQuestradeConnection({ simulated: true });
      setState((current) => ({ ...current, loading: false, error: '', data }));
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message || 'Simulation unavailable.' }));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = useCallback(async (operation, scenario, completion = '') => {
    setState((current) => ({ ...current, operation, completion: '', error: '' }));
    try {
      const response = await selectQuestradeDevScenario(scenario);
      const data = completion ? { ...response, completionKind: completion } : response;
      setState((current) => ({ ...current, data, operation: '', completion, error: '' }));
      return data;
    } catch (error) {
      setState((current) => ({ ...current, operation: '', error: error.message || 'The safe simulation could not be updated.' }));
      throw error;
    }
  }, []);

  const selectScenario = useCallback(async (scenario) => {
    setState((current) => ({ ...current, changingScenario: true, completion: '', error: '' }));
    try {
      const data = await selectQuestradeDevScenario(scenario);
      setState((current) => ({ ...current, data, changingScenario: false, error: '' }));
    } catch (error) {
      setState((current) => ({ ...current, changingScenario: false, error: error.message || 'Scenario unavailable.' }));
    }
  }, []);

  return {
    ...state,
    connect: () => run('connecting', 'healthy-margin'),
    disconnect: () => run('disconnecting', 'disconnected', 'disconnected'),
    forgetLocal: () => run('forgetting', 'disconnected', 'forgot-local'),
    reauthorize: () => run('reauthorizing', 'healthy-margin'),
    refresh,
    retryRevocation: () => run('revoking', 'disconnected', 'disconnected'),
    retryVerification: () => run('verifying', 'healthy-margin'),
    selectAccount: () => run('verifying', 'healthy-margin'),
    selectScenario,
    simulated: true,
  };
}
