import { expect, it } from 'vitest';
import {
  loadSavedReceipts,
  removeSavedReceipt,
  saveReceipt,
} from './customerReceipts.js';

const handle = `qtr_${'a'.repeat(16)}.${'b'.repeat(112)}.${'c'.repeat(22)}`;

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

it('stores only an opaque QBO handle under the signed-in user scope', () => {
  const storage = memoryStorage();
  const saved = saveReceipt('user-1', {
    key: 'QBO-71',
    title: 'Private report',
    handle,
    expiresAt: '2027-07-23T03:00:00.000Z',
  }, storage);
  expect(saved).toHaveLength(1);
  expect(loadSavedReceipts('user-1', storage)[0].handle).toBe(handle);
  expect(loadSavedReceipts('user-2', storage)).toEqual([]);
});

it('rejects malformed or raw Ticket Snitch tokens and removes saved handles', () => {
  const storage = memoryStorage();
  expect(saveReceipt('user-1', {
    key: 'QBO-72',
    title: 'Unsafe raw token',
    handle: `tsr_11111111-1111-4111-8111-111111111111.${'x'.repeat(43)}`,
    expiresAt: '2027-07-23T03:00:00.000Z',
  }, storage)).toEqual([]);
  saveReceipt('user-1', {
    key: 'QBO-71',
    title: 'Private report',
    handle,
    expiresAt: '2027-07-23T03:00:00.000Z',
  }, storage);
  expect(removeSavedReceipt('user-1', 'QBO-71', storage)).toEqual([]);
});
