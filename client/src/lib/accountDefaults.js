import { apiFetch } from '../api/http.js';

const STORAGE_KEYS = Object.freeze({
  gmail: 'qbo-default-gmail-account',
  sending: 'qbo-default-sending-account',
  calendar: 'qbo-default-calendar-account',
});

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function readStoredAccount(key) {
  try {
    const value = window.localStorage.getItem(key);
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

function writeStoredAccount(key, email) {
  const nextValue = typeof email === 'string' ? email.trim() : '';
  try {
    if (nextValue) {
      window.localStorage.setItem(key, nextValue);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage failures and fall back to runtime behavior.
  }
  return nextValue;
}

export function getDefaultGmailAccount() {
  return readStoredAccount(STORAGE_KEYS.gmail);
}

export async function setDefaultGmailAccount(email) {
  const value = typeof email === 'string' ? email.trim() : '';
  const saved = await syncDefaultsToServer({ defaultGmailAccount: value });
  if (!saved) throw new Error('The default inbox could not be saved.');
  writeStoredAccount(STORAGE_KEYS.gmail, saved.defaultGmailAccount || '');
  // Notify same-tab listeners (storage event only fires cross-tab)
  window.dispatchEvent(new CustomEvent('default-email-changed', { detail: saved.defaultGmailAccount || '' }));
  return saved.defaultGmailAccount || '';
}

export function getDefaultCalendarAccount() {
  return readStoredAccount(STORAGE_KEYS.calendar);
}

export function getDefaultSendingAccount() {
  return readStoredAccount(STORAGE_KEYS.sending);
}

export async function setDefaultSendingAccount(email) {
  const value = typeof email === 'string' ? email.trim() : '';
  const saved = await syncDefaultsToServer({ defaultSendingAccount: value });
  if (!saved) throw new Error('The default sending account could not be saved.');
  writeStoredAccount(STORAGE_KEYS.sending, saved.defaultSendingAccount || '');
  window.dispatchEvent(new CustomEvent('default-sending-account-changed', { detail: saved.defaultSendingAccount || '' }));
  return saved.defaultSendingAccount || '';
}

export async function setDefaultCalendarAccount(email) {
  const value = typeof email === 'string' ? email.trim() : '';
  const saved = await syncDefaultsToServer({ defaultCalendarAccount: value });
  if (!saved) throw new Error('The default calendar account could not be saved.');
  writeStoredAccount(STORAGE_KEYS.calendar, saved.defaultCalendarAccount || '');
  return saved.defaultCalendarAccount || '';
}

export function hasConnectedAccount(accounts, email) {
  const target = normalizeEmail(email);
  if (!target || !Array.isArray(accounts)) return false;
  return accounts.some((account) => normalizeEmail(account?.email) === target);
}

export function resolveConnectedAccount(accounts, preferredEmail, fallbackEmail = '') {
  if (!Array.isArray(accounts) || accounts.length === 0) return '';

  const matchAccount = (email) => {
    const target = normalizeEmail(email);
    if (!target) return '';
    const match = accounts.find((account) => normalizeEmail(account?.email) === target);
    return match?.email || '';
  };

  return matchAccount(preferredEmail) || matchAccount(fallbackEmail) || accounts[0]?.email || '';
}

// ---------------------------------------------------------------------------
// Server persistence
// ---------------------------------------------------------------------------

/**
 * Push one or both defaults to the server.
 * Accepts partial updates for inbox, sending, and calendar defaults.
 */
export async function syncDefaultsToServer(fields = {}) {
  try {
    const res = await apiFetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    const data = await res.json();
    return data.ok ? data : null;
  } catch {
    return null;
  }
}

/**
 * Load defaults from the server and hydrate localStorage.
 * Returns the saved inbox, sending, and calendar defaults or null on failure.
 */
export async function loadDefaultsFromServer() {
  try {
    const res = await apiFetch('/api/preferences');
    const data = await res.json();
    if (!data.ok) return null;

    // Hydrate localStorage from server — server is authoritative
    writeStoredAccount(STORAGE_KEYS.gmail, data.defaultGmailAccount || '');
    writeStoredAccount(STORAGE_KEYS.sending, data.defaultSendingAccount || '');
    writeStoredAccount(STORAGE_KEYS.calendar, data.defaultCalendarAccount || '');

    return {
      defaultGmailAccount: data.defaultGmailAccount || '',
      defaultSendingAccount: data.defaultSendingAccount || '',
      defaultCalendarAccount: data.defaultCalendarAccount || '',
    };
  } catch {
    return null;
  }
}
