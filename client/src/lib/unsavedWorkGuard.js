const unsavedWorkChecks = new Set();

export function registerUnsavedWorkGuard(check) {
  if (typeof check !== 'function') return () => {};
  unsavedWorkChecks.add(check);
  return () => unsavedWorkChecks.delete(check);
}

export function hasUnsavedWork() {
  for (const check of unsavedWorkChecks) {
    try {
      if (check()) return true;
    } catch {
      // A stale guard must never break app navigation.
    }
  }
  return false;
}
