import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetchJson } from './http.js';
import {
  connectQuestrade,
  disconnectQuestrade,
  forgetLocalQuestradeConnection,
  getQuestradeConnection,
  reauthorizeQuestrade,
  retryQuestradeRevocation,
  retryQuestradeVerification,
  selectQuestradeDevScenario,
} from './investments.js';

vi.mock('./http.js', () => ({ apiFetchJson: vi.fn() }));

describe('investments API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses only the Investments API namespace', async () => {
    apiFetchJson.mockResolvedValue({ ok: true });
    await getQuestradeConnection();
    await getQuestradeConnection({ simulated: true });
    await selectQuestradeDevScenario('healthy-margin');

    expect(apiFetchJson.mock.calls[0][0]).toBe('/api/investments/providers/questrade/connection');
    expect(apiFetchJson.mock.calls[1][0]).toBe('/api/investments/providers/questrade/dev-connection');
    expect(apiFetchJson.mock.calls[2][0]).toBe('/api/investments/providers/questrade/dev-scenario');
    expect(JSON.parse(apiFetchJson.mock.calls[2][1].body)).toEqual({ scenario: 'healthy-margin' });
    expect(apiFetchJson.mock.calls[2][1].noRetry).toBe(true);
  });

  it('uses a one-time intent before sending a token to the local Investments route', async () => {
    apiFetchJson
      .mockResolvedValueOnce({ ok: true, intent: 'one-time-intent' })
      .mockResolvedValueOnce({ ok: true, state: 'connected' });

    await connectQuestrade('manual-token-canary');

    expect(apiFetchJson.mock.calls[0][0]).toBe('/api/investments/providers/questrade/action-intents');
    expect(JSON.parse(apiFetchJson.mock.calls[0][1].body)).toEqual({ action: 'connect' });
    expect(apiFetchJson.mock.calls[1][0]).toBe('/api/investments/providers/questrade/connect');
    expect(JSON.parse(apiFetchJson.mock.calls[1][1].body)).toEqual({
      intent: 'one-time-intent',
      refreshToken: 'manual-token-canary',
    });
    expect(apiFetchJson.mock.calls[1][1].noRetry).toBe(true);
  });

  it('uses matching one-time intents for every Stage 2 recovery action', async () => {
    apiFetchJson.mockImplementation(async (url) => (
      url.endsWith('/action-intents') ? { ok: true, intent: `intent-${apiFetchJson.mock.calls.length}` } : { ok: true }
    ));

    await reauthorizeQuestrade('renewal-token-canary');
    await retryQuestradeVerification();
    await disconnectQuestrade();
    await retryQuestradeRevocation();
    await forgetLocalQuestradeConnection();

    const intentActions = apiFetchJson.mock.calls
      .filter(([url]) => url.endsWith('/action-intents'))
      .map(([, options]) => JSON.parse(options.body).action);
    expect(intentActions).toEqual([
      'reauthorize',
      'retry-verification',
      'disconnect',
      'retry-revocation',
      'forget-local',
    ]);

    const mutations = apiFetchJson.mock.calls.filter(([url]) => !url.endsWith('/action-intents'));
    expect(mutations.map(([url]) => url.split('/').at(-1))).toEqual([
      'reauthorize',
      'retry-verification',
      'disconnect',
      'retry-revocation',
      'forget-local',
    ]);
    expect(JSON.parse(mutations.at(-1)[1].body).confirm).toBe('FORGET_LOCAL_QUESTRADE');
    expect(mutations.every(([, options]) => options.noRetry === true)).toBe(true);
  });
});
