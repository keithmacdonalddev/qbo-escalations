/**
 * Normalize any error payload into a consistent shape.
 * Handles: null/undefined, strings, Error instances, plain objects, other primitives.
 *
 * @param {*} input - Raw error from API, catch block, or SSE stream
 * @param {string} [fallbackMessage='Request failed'] - Default message when input is empty
 * @returns {{ message: string, error: string, code: string, detail: string, attempts: Array }}
 */
export function normalizeError(input, fallbackMessage = 'Request failed') {
  if (!input) {
    return { message: fallbackMessage, error: fallbackMessage, code: 'REQUEST_FAILED', detail: '', attempts: [] };
  }
  if (typeof input === 'string') {
    return { message: input, error: input, code: 'REQUEST_FAILED', detail: '', attempts: [] };
  }
  if (typeof input === 'object') {
    const message = input.message || input.error || fallbackMessage;
    return {
      ...input,
      message,
      error: message,
      code: input.code || 'REQUEST_FAILED',
      detail: input.detail || '',
      attempts: Array.isArray(input.attempts) ? input.attempts : [],
    };
  }
  const str = String(input);
  return { message: str, error: str, code: 'REQUEST_FAILED', detail: '', attempts: [] };
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
  return err;
}
