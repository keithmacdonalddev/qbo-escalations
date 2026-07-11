'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  externalizeProviderCallPackagePayloads,
  sha256,
} = require('../src/services/provider-call-package-payload-store');

test('externalizeProviderCallPackagePayloads keeps small payloads inline', async () => {
  const envelope = {
    request: { bodyText: '{"ok":true}' },
    response: { bodyText: '{"answer":"yes"}' },
  };

  const result = await externalizeProviderCallPackagePayloads(envelope, {
    packageId: 'pkg-small',
    maxInlineBytes: 1024,
  });

  assert.equal(result.request.bodyText, '{"ok":true}');
  assert.equal(result.storage.inline, true);
  assert.deepEqual(result.storage.externalPayloads, []);
});

test('externalizeProviderCallPackagePayloads writes large payloads to sidecar storage', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-call-packages-'));
  const largeText = 'x'.repeat(64);
  const envelope = {
    request: { bodyText: largeText },
    response: { bodyText: '{"ok":true}' },
  };

  const result = await externalizeProviderCallPackagePayloads(envelope, {
    packageId: 'pkg-large',
    payloadRoot: tempRoot,
    maxInlineBytes: 16,
    now: new Date('2026-05-20T12:00:00.000Z'),
  });

  assert.equal(result.request.bodyText, null);
  assert.equal(result.storage.inline, false);
  assert.equal(result.storage.externalPayloads.length, 1);
  assert.equal(result.storage.externalPayloads[0].field, 'request.bodyText');
  assert.equal(result.storage.externalPayloads[0].byteLength, 64);
  assert.equal(result.storage.externalPayloads[0].sha256, sha256(largeText));
  assert.equal(result.storage.externalPayloads[0].ref, 'server/data/provider-call-packages/2026-05-20/pkg-large/request-bodyText.txt');

  const savedPath = path.join(tempRoot, '2026-05-20', 'pkg-large', 'request-bodyText.txt');
  assert.equal(await fs.readFile(savedPath, 'utf8'), largeText);
});

test('externalizeProviderCallPackagePayloads does not duplicate equivalent large request body JSON', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-call-packages-'));
  const bodyJson = { model: 'kimi-k2.6', image: 'x'.repeat(64) };
  const bodyText = JSON.stringify(bodyJson);
  const envelope = {
    request: {
      bodyText,
      bodyJson,
    },
  };

  const result = await externalizeProviderCallPackagePayloads(envelope, {
    packageId: 'pkg-duplicate-body',
    payloadRoot: tempRoot,
    maxInlineBytes: 16,
    now: new Date('2026-05-20T12:00:00.000Z'),
  });

  assert.equal(result.request.bodyText, null);
  assert.equal(result.request.bodyJson, null);
  assert.equal(result.storage.inline, false);
  assert.equal(result.storage.externalPayloads.length, 1);
  assert.equal(result.storage.externalPayloads[0].field, 'request.bodyText');
  assert.equal(result.request.bodyJsonPayloadRef.derivedFrom, 'request.bodyText');
  assert.equal(result.request.bodyJsonPayloadRef.ref, result.request.bodyTextPayloadRef.ref);
  assert.ok(result.storage.notes.includes('request.bodyJson omitted because it duplicates externalized request.bodyText'));

  const files = await fs.readdir(path.join(tempRoot, '2026-05-20', 'pkg-duplicate-body'));
  assert.deepEqual(files, ['request-bodyText.txt']);
});

test('externalizeProviderCallPackagePayloads externalizes response chunk text when chunks are too large', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-call-packages-'));
  const firstChunk = 'a'.repeat(12);
  const secondChunk = 'b'.repeat(12);
  const envelope = {
    response: {
      bodyChunks: [
        { seq: 0, text: firstChunk },
        { seq: 1, text: secondChunk },
      ],
    },
  };

  const result = await externalizeProviderCallPackagePayloads(envelope, {
    packageId: 'pkg-chunks',
    payloadRoot: tempRoot,
    maxInlineBytes: 16,
    now: new Date('2026-05-20T12:00:00.000Z'),
  });

  assert.equal(result.storage.inline, false);
  assert.equal(result.storage.externalPayloads.length, 2);
  assert.equal(result.response.bodyChunks[0].text, null);
  assert.equal(result.response.bodyChunks[0].textPayloadRef.kind, 'response_body_chunk');
  assert.equal(result.response.bodyChunks[1].text, null);
  assert.equal(
    await fs.readFile(path.join(tempRoot, '2026-05-20', 'pkg-chunks', 'response-bodyChunks-0-text.txt'), 'utf8'),
    firstChunk
  );
  assert.equal(
    await fs.readFile(path.join(tempRoot, '2026-05-20', 'pkg-chunks', 'response-bodyChunks-1-text.txt'), 'utf8'),
    secondChunk
  );
});
