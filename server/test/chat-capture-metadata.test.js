'use strict';

// Evidence-identity tests (Batch 2).
//
// House rule: every provider call saves its full response as a
// ProviderCallPackage. Batch 2 adds the IDENTITY of the call — which
// conversation/case/room/agent produced it — so packages are matchable to
// their source instead of only by timestamp. These tests pin:
//
//   1. startChatOrchestration threads `captureMetadata` into the provider
//      chat adapter as captureContext.metadata (and omits it when absent)
//   2. claude.chat persists captureContext.metadata onto the saved package
//   3. claude.parseEscalation (previously captured NOTHING) records a
//      ProviderCallPackage on success and on process error, including the
//      caller-supplied metadata
//   4. an HTTP adapter (anthropic) stamps captureMetadata into the capture
//      context handed to the HTTP harness
//
// Style mirrors claude-chat-provider-package.test.js: child_process.spawn is
// monkeypatched with a fake EventEmitter-based child and claude.js is
// re-required fresh so it picks up the patched spawn.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Writable } = require('stream');
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
  child.pid = 515151;
  return child;
}

function requireFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

test('chat capture metadata (evidence identity)', async (t) => {
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

  await t.test('startChatOrchestration threads captureMetadata into the provider chat adapter', async () => {
    const claude = require('../src/services/claude');
    const { startChatOrchestration } = require('../src/services/chat-orchestrator');
    const originalChat = claude.chat;
    let receivedOpts = null;
    claude.chat = (opts) => {
      receivedOpts = opts;
      opts.onDone('ok');
      return () => {};
    };

    try {
      const metadata = {
        conversationId: '64b000000000000000000010',
        caseNumber: 'CASE-42',
        agentId: 'chat',
      };
      await new Promise((resolve, reject) => {
        startChatOrchestration({
          mode: 'single',
          primaryProvider: 'claude',
          messages: [{ role: 'user', content: 'hi' }],
          systemPrompt: '',
          images: [],
          captureMetadata: metadata,
          onChunk: () => {},
          onDone: resolve,
          onError: (err) => reject(new Error(err.message || 'orchestration failed')),
        });
      });

      assert.ok(receivedOpts, 'provider chat adapter was invoked');
      assert.deepEqual(receivedOpts.captureContext, { metadata });
    } finally {
      claude.chat = originalChat;
    }
  });

  await t.test('startChatOrchestration omits captureContext when no captureMetadata is given', async () => {
    const claude = require('../src/services/claude');
    const { startChatOrchestration } = require('../src/services/chat-orchestrator');
    const originalChat = claude.chat;
    let receivedOpts = null;
    claude.chat = (opts) => {
      receivedOpts = opts;
      opts.onDone('ok');
      return () => {};
    };

    try {
      await new Promise((resolve, reject) => {
        startChatOrchestration({
          mode: 'single',
          primaryProvider: 'claude',
          messages: [{ role: 'user', content: 'hi' }],
          systemPrompt: '',
          images: [],
          onChunk: () => {},
          onDone: resolve,
          onError: (err) => reject(new Error(err.message || 'orchestration failed')),
        });
      });

      assert.ok(receivedOpts, 'provider chat adapter was invoked');
      assert.equal(receivedOpts.captureContext, undefined);
    } finally {
      claude.chat = originalChat;
    }
  });

  await t.test('claude.chat persists captureContext.metadata onto the saved package', async () => {
    process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
    const fakeChild = createFakeChild();
    childProcess.spawn = () => fakeChild;
    const claude = requireFresh('../src/services/claude');

    const metadata = {
      conversationId: '64b000000000000000000011',
      caseNumber: 'CASE-77',
      escalationId: '64b000000000000000000012',
      agentId: 'chat',
    };

    const outcome = new Promise((resolve) => {
      claude.chat({
        messages: [{ role: 'user', content: 'identity please' }],
        captureContext: { metadata },
        onChunk: () => {},
        onDone: (text) => resolve({ ok: true, text }),
        onError: (err) => resolve({ ok: false, err }),
      });
      fakeChild.stdout.emit('data', Buffer.from(JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'stamped' } },
      }) + '\n'));
      fakeChild.emit('close', 0);
    });

    const result = await outcome;
    assert.equal(result.ok, true);
    assert.equal(result.text, 'stamped');

    await __waitForProviderPackageRecorderSettled();
    const pkg = await ProviderCallPackage.findOne({ callSite: 'claude:chat' }).lean();
    assert.ok(pkg, 'package recorded');
    assert.ok(pkg.metadata, 'metadata stamped on package');
    assert.equal(pkg.metadata.conversationId, metadata.conversationId);
    assert.equal(pkg.metadata.caseNumber, metadata.caseNumber);
    assert.equal(pkg.metadata.escalationId, metadata.escalationId);
    assert.equal(pkg.metadata.agentId, 'chat');
  });

  await t.test('claude.parseEscalation (text path) records a package incl. metadata', async () => {
    process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
    const fakeChild = createFakeChild();
    childProcess.spawn = () => fakeChild;
    const claude = requireFresh('../src/services/claude');

    const pending = claude.parseEscalation('CASE: 67890\nCX IS ATTEMPTING TO: reconcile', {
      timeoutMs: 5000,
      captureContext: { metadata: { escalationId: '64b000000000000000000013' } },
    });
    fakeChild.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'result',
      structured_output: { category: 'reconciliation', caseNumber: '67890' },
      usage: { input_tokens: 5, output_tokens: 9 },
      model: 'claude-opus-4-8',
    })));
    fakeChild.emit('close', 0);

    const result = await pending;
    assert.equal(result.fields.category, 'reconciliation');
    assert.equal(result.fields.caseNumber, '67890');

    await __waitForProviderPackageRecorderSettled();
    const pkg = await ProviderCallPackage.findOne({ callSite: 'claude:parseEscalation' }).lean();
    assert.ok(pkg, 'parseEscalation package recorded');
    assert.equal(pkg.operation, 'parse-escalation');
    assert.equal(pkg.providerId, 'claude');
    assert.equal(pkg.providerPathType, 'cli');
    assert.equal(pkg.outcome, 'success');
    assert.equal(pkg.cli.command, 'claude');
    assert.ok(pkg.cli.args.includes('--json-schema'), 'argv recorded');
    assert.ok(pkg.cli.stdin.text.includes('CASE: 67890'), 'stdin prompt recorded');
    assert.ok(pkg.cli.stdout.text.includes('reconciliation'), 'stdout recorded');
    assert.equal(pkg.cli.process.exitCode, 0);
    assert.equal(pkg.source.spawnSite, 'claude.parseEscalation.text');
    assert.equal(pkg.metadata.escalationId, '64b000000000000000000013');
  });

  await t.test('claude.parseEscalation failure (non-zero exit, no stdout) records a process_error package', async () => {
    process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE = 'true';
    const fakeChild = createFakeChild();
    childProcess.spawn = () => fakeChild;
    const claude = requireFresh('../src/services/claude');

    const pending = claude.parseEscalation('CASE: WILL-FAIL', { timeoutMs: 5000 });
    fakeChild.stderr.emit('data', Buffer.from('parse exploded'));
    fakeChild.emit('close', 1);

    await assert.rejects(pending, /exited with code 1/);

    await __waitForProviderPackageRecorderSettled();
    const pkg = await ProviderCallPackage.findOne({ callSite: 'claude:parseEscalation' }).lean();
    assert.ok(pkg, 'failure package recorded');
    assert.equal(pkg.outcome, 'process_error');
    assert.equal(pkg.cli.process.exitCode, 1);
    assert.ok(pkg.cli.stderr.text.includes('parse exploded'), 'stderr recorded');
    assert.ok(pkg.error, 'error recorded on the package');
  });

  await t.test('requestAnthropicChat stamps captureMetadata into the HTTP capture context', async () => {
    const { _internal } = require('../src/services/remote-api-providers');
    const metadata = { conversationId: '64b000000000000000000014', roomId: 'room-1' };
    let receivedCaptureContext = null;

    const request = _internal.requestAnthropicChat({
      messages: [{ role: 'user', content: 'hello' }],
      systemPrompt: '',
      model: 'claude-sonnet-4-20250514',
      timeoutMs: 5000,
      captureMetadata: metadata,
      getApiKeyFn: async () => 'sk-test',
      requestFn: (method, baseUrl, urlPath, body, headers, timeoutMs, captureContext) => {
        receivedCaptureContext = captureContext;
        return {
          promise: Promise.resolve({
            statusCode: 200,
            body: JSON.stringify({
              content: [{ type: 'text', text: 'hi back' }],
              model: 'claude-sonnet-4-20250514',
              usage: { input_tokens: 1, output_tokens: 2 },
            }),
          }),
          cancel: () => {},
        };
      },
    });

    const result = await request.promise;
    assert.equal(result.text, 'hi back');
    assert.ok(receivedCaptureContext, 'capture context passed to HTTP harness');
    assert.equal(receivedCaptureContext.callSite, 'remote-api-providers:requestAnthropicChat');
    assert.deepEqual(receivedCaptureContext.metadata, metadata);
  });
});
