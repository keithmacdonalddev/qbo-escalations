const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { logUsage, drainPendingWrites, getPendingCount, resetDrain } = require('../src/lib/usage-writer');
const UsageLog = require('../src/models/UsageLog');

let mongod;

test('usage-writer integration suite', async (t) => {
  // Start in-memory MongoDB
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);

  await t.test('logUsage persists a valid document with correct fields', async () => {
    resetDrain();
    logUsage({
      requestId: 'req-persist-1',
      attemptIndex: 0,
      service: 'chat',
      provider: 'claude',
      model: 'claude-sonnet-4-5-20250514',
      inputTokens: 1000,
      outputTokens: 500,
      usageAvailable: true,
      usageComplete: true,
      rawUsage: { input_tokens: 1000, output_tokens: 500 },
      status: 'ok',
      mode: 'single',
    });
    await drainPendingWrites(5000);
    resetDrain();

    const doc = await UsageLog.findOne({ requestId: 'req-persist-1' }).lean();
    assert.ok(doc, 'document should exist');
    assert.equal(doc.inputTokens, 1000);
    assert.equal(doc.outputTokens, 500);
    assert.equal(doc.totalTokens, 1500);
    assert.equal(doc.service, 'chat');
    assert.equal(doc.provider, 'claude');
    assert.equal(doc.model, 'claude-sonnet-4-5-20250514');
    assert.equal(doc.usageAvailable, true);
    assert.equal(doc.usageComplete, true);
    assert.equal(doc.status, 'ok');
    assert.equal(doc.mode, 'single');
    assert.equal(doc.rateFound, true);
    assert.ok(doc.totalCostNanos > 0, 'nanos should be positive');
    assert.ok(doc.totalCostMicros > 0, 'micros should be positive');
    assert.ok(doc.expiresAt instanceof Date, 'expiresAt should be set');
  });

  await t.test('dedup: first-write-wins is deterministic', async () => {
    resetDrain();
    // Write #1: ok with 1000 input tokens
    logUsage({
      requestId: 'req-dedup-1',
      attemptIndex: 0,
      service: 'chat',
      provider: 'claude',
      model: 'claude-sonnet-4-5-20250514',
      inputTokens: 1000,
      outputTokens: 500,
      usageAvailable: true,
      status: 'ok',
    });
    // Write #2: error with 200 input tokens (same dedup key)
    logUsage({
      requestId: 'req-dedup-1',
      attemptIndex: 0,
      service: 'chat',
      provider: 'claude',
      model: 'claude-sonnet-4-5-20250514',
      inputTokens: 200,
      outputTokens: 50,
      usageAvailable: true,
      status: 'error',
    });
    await drainPendingWrites(5000);
    resetDrain();

    const doc = await UsageLog.findOne({ requestId: 'req-dedup-1' }).lean();
    assert.ok(doc, 'document should exist');
    // First write should win deterministically
    assert.equal(doc.inputTokens, 1000, 'first write (1000 tokens) should win');
    assert.equal(doc.status, 'ok', 'first write status (ok) should win');
    // Only one document for this key
    const count = await UsageLog.countDocuments({ requestId: 'req-dedup-1' });
    assert.equal(count, 1, 'exactly one document per dedup key');
  });

  await t.test('dedup: repeated runs always produce same winner', async () => {
    // Run the same race pattern 10 times with different request IDs
    for (let i = 0; i < 10; i++) {
      resetDrain();
      const rid = 'req-repeat-' + i;
      logUsage({
        requestId: rid, attemptIndex: 0, service: 'chat', provider: 'claude',
        inputTokens: 999, outputTokens: 1, usageAvailable: true, status: 'ok',
      });
      logUsage({
        requestId: rid, attemptIndex: 0, service: 'chat', provider: 'claude',
        inputTokens: 1, outputTokens: 1, usageAvailable: true, status: 'error',
      });
      await drainPendingWrites(5000);
      resetDrain();

      const doc = await UsageLog.findOne({ requestId: rid }).lean();
      assert.equal(doc.inputTokens, 999, 'run ' + i + ': first write should always win');
      assert.equal(doc.status, 'ok', 'run ' + i + ': first status should always win');
    }
  });

  await t.test('invalid enum values are rejected and not persisted', async () => {
    resetDrain();
    // Invalid service
    logUsage({ requestId: 'req-bad-service', attemptIndex: 0, service: 'banana', provider: 'claude' });
    // Invalid status (should be coerced to 'ok')
    logUsage({
      requestId: 'req-bad-status', attemptIndex: 0, service: 'chat', provider: 'claude',
      inputTokens: 100, outputTokens: 50, status: 'banana', usageAvailable: true,
    });
    // Invalid mode (should be coerced to 'single')
    logUsage({
      requestId: 'req-bad-mode', attemptIndex: 0, service: 'chat', provider: 'claude',
      inputTokens: 100, outputTokens: 50, mode: 'weird', usageAvailable: true,
    });
    await drainPendingWrites(5000);
    resetDrain();

    // Invalid service should not be persisted at all
    const badService = await UsageLog.findOne({ requestId: 'req-bad-service' });
    assert.equal(badService, null, 'invalid service should not persist');

    // Invalid status should be coerced to 'error'
    const badStatus = await UsageLog.findOne({ requestId: 'req-bad-status' }).lean();
    assert.ok(badStatus, 'document should exist');
    assert.equal(badStatus.status, 'error', 'invalid status coerced to error');

    // Invalid mode should be coerced to 'single'
    const badMode = await UsageLog.findOne({ requestId: 'req-bad-mode' }).lean();
    assert.ok(badMode, 'document should exist');
    assert.equal(badMode.mode, 'single', 'invalid mode coerced to single');
  });

  await t.test('negative tokens are clamped to zero in persisted doc', async () => {
    resetDrain();
    logUsage({
      requestId: 'req-neg-tokens', attemptIndex: 0, service: 'chat', provider: 'claude',
      inputTokens: -100, outputTokens: -50, usageAvailable: true,
    });
    await drainPendingWrites(5000);
    resetDrain();

    const doc = await UsageLog.findOne({ requestId: 'req-neg-tokens' }).lean();
    assert.ok(doc);
    assert.equal(doc.inputTokens, 0, 'negative input clamped to 0');
    assert.equal(doc.outputTokens, 0, 'negative output clamped to 0');
    assert.equal(doc.totalTokens, 0, 'totalTokens should be 0');
  });

  await t.test('usageComplete is false when usageAvailable is false', async () => {
    resetDrain();
    logUsage({
      requestId: 'req-no-usage', attemptIndex: 0, service: 'chat', provider: 'claude',
      usageAvailable: false, usageComplete: true, // caller says true, but should be overridden
    });
    await drainPendingWrites(5000);
    resetDrain();

    const doc = await UsageLog.findOne({ requestId: 'req-no-usage' }).lean();
    assert.ok(doc);
    assert.equal(doc.usageAvailable, false);
    assert.equal(doc.usageComplete, false, 'usageComplete forced false when usageAvailable is false');
  });

  await t.test('usageComplete defaults to true when usageAvailable=true and field omitted', async () => {
    resetDrain();
    logUsage({
      requestId: 'req-uc-default', attemptIndex: 0, service: 'chat', provider: 'claude',
      model: 'claude-sonnet-4-5-20250514',
      inputTokens: 100, outputTokens: 50,
      usageAvailable: true,
      // usageComplete intentionally omitted — should default to true
    });
    await drainPendingWrites(5000);
    resetDrain();

    const doc = await UsageLog.findOne({ requestId: 'req-uc-default' }).lean();
    assert.ok(doc);
    assert.equal(doc.usageAvailable, true);
    assert.equal(doc.usageComplete, true, 'usageComplete should default to true when usageAvailable=true and field omitted');
  });

  await t.test('usageComplete=false is preserved when explicitly set', async () => {
    resetDrain();
    logUsage({
      requestId: 'req-uc-explicit-false', attemptIndex: 0, service: 'chat', provider: 'claude',
      model: 'claude-sonnet-4-5-20250514',
      inputTokens: 100, outputTokens: 50,
      usageAvailable: true,
      usageComplete: false, // explicit false (e.g. extra dimensions detected)
    });
    await drainPendingWrites(5000);
    resetDrain();

    const doc = await UsageLog.findOne({ requestId: 'req-uc-explicit-false' }).lean();
    assert.ok(doc);
    assert.equal(doc.usageComplete, false, 'explicit usageComplete=false must be preserved');
  });

  await t.test('nanos precision preserved for small requests', async () => {
    resetDrain();
    logUsage({
      requestId: 'req-small-nanos', attemptIndex: 0, service: 'chat',
      provider: 'chatgpt-5.3-codex-high',
      model: 'gpt-4o-mini',
      inputTokens: 1, outputTokens: 0,
      usageAvailable: true,
    });
    await drainPendingWrites(5000);
    resetDrain();

    const doc = await UsageLog.findOne({ requestId: 'req-small-nanos' }).lean();
    assert.ok(doc);
    assert.equal(doc.inputCostNanos, 150, 'nanos should be 150 (1 tok * 150 nanos)');
    assert.equal(doc.inputCostMicros, 0, 'micros rounds to 0 for 1 token');
  });

  await t.test('UsageLog schema defines required indexes', () => {
    const indexes = UsageLog.schema.indexes();
    const indexKeys = indexes.map(([fields]) => Object.keys(fields).join(','));

    // Compound unique dedup index
    assert.ok(
      indexes.some(([fields, opts]) =>
        fields.requestId === 1 && fields.attemptIndex === 1 && fields.provider === 1 && opts.unique === true
      ),
      'compound unique dedup index must exist'
    );

    // TTL index on expiresAt
    assert.ok(
      indexes.some(([fields, opts]) =>
        fields.expiresAt === 1 && opts.expireAfterSeconds === 0
      ),
      'TTL index on expiresAt must exist'
    );

    // Query indexes
    assert.ok(indexKeys.includes('createdAt'), 'createdAt index');
    assert.ok(indexKeys.includes('service,createdAt'), 'service+createdAt index');
    assert.ok(indexKeys.includes('provider,createdAt'), 'provider+createdAt index');
    assert.ok(indexKeys.includes('conversationId,createdAt'), 'conversationId+createdAt index');
  });

  await t.test('logUsage returns true for accepted writes', async () => {
    resetDrain();
    const accepted = logUsage({
      requestId: 'req-return-true', attemptIndex: 0, service: 'chat', provider: 'claude',
      inputTokens: 100, outputTokens: 50, usageAvailable: true,
    });
    assert.equal(accepted, true, 'valid write should return true');
    await drainPendingWrites(5000);
    resetDrain();
  });

  await t.test('drainPendingWrites returns structured result', async () => {
    resetDrain();
    const result = await drainPendingWrites(5000);
    assert.equal(result.flushed, true);
    assert.equal(result.remaining, 0);
    resetDrain();
  });

  // Cleanup
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await mongod.stop();
});
