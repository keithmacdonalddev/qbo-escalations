'use strict';

const STATUS_BY_CODE = new Map([
  ['MISSING_FIELD', 400],
  ['MISSING_FIELDS', 400],
  ['MISSING_INPUT', 400],
  ['MISSING_IMAGE', 400],
  ['MISSING_IMAGES', 400],
  ['MISSING_PROMPT', 400],
  ['INVALID_ACTION', 400],
  ['INVALID_CONDITION', 400],
  ['INVALID_CONVERSATION_ID', 400],
  ['INVALID_DATE', 400],
  ['INVALID_FIELD', 400],
  ['INVALID_FILENAME', 400],
  ['INVALID_FILTER', 400],
  ['INVALID_ID', 400],
  ['INVALID_INDEX', 400],
  ['INVALID_PARALLEL_PROVIDERS', 400],
  ['INVALID_PROVIDER', 400],
  ['INVALID_RATING', 400],
  ['INVALID_SERVICE', 400],
  ['INVALID_KEY', 401],
  ['INVALID_STATUS', 400],
  ['INVALID_TIER', 400],
  ['NO_FIELDS', 400],
  ['NO_KEY', 400],
  ['NOT_FOUND', 404],
  ['ENTITY_NOT_FOUND', 404],
  ['IMAGE_NOT_FOUND', 404],
  ['KNOWLEDGE_NOT_FOUND', 404],
  ['LABEL_NOT_FOUND', 404],
  ['SOURCE_IMAGE_NOT_FOUND', 404],
  ['TURN_NOT_FOUND', 404],
  ['TURN_ALREADY_ACCEPTED', 409],
  ['TURN_DISCARDED', 409],
  ['TURN_EXPIRED', 409],
  ['ALREADY_EXISTS', 409],
  ['LABEL_EXISTS', 409],
  ['PARALLEL_ACCEPT_DISABLED', 409],
  ['PARALLEL_MODE_DISABLED', 409],
  ['PARALLEL_TURN_LIMIT', 429],
  ['RATE_LIMITED', 429],
  ['DB_UNAVAILABLE', 503],
  ['PROVIDER_UNAVAILABLE', 503],
  ['SERVICE_UNAVAILABLE', 503],
  ['TIMEOUT', 504],
  ['QUERY_TIMEOUT', 504],
]);

function inferStatusFromCode(code, fallbackStatus = 500) {
  const normalizedCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!normalizedCode) return fallbackStatus;
  if (STATUS_BY_CODE.has(normalizedCode)) return STATUS_BY_CODE.get(normalizedCode);
  if (normalizedCode.startsWith('INVALID_')) return 400;
  if (normalizedCode.startsWith('MISSING_')) return 400;
  if (normalizedCode.startsWith('NO_')) return 400;
  if (normalizedCode.endsWith('_NOT_FOUND')) return 404;
  if (normalizedCode.includes('NOT_FOUND')) return 404;
  if (normalizedCode.includes('TIMEOUT')) return 504;
  if (normalizedCode.includes('UNAVAILABLE')) return 503;
  if (normalizedCode.includes('ALREADY_EXISTS') || normalizedCode.includes('CONFLICT')) return 409;
  return fallbackStatus;
}

function createApiError(code, message, status, extra = {}) {
  const error = new Error(message || 'Request failed');
  error.code = code || 'INTERNAL';
  error.status = Number.isInteger(status) ? status : inferStatusFromCode(error.code, 500);
  Object.assign(error, extra);
  return error;
}

function normalizeApiError(err, fallbackCode = 'INTERNAL', fallbackMessage = 'Request failed') {
  const code = err?.code || fallbackCode;
  const status = Number.isInteger(err?.status) ? err.status : inferStatusFromCode(code, 500);
  const message = err?.message || fallbackMessage;
  return {
    code,
    status,
    message,
    detail: typeof err?.detail === 'string' ? err.detail : '',
  };
}

function sendApiError(res, err, fallbackCode = 'INTERNAL', fallbackMessage = 'Request failed') {
  const normalized = normalizeApiError(err, fallbackCode, fallbackMessage);
  const payload = {
    ok: false,
    code: normalized.code,
    error: normalized.message,
  };
  if (normalized.detail) payload.detail = normalized.detail;
  return res.status(normalized.status).json(payload);
}

module.exports = {
  createApiError,
  inferStatusFromCode,
  normalizeApiError,
  sendApiError,
};
