import { describe, expect, it } from 'vitest';
import { pickLatestHealthSnapshot } from './AgentRegistryContext.jsx';

describe('pickLatestHealthSnapshot', () => {
  it('lets a newer global poll replace an older one-agent refresh', () => {
    const local = { status: 'degraded', checkedAt: '2026-08-15T18:05:00.000Z' };
    const polled = { status: 'online', checkedAt: '2026-08-15T18:06:00.000Z' };
    expect(pickLatestHealthSnapshot(polled, local)).toBe(polled);
  });

  it('keeps a newer one-agent refresh while the global poll catches up', () => {
    const local = { status: 'offline', checkedAt: '2026-08-15T18:07:00.000Z' };
    const polled = { status: 'online', checkedAt: '2026-08-15T18:06:00.000Z' };
    expect(pickLatestHealthSnapshot(polled, local)).toBe(local);
  });
});
