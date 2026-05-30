'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const mongo = require('./_mongo-helper');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const {
  checkProviderPackageStoreHealth,
} = require('../src/services/image-parser');

test.before(async () => {
  await mongo.connect();
});

test.after(async () => {
  await ProviderCallPackage.deleteMany({ providerId: 'health-check' }).catch(() => {});
  await mongo.disconnect();
});

test.beforeEach(async () => {
  await ProviderCallPackage.deleteMany({ providerId: 'health-check' });
});

test.afterEach(async () => {
  await ProviderCallPackage.deleteMany({ providerId: 'health-check' }).catch(() => {});
});

test('checkProviderPackageStoreHealth confirms package store is writable and readable', async () => {
  const result = await checkProviderPackageStoreHealth();

  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.equal(result.code, 'OK');
  assert.match(result.reason, /writable and readable/i);
  assert.equal(typeof result.latencyMs, 'number');

  const healthDocs = await ProviderCallPackage.countDocuments({ providerId: 'health-check' });
  assert.equal(healthDocs, 0);
});

test('checkProviderPackageStoreHealth reports readback failure', async () => {
  const originalExists = ProviderCallPackage.exists;
  ProviderCallPackage.exists = async function missingHealthReadback() {
    return null;
  };

  try {
    const result = await checkProviderPackageStoreHealth();
    assert.equal(result.ok, false);
    assert.equal(result.available, false);
    assert.equal(result.code, 'PROVIDER_PACKAGE_READBACK_FAILED');
    assert.match(result.reason, /written but not readable/i);
  } finally {
    ProviderCallPackage.exists = originalExists;
  }
});
