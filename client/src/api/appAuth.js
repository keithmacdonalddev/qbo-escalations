const AUTH_BASE = '/api/auth';
const AUTH_TIMEOUT_MS = 12_000;

export class AppAuthError extends Error {
  constructor(message, { code = 'QBO_AUTH_REQUEST_FAILED', status = 0, requestId = '' } = {}) {
    super(message);
    this.name = 'AppAuthError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

async function authFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${AUTH_BASE}${path}`, {
      ...options,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AppAuthError(payload?.error || 'QBO sign-in could not be completed.', {
        code: payload?.code || 'QBO_AUTH_REQUEST_FAILED',
        status: response.status,
        requestId: payload?.requestId || response.headers.get('x-request-id') || '',
      });
    }
    return payload;
  } catch (error) {
    if (error instanceof AppAuthError) throw error;
    if (error?.name === 'AbortError') {
      throw new AppAuthError('The QBO server took too long to respond.', { code: 'QBO_AUTH_TIMEOUT' });
    }
    throw new AppAuthError('QBO Escalations could not reach its sign-in server.', { code: 'QBO_AUTH_OFFLINE' });
  } finally {
    clearTimeout(timer);
  }
}

export function loadAppSession() {
  return authFetch('/session');
}

export function signInToApp(password) {
  return authFetch('/login', { method: 'POST', body: JSON.stringify({ password }) });
}

export function signOutOfApp() {
  return authFetch('/logout', { method: 'POST', body: JSON.stringify({}) });
}
