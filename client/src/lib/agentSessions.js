import { useCallback, useMemo, useSyncExternalStore } from 'react';

const sessions = new Map();
const listeners = new Map();
const controllers = new Map();

function getListenerSet(key) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  return set;
}

function emit(key) {
  const set = listeners.get(key);
  if (!set) return;
  for (const listener of set) {
    try {
      listener();
    } catch {
      // Ignore subscriber failures so one panel cannot break the registry.
    }
  }
}

function cloneInitialState(initialState) {
  if (!initialState || typeof initialState !== 'object') return {};
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(initialState);
    } catch {
      // Fall through to the shallow clone below.
    }
  }
  if (Array.isArray(initialState)) return [...initialState];
  return { ...initialState };
}

export function getAgentSessionSnapshot(key, initialState = {}) {
  if (!key) return cloneInitialState(initialState);
  if (!sessions.has(key)) {
    sessions.set(key, cloneInitialState(initialState));
  }
  return sessions.get(key);
}

export function updateAgentSession(key, initialState = {}, patch) {
  if (!key) return cloneInitialState(initialState);
  const current = getAgentSessionSnapshot(key, initialState);
  const next = typeof patch === 'function'
    ? patch(current)
    : { ...current, ...(patch || {}) };
  sessions.set(key, next);
  emit(key);
  return next;
}

export function resetAgentSession(key, initialState = {}, options = {}) {
  if (!key) return cloneInitialState(initialState);
  const current = getAgentSessionSnapshot(key, initialState);
  const preserveKeys = Array.isArray(options.preserveKeys) ? options.preserveKeys : [];
  const preserved = {};
  for (const preserveKey of preserveKeys) {
    if (Object.prototype.hasOwnProperty.call(current, preserveKey)) {
      preserved[preserveKey] = current[preserveKey];
    }
  }
  const next = {
    ...cloneInitialState(initialState),
    ...preserved,
  };
  sessions.set(key, next);
  emit(key);
  return next;
}

export function setAgentSessionController(key, abort) {
  if (!key) return;
  if (typeof abort === 'function') {
    controllers.set(key, abort);
  } else {
    controllers.delete(key);
  }
}

export function abortAgentSession(key) {
  const abort = controllers.get(key);
  if (typeof abort === 'function') {
    abort();
  }
  controllers.delete(key);
}

function subscribeAgentSession(key, listener) {
  if (!key) return () => {};
  const set = getListenerSet(key);
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      listeners.delete(key);
    }
  };
}

export function useSharedAgentSession(key, initialState = {}) {
  const baseState = useMemo(() => cloneInitialState(initialState), [initialState]);

  const subscribe = useCallback((listener) => subscribeAgentSession(key, listener), [key]);
  const getSnapshot = useCallback(() => getAgentSessionSnapshot(key, baseState), [key, baseState]);
  const session = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const patchSession = useCallback((patch) => updateAgentSession(key, baseState, patch), [key, baseState]);
  const clearSession = useCallback((options) => resetAgentSession(key, baseState, options), [key, baseState]);
  const setController = useCallback((abort) => setAgentSessionController(key, abort), [key]);
  const abortSession = useCallback(() => abortAgentSession(key), [key]);

  return {
    session,
    patchSession,
    clearSession,
    setController,
    abortSession,
  };
}
