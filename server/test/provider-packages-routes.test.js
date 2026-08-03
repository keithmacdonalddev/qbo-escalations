const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('node:fs/promises');
const path = require('node:path');
const mongoose = require('mongoose');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const {
  externalizeProviderCallPackagePayloads,
  getDefaultPayloadRoot,
} = require('../src/services/provider-call-package-payload-store');

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

  await t.test('preserves ordered Codex reasoning snapshots and dedupes only exact event replays', async () => {
    const exactReplay = { type: 'item.completed', item: { id: 'r2', type: 'reasoning', summary: ['Summary block', { text: 'second line' }] } };
    const pkg = await ProviderCallPackage.create(baseCliPackage([
      { type: 'item.completed', item: { id: 'r1', type: 'reasoning', text: 'First pass' } },
      // A longer cumulative snapshot is distinct evidence and must survive.
      { type: 'item.completed', item: { id: 'r1', type: 'reasoning', text: 'First pass extended' } },
      exactReplay,
      // Byte-identical replay with the same stable item id is the only event removed.
      exactReplay,
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
      { text: 'First pass' },
      { text: 'First pass extended' },
      { text: 'Summary block\nsecond line' },
    ]);
    assert.equal(res.body.evidence.length, 3);
    assert.deepEqual(res.body.evidence.map((entry) => entry.sequence), [0, 1, 2]);
    assert.ok(res.body.evidence.every((entry) => entry.packageId === String(pkg._id)));
    assert.ok(res.body.evidence.every((entry) => entry.authority === 'diagnostic-only'));
    assert.equal(res.body.evidenceSummary.exactDuplicatesRemoved, 1);
    assert.equal(res.body.provenance.packageId, String(pkg._id));
    assert.equal(res.body.actualModel, '');
    assert.equal(res.body.requestedModel, 'gpt-5.1-codex');
  });

  await t.test('extracts claude thinking blocks from assistant snapshots', async () => {
    const doc = baseCliPackage([
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'partial thought' }] } },
      // A later prefix-related snapshot is a distinct transport event.
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'partial thought, completed' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'visible answer' }] } },
    ]);
    doc.providerId = 'claude';
    const pkg = await ProviderCallPackage.create(doc);

    const res = await request(app).get(`/api/provider-packages/${pkg._id}/reasoning`);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.provider, 'claude');
    assert.deepEqual(res.body.reasoning, [
      { text: 'partial thought' },
      { text: 'partial thought, completed' },
    ]);
    assert.equal(res.body.evidenceSummary.exactDuplicatesRemoved, 0);
  });

  await t.test('extracts anthropic HTTP thinking blocks from response.parsedJson', async () => {
    const pkg = await ProviderCallPackage.create({
      providerId: 'anthropic',
      providerPathType: 'direct-http',
      callSite: 'image-parser:callAnthropic',
      operation: 'image-parse',
      outcome: 'success',
      request: { modelRequested: 'claude-fable-5' },
      response: {
        parsedJson: {
          content: [
            { type: 'thinking', thinking: 'Readable reasoning summary.' },
            { type: 'text', text: 'visible answer' },
          ],
        },
      },
    });

    const res = await request(app).get(`/api/provider-packages/${pkg._id}/reasoning`);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.provider, 'anthropic');
    assert.equal(res.body.model, 'claude-fable-5');
    assert.deepEqual(res.body.reasoning, [{ text: 'Readable reasoning summary.' }]);
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

  await t.test('loads externalized labelled reasoning with provenance and a bounded display response', async () => {
    const packageId = new mongoose.Types.ObjectId();
    const capturedAt = new Date('2026-07-24T12:00:00.000Z');
    const prepared = await externalizeProviderCallPackagePayloads({
      _id: packageId,
      providerId: 'openai',
      providerPathType: 'direct-http',
      callSite: 'test:reasoning-sidecar',
      operation: 'chat',
      outcome: 'success',
      request: { modelRequested: 'gpt-5.4' },
      reasoningEvidence: [{
        sequence: 0,
        providerId: 'openai',
        model: 'gpt-5.4',
        sourcePath: 'response.parsedJson.choices[0].message.reasoning_content',
        kind: 'provider-reasoning',
        authority: 'diagnostic-only',
        text: 'r'.repeat(450_000),
      }],
      reasoningEvidenceSummary: { complete: true, truncated: false, totalChars: 450_000 },
    }, {
      packageId,
      now: capturedAt,
      maxInlineBytes: 64,
      fields: ['reasoningEvidence'],
    });

    try {
      const pkg = await ProviderCallPackage.create(prepared);
      const res = await request(app).get(`/api/provider-packages/${pkg._id}/reasoning`);
      assert.equal(res.status, 200);
      assert.equal(res.body.truncated, true);
      assert.equal(res.body.reasoning[0].text.length, 400_000);
      assert.equal(res.body.evidence[0].providerId, 'openai');
      assert.equal(res.body.evidence[0].model, 'gpt-5.4');
      assert.equal(res.body.evidence[0].authority, 'diagnostic-only');
      assert.equal(
        res.body.evidence[0].sourcePath,
        'response.parsedJson.choices[0].message.reasoning_content',
      );
      assert.equal(res.body.displayTruncation.storedEvidenceComplete, true);
      assert.equal(res.body.displayTruncation.storedEvidenceTruncated, false);
    } finally {
      await fs.rm(
        path.join(getDefaultPayloadRoot(), '2026-07-24', String(packageId)),
        { recursive: true, force: true },
      );
    }
  });

  await t.test('rejects traversal in an external reasoning payload ref', async () => {
    const pkg = await ProviderCallPackage.create({
      providerId: 'openai',
      providerPathType: 'direct-http',
      callSite: 'test:reasoning-traversal',
      operation: 'chat',
      outcome: 'success',
      request: { modelRequested: 'gpt-5.4' },
      reasoningEvidence: [],
      reasoningEvidencePayloadRef: {
        field: 'reasoningEvidence',
        kind: 'provider_reasoning_evidence',
        byteLength: 2,
        sha256: '0'.repeat(64),
        encoding: 'utf8',
        ref: 'server/data/provider-call-packages/../../outside.json',
      },
    });

    const res = await request(app).get(`/api/provider-packages/${pkg._id}/reasoning`);
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'PROVIDER_PAYLOAD_REF_INVALID');
    assert.equal(res.body.payloadStatus, 'invalid-ref');
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
