'use strict';

// Evidence-capture tests for claude.js's CLI spawn sites (Batch 1).
//
// House rule (product owner, locked): every provider call must leave the
// provider's WHOLE response saved in MongoDB as a ProviderCallPackage.
// claude.js's chat() — the transport behind main chat, room agents, workspace
// requests, and the KB sidebar tool loop — previously captured NOTHING.
// These tests pin the new in-module capture (mirroring codex.js's pattern):
//
//   1. a chat call records a ProviderCallPackage containing the stdout JSONL
//      events, including thinking deltas
//   2. streaming callbacks still fire with identical content
//   3. capture failure does not break the chat (background, non-fatal)
//   4. capture disabled (flag off, no forceCapture) -> no package, chat works
//   5. transcribeImage records a package too (Batch 1 straggler B2)
//
// Style mirrors provider-usage-contract.test.js: child_process.spawn is
// monkeypatched with a fake EventEmitter-based child, and claude.js is
// re-required fresh so it picks up the patched spawn.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Writable } = require('stream');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const mongo = require('./_mongo-helper');
const ProviderCallPackage = require('../src/models/ProviderCallPackage');
const {
  __waitForProviderPackageRecorderSettled,
} = require('../src/services/provider-call-package-recorder');

const originalSpawn = childProcess.spawn;
const originalFlag = process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;

function createFakeChild() {
  const child = new EventEmitter();
  child.stdin = new Writable({ write(_, __, cb) { cb(); } });
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  child.pid = 424242;
  return child;
}

function emitLines(child, lines) {
  child.stdout.emit('data', Buffer.from(lines.join('\n') + '\n'));
}

function closeChild(child, code = 0) {
  child.emit('close', code);
}

function requireFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

const THINKING_TEXT = 'pondering the ledger before answering';

function thinkingDeltaLine() {
  return JSON.stringify({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: THINKING_TEXT },
    },
  });
}

function textDeltaLine(text) {
  return JSON.stringify({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text },
    },
  });
}

function resultLine() {
  return JSON.stringify({
    type: 'result',
    result: '',
    model: 'claude-opus-4-8',
    usage: { input_tokens: 10, output_tokens: 25 },
  });
}

function runChat(claude, fakeChild, { lines, exitCode = 0 } = {}) {
  const chunks = [];
  const thinking = [];
  const outcome = new Promise((resolve) => {
    claude.chat({
      messages: [{ role: 'user', content: 'hello evidence layer' }],
      systemPrompt: 'You are the QBO assistant.',
      onChunk: (text) => chunks.push(text),
      onThinkingChunk: (text) => thinking.push(text),
      onDone: (text, usage) => resolve({ ok: true, text, usage }),
      onError: (err) => resolve({ ok: false, err }),
    });
    emitLines(fakeChild, lines);
    closeChild(fakeChild, exitCode);
  });
  return { chunks, thinking, outcome };
}

test('claude CLI provider package capture', async (t) => {
  t.before(async () => {
    await mongo.connect();
  });

  t.after(async () => {
    childProcess.spawn = originalSpawn;
    if (originalFlag === undefined) delete process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
    else process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = originalFlag;
    await __waitForProviderPackageRecorderSettled();
    await mongo.disconnect();
  });

  t.beforeEach(async () => {
    await ProviderCallPackage.deleteMany({});
  });

  await t.test('chat records a full package (stdout JSONL incl. thinking delta) and streams identically', async () => {
    process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
    const fakeChild = createFakeChild();
    childProcess.spawn = () => fakeChild;
    const claude = requireFresh('../src/services/claude');

    const lines = [thinkingDeltaLine(), textDeltaLine('Hello '), textDeltaLine('there'), resultLine()];
    const { chunks, thinking, outcome } = runChat(claude, fakeChild, { lines });
    const result = await outcome;

    // (2) streaming callback surface is unchanged
    assert.equal(result.ok, true);
    assert.equal(result.text, 'Hello there');
    assert.deepEqual(chunks, ['Hello ', 'there']);
    assert.deepEqual(thinking, [THINKING_TEXT]);
    assert.equal(result.usage.inputTokens, 10);
    assert.equal(result.usage.outputTokens, 25);
    assert.equal(result.usage.model, 'claude-opus-4-8');

    // (1) the whole response landed in MongoDB as a ProviderCallPackage
    await __waitForProviderPackageRecorderSettled();
    const docs = await ProviderCallPackage.find({ providerId: 'claude' }).lean();
    assert.equal(docs.length, 1);
    const pkg = docs[0];

    assert.equal(pkg.callSite, 'claude:chat');
    assert.equal(pkg.operation, 'chat');
    assert.equal(pkg.providerResearchId, 'anthropic-cli');
    assert.equal(pkg.providerPathType, 'cli');
    assert.equal(pkg.outcome, 'success');
    assert.equal(pkg.cli.command, 'claude');
    assert.ok(pkg.cli.args.includes('stream-json'), 'argv recorded');
    assert.ok(pkg.cli.stdin.text.includes('hello evidence layer'), 'stdin prompt recorded');
    assert.ok(pkg.cli.stdin.text.includes('System instructions:'), 'system prompt recorded');
    assert.equal(pkg.cli.stdout.jsonlEvents.length, 4);
    const thinkingEvent = pkg.cli.stdout.jsonlEvents.find(
      (event) => event?.event?.delta?.type === 'thinking_delta'
    );
    assert.ok(thinkingEvent, 'thinking delta event saved in package');
    assert.equal(thinkingEvent.event.delta.thinking, THINKING_TEXT);
    assert.ok(pkg.cli.stdout.text.includes(THINKING_TEXT), 'raw stdout text recorded');
    assert.equal(pkg.cli.process.exitCode, 0);
    assert.equal(pkg.cli.process.closed, true);
    assert.equal(pkg.cli.process.pid, 424242);
    assert.ok(pkg.timing.requestStartedAt, 'timing recorded');
    assert.ok(pkg.timing.responseCompletedAt, 'completion timing recorded');
  });

  await t.test('chat failure (non-zero exit) records a process_error package', async () => {
    process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
    const fakeChild = createFakeChild();
    childProcess.spawn = () => fakeChild;
    const claude = requireFresh('../src/services/claude');

    const failure = new Promise((resolve) => {
      claude.chat({
        messages: [{ role: 'user', content: 'will fail' }],
        onChunk() {},
        onDone: () => resolve({ ok: true }),
        onError: (err) => resolve({ ok: false, err }),
      });
      fakeChild.stderr.emit('data', Buffer.from('boom from the CLI'));
      closeChild(fakeChild, 1);
    });
    const result = await failure;
    assert.equal(result.ok, false);
    assert.match(result.err.message, /exited with code 1/);

    await __waitForProviderPackageRecorderSettled();
    const docs = await ProviderCallPackage.find({ providerId: 'claude' }).lean();
    assert.equal(docs.length, 1);
    assert.equal(docs[0].outcome, 'process_error');
    assert.equal(docs[0].cli.process.exitCode, 1);
    assert.ok(docs[0].cli.stderr.text.includes('boom from the CLI'), 'stderr recorded');
    assert.ok(docs[0].error, 'error recorded on the package');
  });

  await t.test('capture failure is non-fatal: chat still succeeds when the package write throws', async () => {
    process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
    const fakeChild = createFakeChild();
    childProcess.spawn = () => fakeChild;
    const claude = requireFresh('../src/services/claude');

    const originalCreate = ProviderCallPackage.create;
    ProviderCallPackage.create = async () => {
      throw new Error('capture exploded');
    };
    try {
      const lines = [textDeltaLine('still works'), resultLine()];
      const { chunks, outcome } = runChat(claude, fakeChild, { lines });
      const result = await outcome;

      assert.equal(result.ok, true);
      assert.equal(result.text, 'still works');
      assert.deepEqual(chunks, ['still works']);

      await __waitForProviderPackageRecorderSettled();
      const count = await ProviderCallPackage.countDocuments({ providerId: 'claude' });
      assert.equal(count, 0);
    } finally {
      ProviderCallPackage.create = originalCreate;
    }
  });

  await t.test('capture disabled (flag off, no forceCapture): no package, chat still works', async () => {
    delete process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE;
    const fakeChild = createFakeChild();
    childProcess.spawn = () => fakeChild;
    const claude = requireFresh('../src/services/claude');

    const lines = [thinkingDeltaLine(), textDeltaLine('quiet mode'), resultLine()];
    const { chunks, thinking, outcome } = runChat(claude, fakeChild, { lines });
    const result = await outcome;

    assert.equal(result.ok, true);
    assert.equal(result.text, 'quiet mode');
    assert.deepEqual(chunks, ['quiet mode']);
    assert.deepEqual(thinking, [THINKING_TEXT]);

    await __waitForProviderPackageRecorderSettled();
    const count = await ProviderCallPackage.countDocuments({ providerId: 'claude' });
    assert.equal(count, 0);
  });

  await t.test('transcribeImage records a package with the full stdout text', async () => {
    process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
    const fakeChild = createFakeChild();
    childProcess.spawn = () => fakeChild;
    const claude = requireFresh('../src/services/claude');

    // File-path input: avoids the base64 temp-file write path entirely.
    const imagePath = path.join(os.tmpdir(), `qbo-test-transcribe-${Date.now()}.png`);
    fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    try {
      const pending = claude.transcribeImage(imagePath, { timeoutMs: 5000 });
      fakeChild.stdout.emit('data', Buffer.from('TRANSCRIBED: COID 12345, CASE 67890'));
      closeChild(fakeChild, 0);
      const result = await pending;

      assert.equal(result.text, 'TRANSCRIBED: COID 12345, CASE 67890');

      await __waitForProviderPackageRecorderSettled();
      const docs = await ProviderCallPackage.find({ providerId: 'claude' }).lean();
      assert.equal(docs.length, 1);
      const pkg = docs[0];
      assert.equal(pkg.callSite, 'claude:transcribeImage');
      assert.equal(pkg.operation, 'image-transcribe');
      assert.equal(pkg.outcome, 'success');
      assert.ok(pkg.cli.stdout.text.includes('TRANSCRIBED: COID 12345'), 'stdout text recorded');
      assert.ok(pkg.cli.stdin.text.includes('Transcribe ALL text'), 'transcribe prompt recorded');
      assert.equal(pkg.cli.process.exitCode, 0);
    } finally {
      try { fs.unlinkSync(imagePath); } catch { /* ignore */ }
    }
  });
});
