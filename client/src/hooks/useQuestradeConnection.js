import { useCallback, useEffect, useState } from 'react';
import { getQuestradeConnection, selectQuestradeDevScenario } from '../api/investments.js';

const INITIAL_STATE = Object.freeze({
  loading: true,
  error: '',
  data: null,
  changingScenario: false,
});

export function useQuestradeConnection() {
  const [state, setState] = useState(INITIAL_STATE);

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const data = await getQuestradeConnection();
      setState({ loading: false, error: '', data, changingScenario: false });
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error.message || 'Status unavailable.' }));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectScenario = useCallback(async (scenario) => {
    setState((current) => ({ ...current, changingScenario: true, error: '' }));
    try {
      const data = await selectQuestradeDevScenario(scenario);
      setState({ loading: false, error: '', data, changingScenario: false });
    } catch (error) {
      setState((current) => ({ ...current, changingScenario: false, error: error.message || 'Scenario unavailable.' }));
    }
  }, []);

  return { ...state, refresh, selectScenario };
}
