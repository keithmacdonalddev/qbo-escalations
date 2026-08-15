import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetchJson } from './http.js';
import { getQuestradeConnection, selectQuestradeDevScenario } from './investments.js';

vi.mock('./http.js', () => ({ apiFetchJson: vi.fn() }));

describe('investments API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses only the Investments API namespace', async () => {
    apiFetchJson.mockResolvedValue({ ok: true });
    await getQuestradeConnection();
    await selectQuestradeDevScenario('healthy-margin');

    expect(apiFetchJson.mock.calls[0][0]).toBe('/api/investments/providers/questrade/connection');
    expect(apiFetchJson.mock.calls[1][0]).toBe('/api/investments/providers/questrade/dev-scenario');
    expect(JSON.parse(apiFetchJson.mock.calls[1][1].body)).toEqual({ scenario: 'healthy-margin' });
    expect(apiFetchJson.mock.calls[1][1].noRetry).toBe(true);
  });
});
