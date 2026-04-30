import { apiFetchJson } from './http.js';

const LIVE_CALL_ASSIST_STREAM_PATH = '/api/live-call-assist/stream';

export function buildLiveCallAssistWebSocketUrl(path = LIVE_CALL_ASSIST_STREAM_PATH) {
  if (typeof window === 'undefined' || !window.location) return path;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

export function getLiveCallAssistStatus() {
  return apiFetchJson('/api/live-call-assist/status', {
    method: 'GET',
    noDedupe: true,
    timeout: 8_000,
  }, 'Failed to load Live Call Assist status');
}

export { LIVE_CALL_ASSIST_STREAM_PATH };
