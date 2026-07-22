const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const Conversation = require('../src/models/Conversation');
const AiTrace = require('../src/models/AiTrace');
const claude = require('../src/services/claude');
const codex = require('../src/services/codex');

const SAMPLE_IMAGE = 'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3Z8UkAAAAASUVORK5CYII=';

function setDefaultChatStubs() {
  claude.chat = ({ onChunk, onDone }) => {
    onChunk('claude');
    onDone('claude');
    return () => {};
  };
  codex.chat = ({ onChunk, onDone }) => {
    onChunk('codex');
    onDone('codex');
    return () => {};
  };
}

function parseEvent(text, name) {
  const match = text.match(new RegExp(`event: ${name}\\s+data: (.+)`));
  return match ? JSON.parse(match[1]) : null;
}

async function withFailingFinalTraceWrite(run) {
  const originalFindByIdAndUpdate = AiTrace.findByIdAndUpdate;
  AiTrace.findByIdAndUpdate = function patchedFindByIdAndUpdate(traceId, update, options) {
    if (Object.prototype.hasOwnProperty.call(update?.$set || {}, 'attempts')) {
      return {
        lean: async () => {
          throw new Error('simulated final trace write failure');
        },
      };
    }
    return originalFindByIdAndUpdate.call(this, traceId, update, options);
  };
  try {
    return await run();
  } finally {
    AiTrace.findByIdAndUpdate = originalFindByIdAndUpdate;
  }
}

test('chat-fallback-integration suite', async (t) => {
  let app;
  let agent;
  let originalClaudeChat;
  let originalCodexChat;

  t.before(async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ADMIN_API_KEY;
    delete process.env.EDITOR_API_KEY;
    delete process.env.VIEWER_API_KEY;

    originalClaudeChat = claude.chat;
    originalCodexChat = codex.chat;
    setDefaultChatStubs();

    await connect();
    app = createApp();
    agent = request(app);
  });

  t.after(async () => {
    claude.chat = originalClaudeChat;
    codex.chat = originalCodexChat;
    delete process.env.FEATURE_CHAT_PROVIDER_PARITY;
    delete process.env.FEATURE_CHAT_FALLBACK_MODE;
    delete process.env.CHAT_MAX_IMAGES_PER_REQUEST;
    await disconnect();
  });

  t.beforeEach(async () => {
    setDefaultChatStubs();
    delete process.env.FEATURE_CHAT_PROVIDER_PARITY;
    delete process.env.FEATURE_CHAT_FALLBACK_MODE;
    delete process.env.CHAT_MAX_IMAGES_PER_REQUEST;
    await Conversation.deleteMany({});
  });

  await t.test('chat fallback streams provider_error and fallback events then succeeds on alternate', async () => {
    claude.chat = ({ onError }) => {
      const err = new Error('claude failed');
      err.code = 'PROVIDER_EXEC_FAILED';
      onError(err);
      return () => {};
    };
    codex.chat = ({ onChunk, onDone }) => {
      onChunk('fallback response');
      onDone('fallback response');
      return () => {};
    };

    const res = await agent
      .post('/api/chat')
      .send({
        message: 'fallback please',
        mode: 'fallback',
        primaryProvider: 'claude',
        fallbackProvider: 'gpt-5.5',
      });

    assert.equal(res.status, 200);
    assert.match(res.text, /event: provider_error/);
    assert.match(res.text, /event: fallback/);
    assert.match(res.text, /event: done/);

    const done = parseEvent(res.text, 'done');
    assert.ok(done);
    assert.equal(done.providerUsed, 'gpt-5.5');
    assert.equal(done.fallbackUsed, true);
    assert.equal(done.fallbackFrom, 'claude');
  });

  await t.test('chat retry supports fallback policy and emits fallback metadata', async () => {
    const first = await agent
      .post('/api/chat')
      .send({ message: 'first', provider: 'claude' });
    assert.equal(first.status, 200);
    const start = parseEvent(first.text, 'start');
    assert.ok(start);

    const conversation = await Conversation.findById(start.conversationId);
    conversation.caseIntake = {
      status: 'failed',
      runs: [{
        id: 'failed-analyst-run',
        phase: 'analyst',
        status: 'failed',
        startedAt: new Date(Date.now() - 1_000),
        completedAt: new Date(),
      }],
      evidence: {
        contractVersion: 1,
        receipts: {
          analyst: {
            attempted: true,
            completed: false,
            failed: true,
            messageSaved: false,
            errorCode: 'PROVIDER_EXEC_FAILED',
          },
        },
      },
    };
    conversation.markModified('caseIntake');
    await conversation.save();

    claude.chat = ({ onError }) => {
      const err = new Error('claude retry failed');
      err.code = 'PROVIDER_EXEC_FAILED';
      onError(err);
      return () => {};
    };
    codex.chat = ({ onDone }) => {
      onDone('retry fallback');
      return () => {};
    };

    const retry = await agent
      .post('/api/chat/retry')
      .send({
        conversationId: start.conversationId,
        mode: 'fallback',
        primaryProvider: 'claude',
        fallbackProvider: 'gpt-5.5',
      });

    assert.equal(retry.status, 200);
    assert.match(retry.text, /event: fallback/);
    const done = parseEvent(retry.text, 'done');
    assert.ok(done);
    assert.equal(done.providerUsed, 'gpt-5.5');
    assert.equal(done.fallbackUsed, true);
    assert.equal(done.fallbackFrom, 'claude');

    const saved = await Conversation.findById(start.conversationId).lean();
    assert.equal(saved.caseIntake.status, 'analyst-complete');
    assert.equal(saved.caseIntake.evidence.receipts.analyst.completed, true);
    assert.equal(saved.caseIntake.evidence.receipts.analyst.failed, false);
    assert.equal(saved.caseIntake.evidence.receipts.analyst.messageSaved, true);
    assert.equal(saved.caseIntake.evidence.receipts.analyst.errorCode, '');
  });

  await t.test('primary chat keeps the saved answer and sends done when its final trace write fails', async () => {
    const response = await withFailingFinalTraceWrite(() => agent
      .post('/api/chat')
      .send({
        message: 'Review this escalation without losing the answer.',
        provider: 'claude',
        parsedEscalationText: [
          'COID/MID: 9341452197744835',
          'CASE: 15154531492',
          'CLIENT/CONTACT: Trace Failure Test',
          'CX IS ATTEMPTING TO: Complete payroll setup.',
          'EXPECTED OUTCOME: Setup completes.',
          'ACTUAL OUTCOME: Setup is blocked.',
          'KB/TOOLS USED: Help panel.',
          'TRIED TEST ACCOUNT: n/a',
          'TS STEPS: Reproduced the issue.',
        ].join('\n'),
        parsedEscalationSource: 'image-parser',
        pipelineReceipts: { triage: { planned: false, skipReason: 'Not needed.' } },
      }));

    assert.match(response.text, /event: done/);
    assert.doesNotMatch(response.text, /ONDONE_SAVE_FAILED/);
    const done = parseEvent(response.text, 'done');
    const saved = await Conversation.findById(done.conversationId).lean();
    const receipt = saved.caseIntake.evidence.receipts.analyst;
    assert.equal(saved.caseIntake.status, 'analyst-complete');
    assert.equal(receipt.completed, true);
    assert.equal(receipt.failed, false);
    assert.equal(receipt.messageSaved, true);
    assert.equal(receipt.traceSaveOk, false);
    assert.ok(saved.messages.some((message) => message.role === 'assistant'));

    const evidence = await agent.get(`/api/conversations/${done.conversationId}/evidence`);
    const analystMessage = evidence.body.evidence.artifacts.find((item) => item.code === 'ANALYST_MESSAGE');
    const aiTrace = evidence.body.evidence.artifacts.find((item) => item.code === 'AI_TRACE');
    assert.equal(analystMessage.state, 'confirmed');
    assert.equal(aiTrace.state, 'missing');
    assert.equal(evidence.body.evidence.missing.some((item) => item.code === 'ANALYST_MESSAGE'), false);
  });

  await t.test('chat retry keeps the saved answer and sends done when its final trace write fails', async () => {
    const first = await agent.post('/api/chat').send({ message: 'first', provider: 'claude' });
    const start = parseEvent(first.text, 'start');
    const conversation = await Conversation.findById(start.conversationId);
    conversation.caseIntake = {
      status: 'failed',
      runs: [{
        id: 'failed-analyst-run',
        phase: 'analyst',
        status: 'failed',
        startedAt: new Date(Date.now() - 1_000),
        completedAt: new Date(),
      }],
      evidence: {
        contractVersion: 1,
        receipts: {
          analyst: {
            attempted: true,
            completed: false,
            failed: true,
            messageSaved: false,
            errorCode: 'PROVIDER_EXEC_FAILED',
          },
        },
      },
    };
    conversation.markModified('caseIntake');
    await conversation.save();

    const retry = await withFailingFinalTraceWrite(() => agent
      .post('/api/chat/retry')
      .send({ conversationId: start.conversationId, provider: 'claude' }));

    assert.match(retry.text, /event: done/);
    assert.doesNotMatch(retry.text, /ONDONE_SAVE_FAILED/);
    const saved = await Conversation.findById(start.conversationId).lean();
    const receipt = saved.caseIntake.evidence.receipts.analyst;
    assert.equal(saved.caseIntake.status, 'analyst-complete');
    assert.equal(receipt.completed, true);
    assert.equal(receipt.failed, false);
    assert.equal(receipt.messageSaved, true);
    assert.equal(receipt.traceSaveOk, false);
  });

  await t.test('fallback mode flag disables fallback execution path', async () => {
    process.env.FEATURE_CHAT_FALLBACK_MODE = '0';
    let codexCalled = false;
    codex.chat = ({ onDone }) => {
      codexCalled = true;
      onDone('codex');
      return () => {};
    };

    const res = await agent
      .post('/api/chat')
      .send({
        message: 'flag test',
        mode: 'fallback',
        primaryProvider: 'claude',
        fallbackProvider: 'gpt-5.5',
      });

    assert.equal(res.status, 200);
    const done = parseEvent(res.text, 'done');
    assert.ok(done);
    assert.equal(done.providerUsed, 'claude');
    assert.equal(done.fallbackUsed, false);
    assert.equal(codexCalled, false);
  });

  await t.test('provider parity flag forces legacy default provider path', async () => {
    process.env.FEATURE_CHAT_PROVIDER_PARITY = '0';
    let codexCalled = false;
    codex.chat = ({ onDone }) => {
      codexCalled = true;
      onDone('codex');
      return () => {};
    };
    claude.chat = ({ onDone }) => {
      onDone('claude default');
      return () => {};
    };

    const res = await agent
      .post('/api/chat')
      .send({
        message: 'parity off',
        provider: 'gpt-5.5',
        mode: 'fallback',
        fallbackProvider: 'claude',
      });

    assert.equal(res.status, 200);
    const done = parseEvent(res.text, 'done');
    assert.ok(done);
    assert.equal(done.providerUsed, 'claude');
    assert.equal(done.mode, 'single');
    assert.equal(codexCalled, false);
  });

  await t.test('chat rejects image payloads and preserves conversation count', async () => {
    const beforeCount = await Conversation.countDocuments({});

    const res = await agent
      .post('/api/chat')
      .send({
        images: [SAMPLE_IMAGE],
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'CHAT_IMAGES_DISABLED');

    const afterCount = await Conversation.countDocuments({});
    assert.equal(afterCount, beforeCount);
  });

  await t.test('chat failure waits for its analyst failure receipt save before settling SSE', async () => {
    const originalSave = Conversation.prototype.save;
    let releaseFailureSave;
    let markFailureSaveStarted;
    const failureSaveStarted = new Promise((resolve) => { markFailureSaveStarted = resolve; });
    const releaseFailure = new Promise((resolve) => { releaseFailureSave = resolve; });
    let gated = false;

    Conversation.prototype.save = async function patchedSave(...args) {
      if (!gated && this.caseIntake?.evidence?.receipts?.analyst?.failed === true) {
        gated = true;
        markFailureSaveStarted();
        await releaseFailure;
      }
      return originalSave.apply(this, args);
    };
    claude.chat = ({ onError }) => {
      const err = new Error('analyst failed');
      err.code = 'PROVIDER_EXEC_FAILED';
      onError(err);
      return () => {};
    };
    codex.chat = ({ onError }) => {
      const err = new Error('fallback analyst failed');
      err.code = 'PROVIDER_EXEC_FAILED';
      onError(err);
      return () => {};
    };

    try {
      let responseSettled = false;
      const responsePromise = agent
        .post('/api/chat')
        .send({
          message: 'Review this escalation.',
          provider: 'claude',
          parsedEscalationText: [
            'COID/MID: 9341452197744835',
            'CASE: 15154531492',
            'CLIENT/CONTACT: Doug Mckensie',
            'CX IS ATTEMPTING TO: Download a payroll XML file.',
            'EXPECTED OUTCOME: The full file downloads.',
            'ACTUAL OUTCOME: The summary is missing.',
            'KB/TOOLS USED: HELP PANEL, KB ARTICLES, GOOGLE, SCREEN SHARE.',
            'TRIED TEST ACCOUNT: n/a',
            'TS STEPS: Reproduced the missing summary.',
          ].join('\n'),
          parsedEscalationSource: 'image-parser',
          pipelineReceipts: { triage: { planned: false, skipReason: 'Not needed.' } },
        })
        .then((response) => {
          responseSettled = true;
          return response;
        });

      await Promise.race([
        failureSaveStarted,
        new Promise((_, reject) => setTimeout(() => reject(new Error('failure receipt save was not attempted')), 5_000)),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(responseSettled, false, 'SSE must remain open until the failure receipt save settles');
      releaseFailureSave();

      const response = await responsePromise;
      assert.match(response.text, /event: error/);
      const saved = await Conversation.findOne({}).lean();
      assert.equal(saved?.caseIntake?.evidence?.receipts?.analyst?.failed, true);
    } finally {
      releaseFailureSave?.();
      Conversation.prototype.save = originalSave;
      setDefaultChatStubs();
    }
  });

  await t.test('failed retry replaces the old completed analyst receipt with an honest failure', async () => {
    setDefaultChatStubs();
    const first = await agent.post('/api/chat').send({ message: 'first', provider: 'claude' });
    const start = parseEvent(first.text, 'start');
    const conversation = await Conversation.findById(start.conversationId);
    conversation.caseIntake = {
      status: 'analyst-complete',
      runs: [{
        id: 'old-analyst-run',
        phase: 'analyst',
        status: 'completed',
        startedAt: new Date(Date.now() - 1_000),
        completedAt: new Date(),
      }],
      evidence: {
        contractVersion: 1,
        receipts: {
          analyst: {
            attempted: true,
            completed: true,
            failed: false,
            messageSaved: true,
            errorCode: '',
          },
        },
      },
    };
    conversation.markModified('caseIntake');
    await conversation.save();

    claude.chat = ({ onError }) => {
      const err = new Error('retry provider failed');
      err.code = 'PROVIDER_EXEC_FAILED';
      onError(err);
      return () => {};
    };
    codex.chat = ({ onError }) => {
      const err = new Error('retry fallback failed');
      err.code = 'PROVIDER_EXEC_FAILED';
      onError(err);
      return () => {};
    };

    try {
      const retry = await agent
        .post('/api/chat/retry')
        .send({ conversationId: start.conversationId, provider: 'claude' });
      assert.match(retry.text, /event: error/);

      const saved = await Conversation.findById(start.conversationId).lean();
      const receipt = saved.caseIntake.evidence.receipts.analyst;
      assert.equal(saved.caseIntake.status, 'failed');
      assert.equal(receipt.attempted, true);
      assert.equal(receipt.completed, false);
      assert.equal(receipt.failed, true);
      assert.equal(receipt.messageSaved, false);
      assert.equal(receipt.errorCode, 'PROVIDER_EXEC_FAILED');
    } finally {
      setDefaultChatStubs();
    }
  });
});
