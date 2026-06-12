'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Writable } = require('stream');
const childProcess = require('child_process');

const mongo = require('./_mongo-helper');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const {
  __waitForProviderPackageRecorderSettled,
  buildCliProviderCallPackage,
  recordCliProviderCallPackage,
} = require('../src/services/provider-call-package-recorder');
const {
  requireProviderPackageCapture,
} = require('../src/services/providers/provider-handoff');
const { redactProviderCallPackage } = require('../src/services/provider-call-package-redaction');

const originalSpawn = childProcess.spawn;
const originalEnv = {
  ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE: process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE,
};

function restoreEnv() {
  if (originalEnv.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE === undefined) {
    delete process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
  } else {
    process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = originalEnv.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
  }
}

function requireFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

function createFakeChild() {
  const child = new EventEmitter();
  const stdinChunks = [];
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      stdinChunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      callback();
    },
  });
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 4242;
  child.killSignal = null;
  child.killed = false;
  child.kill = (signal = 'SIGTERM') => {
    child.killed = true;
    child.killSignal = signal;
    return true;
  };
  child.getStdinText = () => stdinChunks.join('');
  return child;
}

function installSpawnMock() {
  const calls = [];
  childProcess.spawn = (command, args, options) => {
    const child = createFakeChild();
    calls.push({ command, args, options, child });
    return child;
  };
  return calls;
}

function emitStdoutLines(child, lines, trailingNewline = true) {
  const suffix = trailingNewline ? '\n' : '';
  child.stdout.emit('data', Buffer.from(lines.join('\n') + suffix));
}

function closeChild(child, code = 0, signal = null) {
  child.emit('close', code, signal);
}

test.before(async () => {
  await mongo.connect();
});

test.after(async () => {
  childProcess.spawn = originalSpawn;
  restoreEnv();
  await mongo.disconnect();
});

test.beforeEach(async () => {
  childProcess.spawn = originalSpawn;
  restoreEnv();
  await ProviderCallPackage.deleteMany({});
});

test.afterEach(async () => {
  childProcess.spawn = originalSpawn;
  restoreEnv();
  await __waitForProviderPackageRecorderSettled();
  await ProviderCallPackage.deleteMany({}).catch(() => {});
});

test('buildCliProviderCallPackage builds the Codex CLI provider package shape', () => {
  const envelope = buildCliProviderCallPackage({
    captureContext: {
      providerId: 'codex',
      providerResearchId: 'openai-cli',
      providerPathType: 'cli',
      callSite: 'codex:transcribeImage',
      operation: 'image-transcribe',
      modelRequested: 'gpt-5.5',
      reasoningEffort: 'high',
    },
    command: 'codex',
    args: ['exec', '--json', '-'],
    stdinText: 'Transcribe this image',
    stdoutText: '{"type":"usage","prompt_tokens":1,"completion_tokens":2}\n',
    stdoutLines: ['{"type":"usage","prompt_tokens":1,"completion_tokens":2}'],
    stdoutJsonlEvents: [{ type: 'usage', prompt_tokens: 1, completion_tokens: 2 }],
    stderrText: '',
    exitCode: 0,
    closed: true,
    requestStartedAt: '2026-05-20T12:00:00.000Z',
    responseCompletedAt: '2026-05-20T12:00:01.000Z',
    expectsJsonl: true,
  });

  assert.equal(envelope.captureVersion, 'provider-harness-cli-v0.2');
  assert.equal(envelope.providerId, 'codex');
  assert.equal(envelope.providerResearchId, 'openai-cli');
  assert.equal(envelope.providerPathType, 'cli');
  assert.equal(envelope.callSite, 'codex:transcribeImage');
  assert.equal(envelope.operation, 'image-transcribe');
  assert.equal(envelope.request, null);
  assert.equal(envelope.response, null);
  assert.equal(envelope.cli.command, 'codex');
  assert.deepEqual(envelope.cli.args, ['exec', '--json', '-']);
  assert.equal(envelope.cli.stdin.text, 'Transcribe this image');
  assert.equal(envelope.cli.stdout.lines.length, 1);
  assert.equal(envelope.cli.stdout.jsonlEvents[0].type, 'usage');
  assert.equal(envelope.cli.process.exitCode, 0);
  assert.equal(envelope.outcome, 'success');
});

test('buildCliProviderCallPackage classifies timeout, process error, and invalid JSONL', () => {
  const base = {
    providerId: 'codex',
    providerPathType: 'cli',
    callSite: 'codex:test',
    operation: 'image-transcribe',
    command: 'codex',
    expectsJsonl: true,
  };

  assert.equal(buildCliProviderCallPackage({
    ...base,
    timeout: { fired: true, timeoutMs: 5 },
    error: Object.assign(new Error('timed out'), { code: 'TIMEOUT' }),
  }).outcome, 'timeout');

  assert.equal(buildCliProviderCallPackage({
    ...base,
    stdoutJsonlEvents: [{ type: 'usage' }],
    exitCode: 1,
  }).outcome, 'process_error');

  assert.equal(buildCliProviderCallPackage({
    ...base,
    stdoutJsonlEvents: [],
    exitCode: 0,
  }).outcome, 'invalid_jsonl');
});

test('redactProviderCallPackage redacts CLI secret-like text without dropping prompt text', () => {
  const redacted = redactProviderCallPackage(buildCliProviderCallPackage({
    providerId: 'codex',
    providerPathType: 'cli',
    callSite: 'codex:test',
    operation: 'image-transcribe',
    command: 'codex',
    args: ['exec', '--token=sk-secretsecretsecret'],
    stdinText: 'Customer case text OPENAI_API_KEY=sk-testsecretsecret',
    stdoutText: '{"apiKey":"plain-output-secret","answer":"keep answer"}\n',
    stdoutLines: ['{"apiKey":"plain-output-secret","answer":"keep answer"}'],
    stdoutJsonlEvents: [{ apiKey: 'plain-output-secret', answer: 'keep answer' }],
    stderrText: 'Bearer sk-stderrsecretsecret',
    exitCode: 0,
  }));

  assert.equal(redacted.cli.stdin.text.includes('sk-testsecretsecret'), false);
  assert.equal(redacted.cli.stdin.text.includes('Customer case text'), true);
  assert.equal(redacted.cli.args[1].includes('sk-secretsecretsecret'), false);
  assert.equal(redacted.cli.stdout.text.includes('plain-output-secret'), false);
  assert.equal(redacted.cli.stdout.lines[0].includes('plain-output-secret'), false);
  assert.equal(redacted.cli.stdout.jsonlEvents[0].apiKey, '[REDACTED]');
  assert.equal(redacted.cli.stderr.text.includes('sk-stderrsecretsecret'), false);
  assert.ok(redacted.redaction.redactedBodyPaths.some((entry) => entry.startsWith('cli.')));
});

test('recordCliProviderCallPackage persists CLI package when enabled', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const result = await recordCliProviderCallPackage({
    providerId: 'codex',
    providerResearchId: 'openai-cli',
    providerPathType: 'cli',
    callSite: 'codex:test',
    operation: 'image-transcribe',
    command: 'codex',
    args: ['exec', '--json', '-'],
    stdinText: 'prompt',
    stdoutText: '{"item":{"type":"agent_message","text":"hello"}}\n',
    stdoutLines: ['{"item":{"type":"agent_message","text":"hello"}}'],
    stdoutJsonlEvents: [{ item: { type: 'agent_message', text: 'hello' } }],
    stderrText: '',
    exitCode: 0,
    closed: true,
    expectsJsonl: true,
  }, { log: false });

  assert.equal(result.ok, true);
  const saved = await ProviderCallPackage.findById(result.id).lean();
  assert.equal(saved.providerId, 'codex');
  assert.equal(saved.captureVersion, 'provider-harness-cli-v0.2');
  assert.equal(saved.cli.command, 'codex');
  assert.equal(saved.cli.stdout.jsonlEvents[0].item.text, 'hello');
  assert.equal(saved.outcome, 'success');
});

test('ProviderCallPackage enforces the Codex CLI package shape', async () => {
  await assert.rejects(
    ProviderCallPackage.create({
      schemaVersion: '0.1',
      captureVersion: 'provider-harness-cli-v0.2',
      providerId: 'codex',
      providerResearchId: 'openai-cli',
      providerPathType: 'cli',
      callSite: 'codex:transcribeImage',
      operation: 'image-transcribe',
      source: {
        file: 'server/src/services/codex.js',
        functionName: 'transcribeImage',
        spawnSite: 'codex.transcribeImage',
      },
      request: null,
      response: null,
      cli: {
        command: 'codex',
        args: ['exec', '--json', '-'],
        stdin: { text: 'prompt', byteLength: 6, sha256: 'abc' },
        stdout: { text: '', byteLength: 0, sha256: null },
        stderr: { text: '', byteLength: 0, sha256: null },
        process: { spawned: true, closed: true, exitCode: 0 },
        timeout: { timeoutMs: 1000, fired: false },
        unexpectedProviderField: 'must not be accepted',
      },
      timing: {
        requestStartedAt: '2026-05-20T12:00:00.000Z',
        responseCompletedAt: '2026-05-20T12:00:01.000Z',
        durationMs: 1000,
      },
      outcome: 'success',
      error: null,
      redaction: { applied: false, redactedHeaderNames: [], redactedBodyPaths: [], notes: [] },
      storage: { inline: true, externalPayloads: [], notes: [], truncated: false, truncationReason: null },
    }),
    /unexpectedProviderField/
  );
});

test('codex transcribeImage writes one background CLI package record on success', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const spawnCalls = installSpawnMock();
  const codex = requireFresh('../src/services/codex');

  const promise = codex.transcribeImage('data:image/png;base64,aGVsbG8=', {
    model: 'gpt-5.5',
    reasoningEffort: 'high',
    timeoutMs: 1000,
  });

  assert.equal(spawnCalls.length, 1);
  const { child } = spawnCalls[0];
  emitStdoutLines(child, [
    JSON.stringify({ item: { type: 'agent_message', id: 'a1', text: 'VISIBLE TEXT' } }),
    JSON.stringify({ type: 'usage', prompt_tokens: 10, completion_tokens: 5, model: 'gpt-5.5' }),
  ]);
  closeChild(child, 0);

  const result = await promise;
  assert.deepEqual(result, {
    text: 'VISIBLE TEXT',
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      model: 'gpt-5.5',
      rawUsage: {
        type: 'usage',
        prompt_tokens: 10,
        completion_tokens: 5,
        model: 'gpt-5.5',
      },
      usageComplete: true,
    },
  });

  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'codex:transcribeImage' }).lean();
  assert.ok(saved, 'expected a provider call package record');
  assert.equal(saved.providerId, 'codex');
  assert.equal(saved.providerResearchId, 'openai-cli');
  assert.equal(saved.providerPathType, 'cli');
  assert.equal(saved.operation, 'image-transcribe');
  assert.equal(saved.cli.command, 'codex');
  assert.equal(saved.cli.modelRequested, 'gpt-5.5');
  assert.equal(saved.cli.reasoningEffort, 'high');
  assert.equal(saved.cli.stdin.text, child.getStdinText());
  assert.equal(saved.cli.stdout.text.includes('VISIBLE TEXT'), true);
  assert.equal(saved.cli.stdout.lines.length, 2);
  assert.equal(saved.cli.stdout.jsonlEvents.length, 2);
  assert.equal(saved.cli.stdout.chunks.length, 1);
  assert.equal(saved.cli.stderr.text, '');
  assert.equal(saved.cli.process.exitCode, 0);
  assert.equal(saved.cli.process.closed, true);
  assert.equal(saved.outcome, 'success');
});

test('codex transcribeImage returns normally and writes no record when capture is disabled', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'false';
  const spawnCalls = installSpawnMock();
  const codex = requireFresh('../src/services/codex');

  const promise = codex.transcribeImage('data:image/png;base64,aGVsbG8=', { timeoutMs: 1000 });
  const { child } = spawnCalls[0];
  emitStdoutLines(child, [
    JSON.stringify({ item: { type: 'agent_message', id: 'a1', text: 'NO CAPTURE TEXT' } }),
  ]);
  closeChild(child, 0);

  const result = await promise;
  await __waitForProviderPackageRecorderSettled();
  assert.equal(result.text, 'NO CAPTURE TEXT');
  assert.equal(await ProviderCallPackage.countDocuments({}), 0);
});

test('codex chat honors caller-supplied capture context and force-captures the CLI package', async () => {
  delete process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
  const spawnCalls = installSpawnMock();
  const codex = requireFresh('../src/services/codex');
  let donePayload = null;
  const providerEvents = [];

  const done = new Promise((resolve, reject) => {
    codex.chat({
      messages: [{ role: 'user', content: 'Read the image.' }],
      systemPrompt: 'Parser instructions',
      images: ['data:image/png;base64,aGVsbG8='],
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      timeoutMs: 1000,
      captureContext: {
        providerId: 'gpt-5.5',
        providerResearchId: 'openai-cli',
        providerPathType: 'cli',
        callSite: 'image-parser:callCodex',
        operation: 'image-parse',
        forceCapture: true,
        source: {
          file: 'server/src/services/image-parser.js',
          functionName: 'callCodex',
          helperName: 'codex.chat',
          spawnSite: 'codex.chat',
        },
      },
      onProviderEvent(eventType, payload) {
        providerEvents.push({ eventType, payload });
      },
      onChunk() {},
      onThinkingChunk() {},
      onDone(text, usage, providerTrace) {
        donePayload = { text, usage, providerTrace };
        resolve();
      },
      onError: reject,
    });
  });

  assert.equal(spawnCalls.length, 1);
  const { child, args } = spawnCalls[0];
  assert.ok(args.includes('--image'));
  emitStdoutLines(child, [
    JSON.stringify({ item: { type: 'reasoning', id: 'r1', text: 'Thinking trace' } }),
    JSON.stringify({ item: { type: 'agent_message', id: 'a1', text: 'COID/MID: 123' } }),
    JSON.stringify({ type: 'usage', prompt_tokens: 20, completion_tokens: 10, model: 'gpt-5.5' }),
  ]);
  closeChild(child, 0);

  await done;
  assert.equal(donePayload.text, 'COID/MID: 123');
  assert.equal(donePayload.usage.inputTokens, 20);
  assert.equal(donePayload.providerTrace.providerHarness, 'openai-cli');
  assert.equal(donePayload.providerTrace.providerPackageId.length, 24);
  assert.equal(donePayload.providerTrace.packageCaptureQueued, true);
  assert.equal(donePayload.providerTrace.packageCaptureStatus, 'queued');
  assert.equal(typeof donePayload.providerTrace.packageCapturePromise?.then, 'function');

  await requireProviderPackageCapture({
    providerTrace: donePayload.providerTrace,
    onProviderEvent(eventType, payload) {
      providerEvents.push({ eventType, payload });
    },
    providerId: donePayload.providerTrace.providerId,
    providerHarness: donePayload.providerTrace.providerHarness,
  });
  assert.equal(donePayload.providerTrace.packageCaptureStatus, 'saved');
  assert.equal(donePayload.providerTrace.packageReadbackStatus, 'confirmed');

  const saved = await ProviderCallPackage.findOne({ callSite: 'image-parser:callCodex' }).lean();
  assert.ok(saved, 'expected a provider call package record');
  assert.equal(donePayload.providerTrace.providerPackageId, String(saved._id));
  assert.equal(saved.providerId, 'gpt-5.5');
  assert.equal(saved.providerResearchId, 'openai-cli');
  assert.equal(saved.providerPathType, 'cli');
  assert.equal(saved.operation, 'image-parse');
  assert.equal(saved.cli.command, 'codex');
  assert.equal(saved.cli.modelRequested, 'gpt-5.5');
  assert.equal(saved.cli.reasoningEffort, 'high');
  assert.equal(saved.cli.stdin.text, child.getStdinText());
  assert.equal(saved.cli.stdout.lines.length, 3);
  assert.equal(saved.cli.stdout.jsonlEvents.length, 3);
  assert.equal(saved.cli.process.exitCode, 0);
  assert.equal(saved.cli.process.closed, true);
  assert.equal(saved.outcome, 'success');
  assert.equal(providerEvents.some((event) => event.eventType === 'provider.package_capture_started'), true);
  assert.equal(providerEvents.some((event) => event.eventType === 'provider.package_capture_saved'), true);
  assert.equal(providerEvents.some((event) => event.eventType === 'provider.package_capture_wait_started'), true);
  assert.equal(providerEvents.some((event) => event.eventType === 'provider.package_capture_read_confirmed'), true);
  assert.equal(providerEvents.some((event) => event.eventType === 'provider.package_capture_confirmed'), true);
});

test('claude CLI harness force-captures the CLI package and confirms readback', async () => {
  delete process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
  const spawnCalls = installSpawnMock();
  const { sendClaudeCliPrompt } = requireFresh('../src/services/providers/claude-cli-provider-harness');
  const providerEvents = [];

  const promise = sendClaudeCliPrompt({
    systemPrompt: 'Triage instructions',
    messages: [{ role: 'user', content: 'Triage this canonical template.' }],
    model: 'claude-opus-4-8',
    reasoningEffort: 'high',
    timeoutMs: 1000,
    captureContext: {
      providerId: 'claude',
      providerResearchId: 'anthropic-cli',
      providerPathType: 'cli',
      callSite: 'triage',
      operation: 'triage',
      forceCapture: true,
      source: {
        file: 'server/src/services/triage.js',
        functionName: 'runDirectTriageProviderCall',
        helperName: 'sendClaudeCliPrompt',
        spawnSite: 'claude-cli-provider-harness.sendClaudeCliPrompt',
      },
    },
    onProviderEvent(eventType, payload) {
      providerEvents.push({ eventType, payload });
    },
  });

  assert.equal(spawnCalls.length, 1);
  const { child, args } = spawnCalls[0];
  assert.equal(args[0], '-p');
  assert.ok(args.includes('--output-format'));
  assert.ok(args.includes('stream-json'));
  assert.ok(args.includes('--model'));
  assert.ok(args.includes('claude-opus-4-8'));
  // Regression: hidden CLI flag that opts thinking into readable summaries must stay in the argv.
  assert.equal(args[args.indexOf('--thinking-display') + 1], 'summarized');
  emitStdoutLines(child, [
    JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Category: bank feeds\n' } },
    }),
    JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Severity: P3\n' } },
    }),
    JSON.stringify({
      type: 'result',
      result: 'Category: bank feeds\nSeverity: P3\n',
      model: 'claude-opus-4-8',
      usage: { input_tokens: 11, output_tokens: 7 },
    }),
  ]);
  closeChild(child, 0);

  const result = await promise;
  assert.equal(result.providerTrace.providerHarness, 'claude-cli');
  assert.equal(result.providerTrace.providerPackageId.length, 24);
  assert.equal(result.providerTrace.packageCaptureStatus, 'saved');
  assert.equal(result.providerTrace.packageReadbackStatus, 'confirmed');
  assert.ok(providerEvents.some((event) => event.eventType === 'provider.package_capture_confirmed'));

  const saved = await ProviderCallPackage.findOne({ callSite: 'triage' }).lean();
  assert.ok(saved, 'expected a Claude CLI provider call package record');
  assert.equal(saved.providerId, 'claude');
  assert.equal(saved.providerResearchId, 'anthropic-cli');
  assert.equal(saved.providerPathType, 'cli');
  assert.equal(saved.operation, 'triage');
  assert.equal(saved.cli.command, 'claude');
  assert.equal(saved.cli.modelRequested, 'claude-opus-4-8');
  assert.equal(saved.cli.reasoningEffort, 'high');
  assert.equal(saved.cli.stdin.text, child.getStdinText());
  assert.equal(saved.cli.stdout.jsonlEvents.length, 3);
});

test('codex chat records cleanup as an aborted CLI package', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const spawnCalls = installSpawnMock();
  const codex = requireFresh('../src/services/codex');

  const cleanup = codex.chat({
    messages: [{ role: 'user', content: 'hello' }],
    model: 'gpt-5.5',
    reasoningEffort: 'high',
    timeoutMs: 1000,
    onChunk() {},
    onDone() {},
    onError() {},
  });

  const { child } = spawnCalls[0];
  emitStdoutLines(child, [
    JSON.stringify({ item: { type: 'agent_message', id: 'a1', text: 'partial' } }),
  ]);
  const abortData = cleanup();
  closeChild(child, null, 'SIGTERM');

  assert.equal(abortData.partialResponse, 'partial');
  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'codex:chat' }).lean();
  assert.ok(saved, 'expected aborted chat package');
  assert.equal(saved.outcome, 'aborted');
  assert.equal(saved.cli.process.killed, true);
  assert.equal(saved.cli.process.killSignal, 'SIGTERM');
  assert.equal(saved.cli.process.closed, true);
  assert.equal(saved.cli.process.signal, 'SIGTERM');
  assert.equal(saved.error.code, 'ABORT_ERR');
});

test('codex parseEscalation writes one background CLI package record on success', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const spawnCalls = installSpawnMock();
  const codex = requireFresh('../src/services/codex');

  const promise = codex.parseEscalation('CASE: CS-CODEX-001', {
    model: 'gpt-5.5',
    reasoningEffort: 'high',
    timeoutMs: 1000,
  });

  const { child } = spawnCalls[0];
  emitStdoutLines(child, [
    JSON.stringify({
      item: {
        type: 'agent_message',
        id: 'a1',
        text: '{"category":"general","caseNumber":"CS-CODEX-001","triedTestAccount":"unknown"}',
      },
    }),
    JSON.stringify({ type: 'usage', prompt_tokens: 30, completion_tokens: 15, model: 'gpt-5.5' }),
  ]);
  closeChild(child, 0);

  const result = await promise;
  assert.equal(result.fields.caseNumber, 'CS-CODEX-001');
  assert.equal(result.usage.inputTokens, 30);

  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'codex:parseEscalation' }).lean();
  assert.ok(saved, 'expected parseEscalation provider package');
  assert.equal(saved.providerId, 'codex');
  assert.equal(saved.providerResearchId, 'openai-cli');
  assert.equal(saved.providerPathType, 'cli');
  assert.equal(saved.operation, 'parse-escalation');
  assert.equal(saved.cli.modelRequested, 'gpt-5.5');
  assert.equal(saved.cli.reasoningEffort, 'high');
  assert.equal(saved.cli.stdin.text, child.getStdinText());
  assert.equal(saved.cli.stdout.jsonlEvents.length, 2);
  assert.equal(saved.cli.process.exitCode, 0);
  assert.equal(saved.outcome, 'success');
});

test('codex transcribeImage does not wait for background Mongo insert', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const spawnCalls = installSpawnMock();
  const originalCreate = ProviderCallPackage.create;
  let releaseCreate;
  let createStarted = false;
  ProviderCallPackage.create = async function delayedCreate(...args) {
    createStarted = true;
    await new Promise((resolve) => { releaseCreate = resolve; });
    return originalCreate.apply(this, args);
  };

  try {
    const codex = requireFresh('../src/services/codex');
    const promise = codex.transcribeImage('data:image/png;base64,aGVsbG8=', { timeoutMs: 1000 });
    const { child } = spawnCalls[0];
    emitStdoutLines(child, [
      JSON.stringify({ item: { type: 'agent_message', id: 'a1', text: 'FAST RETURN' } }),
    ]);
    closeChild(child, 0);

    const result = await promise;
    assert.equal(result.text, 'FAST RETURN');
    assert.equal(createStarted, false, 'Mongo insert should not block provider resolution synchronously');

    while (!createStarted) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    releaseCreate();
    await __waitForProviderPackageRecorderSettled();
    assert.equal(await ProviderCallPackage.countDocuments({ callSite: 'codex:transcribeImage' }), 1);
  } finally {
    ProviderCallPackage.create = originalCreate;
  }
});

test('codex transcribeImage preserves malformed stdout lines in the wired provider package', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const spawnCalls = installSpawnMock();
  const codex = requireFresh('../src/services/codex');

  const promise = codex.transcribeImage('data:image/png;base64,aGVsbG8=', { timeoutMs: 1000 });
  const { child } = spawnCalls[0];
  emitStdoutLines(child, [
    'this is not json',
    JSON.stringify({ item: { type: 'agent_message', id: 'a1', text: 'VISIBLE AFTER BAD LINE' } }),
  ]);
  closeChild(child, 0);

  const result = await promise;
  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'codex:transcribeImage' }).lean();
  assert.equal(result.text, 'VISIBLE AFTER BAD LINE');
  assert.equal(saved.outcome, 'success');
  assert.deepEqual(saved.cli.stdout.malformedLines, ['this is not json']);
  assert.equal(saved.cli.stdout.jsonlEvents.length, 1);
});

test('codex transcribeImage preserves nonzero exit facts in the wired provider package', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const spawnCalls = installSpawnMock();
  const codex = requireFresh('../src/services/codex');

  const promise = codex.transcribeImage('data:image/png;base64,aGVsbG8=', { timeoutMs: 1000 });
  const { child } = spawnCalls[0];
  child.stderr.emit('data', Buffer.from('codex failed before output'));
  closeChild(child, 1);

  await assert.rejects(promise, /Codex CLI exited with code 1/);
  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'codex:transcribeImage' }).lean();
  assert.equal(saved.outcome, 'process_error');
  assert.equal(saved.cli.process.exitCode, 1);
  assert.equal(saved.cli.process.closed, true);
  assert.equal(saved.cli.stderr.text, 'codex failed before output');
});

test('codex transcribeImage waits for close facts before recording timeout package', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const spawnCalls = installSpawnMock();
  const codex = requireFresh('../src/services/codex');

  const promise = codex.transcribeImage('data:image/png;base64,aGVsbG8=', { timeoutMs: 5 });
  const { child } = spawnCalls[0];

  await assert.rejects(promise, /timed out/);
  assert.equal(await ProviderCallPackage.countDocuments({}), 0);

  const finalEvent = JSON.stringify({ item: { type: 'agent_message', id: 'late', text: 'LATE TEXT' } });
  child.stdout.emit('data', Buffer.from(finalEvent));
  child.stderr.emit('data', Buffer.from('late stderr before close'));
  closeChild(child, null, 'SIGTERM');

  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'codex:transcribeImage' }).lean();
  assert.equal(saved.outcome, 'timeout');
  assert.equal(saved.cli.timeout.fired, true);
  assert.equal(saved.cli.process.killed, true);
  assert.equal(saved.cli.process.killSignal, 'SIGTERM');
  assert.equal(saved.cli.process.closed, true);
  assert.equal(saved.cli.process.signal, 'SIGTERM');
  assert.equal(saved.cli.stdout.finalBuffer, finalEvent);
  assert.equal(saved.cli.stdout.jsonlEvents[0].item.text, 'LATE TEXT');
  assert.equal(saved.cli.stderr.text, 'late stderr before close');
});

test('codex transcribeImage records spawn errors as spawn_error', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const spawnCalls = installSpawnMock();
  const codex = requireFresh('../src/services/codex');

  const promise = codex.transcribeImage('data:image/png;base64,aGVsbG8=', { timeoutMs: 1000 });
  const { child } = spawnCalls[0];
  child.emit('error', Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }));
  closeChild(child, null, null);

  await assert.rejects(promise, /spawn codex ENOENT/);
  await __waitForProviderPackageRecorderSettled();
  const saved = await ProviderCallPackage.findOne({ callSite: 'codex:transcribeImage' }).lean();
  assert.equal(saved.outcome, 'spawn_error');
  assert.equal(saved.error.code, 'ENOENT');
  assert.equal(saved.cli.process.spawned, false);
  assert.equal(saved.cli.process.closed, true);
});

test('codex transcribeImage still returns when background recorder insert fails', async () => {
  process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
  const spawnCalls = installSpawnMock();
  const originalCreate = ProviderCallPackage.create;
  ProviderCallPackage.create = async function failingCreate() {
    throw new Error('mongo insert failed');
  };

  try {
    const codex = requireFresh('../src/services/codex');
    const promise = codex.transcribeImage('data:image/png;base64,aGVsbG8=', { timeoutMs: 1000 });
    const { child } = spawnCalls[0];
    emitStdoutLines(child, [
      JSON.stringify({ item: { type: 'agent_message', id: 'a1', text: 'RESULT DESPITE RECORDER ERROR' } }),
    ]);
    closeChild(child, 0);

    const result = await promise;
    await __waitForProviderPackageRecorderSettled();
    assert.equal(result.text, 'RESULT DESPITE RECORDER ERROR');
    assert.equal(await ProviderCallPackage.countDocuments({}), 0);
  } finally {
    ProviderCallPackage.create = originalCreate;
  }
});
