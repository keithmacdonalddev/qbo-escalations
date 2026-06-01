'use strict';

// Regression coverage for the secret-at-rest hardening (Fix A): provider API
// keys and Gmail OAuth tokens are stored with `select: false`, so they are
// never returned by a default query (and therefore can't leak through generic
// finds, logs, or API responses). The legitimate read-sites must still be able
// to opt the secret back in via `.select('+field')`.
//
// These tests assert BOTH halves of the contract against a real in-memory
// MongoDB:
//   1. A plain find / the metadata statics omit the secret fields.
//   2. The exact `.select('+...')` opt-in used by the production read-sites
//      (gmail.js getAuth/disconnect, image-parser.js resolveApiKey/
//      getAllStoredKeys) still returns the secret values — so OAuth and
//      provider calls keep working.

const test = require('node:test');
const assert = require('node:assert/strict');

const { connect, disconnect } = require('./_mongo-helper');
const GmailAuth = require('../src/models/GmailAuth');
const ImageParserApiKey = require('../src/models/ImageParserApiKey');

test.before(async () => {
  await connect();
});

test.after(async () => {
  await disconnect();
});

test('GmailAuth tokens are select:false but opt-in-readable', async (t) => {
  await t.test('setup: insert an account', async () => {
    await GmailAuth.deleteMany({});
    await GmailAuth.create({
      email: 'tokens-test@example.com',
      accessToken: 'access-secret-123',
      refreshToken: 'refresh-secret-456',
      tokenExpiry: new Date(Date.now() + 3600000),
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
    });
  });

  await t.test('metadata static getByEmail omits the tokens', async () => {
    const doc = await GmailAuth.getByEmail('tokens-test@example.com');
    assert.ok(doc, 'account should be found');
    assert.equal(doc.email, 'tokens-test@example.com');
    assert.equal(doc.scope, 'https://www.googleapis.com/auth/gmail.readonly');
    assert.equal(doc.accessToken, undefined, 'accessToken must NOT be returned by default');
    assert.equal(doc.refreshToken, undefined, 'refreshToken must NOT be returned by default');
  });

  await t.test('metadata static getPrimary omits the tokens', async () => {
    const doc = await GmailAuth.getPrimary();
    assert.ok(doc);
    assert.equal(doc.accessToken, undefined, 'accessToken must NOT be returned by default');
    assert.equal(doc.refreshToken, undefined, 'refreshToken must NOT be returned by default');
  });

  await t.test('getAll omits the tokens for every account', async () => {
    const docs = await GmailAuth.getAll();
    assert.ok(docs.length >= 1);
    for (const doc of docs) {
      assert.equal(doc.accessToken, undefined, 'accessToken must NOT leak via getAll');
      assert.equal(doc.refreshToken, undefined, 'refreshToken must NOT leak via getAll');
    }
  });

  await t.test('explicit .select(+accessToken +refreshToken) still returns the tokens (gmail.js getAuth path)', async () => {
    // Mirrors the exact query gmail.js getAuth()/disconnect() now use.
    const stored = await GmailAuth
      .findOne({ email: 'tokens-test@example.com' })
      .select('+accessToken +refreshToken')
      .lean();
    assert.ok(stored, 'account should be found');
    assert.equal(stored.accessToken, 'access-secret-123', 'opt-in read must return accessToken');
    assert.equal(stored.refreshToken, 'refresh-secret-456', 'opt-in read must return refreshToken');
  });

  await t.test('explicit opt-in works for the primary lookup too', async () => {
    const stored = await GmailAuth
      .findOne()
      .sort({ updatedAt: -1 })
      .select('+accessToken +refreshToken')
      .lean();
    assert.ok(stored);
    assert.equal(stored.accessToken, 'access-secret-123');
    assert.equal(stored.refreshToken, 'refresh-secret-456');
  });
});

test('ImageParserApiKey key is select:false but opt-in-readable', async (t) => {
  await t.test('setup: insert a key', async () => {
    await ImageParserApiKey.deleteMany({});
    await ImageParserApiKey.create({ provider: 'anthropic', key: 'sk-secret-key-789' });
  });

  await t.test('plain findOne omits the key', async () => {
    const doc = await ImageParserApiKey.findOne({ provider: 'anthropic' }).lean();
    assert.ok(doc, 'doc should be found');
    assert.equal(doc.provider, 'anthropic');
    assert.equal(doc.key, undefined, 'key must NOT be returned by default');
  });

  await t.test('plain find({}) omits the key for every doc', async () => {
    const docs = await ImageParserApiKey.find({}).lean();
    assert.ok(docs.length >= 1);
    for (const doc of docs) {
      assert.equal(doc.key, undefined, 'key must NOT leak via find({})');
    }
  });

  await t.test('explicit .select(+key) still returns the key (resolveApiKey path)', async () => {
    const doc = await ImageParserApiKey.findOne({ provider: 'anthropic' }).select('+key').lean();
    assert.ok(doc);
    assert.equal(doc.key, 'sk-secret-key-789', 'opt-in read must return the key');
  });

  await t.test('explicit .select(+key) works for find({}) (getAllStoredKeys path)', async () => {
    const docs = await ImageParserApiKey.find({}).select('+key').lean();
    const anthropic = docs.find((d) => d.provider === 'anthropic');
    assert.ok(anthropic);
    assert.equal(anthropic.key, 'sk-secret-key-789');
  });
});
