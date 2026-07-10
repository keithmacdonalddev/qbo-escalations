'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const mongoose = require('mongoose');
const mongo = require('./_mongo-helper');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const TriageResult = require('../src/models/TriageResult');
const {
  extractTriageTextFromProviderPackage,
  preflightProvider,
  runDirectTriageProviderCall,
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

test('triage direct Anthropic body gates thinking + temperature by model and extraction skips thinking blocks', async () => {
  const capturedBodies = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      capturedBodies.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_triage_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-fable-5',
        // Thinking-enabled responses lead with a thinking block before the text block.
        content: [
          { type: 'thinking', thinking: 'Readable reasoning summary.' },
          { type: 'text', text: TRIAGE_OUTPUT },
        ],
        usage: { input_tokens: 12, output_tokens: 8 },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const prevUrl = process.env.ANTHROPIC_API_URL;
  const prevKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-triage-test';

  try {
    const promptTrace = { promptId: 'triage-test-prompt', promptVersion: '1' };

    // fable-5: thinking present, temperature OMITTED (sampling params 400 there).
    const fableResult = await runDirectTriageProviderCall({
      provider: 'anthropic',
      model: 'claude-fable-5',
      systemPrompt: 'Triage instructions',
      userPrompt: 'Triage this template.',
      reasoningEffort: 'xhigh',
      timeoutMs: 1000,
      promptTrace,
    });
    assert.equal(capturedBodies.length, 1);
    assert.deepEqual(capturedBodies[0].thinking, { type: 'adaptive', display: 'summarized' });
    assert.deepEqual(capturedBodies[0].output_config, { effort: 'xhigh' });
    assert.equal(capturedBodies[0].temperature, undefined);
    assert.equal(capturedBodies[0].max_tokens, 1200);

    // Extraction must skip the leading thinking block and return the text block.
    const savedPackage = await ProviderCallPackage.findById(fableResult.providerTrace.providerPackageId).lean();
    assert.ok(savedPackage, 'anthropic triage package saved');
    const payload = await extractTriageTextFromProviderPackage(savedPackage, fableResult.providerTrace);
    assert.equal(payload.text, TRIAGE_OUTPUT);
    assert.equal(payload.sourcePath, 'response.parsedJson.content[type=text].text');

    // Sonnet 5: adaptive thinking, selected effort, and no sampling parameter.
    await runDirectTriageProviderCall({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      systemPrompt: 'Triage instructions',
      userPrompt: 'Triage this template.',
      reasoningEffort: 'max',
      timeoutMs: 1000,
      promptTrace,
    });
    assert.equal(capturedBodies.length, 2);
    assert.deepEqual(capturedBodies[1].thinking, { type: 'adaptive', display: 'summarized' });
    assert.deepEqual(capturedBodies[1].output_config, { effort: 'max' });
    assert.equal(capturedBodies[1].temperature, undefined);
  } finally {
    if (prevUrl === undefined) delete process.env.ANTHROPIC_API_URL;
    else process.env.ANTHROPIC_API_URL = prevUrl;
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    await new Promise((resolve) => server.close(resolve));
  }
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

test('preflightProvider caches successful results but never caches failures', async () => {
  // Short-lived local server standing in for LM Studio: fails the FIRST
  // reachability check, succeeds afterwards, and counts every live request so
  // the test can prove whether the cache or the wire answered.
  let requestCount = 0;
  const server = http.createServer((_req, res) => {
    requestCount += 1;
    if (requestCount === 1) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const prevUrl = process.env.LM_STUDIO_API_URL;
  process.env.LM_STUDIO_API_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const failed = await preflightProvider({ provider: 'lm-studio', model: 'preflight-cache-test' });
    assert.equal(failed.ok, false);
    assert.notEqual(failed.cached, true);

    // The failure was NOT cached: the next call must hit the live server again.
    const live = await preflightProvider({ provider: 'lm-studio', model: 'preflight-cache-test' });
    assert.equal(live.ok, true);
    assert.notEqual(live.cached, true);
    assert.equal(requestCount, 2);

    // The success WAS cached: no third live request, and the result is
    // honestly marked as served from cache.
    const cached = await preflightProvider({ provider: 'lm-studio', model: 'preflight-cache-test' });
    assert.equal(cached.ok, true);
    assert.equal(cached.cached, true);
    assert.equal(requestCount, 2);
  } finally {
    if (prevUrl === undefined) delete process.env.LM_STUDIO_API_URL;
    else process.env.LM_STUDIO_API_URL = prevUrl;
    await new Promise((resolve) => server.close(resolve));
  }
});
