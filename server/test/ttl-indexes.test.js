'use strict';

// Regression coverage for the unbounded-log-collection fix (Fix B): the four
// previously-unbounded collections now carry an env-tunable TTL via a dedicated
// `expiresAt` field plus a `{ expiresAt: 1 }, { expireAfterSeconds: 0 }` index
// (mirroring UsageLog). This test builds the indexes against a real in-memory
// MongoDB to prove:
//   1. The TTL index actually builds (no conflict with the existing
//      { createdAt: -1 } query index — a conflicting expireAfterSeconds spec
//      would fail index creation).
//   2. New documents get a future expiresAt so MongoDB will prune them.

const test = require('node:test');
const assert = require('node:assert/strict');

const { connect, disconnect } = require('./_mongo-helper');

const MODELS = [
  { name: 'ImageParseResult', model: require('../src/models/ImageParseResult'), defaultDays: 90 },
  { name: 'ImageParserTestResult', model: require('../src/models/ImageParserTestResult'), defaultDays: 30 },
  { name: 'TriageTestResult', model: require('../src/models/TriageTestResult'), defaultDays: 30 },
  { name: 'ProviderCallPackage', model: require('../src/models/ProviderCallPackage'), defaultDays: 30 },
];

test.before(async () => {
  await connect();
});

test.after(async () => {
  await disconnect();
});

test('TTL indexes build without conflict and set expiresAt', async (t) => {
  for (const { name, model } of MODELS) {
    await t.test(`${name} builds a TTL index on expiresAt`, async () => {
      // syncIndexes builds every declared index; if the new TTL index
      // conflicted with the existing createdAt index this would throw.
      await model.syncIndexes();
      const indexes = await model.collection.indexes();
      const ttlIndex = indexes.find(
        (ix) => ix.key && ix.key.expiresAt === 1 && Object.prototype.hasOwnProperty.call(ix, 'expireAfterSeconds')
      );
      assert.ok(ttlIndex, `${name} should have a TTL index on { expiresAt: 1 }`);
      assert.equal(ttlIndex.expireAfterSeconds, 0, `${name} TTL index should use expireAfterSeconds: 0`);

      // The original createdAt query index must still exist and remain a plain
      // (non-TTL) index — we did not disturb it.
      const createdAtIndex = indexes.find((ix) => ix.key && ix.key.createdAt === -1);
      assert.ok(createdAtIndex, `${name} should still have its { createdAt: -1 } query index`);
      assert.equal(
        Object.prototype.hasOwnProperty.call(createdAtIndex, 'expireAfterSeconds'),
        false,
        `${name} createdAt index must remain a plain index, not a TTL index`
      );
    });
  }

  await t.test('new docs get a future expiresAt matching the default retention', async () => {
    for (const { name, model, defaultDays } of MODELS) {
      // Minimal valid doc per model — only required top-level fields are set.
      const seed = name === 'ProviderCallPackage'
        ? {
            schemaVersion: '0.1',
            providerId: 'anthropic',
            providerPathType: 'cli',
            callSite: 'test',
            operation: 'parse',
            outcome: 'ok',
          }
        : { provider: 'anthropic' };
      const doc = new model(seed);
      assert.ok(doc.expiresAt instanceof Date, `${name} expiresAt should be a Date`);
      const days = (doc.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      assert.ok(
        days > defaultDays - 1 && days < defaultDays + 1,
        `${name} expected ~${defaultDays} day TTL, got ${days.toFixed(2)} days`
      );
    }
  });
});
