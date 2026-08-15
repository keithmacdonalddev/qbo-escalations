import { describe, expect, it } from 'vitest';
import { googleRecoveryMessage } from './googleRecoveryMessage.js';

describe('googleRecoveryMessage', () => {
  it('replaces raw browser network failures with useful recovery guidance', () => {
    expect(googleRecoveryMessage(new TypeError('Failed to fetch'), 'Google sign-in could not be opened.'))
      .toBe('Google sign-in could not be opened. Check your connection and try again.');
  });

  it('preserves a useful provider response', () => {
    expect(googleRecoveryMessage(new Error('Google access was denied.'), 'Fallback'))
      .toBe('Google access was denied.');
  });
});
