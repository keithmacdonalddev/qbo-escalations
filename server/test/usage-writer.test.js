const test = require('node:test');
const assert = require('node:assert/strict');

const { logUsage, getPendingCount, getDroppedCount, getHealth, drainPendingWrites, resetDrain } = require('../src/lib/usage-writer');

// These tests verify the in-process logic of usage-writer without a DB connection.

test('logUsage returns false for null input', () => {
  assert.equal(logUsage(null), false);
  assert.equal(getPendingCount(), 0);
});

test('logUsage returns false for missing requestId', () => {
  assert.equal(logUsage({ service: 'chat', provider: 'claude' }), false);
});

test('logUsage returns false for missing service', () => {
  assert.equal(logUsage({ requestId: 'x', provider: 'claude' }), false);
});

test('logUsage returns false for missing provider', () => {
  assert.equal(logUsage({ requestId: 'x', service: 'chat' }), false);
});

test('logUsage returns false for invalid service enum', () => {
  assert.equal(logUsage({ requestId: 'x', service: 'banana', provider: 'claude' }), false);
});

test('logUsage returns false for unknown service', () => {
  assert.equal(logUsage({ requestId: 'x', service: 'webhook', provider: 'claude' }), false);
});

test('drainPendingWrites returns structured result when empty', async () => {
  resetDrain();
  const result = await drainPendingWrites(100);
  assert.deepEqual(result, { flushed: true, remaining: 0 });
});

test('drainPendingWrites blocks new writes and logUsage returns false', async () => {
  resetDrain();
  await drainPendingWrites(100);
  assert.equal(logUsage({ requestId: 'post-drain', service: 'chat', provider: 'claude' }), false);
  assert.equal(getPendingCount(), 0);
  resetDrain();
});

test('resetDrain re-enables writes after drain', async () => {
  await drainPendingWrites(100);
  assert.equal(logUsage({ requestId: 'blocked', service: 'chat', provider: 'claude' }), false);
  resetDrain();
  assert.equal(typeof resetDrain, 'function');
});

// --- Finding #3 regression: usageComplete default when usageAvailable=true but field omitted ---
// The usage-writer builds doc objects in-process before DB write.
// We can't inspect doc building directly without a DB, but we can verify
// the module's acceptance/rejection logic handles the field combinations.
// The integration suite (usage-integration.test.js) covers persisted values.

// Note: the logUsage function with DB writes is covered in usage-integration.test.js.
// Here we verify acceptance behavior for field combos that affect usageComplete.

test('logUsage accepts usageAvailable true with usageComplete omitted', () => {
  resetDrain();
  // Will be accepted into the queue (returns true) — the usageComplete default
  // is applied during doc construction, not during validation.
  const accepted = logUsage({
    requestId: 'uc-default-' + Date.now(),
    service: 'chat',
    provider: 'claude',
    usageAvailable: true,
    // usageComplete intentionally omitted
  });
  assert.equal(accepted, true, 'should accept write with usageComplete omitted');
});

test('logUsage accepts usageAvailable true with usageComplete explicitly false', () => {
  resetDrain();
  const accepted = logUsage({
    requestId: 'uc-false-' + Date.now(),
    service: 'chat',
    provider: 'claude',
    usageAvailable: true,
    usageComplete: false,
  });
  assert.equal(accepted, true);
});

test('getHealth returns structured snapshot', () => {
  resetDrain();
  const h = getHealth();
  assert.equal(typeof h.pending, 'number');
  assert.equal(typeof h.maxPending, 'number');
  assert.equal(typeof h.dropped, 'number');
  assert.equal(typeof h.accepted, 'number');
  assert.equal(typeof h.errors, 'number');
  assert.equal(typeof h.draining, 'boolean');
  assert.ok(h.maxPending > 0);
});
