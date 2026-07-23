import { afterEach, expect, it, vi } from 'vitest';
import {
  consumeTicketSnitchAuthReturn,
  loadAppSession,
  signInToApp,
  signOutOfApp,
} from './appAuth.js';

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'x-request-id': 'auth-api-request' }),
    json: async () => body,
  };
}

it('loads QBO session state with same-origin cookie handling', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ok: true, enabled: true, authenticated: false }));
  const state = await loadAppSession();
  expect(state.authenticated).toBe(false);
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/session', expect.objectContaining({ credentials: 'same-origin' }));
});

it('sends only the entered password to the QBO login endpoint', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ok: true, authenticated: true, user: { id: 'user-1', displayName: 'Taylor' } }));
  await signInToApp('private-password');
  const options = fetchMock.mock.calls[0][1];
  expect(options.method).toBe('POST');
  expect(JSON.parse(options.body)).toEqual({ password: 'private-password' });
  expect(options.body).not.toContain('projectId');
  expect(options.body).not.toContain('reporter');
});

it('signs out without placing session values in the request body', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ ok: true, authenticated: false }));
  await signOutOfApp();
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({});
});

it('consumes Ticket Snitch return status and removes it from the browser address', () => {
  window.history.pushState(null, '', '/chat?requestId=keep-me&qboAuth=error&qboAuthCode=FLOW_FAILED&qboAuthRequestId=req-17#reply');

  expect(consumeTicketSnitchAuthReturn()).toEqual({
    result: 'error',
    code: 'FLOW_FAILED',
    requestId: 'req-17',
  });
  expect(window.location.pathname).toBe('/chat');
  expect(window.location.search).toBe('?requestId=keep-me');
  expect(window.location.hash).toBe('#reply');
  expect(consumeTicketSnitchAuthReturn()).toBeNull();
});
