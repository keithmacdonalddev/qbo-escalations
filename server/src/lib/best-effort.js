'use strict';

const { reportServerError } = require('./server-error-pipeline');

function getErrorMessage(err) {
  if (!err) return 'Unknown error';
  if (typeof err.message === 'string' && err.message.trim()) return err.message.trim();
  const fallback = String(err);
  return fallback && fallback !== '[object Object]' ? fallback : 'Unknown error';
}

function reportBestEffortError(err, {
  source = 'unknown',
  action = 'Best-effort task',
  detail = '',
  category = 'background-task',
  severity = 'warning',
} = {}) {
  const message = getErrorMessage(err);
  console.warn(`[${source}] ${action} failed: ${message}`);
  reportServerError({
    message: `${action} failed: ${message}`,
    detail,
    stack: err?.stack || '',
    source,
    category,
    severity,
  });
}

function observeBestEffort(taskOrPromise, options = {}) {
  try {
    return Promise.resolve(typeof taskOrPromise === 'function' ? taskOrPromise() : taskOrPromise).catch((err) => {
      reportBestEffortError(err, options);
      return null;
    });
  } catch (err) {
    reportBestEffortError(err, options);
    return Promise.resolve(null);
  }
}

module.exports = {
  reportBestEffortError,
  observeBestEffort,
};
