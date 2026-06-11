const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');

function baseCliPackage(jsonlEvents) {
  return {
    providerId: 'codex',
    providerPathType: 'cli',
    callSite: 'triage-service',
    operation: 'triage',
    outcome: 'success',
    cli: {
      command: 'codex',
      modelRequested: 'gpt-5.1-codex',
      stdin: { text: 'prompt' },
      stdout: { text: '', jsonlEvents },
      stderr: { text: '' },
      process: {},
      timeout: {},
    },
  };
}

test('provider package reasoning route suite', async (t) => {
  let app;

  t.before(async () => {
    process.env.NODE_ENV = 'test';
    await connect();
    app = createApp();
  });

  t.after(async () => {
    await disconnect();
  });

  await t.test('extracts codex reasoning items (snapshot dedupe + summary shape)', async () => {
    const pkg = await ProviderCallPackage.create(baseCliPackage([
      { type: 'item.completed', item: { id: 'r1', type: 'reasoning', text: 'First pass' } },
      // Cumulative snapshot of the same item — only the final text should survive.
      { type: 'item.completed', item: { id: 'r1', type: 'reasoning', text: 'First pass extended' } },
      { type: 'item.completed', item: { id: 'r2', type: 'reasoning', summary: ['Summary block', { text: 'second line' }] } },
      // Non-reasoning items must be ignored.
      { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'final answer' } },
    ]));

    const res = await request(app).get(`/api/provider-packages/${pkg._id}/reasoning`);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.provider, 'codex');
    assert.equal(res.body.model, 'gpt-5.1-codex');
    assert.equal(res.body.truncated, false);
    assert.deepEqual(res.body.reasoning, [
      { text: 'First pass extended' },
      { text: 'Summary block\nsecond line' },
    ]);
  });

  await t.test('extracts claude thinking blocks from assistant snapshots', async () => {
    const doc = baseCliPackage([
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'partial thought' }] } },
      // Final snapshot supersedes the partial one (prefix family).
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'partial thought, completed' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'visible answer' }] } },
    ]);
    doc.providerId = 'claude';
    const pkg = await ProviderCallPackage.create(doc);

    const res = await request(app).get(`/api/provider-packages/${pkg._id}/reasoning`);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.provider, 'claude');
    assert.deepEqual(res.body.reasoning, [{ text: 'partial thought, completed' }]);
  });

  await t.test('returns an honest empty result when nothing was captured', async () => {
    const pkg = await ProviderCallPackage.create({
      providerId: 'lm-studio',
      providerPathType: 'http',
      callSite: 'image-parser',
      operation: 'parse',
      outcome: 'success',
    });

    const res = await request(app).get(`/api/provider-packages/${pkg._id}/reasoning`);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.reasoning, []);
  });

  await t.test('rejects a malformed package id with 400', async () => {
    const res = await request(app).get('/api/provider-packages/not-an-object-id/reasoning');
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'INVALID_PACKAGE_ID');
  });

  await t.test('returns 404 for an unknown package id', async () => {
    const res = await request(app).get('/api/provider-packages/64b000000000000000000000/reasoning');
    assert.equal(res.status, 404);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'NOT_FOUND');
  });
});
