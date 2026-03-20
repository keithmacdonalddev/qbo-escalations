import { apiFetch } from '../api/http.js';

const STORAGE_KEYS = Object.freeze({
  gmail: 'qbo-default-gmail-account',
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

export function setDefaultGmailAccount(email) {
  const value = writeStoredAccount(STORAGE_KEYS.gmail, email);
  // Fire-and-forget server sync — localStorage is the immediate source of truth
  syncDefaultsToServer({ defaultGmailAccount: value }).catch(() => {});
  // Notify same-tab listeners (storage event only fires cross-tab)
  window.dispatchEvent(new CustomEvent('default-email-changed', { detail: value }));
  return value;
}

export function getDefaultCalendarAccount() {
  return readStoredAccount(STORAGE_KEYS.calendar);
}

export function setDefaultCalendarAccount(email) {
  const value = writeStoredAccount(STORAGE_KEYS.calendar, email);
  // Fire-and-forget server sync
  syncDefaultsToServer({ defaultCalendarAccount: value }).catch(() => {});
  return value;
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
 * Accepts partial updates: { defaultGmailAccount } or { defaultCalendarAccount } or both.
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
 * Returns { defaultGmailAccount, defaultCalendarAccount } or null on failure.
 */
export async function loadDefaultsFromServer() {
  try {
    const res = await apiFetch('/api/preferences');
    const data = await res.json();
    if (!data.ok) return null;

    // Hydrate localStorage from server — server is authoritative
    if (data.defaultGmailAccount) {
      writeStoredAccount(STORAGE_KEYS.gmail, data.defaultGmailAccount);
    }
    if (data.defaultCalendarAccount) {
      writeStoredAccount(STORAGE_KEYS.calendar, data.defaultCalendarAccount);
    }

    return {
      defaultGmailAccount: data.defaultGmailAccount || '',
      defaultCalendarAccount: data.defaultCalendarAccount || '',
    };
  } catch {
    return null;
  }
}
