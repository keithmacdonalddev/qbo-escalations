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
const { redactProviderCallPackage } = require('../src/services/provider-call-package-redaction');

const originalSpawn = childProcess.spawn;
const originalEnv = {
  ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE: process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE,
  PROVIDER_HARNESS_CONSOLE_TRACE: process.env.PROVIDER_HARNESS_CONSOLE_TRACE,
};

function restoreEnv() {
  if (originalEnv.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE === undefined) {
    delete process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
  } else {
    process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = originalEnv.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
  }
  if (originalEnv.PROVIDER_HARNESS_CONSOLE_TRACE === undefined) {
    delete process.env.PROVIDER_HARNESS_CONSOLE_TRACE;
  } else {
    process.env.PROVIDER_HARNESS_CONSOLE_TRACE = originalEnv.PROVIDER_HARNESS_CONSOLE_TRACE;
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
  delete process.env.PROVIDER_HARNESS_CONSOLE_TRACE;
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
  delete process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
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
