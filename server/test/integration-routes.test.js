const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createApp } = require('../src/app');
const Conversation = require('../src/models/Conversation');
const Escalation = require('../src/models/Escalation');
const Template = require('../src/models/Template');
const ParallelCandidateTurn = require('../src/models/ParallelCandidateTurn');
const claude = require('../src/services/claude');
const codex = require('../src/services/codex');

const SAMPLE_PNG_DATA_URL = 'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3Z8UkAAAAASUVORK5CYII=';

let mongod;
let app;
let agent;
let originalClaudeChat;
let originalCodexChat;
let originalClaudeParse;
let originalCodexParse;

test.before(async () => {
  process.env.NODE_ENV = 'test';
  delete process.env.ADMIN_API_KEY;
  delete process.env.EDITOR_API_KEY;
  delete process.env.VIEWER_API_KEY;

  originalClaudeChat = claude.chat;
  originalCodexChat = codex.chat;
  originalClaudeParse = claude.parseEscalation;
  originalCodexParse = codex.parseEscalation;

  const fakeStream = ({ onChunk, onDone }) => {
    if (onChunk) onChunk('mock assistant response');
    if (onDone) onDone('mock assistant response', null);
    return () => {};
  };
  claude.chat = fakeStream;
  codex.chat = fakeStream;
  claude.parseEscalation = async () => ({
    fields: {
      category: 'technical',
      attemptingTo: 'Sign in to QBO',
      actualOutcome: 'Login error shown',
      tsSteps: 'Cleared cache',
      triedTestAccount: 'unknown',
      coid: '12345',
    },
    usage: null,
  });
  codex.parseEscalation = async () => ({
    fields: {
      category: 'technical',
      attemptingTo: 'Sign in to QBO',
      actualOutcome: 'Login error shown',
      tsSteps: 'Cleared cache',
      triedTestAccount: 'unknown',
      coid: '12345',
    },
    usage: null,
  });

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  app = createApp();
  agent = request(app);
});

test.after(async () => {
  claude.chat = originalClaudeChat;
  codex.chat = originalCodexChat;
  claude.parseEscalation = originalClaudeParse;
  codex.parseEscalation = originalCodexParse;

  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    Conversation.deleteMany({}),
    Escalation.deleteMany({}),
    Template.deleteMany({}),
    ParallelCandidateTurn.deleteMany({}),
  ]);
});

test('template create/update/delete works without auth in local mode', async () => {
  const created = await agent
    .post('/api/templates')
    .send({ category: 'general', title: 'T1', body: 'Body' });
  assert.equal(created.status, 201);
  const templateId = created.body.template._id;

  const updated = await agent
    .patch(`/api/templates/${templateId}`)
    .send({ title: 'T2' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.template.title, 'T2');

  const deleted = await agent.delete(`/api/templates/${templateId}`);
  assert.equal(deleted.status, 200);
});

test('from-conversation links both records and deleting conversation unlinks escalation', async () => {
  const conversation = await Conversation.create({
    title: 'Link test',
    messages: [{ role: 'user', content: 'Need help', timestamp: new Date() }],
    provider: 'claude',
  });

  const created = await agent
    .post('/api/escalations/from-conversation')
    .send({
      conversationId: conversation._id.toString(),
      category: 'general',
      attemptingTo: 'Do something in QBO',
    });
  assert.equal(created.status, 201);

  const escalationId = created.body.escalation._id;
  const conversationAfterLink = await Conversation.findById(conversation._id).lean();
  const escalationAfterLink = await Escalation.findById(escalationId).lean();

  assert.equal(String(conversationAfterLink.escalationId), escalationId);
  assert.equal(String(escalationAfterLink.conversationId), conversation._id.toString());

  const deletedConversation = await agent.delete(`/api/conversations/${conversation._id}`);
  assert.equal(deletedConversation.status, 200);

  const escalationAfterDelete = await Escalation.findById(escalationId).lean();
  assert.equal(escalationAfterDelete.conversationId, null);
});

test('deleting escalation unlinks linked conversation', async () => {
  const conversation = await Conversation.create({
    title: 'Unlink test',
    messages: [{ role: 'user', content: 'hello', timestamp: new Date() }],
    provider: 'claude',
  });

  const created = await agent
    .post('/api/escalations/from-conversation')
    .send({
      conversationId: conversation._id.toString(),
      category: 'technical',
      attemptingTo: 'Fix login issue',
    });
  assert.equal(created.status, 201);

  const escalationId = created.body.escalation._id;
  const deletedEscalation = await agent.delete(`/api/escalations/${escalationId}`);
  assert.equal(deletedEscalation.status, 200);

  const conversationAfter = await Conversation.findById(conversation._id).lean();
  assert.equal(conversationAfter.escalationId, null);
});

test('conversations list escapes regex-like search input', async () => {
  await Conversation.create({
    title: 'Payroll [Bracket] incident',
    messages: [{ role: 'user', content: 'Need help', timestamp: new Date() }],
    provider: 'claude',
  });

  const res = await agent.get('/api/conversations?search=%5B');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.conversations.length, 1);
  assert.match(res.body.conversations[0].title, /\[Bracket\]/);
});

test('conversations list tolerates non-string search and invalid paging values', async () => {
  await Conversation.create({
    title: 'Conversation A',
    messages: [{ role: 'user', content: 'A', timestamp: new Date() }],
    provider: 'claude',
  });
  await Conversation.create({
    title: 'Conversation B',
    messages: [{ role: 'user', content: 'B', timestamp: new Date() }],
    provider: 'claude',
  });

  const res = await agent.get('/api/conversations?search=a&search=b&limit=-5&skip=-20');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.total, 2);
  assert.equal(res.body.conversations.length, 1);
});

test('conversation routes return 400 for invalid ids', async () => {
  const invalidId = 'not-an-object-id';

  const getRes = await agent.get(`/api/conversations/${invalidId}`);
  assert.equal(getRes.status, 400);
  assert.equal(getRes.body.code, 'INVALID_CONVERSATION_ID');

  const patchRes = await agent
    .patch(`/api/conversations/${invalidId}`)
    .send({ title: 'ignored' });
  assert.equal(patchRes.status, 400);
  assert.equal(patchRes.body.code, 'INVALID_CONVERSATION_ID');

  const exportRes = await agent.get(`/api/conversations/${invalidId}/export`);
  assert.equal(exportRes.status, 400);
  assert.equal(exportRes.body.code, 'INVALID_CONVERSATION_ID');
});

test('chat and retry endpoints stream SSE and persist conversation updates', async () => {
  const chatRes = await agent
    .post('/api/chat')
    .send({ message: 'First message', provider: 'claude' });
  assert.equal(chatRes.status, 200);
  assert.match(chatRes.text, /event: start/);
  assert.match(chatRes.text, /event: chunk/);
  assert.match(chatRes.text, /event: done/);

  const startMatch = chatRes.text.match(/event: start\s+data: (.+)/);
  assert.ok(startMatch);
  const startData = JSON.parse(startMatch[1]);
  assert.ok(startData.conversationId);

  const retryRes = await agent
    .post('/api/chat/retry')
    .send({ conversationId: startData.conversationId, provider: 'claude' });
  assert.equal(retryRes.status, 200);
  assert.match(retryRes.text, /event: done/);

  const updatedConversation = await Conversation.findById(startData.conversationId).lean();
  assert.equal(updatedConversation.messages.length, 2);
  assert.equal(updatedConversation.messages[0].role, 'user');
  assert.equal(updatedConversation.messages[1].role, 'assistant');
  assert.equal(updatedConversation.messages[1].content, 'mock assistant response');
});

test('parallel chat mode persists both provider responses and retry replaces both', async () => {
  const chatRes = await agent
    .post('/api/chat')
    .send({
      message: 'Parallel test message',
      provider: 'claude',
      mode: 'parallel',
      fallbackProvider: 'chatgpt-5.3-codex-high',
    });

  assert.equal(chatRes.status, 200);
  assert.match(chatRes.text, /event: start/);
  assert.match(chatRes.text, /event: done/);

  const startMatch = chatRes.text.match(/event: start\s+data: (.+)/);
  assert.ok(startMatch);
  const startData = JSON.parse(startMatch[1]);
  assert.equal(startData.mode, 'parallel');
  assert.deepEqual((startData.parallelProviders || []).sort(), ['chatgpt-5.3-codex-high', 'claude']);

  const doneMatch = chatRes.text.match(/event: done\s+data: (.+)/);
  assert.ok(doneMatch);
  const doneData = JSON.parse(doneMatch[1]);
  assert.equal(doneData.mode, 'parallel');
  assert.equal(doneData.providerUsed, 'parallel');
  assert.ok(doneData.turnId);
  assert.ok(Array.isArray(doneData.results));
  assert.equal(doneData.results.length, 2);
  const firstTurn = await ParallelCandidateTurn.findOne({ turnId: doneData.turnId }).lean();
  assert.ok(firstTurn);
  assert.equal(firstTurn.status, 'open');
  assert.equal(firstTurn.service, 'chat');
  assert.equal(String(firstTurn.conversationId), startData.conversationId);
  assert.equal(firstTurn.candidates.length, 2);
  assert.deepEqual(firstTurn.candidates.map((c) => c.provider).sort(), ['chatgpt-5.3-codex-high', 'claude']);

  const afterFirstRun = await Conversation.findById(startData.conversationId).lean();
  assert.equal(afterFirstRun.messages.length, 3);
  const firstAssistantProviders = afterFirstRun.messages
    .filter((m) => m.role === 'assistant')
    .map((m) => m.provider)
    .sort();
  assert.deepEqual(firstAssistantProviders, ['chatgpt-5.3-codex-high', 'claude']);

  const retryRes = await agent
    .post('/api/chat/retry')
    .send({
      conversationId: startData.conversationId,
      provider: 'claude',
      mode: 'parallel',
      fallbackProvider: 'chatgpt-5.3-codex-high',
    });

  assert.equal(retryRes.status, 200);
  assert.match(retryRes.text, /event: done/);
  const retryDoneMatch = retryRes.text.match(/event: done\s+data: (.+)/);
  assert.ok(retryDoneMatch);
  const retryDoneData = JSON.parse(retryDoneMatch[1]);
  assert.ok(retryDoneData.turnId);
  const retryTurn = await ParallelCandidateTurn.findOne({ turnId: retryDoneData.turnId }).lean();
  assert.ok(retryTurn);
  assert.equal(retryTurn.status, 'open');

  const afterRetry = await Conversation.findById(startData.conversationId).lean();
  assert.equal(afterRetry.messages.length, 3);
  const retryAssistantProviders = afterRetry.messages
    .filter((m) => m.role === 'assistant')
    .map((m) => m.provider)
    .sort();
  assert.deepEqual(retryAssistantProviders, ['chatgpt-5.3-codex-high', 'claude']);
});

test('parallel accept endpoint commits exactly one winner and is idempotent', async () => {
  const chatRes = await agent
    .post('/api/chat')
    .send({
      message: 'Parallel accept message',
      provider: 'claude',
      mode: 'parallel',
      fallbackProvider: 'chatgpt-5.3-codex-high',
    });

  assert.equal(chatRes.status, 200);

  const startMatch = chatRes.text.match(/event: start\s+data: (.+)/);
  const doneMatch = chatRes.text.match(/event: done\s+data: (.+)/);
  assert.ok(startMatch);
  assert.ok(doneMatch);
  const startData = JSON.parse(startMatch[1]);
  const doneData = JSON.parse(doneMatch[1]);
  assert.ok(doneData.turnId);

  const acceptRes = await agent
    .post(`/api/chat/parallel/${doneData.turnId}/accept`)
    .send({
      conversationId: startData.conversationId,
      provider: 'claude',
    });
  assert.equal(acceptRes.status, 200);
  assert.equal(acceptRes.body.ok, true);
  assert.equal(acceptRes.body.idempotent, false);
  assert.equal(acceptRes.body.acceptedProvider, 'claude');

  const conversationAfterAccept = await Conversation.findById(startData.conversationId).lean();
  const assistantsAfterAccept = conversationAfterAccept.messages.filter((m) => m.role === 'assistant');
  assert.equal(assistantsAfterAccept.length, 1);
  assert.equal(assistantsAfterAccept[0].provider, 'claude');
  assert.equal(assistantsAfterAccept[0].attemptMeta.turnId, doneData.turnId);
  assert.equal(assistantsAfterAccept[0].attemptMeta.accepted, true);
  const turnAfterAccept = await ParallelCandidateTurn.findOne({ turnId: doneData.turnId }).lean();
  assert.ok(turnAfterAccept);
  assert.equal(turnAfterAccept.status, 'accepted');
  assert.equal(turnAfterAccept.acceptedProvider, 'claude');
  assert.equal(turnAfterAccept.acceptedContent, assistantsAfterAccept[0].content);

  const acceptAgainRes = await agent
    .post(`/api/chat/parallel/${doneData.turnId}/accept`)
    .send({
      conversationId: startData.conversationId,
      provider: 'claude',
    });
  assert.equal(acceptAgainRes.status, 200);
  assert.equal(acceptAgainRes.body.idempotent, true);
  assert.equal(acceptAgainRes.body.acceptedProvider, 'claude');

  const conflictingAccept = await agent
    .post(`/api/chat/parallel/${doneData.turnId}/accept`)
    .send({
      conversationId: startData.conversationId,
      provider: 'chatgpt-5.3-codex-high',
    });
  assert.equal(conflictingAccept.status, 409);
  assert.equal(conflictingAccept.body.code, 'TURN_ALREADY_ACCEPTED');
});

test('parallel unaccept endpoint restores both candidates after winner-only acceptance', async () => {
  const chatRes = await agent
    .post('/api/chat')
    .send({
      message: 'Parallel unaccept message',
      provider: 'claude',
      mode: 'parallel',
      fallbackProvider: 'chatgpt-5.3-codex-high',
    });

  assert.equal(chatRes.status, 200);
  const startMatch = chatRes.text.match(/event: start\s+data: (.+)/);
  const doneMatch = chatRes.text.match(/event: done\s+data: (.+)/);
  assert.ok(startMatch);
  assert.ok(doneMatch);
  const startData = JSON.parse(startMatch[1]);
  const doneData = JSON.parse(doneMatch[1]);

  const acceptRes = await agent
    .post(`/api/chat/parallel/${doneData.turnId}/accept`)
    .send({
      conversationId: startData.conversationId,
      provider: 'claude',
    });
  assert.equal(acceptRes.status, 200);
  assert.equal(acceptRes.body.ok, true);

  const unacceptRes = await agent
    .post(`/api/chat/parallel/${doneData.turnId}/unaccept`)
    .send({ conversationId: startData.conversationId });
  assert.equal(unacceptRes.status, 200);
  assert.equal(unacceptRes.body.ok, true);

  const conversationAfterUnaccept = await Conversation.findById(startData.conversationId).lean();
  const assistantsAfterUnaccept = conversationAfterUnaccept.messages.filter((m) => (
    m.role === 'assistant' && m.mode === 'parallel' && m.attemptMeta?.turnId === doneData.turnId
  ));
  assert.equal(assistantsAfterUnaccept.length, 2);
  assert.deepEqual(
    assistantsAfterUnaccept.map((m) => m.provider).sort(),
    ['chatgpt-5.3-codex-high', 'claude']
  );
  for (const assistant of assistantsAfterUnaccept) {
    assert.equal(assistant.attemptMeta.accepted, false);
    assert.equal(assistant.attemptMeta.rejected, false);
  }

  const turnAfterUnaccept = await ParallelCandidateTurn.findOne({ turnId: doneData.turnId }).lean();
  assert.ok(turnAfterUnaccept);
  assert.equal(turnAfterUnaccept.status, 'open');
  assert.equal(turnAfterUnaccept.acceptedProvider, null);
  assert.equal(turnAfterUnaccept.acceptedContent, null);
  assert.equal(turnAfterUnaccept.acceptedAt, null);
});

test('parallel discard endpoint removes unaccepted candidates', async () => {
  const chatRes = await agent
    .post('/api/chat')
    .send({
      message: 'Parallel discard message',
      provider: 'claude',
      mode: 'parallel',
      fallbackProvider: 'chatgpt-5.3-codex-high',
    });
  assert.equal(chatRes.status, 200);

  const startMatch = chatRes.text.match(/event: start\s+data: (.+)/);
  const doneMatch = chatRes.text.match(/event: done\s+data: (.+)/);
  assert.ok(startMatch);
  assert.ok(doneMatch);
  const startData = JSON.parse(startMatch[1]);
  const doneData = JSON.parse(doneMatch[1]);
  assert.ok(doneData.turnId);

  const discardRes = await agent
    .post(`/api/chat/parallel/${doneData.turnId}/discard`)
    .send({ conversationId: startData.conversationId });
  assert.equal(discardRes.status, 200);
  assert.equal(discardRes.body.ok, true);
  assert.equal(discardRes.body.discardedCount, 2);

  const conversationAfterDiscard = await Conversation.findById(startData.conversationId).lean();
  assert.equal(conversationAfterDiscard.messages.length, 1);
  assert.equal(conversationAfterDiscard.messages[0].role, 'user');
  const turnAfterDiscard = await ParallelCandidateTurn.findOne({ turnId: doneData.turnId }).lean();
  assert.ok(turnAfterDiscard);
  assert.equal(turnAfterDiscard.status, 'discarded');
});

test('parallel open-turn cap blocks new chat parallel turn without mutating conversations', async () => {
  const seededConversation = await Conversation.create({
    title: 'Cap seed',
    messages: [{ role: 'user', content: 'seed', timestamp: new Date() }],
    provider: 'claude',
  });

  for (let i = 0; i < 8; i++) {
    await ParallelCandidateTurn.create({
      turnId: `cap-chat-${i}`,
      service: 'chat',
      conversationId: seededConversation._id,
      status: 'open',
      candidates: [{ provider: 'claude', content: 'seed', state: 'ok', latencyMs: 1 }],
    });
  }

  const beforeCount = await Conversation.countDocuments({});
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'Should be blocked by open-turn limit',
      provider: 'claude',
      mode: 'parallel',
      fallbackProvider: 'chatgpt-5.3-codex-high',
    });

  assert.equal(res.status, 429);
  assert.equal(res.body.code, 'PARALLEL_TURN_LIMIT');

  const afterCount = await Conversation.countDocuments({});
  assert.equal(afterCount, beforeCount);
});

test('parallel open-turn cap blocks retry before removing assistant message', async () => {
  const conversation = await Conversation.create({
    title: 'Retry cap',
    provider: 'claude',
    messages: [
      { role: 'user', content: 'hello', timestamp: new Date() },
      { role: 'assistant', content: 'existing answer', provider: 'claude', mode: 'single', timestamp: new Date() },
    ],
  });

  for (let i = 0; i < 8; i++) {
    await ParallelCandidateTurn.create({
      turnId: `cap-retry-${i}`,
      service: 'chat',
      conversationId: conversation._id,
      status: 'open',
      candidates: [{ provider: 'claude', content: 'seed', state: 'ok', latencyMs: 1 }],
    });
  }

  const res = await agent
    .post('/api/chat/retry')
    .send({
      conversationId: conversation._id.toString(),
      provider: 'claude',
      mode: 'parallel',
      fallbackProvider: 'chatgpt-5.3-codex-high',
    });

  assert.equal(res.status, 429);
  assert.equal(res.body.code, 'PARALLEL_TURN_LIMIT');

  const after = await Conversation.findById(conversation._id).lean();
  assert.equal(after.messages.length, 2);
  assert.equal(after.messages[1].role, 'assistant');
  assert.equal(after.messages[1].content, 'existing answer');
});

test('chat guardrail fallback can downgrade parallel mode before open-turn cap check', async () => {
  const seededConversation = await Conversation.create({
    title: 'Guardrail fallback chat',
    messages: [{ role: 'user', content: 'seed', timestamp: new Date() }],
    provider: 'claude',
  });

  for (let i = 0; i < 8; i++) {
    await ParallelCandidateTurn.create({
      turnId: `guardrail-chat-${i}`,
      service: 'chat',
      conversationId: seededConversation._id,
      status: 'open',
      candidates: [{ provider: 'claude', content: 'seed', state: 'ok', latencyMs: 1 }],
    });
  }

  const res = await agent
    .post('/api/chat')
    .send({
      message: 'Should bypass parallel cap via guardrail fallback',
      provider: 'claude',
      mode: 'parallel',
      fallbackProvider: 'chatgpt-5.3-codex-high',
      settings: {
        guardrails: {
          maxEstimatedRequestCostUsd: 0.000001,
          onBudgetExceeded: 'fallback',
        },
      },
    });

  assert.equal(res.status, 200);
  const startMatch = res.text.match(/event: start\s+data: (.+)/);
  const doneMatch = res.text.match(/event: done\s+data: (.+)/);
  assert.ok(startMatch);
  assert.ok(doneMatch);
  const startData = JSON.parse(startMatch[1]);
  const doneData = JSON.parse(doneMatch[1]);
  assert.equal(startData.mode, 'single');
  assert.equal(doneData.mode, 'single');
  // Guardrail fallback picks cheapest provider (gpt-5-mini since P5)
  assert.equal(doneData.providerUsed, 'gpt-5-mini');
});

test('retry guardrail block does not remove existing assistant response', async () => {
  const conversation = await Conversation.create({
    title: 'Retry guardrail block',
    provider: 'claude',
    messages: [
      { role: 'user', content: 'hello', timestamp: new Date() },
      { role: 'assistant', content: 'existing answer', provider: 'claude', mode: 'single', timestamp: new Date() },
    ],
  });

  const res = await agent
    .post('/api/chat/retry')
    .send({
      conversationId: conversation._id.toString(),
      provider: 'claude',
      mode: 'single',
      settings: {
        guardrails: {
          maxEstimatedRequestCostUsd: 0.000001,
          onBudgetExceeded: 'block',
        },
      },
    });

  assert.equal(res.status, 429);
  assert.equal(res.body.code, 'MAX_REQUEST_COST_EXCEEDED');

  const after = await Conversation.findById(conversation._id).lean();
  assert.equal(after.messages.length, 2);
  assert.equal(after.messages[1].role, 'assistant');
  assert.equal(after.messages[1].content, 'existing answer');
});

test('retry guardrail fallback can downgrade parallel mode before open-turn cap check', async () => {
  const conversation = await Conversation.create({
    title: 'Retry guardrail fallback',
    provider: 'claude',
    messages: [
      { role: 'user', content: 'hello', timestamp: new Date() },
      { role: 'assistant', content: 'existing answer', provider: 'claude', mode: 'single', timestamp: new Date() },
    ],
  });

  for (let i = 0; i < 8; i++) {
    await ParallelCandidateTurn.create({
      turnId: `guardrail-retry-${i}`,
      service: 'chat',
      conversationId: conversation._id,
      status: 'open',
      candidates: [{ provider: 'claude', content: 'seed', state: 'ok', latencyMs: 1 }],
    });
  }

  const res = await agent
    .post('/api/chat/retry')
    .send({
      conversationId: conversation._id.toString(),
      provider: 'claude',
      mode: 'parallel',
      fallbackProvider: 'chatgpt-5.3-codex-high',
      settings: {
        guardrails: {
          maxEstimatedRequestCostUsd: 0.000001,
          onBudgetExceeded: 'fallback',
        },
      },
    });

  assert.equal(res.status, 200);
  const doneMatch = res.text.match(/event: done\s+data: (.+)/);
  assert.ok(doneMatch);
  const doneData = JSON.parse(doneMatch[1]);
  assert.equal(doneData.mode, 'single');
  // Guardrail fallback picks cheapest provider (gpt-5-mini since P5)
  assert.equal(doneData.providerUsed, 'gpt-5-mini');
});

test('screenshot upload normalizes and deduplicates by hash', async () => {
  const createdEscalation = await agent
    .post('/api/escalations')
    .send({ category: 'general', attemptingTo: 'Upload screenshot test' });
  assert.equal(createdEscalation.status, 201);

  const escalationId = createdEscalation.body.escalation._id;
  const upload = await agent
    .post(`/api/escalations/${escalationId}/screenshots`)
    .send({ images: [SAMPLE_PNG_DATA_URL, SAMPLE_PNG_DATA_URL] });

  assert.equal(upload.status, 201);
  assert.equal(upload.body.createdCount, 1);
  assert.ok(upload.body.skippedDuplicates >= 1);
  assert.equal(upload.body.escalation.screenshotPaths.length, 1);
  assert.equal(upload.body.escalation.screenshotHashes.length, 1);

  const secondUpload = await agent
    .post(`/api/escalations/${escalationId}/screenshots`)
    .send({ images: [SAMPLE_PNG_DATA_URL] });
  assert.equal(secondUpload.status, 400);
  assert.ok(secondUpload.body.skippedDuplicates >= 1);
});

test('escalation parse endpoint persists parseMeta with provider policy', async () => {
  const res = await agent
    .post('/api/escalations/parse')
    .send({
      text: 'Customer cannot log in and sees error',
      mode: 'single',
      primaryProvider: 'chatgpt-5.3-codex-high',
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.ok, true);
  assert.equal(res.body._meta.providerUsed, 'chatgpt-5.3-codex-high');
  assert.ok(res.body.escalation.parseMeta);
  assert.equal(res.body.escalation.parseMeta.providerUsed, 'chatgpt-5.3-codex-high');
});

test('escalation parse endpoint supports parallel mode with winner and candidates metadata', async () => {
  claude.parseEscalation = async () => ({
    fields: {
      category: 'technical',
      attemptingTo: 'Sign in to QBO',
      actualOutcome: 'Login error shown',
      tsSteps: 'Cleared cache and retried',
      triedTestAccount: 'unknown',
      coid: '12345',
    },
    usage: null,
  });
  codex.parseEscalation = async () => ({
    fields: {
      category: 'technical',
      attemptingTo: 'Sign in to QBO with MFA',
      expectedOutcome: 'User logs in',
      actualOutcome: 'MFA loop blocks login',
      tsSteps: 'Cleared cache, incognito, reset MFA',
      triedTestAccount: 'yes',
      coid: '12345',
      caseNumber: 'CS-777',
    },
    usage: null,
  });

  const res = await agent
    .post('/api/escalations/parse')
    .send({
      text: 'Parallel parse candidate comparison',
      mode: 'parallel',
      primaryProvider: 'claude',
      fallbackProvider: 'chatgpt-5.3-codex-high',
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.ok, true);
  assert.equal(res.body._meta.mode, 'parallel');
  assert.ok(Array.isArray(res.body._meta.candidates));
  assert.equal(res.body._meta.candidates.length, 2);
  assert.ok(res.body._meta.winner);
  assert.equal(res.body._meta.providerUsed, res.body._meta.winner);
  assert.ok(res.body.escalation.parseMeta);
  assert.equal(res.body.escalation.parseMeta.winner, res.body._meta.winner);
});

test('escalation parse endpoint can regex-fallback when providers fail', async () => {
  claude.parseEscalation = async () => {
    const err = new Error('claude down');
    err.code = 'PARSE_PROVIDER_FAILED';
    throw err;
  };
  codex.parseEscalation = async () => {
    const err = new Error('codex down');
    err.code = 'PARSE_PROVIDER_FAILED';
    throw err;
  };

  const text = [
    'COID/MID: 12345 / 67890',
    'CASE: CS-2026-100200',
    'CX IS ATTEMPTING TO: reconnect payroll',
    'EXPECTED OUTCOME: payroll should submit',
    'ACTUAL OUTCOME: payroll tax filing error',
    'TS STEPS: retried filing and cleared cache',
    'TRIED TEST ACCOUNT: no',
  ].join('\n');

  const res = await agent
    .post('/api/escalations/parse')
    .send({
      text,
      mode: 'fallback',
      primaryProvider: 'claude',
      fallbackProvider: 'chatgpt-5.3-codex-high',
    });

  assert.equal(res.status, 201);
  assert.equal(res.body._meta.providerUsed, 'regex');
  assert.equal(res.body._meta.usedRegexFallback, true);
  assert.equal(res.body.escalation.parseMeta.usedRegexFallback, true);
});

test('chat parse-escalation endpoint supports persist mode with parse metadata', async () => {
  claude.parseEscalation = async () => ({
    fields: {
      category: 'technical',
      attemptingTo: 'Sign in to QBO',
      actualOutcome: 'Login error shown',
      tsSteps: 'Cleared cache',
      triedTestAccount: 'unknown',
      coid: '12345',
    },
    usage: null,
  });
  codex.parseEscalation = async () => ({
    fields: {
      category: 'technical',
      attemptingTo: 'Sign in to QBO',
      actualOutcome: 'Login error shown',
      tsSteps: 'Cleared cache',
      triedTestAccount: 'unknown',
      coid: '12345',
    },
    usage: null,
  });

  const res = await agent
    .post('/api/chat/parse-escalation')
    .send({
      text: 'Customer cannot sign in to QBO and sees login error',
      mode: 'single',
      primaryProvider: 'claude',
      persist: true,
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.escalation._id);
  assert.equal(res.body._meta.providerUsed, 'claude');
  assert.ok(res.body.escalation.parseMeta);
  assert.equal(res.body.escalation.parseMeta.providerUsed, 'claude');
});

test('chat parse-escalation endpoint supports parallel parse metadata', async () => {
  claude.parseEscalation = async () => ({
    fields: {
      category: 'technical',
      attemptingTo: 'Sign in to QBO',
      actualOutcome: 'Login error shown',
      tsSteps: 'Cleared cache',
      triedTestAccount: 'unknown',
      coid: '12345',
    },
    usage: null,
  });
  codex.parseEscalation = async () => ({
    fields: {
      category: 'technical',
      attemptingTo: 'Sign in to QBO with MFA',
      expectedOutcome: 'User logs in',
      actualOutcome: 'MFA loop blocks login',
      tsSteps: 'Cleared cache and reset MFA',
      triedTestAccount: 'yes',
      coid: '12345',
      caseNumber: 'CS-900',
    },
    usage: null,
  });

  const res = await agent
    .post('/api/chat/parse-escalation')
    .send({
      text: 'Parallel parse from chat endpoint',
      mode: 'parallel',
      primaryProvider: 'claude',
      fallbackProvider: 'chatgpt-5.3-codex-high',
      persist: true,
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.ok, true);
  assert.equal(res.body._meta.mode, 'parallel');
  assert.ok(Array.isArray(res.body._meta.candidates));
  assert.equal(res.body._meta.candidates.length, 2);
  assert.ok(res.body._meta.winner);
  assert.equal(res.body._meta.providerUsed, res.body._meta.winner);
  assert.equal(res.body.escalation.parseMeta.winner, res.body._meta.winner);
});

// ---------- Phase 5: New provider ID acceptance ----------

test('P5: chat accepts claude-sonnet-4-6 as primaryProvider', async () => {
  const res = await agent
    .post('/api/chat')
    .send({ message: 'P5 test', primaryProvider: 'claude-sonnet-4-6' })
    .expect(200);

  assert.equal(res.headers['content-type'].includes('text/event-stream'), true);
});

test('P5: chat accepts gpt-5-mini as primaryProvider', async () => {
  const res = await agent
    .post('/api/chat')
    .send({ message: 'P5 test', primaryProvider: 'gpt-5-mini' })
    .expect(200);

  assert.equal(res.headers['content-type'].includes('text/event-stream'), true);
});

test('P5: chat rejects invalid provider ID', async () => {
  const res = await agent
    .post('/api/chat')
    .send({ message: 'test', primaryProvider: 'invalid-provider' })
    .expect(400);

  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_PROVIDER');
});

test('P5: chat fallback works across provider families', async () => {
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'P5 fallback test',
      primaryProvider: 'claude-sonnet-4-6',
      fallbackProvider: 'gpt-5-mini',
      mode: 'fallback',
    })
    .expect(200);

  assert.equal(res.headers['content-type'].includes('text/event-stream'), true);
});

test('P5: conversation persists new provider IDs', async () => {
  await agent
    .post('/api/chat')
    .send({ message: 'P5 persist test', primaryProvider: 'claude-sonnet-4-6' })
    .expect(200);

  const Conversation = require('../src/models/Conversation');
  const conv = await Conversation.findOne({ title: /P5 persist test/ }).lean();
  assert.ok(conv, 'conversation should exist');
  assert.equal(conv.provider, 'claude-sonnet-4-6');
});

test('P5: escalation parse accepts new provider IDs', async () => {
  const res = await agent
    .post('/api/escalations/parse')
    .send({
      text: 'P5 parse test',
      provider: 'gpt-5-mini',
    });

  assert.ok([200, 201].includes(res.status));
  assert.equal(res.body.ok, true);
});

test('P5: chat retry accepts new provider IDs', async () => {
  // Create a conversation first
  await agent
    .post('/api/chat')
    .send({ message: 'P5 retry setup', primaryProvider: 'claude-sonnet-4-6' })
    .expect(200);

  const Conversation = require('../src/models/Conversation');
  const conv = await Conversation.findOne({ title: /P5 retry setup/ }).lean();
  assert.ok(conv);

  const retryRes = await agent
    .post('/api/chat/retry')
    .send({
      conversationId: conv._id.toString(),
      primaryProvider: 'gpt-5-mini',
    })
    .expect(200);

  assert.equal(retryRes.headers['content-type'].includes('text/event-stream'), true);
});

test('P5: chat parse-escalation accepts new provider IDs', async () => {
  const res = await agent
    .post('/api/chat/parse-escalation')
    .send({
      text: 'P5 chat parse test',
      provider: 'claude-sonnet-4-6',
    });

  assert.ok([200, 201].includes(res.status));
  assert.equal(res.body.ok, true);
});

test('P5: parse parallel mode downgrades to single when providers collapse', async () => {
  const res = await agent
    .post('/api/escalations/parse')
    .send({
      text: 'P5 parallel collapse test',
      mode: 'parallel',
      primaryProvider: 'claude-sonnet-4-6',
      fallbackProvider: 'claude-sonnet-4-6',
    });

  assert.ok([200, 201].includes(res.status));
  assert.equal(res.body.ok, true);
  assert.equal(res.body._meta.mode, 'single');
});
