/**
 * Normalize any error payload into a consistent shape.
 * Handles: null/undefined, strings, Error instances, plain objects, other primitives.
 *
 * @param {*} input - Raw error from API, catch block, or SSE stream
 * @param {string} [fallbackMessage='Request failed'] - Default message when input is empty
 * @returns {{ message: string, error: string, code: string, detail: string, attempts: Array, status?: number, statusText?: string, url?: string }}
 */
const STATUS_BY_CODE = new Map([
  ['MISSING_FIELD', 400],
  ['MISSING_FIELDS', 400],
  ['MISSING_INPUT', 400],
  ['INVALID_ACTION', 400],
  ['INVALID_CONDITION', 400],
  ['INVALID_CONVERSATION_ID', 400],
  ['INVALID_DATE', 400],
  ['INVALID_FIELD', 400],
  ['INVALID_FILENAME', 400],
  ['INVALID_FILTER', 400],
  ['INVALID_ID', 400],
  ['INVALID_PROVIDER', 400],
  ['INVALID_SERVICE', 400],
  ['INVALID_STATUS', 400],
  ['NO_KEY', 400],
  ['NOT_FOUND', 404],
  ['ENTITY_NOT_FOUND', 404],
  ['IMAGE_NOT_FOUND', 404],
  ['KNOWLEDGE_NOT_FOUND', 404],
  ['LABEL_NOT_FOUND', 404],
  ['SOURCE_IMAGE_NOT_FOUND', 404],
  ['ALREADY_EXISTS', 409],
  ['LABEL_EXISTS', 409],
  ['RATE_LIMITED', 429],
  ['DB_UNAVAILABLE', 503],
  ['PROVIDER_UNAVAILABLE', 503],
  ['SERVICE_UNAVAILABLE', 503],
  ['TIMEOUT', 504],
  ['QUERY_TIMEOUT', 504],
]);

function inferStatusFromCode(code, fallbackStatus = 0) {
  const normalizedCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!normalizedCode) return fallbackStatus;
  if (STATUS_BY_CODE.has(normalizedCode)) return STATUS_BY_CODE.get(normalizedCode);
  if (normalizedCode.startsWith('INVALID_')) return 400;
  if (normalizedCode.startsWith('MISSING_')) return 400;
  if (normalizedCode.startsWith('NO_')) return 400;
  if (normalizedCode.includes('NOT_FOUND')) return 404;
  if (normalizedCode.includes('ALREADY_EXISTS') || normalizedCode.includes('CONFLICT')) return 409;
  if (normalizedCode.includes('RATE_LIMIT')) return 429;
  if (normalizedCode.includes('UNAVAILABLE')) return 503;
  if (normalizedCode.includes('TIMEOUT')) return 504;
  return fallbackStatus;
}

export function normalizeError(input, fallbackMessage = 'Request failed') {
  if (!input) {
    return {
      message: fallbackMessage,
      error: fallbackMessage,
      code: 'REQUEST_FAILED',
      detail: '',
      attempts: [],
      status: inferStatusFromCode('REQUEST_FAILED', 0),
    };
  }
  if (typeof input === 'string') {
    return {
      message: input,
      error: input,
      code: 'REQUEST_FAILED',
      detail: '',
      attempts: [],
      status: inferStatusFromCode('REQUEST_FAILED', 0),
    };
  }
  if (typeof input === 'object') {
    const message = input.message || input.error || fallbackMessage;
    const status = Number.isInteger(input.status)
      ? input.status
      : inferStatusFromCode(input.code, 0);
    return {
      ...input,
      message,
      error: message,
      code: input.code || 'REQUEST_FAILED',
      detail: input.detail || '',
      attempts: Array.isArray(input.attempts) ? input.attempts : [],
      status,
      statusText: typeof input.statusText === 'string' ? input.statusText : '',
      url: typeof input.url === 'string' ? input.url : '',
    };
  }
  const str = String(input);
  return {
    message: str,
    error: str,
    code: 'REQUEST_FAILED',
    detail: '',
    attempts: [],
    status: inferStatusFromCode('REQUEST_FAILED', 0),
  };
}

/**
 * Build an Error instance with structured metadata.
 * Used where callers expect thrown Error objects (e.g. escalationsApi).
 */
export function toApiError(data, fallbackMessage) {
  const norm = normalizeError(data, fallbackMessage);
  const err = new Error(norm.message);
  err.code = norm.code;
  err.detail = norm.detail;
  err.attempts = norm.attempts;
  err.status = norm.status;
  err.statusText = norm.statusText;
  err.url = norm.url;
  return err;
}
