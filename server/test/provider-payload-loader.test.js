'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { loadProviderPayloadText } = require('../src/services/provider-payload-loader');

test('provider payload loader verifies containment, size, length, and SHA-256 before returning text', async (t) => {
  const payloadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qbo-provider-payload-'));
  t.after(() => fs.rm(payloadRoot, { recursive: true, force: true }));
  const relative = '2026-07-24/package-1/reasoning.txt';
  const fullPath = path.join(payloadRoot, ...relative.split('/'));
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  const text = '[{"text":"bounded reasoning"}]';
  await fs.writeFile(fullPath, text, 'utf8');
  const ref = {
    ref: `server/data/provider-call-packages/${relative}`,
    byteLength: Buffer.byteLength(text),
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
    encoding: 'utf8',
  };

  const loaded = await loadProviderPayloadText(ref, { payloadRoot, maxBytes: 1024 });
  assert.equal(loaded.status, 'verified');
  assert.equal(loaded.text, text);

  await assert.rejects(
    loadProviderPayloadText({ ...ref, ref: 'server/data/provider-call-packages/../../outside.txt' }, { payloadRoot }),
    (error) => error.code === 'PROVIDER_PAYLOAD_REF_INVALID' && error.payloadStatus === 'invalid-ref'
  );
  await assert.rejects(
    loadProviderPayloadText(ref, { payloadRoot, maxBytes: 4 }),
    (error) => error.code === 'PROVIDER_PAYLOAD_TOO_LARGE' && error.payloadStatus === 'too-large'
  );
  await assert.rejects(
    loadProviderPayloadText({ ...ref, byteLength: ref.byteLength + 1 }, { payloadRoot }),
    (error) => error.code === 'PROVIDER_PAYLOAD_INTEGRITY_FAILED'
  );
  await assert.rejects(
    loadProviderPayloadText({ ...ref, sha256: '0'.repeat(64) }, { payloadRoot }),
    (error) => error.code === 'PROVIDER_PAYLOAD_INTEGRITY_FAILED'
  );
  await assert.rejects(
    loadProviderPayloadText({ ...ref, ref: 'server/data/provider-call-packages/2026-07-24/package-1/missing.txt' }, { payloadRoot }),
    (error) => error.code === 'PROVIDER_PAYLOAD_MISSING' && error.payloadStatus === 'missing'
  );
});
