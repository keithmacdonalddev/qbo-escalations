const STORAGE_PREFIX = 'qbo-ticket-snitch-receipts:v1:';
const MAX_RECEIPTS = 50;

function storageKey(reporterScope) {
  return `${STORAGE_PREFIX}${encodeURIComponent(String(reporterScope || '').slice(0, 128))}`;
}

function validReceipt(value) {
  return value
    && typeof value === 'object'
    && /^[A-Z][A-Z0-9-]{1,11}-\d+$/.test(String(value.key || ''))
    && /^qtr_[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{80,220}\.[A-Za-z0-9_-]{22}$/.test(String(value.handle || ''))
    && !Number.isNaN(Date.parse(value.expiresAt));
}

export function loadSavedReceipts(reporterScope, storage = globalThis.localStorage) {
  if (!reporterScope || !storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(reporterScope)) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validReceipt).slice(0, MAX_RECEIPTS);
  } catch {
    return [];
  }
}

export function saveReceipt(reporterScope, receipt, storage = globalThis.localStorage) {
  if (!reporterScope || !validReceipt(receipt) || !storage) return [];
  const current = loadSavedReceipts(reporterScope, storage).filter(
    (entry) => entry.key !== receipt.key,
  );
  const next = [
    {
      key: String(receipt.key),
      title: String(receipt.title || '').slice(0, 240),
      handle: String(receipt.handle),
      expiresAt: new Date(receipt.expiresAt).toISOString(),
      createdAt: receipt.createdAt
        ? new Date(receipt.createdAt).toISOString()
        : new Date().toISOString(),
    },
    ...current,
  ].slice(0, MAX_RECEIPTS);
  storage.setItem(storageKey(reporterScope), JSON.stringify(next));
  return next;
}

export function removeSavedReceipt(reporterScope, key, storage = globalThis.localStorage) {
  if (!reporterScope || !storage) return [];
  const next = loadSavedReceipts(reporterScope, storage).filter(
    (entry) => entry.key !== key,
  );
  storage.setItem(storageKey(reporterScope), JSON.stringify(next));
  return next;
}
