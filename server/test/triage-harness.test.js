'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const mongo = require('./_mongo-helper');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const TriageResult = require('../src/models/TriageResult');
const {
  runTriage,
} = require('../src/services/triage');

const PARSER_TEXT = [
  'COID/MID: 12345 / 67890',
  'CASE: CS-2026-002001',
  'CLIENT/CONTACT: Example Client',
  'CX IS ATTEMPTING TO: connect a bank account',
  'EXPECTED OUTCOME: bank feed connects',
  'ACTUAL OUTCOME: bank feed connection error appears',
  'KB/TOOLS USED: Help panel',
  'TRIED TEST ACCOUNT: yes',
  'TS STEPS: cleared cache and retried in incognito',
].join('\n');

const TRIAGE_OUTPUT = [
  'Category: bank feeds',
  'Severity: P3',
  'Fast read: Bank feed connection is failing after basic browser troubleshooting.',
  'Immediate next step: Capture the bank name and exact connector error, then retry once in incognito.',
  'Missing info: bank name; exact connector error',
  'Confidence: High',
  'Category check: Bank feeds because the failure is in the bank connection workflow.',
].join('\n');

test.before(async () => {
  process.env.NODE_ENV = 'test';
  await mongo.connect();
});

test.after(async () => {
  await mongo.disconnect();
});

test.beforeEach(async () => {
  await ProviderCallPackage.deleteMany({});
  await TriageResult.deleteMany({});
});

test('runTriage builds the card from the saved ProviderCallPackage readback', async () => {
  const packageId = new mongoose.Types.ObjectId();
  let directCalled = false;
  let capturedUserPrompt = '';

  const result = await runTriage(PARSER_TEXT, {
    runId: 'triage-harness-readback',
    parseFields: {
      clientContact: 'Wrong Client',
      category: 'billing',
    },
    provider: 'lm-studio',
    model: 'local-triage-model',
    preflightProvider: async () => ({ ok: true, code: 'OK', reason: 'stub reachable' }),
    runDirectTriageProviderCall: async ({ userPrompt }) => {
      directCalled = true;
      capturedUserPrompt = userPrompt;
      await ProviderCallPackage.collection.insertOne({
        _id: packageId,
        providerId: 'lm-studio',
        providerResearchId: 'lm-studio-openai-compatible',
        providerPathType: 'lm-studio-http-nonstream',
        outcome: 'success',
        lmStudio: {
          response: {
            parsedJson: {
              choices: [{ message: { role: 'assistant', content: TRIAGE_OUTPUT } }],
            },
          },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      return {
        providerTrace: {
          providerId: 'lm-studio',
          providerPackageId: String(packageId),
          model: 'local-triage-model',
          captureEnabled: true,
        },
        fullResponse: '',
      };
    },
  });

  assert.equal(directCalled, true);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'success');
  assert.equal(result.card.category, 'bank-feeds');
  assert.equal(result.card.client, 'Example Client');
  assert.equal(result.card.severity, 'P3');
  assert.match(result.rawOutput, /Bank feed connection is failing/);
  assert.equal(result.triageMeta.source, 'agent');
  assert.equal(result.triageMeta.providerPackageId, String(packageId));
  assert.match(capturedUserPrompt, /Parsed escalation template:/);
  assert.match(capturedUserPrompt, /CLIENT\/CONTACT: Example Client/);
  assert.doesNotMatch(capturedUserPrompt, /Parsed fields JSON/);
  assert.doesNotMatch(capturedUserPrompt, /Wrong Client/);

  const savedPackage = await ProviderCallPackage.findById(packageId).lean();
  assert.ok(savedPackage);
  const savedResult = await TriageResult.findOne({ runId: 'triage-harness-readback' }).lean();
  assert.ok(savedResult);
  assert.equal(savedResult.providerPackageId, String(packageId));
  assert.equal(savedResult.status, 'success');
  assert.equal(savedResult.parseFields.clientContact, 'Example Client');
  assert.notEqual(savedResult.parseFields.category, 'billing');
});

test('runTriage builds the card from a saved Claude CLI ProviderCallPackage', async () => {
  const packageId = new mongoose.Types.ObjectId();

  const result = await runTriage(PARSER_TEXT, {
    runId: 'triage-harness-claude-cli-readback',
    provider: 'claude',
    model: 'claude-opus-4-8',
    preflightProvider: async () => ({ ok: true, code: 'OK', reason: 'stub reachable' }),
    runDirectTriageProviderCall: async () => {
      await ProviderCallPackage.collection.insertOne({
        _id: packageId,
        providerId: 'claude',
        providerResearchId: 'anthropic-cli',
        providerPathType: 'cli',
        callSite: 'triage',
        operation: 'triage',
        outcome: 'success',
        cli: {
          command: 'claude',
          args: ['-p', '--output-format', 'stream-json'],
          modelRequested: 'claude-opus-4-8',
          reasoningEffort: 'high',
          stdin: { text: 'triage prompt' },
          stdout: {
            text: '',
            lines: [],
            jsonlEvents: [
              {
                type: 'stream_event',
                event: {
                  type: 'content_block_delta',
                  delta: { type: 'text_delta', text: TRIAGE_OUTPUT },
                },
              },
            ],
            malformedLines: [],
            finalBuffer: '',
            chunks: [],
          },
          stderr: { text: '', chunks: [] },
          process: { pid: 1234, exitCode: 0, signal: null, spawned: true, closed: true, killed: false, killSignal: null },
          timeout: { timeoutMs: 120000, fired: false },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      return {
        providerTrace: {
          providerId: 'claude',
          providerResearchId: 'anthropic-cli',
          providerPackageId: String(packageId),
          model: 'claude-opus-4-8',
          captureEnabled: true,
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'success');
  assert.equal(result.card.category, 'bank-feeds');
  assert.equal(result.card.severity, 'P3');
  assert.equal(result.triageMeta.providerUsed, 'claude');
  assert.equal(result.triageMeta.providerPayload.sourcePath, 'cli.stdout.jsonlEvents[stream_event.content_block_delta.delta.text]');
});

test('runTriage preflight failure short-circuits to fallback before provider handoff', async () => {
  let directCalled = false;
  const events = [];
  const eventBus = {
    emit(kind, data) {
      events.push({ kind, data });
    },
  };

  const result = await runTriage(PARSER_TEXT, {
    runId: 'triage-harness-preflight',
    provider: 'lm-studio',
    model: 'local-triage-model',
    eventBus,
    preflightProvider: async () => ({
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
      reason: 'LM Studio is not reachable.',
    }),
    runDirectTriageProviderCall: async () => {
      directCalled = true;
      throw new Error('should not be called');
    },
  });

  assert.equal(directCalled, false);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'degraded');
  assert.equal(result.card.fallback.used, true);
  assert.equal(result.triageMeta.source, 'fallback');
  assert.equal(result.triageMeta.failureStage, 'preflight');
  assert.equal(result.triageMeta.errorCode, 'PROVIDER_UNAVAILABLE');
  assert.ok(events.some((event) => event.kind === 'triage.preflight_checked'));
  assert.equal(events.some((event) => event.kind === 'triage.agent_handoff_to_provider'), false);

  const savedResult = await TriageResult.findOne({ runId: 'triage-harness-preflight' }).lean();
  assert.ok(savedResult);
  assert.equal(savedResult.status, 'degraded');
  assert.equal(savedResult.fallbackUsed, true);
});
