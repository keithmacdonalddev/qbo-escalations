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
  return writeStoredAccount(STORAGE_KEYS.gmail, email);
}

export function getDefaultCalendarAccount() {
  return readStoredAccount(STORAGE_KEYS.calendar);
}

export function setDefaultCalendarAccount(email) {
  return writeStoredAccount(STORAGE_KEYS.calendar, email);
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
