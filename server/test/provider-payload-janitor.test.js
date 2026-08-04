'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runProviderPayloadJanitor } = require('../src/services/provider-payload-janitor');

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

test('provider payload janitor removes expired and orphaned package directories only', async () => {
  const payloadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qbo-provider-payload-janitor-'));
  const now = new Date('2026-08-03T12:00:00.000Z');
  const dateFolder = '2026-08-02';
  const ids = {
    active: '111111111111111111111111',
    expired: '222222222222222222222222',
    orphan: '333333333333333333333333',
    freshOrphan: '444444444444444444444444',
  };

  try {
    for (const id of Object.values(ids)) {
      const directory = path.join(payloadRoot, dateFolder, id);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'payload.txt'), id, 'utf8');
    }
    const oldTime = new Date(now.getTime() - 60 * 60 * 1000);
    await fs.utimes(path.join(payloadRoot, dateFolder, ids.orphan), oldTime, oldTime);

    const documents = [
      { _id: ids.active, expiresAt: new Date(now.getTime() + 60_000) },
      { _id: ids.expired, expiresAt: new Date(now.getTime() - 60_000) },
    ];
    const model = {
      find() {
        return {
          select() { return this; },
          async lean() { return documents; },
        };
      },
    };

    const result = await runProviderPayloadJanitor({ payloadRoot, now, model });

    assert.equal(result.checked, 4);
    assert.deepEqual(result.removedPackageIds.sort(), [ids.expired, ids.orphan].sort());
    assert.equal(await exists(path.join(payloadRoot, dateFolder, ids.active)), true);
    assert.equal(await exists(path.join(payloadRoot, dateFolder, ids.freshOrphan)), true);
    assert.equal(await exists(path.join(payloadRoot, dateFolder, ids.expired)), false);
    assert.equal(await exists(path.join(payloadRoot, dateFolder, ids.orphan)), false);
  } finally {
    await fs.rm(payloadRoot, { recursive: true, force: true });
  }
});
