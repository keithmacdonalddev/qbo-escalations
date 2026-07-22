import { afterEach, describe, expect, it } from 'vitest';
import { hasUnsavedWork, registerUnsavedWorkGuard } from './unsavedWorkGuard.js';

const cleanups = [];

function register(check) {
  const cleanup = registerUnsavedWorkGuard(check);
  cleanups.push(cleanup);
  return cleanup;
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

describe('unsavedWorkGuard', () => {
  it('reports unsaved work from a registered check and clears it on cleanup', () => {
    const cleanup = register(() => true);

    expect(hasUnsavedWork()).toBe(true);
    cleanup();
    expect(hasUnsavedWork()).toBe(false);
  });

  it('keeps multiple registrants independent until each one is removed', () => {
    const removeSavedCheck = register(() => false);
    const removeUnsavedCheck = register(() => true);

    expect(hasUnsavedWork()).toBe(true);
    removeSavedCheck();
    expect(hasUnsavedWork()).toBe(true);
    removeUnsavedCheck();
    expect(hasUnsavedWork()).toBe(false);
  });

  it('ignores stale checks that throw instead of breaking navigation decisions', () => {
    register(() => {
      throw new Error('stale component');
    });
    register(() => false);

    expect(hasUnsavedWork()).toBe(false);
  });
});
