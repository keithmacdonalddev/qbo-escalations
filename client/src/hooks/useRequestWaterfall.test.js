import { describe, expect, it } from 'vitest';
import { requestWaterfallInternals } from './useRequestWaterfall.js';

const { isSensitiveTrackerUrl, sanitizeTrackedOptions } = requestWaterfallInternals;

describe('request waterfall credential safety', () => {
  it('never captures or replays normal provider-key request bodies', () => {
    const secret = 'normal-provider-secret';
    const result = sanitizeTrackedOptions({
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: secret }),
    }, '/api/ai-management/keys/openai');

    expect(isSensitiveTrackerUrl('/api/ai-management/keys/openai/test')).toBe(true);
    expect(result).toEqual({ body: null, canReplay: false, bodyOmitted: true, sensitive: true });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('never captures or replays spending-report credential bodies', () => {
    const secret = 'organization-admin-secret';
    const result = sanitizeTrackedOptions({ body: JSON.stringify({ key: secret }) },
      '/api/ai-management/spending/anthropic/credential');

    expect(result.canReplay).toBe(false);
    expect(result.body).toBeNull();
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('keeps safe small request bodies available for developer replay', () => {
    const body = JSON.stringify({ automaticCheckFrequency: 'weekly' });
    const result = sanitizeTrackedOptions({
      headers: { 'Content-Type': 'application/json' },
      body,
    }, '/api/ai-management/settings');

    expect(result.body).toBe(body);
    expect(result.canReplay).toBe(true);
  });
});
