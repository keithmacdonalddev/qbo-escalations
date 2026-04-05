const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const Conversation = require('../src/models/Conversation');
const Escalation = require('../src/models/Escalation');
const Template = require('../src/models/Template');
const ParallelCandidateTurn = require('../src/models/ParallelCandidateTurn');
const claude = require('../src/services/claude');
const codex = require('../src/services/codex');

const SAMPLE_PNG_DATA_URL = 'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3Z8UkAAAAASUVORK5CYII=';
function parseSseEvents(payload) {
  const blocks = String(payload || '').split('\n\n');
  const events = [];
  for (const block of blocks) {
    if (!block || block.startsWith(':')) continue;
    const lines = block.split('\n');
    let event = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        data += (data ? '\n' : '') + line.slice('data:'.length).trim();
      }
    }
    if (event) events.push({ event, data });
  }
  return events;
}

test("integration-routes suite", async (t) => {
  let app;
  let agent;
  let originalClaudeChat;
  let originalCodexChat;
  let originalClaudeParse;
  let originalCodexParse;

t.before(async () => {
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

  await connect();

  app = createApp();
  agent = request(app);
});

t.after(async () => {
  claude.chat = originalClaudeChat;
  codex.chat = originalCodexChat;
  claude.parseEscalation = originalClaudeParse;
  codex.parseEscalation = originalCodexParse;

  await disconnect();
});

t.beforeEach(async () => {
  await Promise.all([
    Conversation.deleteMany({}),
    Escalation.deleteMany({}),
    Template.deleteMany({}),
    ParallelCandidateTurn.deleteMany({}),
  ]);
});

await t.test('template create/update/delete works without auth in local mode', async () => {
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

await t.test('from-conversation links both records and deleting conversation unlinks escalation', async () => {
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

await t.test('deleting escalation unlinks linked conversation', async () => {
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

await t.test('conversations list escapes regex-like search input', async () => {
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

await t.test('conversations list tolerates non-string search and invalid paging values', async () => {
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

await t.test('conversation routes return 400 for invalid ids', async () => {
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

await t.test('chat and retry endpoints stream SSE and persist conversation updates', async () => {
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

await t.test('chat and retry SSE expose per-request model overrides', async () => {
  const previousClaudeChat = claude.chat;
  const receivedModels = [];
  claude.chat = ({ model, onChunk, onDone }) => {
    receivedModels.push(model || null);
    onChunk('override response');
    onDone('override response');
    return () => {};
  };

  try {
    const chatRes = await agent
      .post('/api/chat')
      .send({
        message: 'Model override message',
        provider: 'claude',
        primaryModel: 'claude-chat-override',
      });
    assert.equal(chatRes.status, 200);

    const chatEvents = parseSseEvents(chatRes.text);
    const chatStart = JSON.parse(chatEvents.find((event) => event.event === 'start').data);
    const chatDone = JSON.parse(chatEvents.find((event) => event.event === 'done').data);

    assert.equal(chatStart.primaryModel, 'claude-chat-override');
    assert.equal(chatStart.fallbackModel, null);
    assert.equal(chatDone.modelUsed, 'claude-chat-override');
    assert.equal(receivedModels[0], 'claude-chat-override');

    const retryRes = await agent
      .post('/api/chat/retry')
      .send({
        conversationId: chatStart.conversationId,
        provider: 'claude',
        primaryModel: 'claude-retry-override',
      });
    assert.equal(retryRes.status, 200);

    const retryEvents = parseSseEvents(retryRes.text);
    const retryStart = JSON.parse(retryEvents.find((event) => event.event === 'start').data);
    const retryDone = JSON.parse(retryEvents.find((event) => event.event === 'done').data);

    assert.equal(retryStart.primaryModel, 'claude-retry-override');
    assert.equal(retryStart.fallbackModel, null);
    assert.equal(retryDone.modelUsed, 'claude-retry-override');
    assert.equal(receivedModels[1], 'claude-retry-override');
  } finally {
    claude.chat = previousClaudeChat;
  }
});

await t.test('image chat is rejected and does not create a conversation', async () => {
  const beforeCount = await Conversation.countDocuments({});
  const chatRes = await agent
    .post('/api/chat')
    .send({ message: '', images: [SAMPLE_PNG_DATA_URL], provider: 'claude' });

  assert.equal(chatRes.status, 400);
  assert.equal(chatRes.body.code, 'CHAT_IMAGES_DISABLED');

  const afterCount = await Conversation.countDocuments({});
  assert.equal(afterCount, beforeCount);
});

await t.test('parallel chat mode persists both provider responses and retry replaces both', async () => {
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

await t.test('parallel accept endpoint commits exactly one winner and is idempotent', async () => {
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

await t.test('parallel unaccept endpoint restores both candidates after winner-only acceptance', async () => {
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

await t.test('parallel discard endpoint removes unaccepted candidates', async () => {
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

await t.test('screenshot upload normalizes and deduplicates by hash', async () => {
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

// ---------- Phase 5: New provider ID acceptance ----------

await t.test('P5: chat accepts claude-sonnet-4-6 as primaryProvider', async () => {
  const res = await agent
    .post('/api/chat')
    .send({ message: 'P5 test', primaryProvider: 'claude-sonnet-4-6' })
    .expect(200);

  assert.equal(res.headers['content-type'].includes('text/event-stream'), true);
});

await t.test('P5: chat accepts gpt-5-mini as primaryProvider', async () => {
  const res = await agent
    .post('/api/chat')
    .send({ message: 'P5 test', primaryProvider: 'gpt-5-mini' })
    .expect(200);

  assert.equal(res.headers['content-type'].includes('text/event-stream'), true);
});

await t.test('P5: chat rejects invalid provider ID', async () => {
  const res = await agent
    .post('/api/chat')
    .send({ message: 'test', primaryProvider: 'invalid-provider' })
    .expect(400);

  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_PROVIDER');
});

await t.test('P5: chat fallback works across provider families', async () => {
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

await t.test('P5: conversation persists new provider IDs', async () => {
  await agent
    .post('/api/chat')
    .send({ message: 'P5 persist test', primaryProvider: 'claude-sonnet-4-6' })
    .expect(200);

  const Conversation = require('../src/models/Conversation');
  const conv = await Conversation.findOne({ title: /P5 persist test/ }).lean();
  assert.ok(conv, 'conversation should exist');
  assert.equal(conv.provider, 'claude-sonnet-4-6');
});

await t.test('P5: escalation parse accepts new provider IDs', async () => {
  const res = await agent
    .post('/api/escalations/parse')
    .send({
      text: 'P5 parse test',
      provider: 'gpt-5-mini',
    });

  assert.ok([200, 201].includes(res.status));
  assert.equal(res.body.ok, true);
});

await t.test('P5: chat retry accepts new provider IDs', async () => {
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

await t.test('P5: chat parse-escalation accepts new provider IDs', async () => {
  const res = await agent
    .post('/api/chat/parse-escalation')
    .send({
      text: 'P5 chat parse test',
      provider: 'claude-sonnet-4-6',
    });

  assert.ok([200, 201].includes(res.status));
  assert.equal(res.body.ok, true);
});

await t.test('POST /api/chat/parse-escalation returns triageCard payload', async () => {
  const res = await agent
    .post('/api/chat/parse-escalation')
    .send({
      text: [
        'COID/MID: 12345 / 67890',
        'CASE: CS-2026-002001',
        'CLIENT/CONTACT: Example Client',
        'AGENT: Jamie Agent',
        'CX IS ATTEMPTING TO: sign in to QuickBooks Online',
        'EXPECTED OUTCOME: customer signs in successfully',
        'ACTUAL OUTCOME: login error shown after MFA',
        'TS STEPS: cleared cache and retried in incognito',
        'TRIED TEST ACCOUNT: yes',
      ].join('\n'),
      provider: 'claude',
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.triageCard);
  assert.equal(res.body.triageCard.agent, 'Jamie Agent');
  assert.equal(res.body.triageCard.client, 'Example Client');
  assert.equal(res.body.triageCard.category, 'technical');
  assert.ok(['P2', 'P3'].includes(res.body.triageCard.severity));
  assert.ok(typeof res.body.triageCard.read === 'string' && res.body.triageCard.read.length > 0);
  assert.ok(typeof res.body.triageCard.action === 'string' && res.body.triageCard.action.length > 0);
  assert.ok(res.body._meta);
});

await t.test('POST /api/chat emits triage_card for parsedEscalationText handoff', async () => {
  const extractedText = [
    'COID/MID: 12345 / 67890',
    'CASE: CS-2026-002001',
    'CLIENT/CONTACT: Example Client',
    'AGENT: Jamie Agent',
    'CX IS ATTEMPTING TO: sign in to QuickBooks Online',
    'EXPECTED OUTCOME: customer signs in successfully',
    'ACTUAL OUTCOME: login error shown after MFA',
    'TS STEPS: cleared cache and retried in incognito',
    'TRIED TEST ACCOUNT: yes',
  ].join('\n');

  const res = await agent
    .post('/api/chat')
    .send({
      message: [
        'Parsed escalation preview',
        'Case CS-2026-002001',
        'Client: Example Client',
        'Issue: login error shown after MFA',
      ].join('\n'),
      parsedEscalationText: extractedText,
      parsedEscalationSource: 'image-parser',
      parsedEscalationProvider: 'claude',
      provider: 'claude',
    })
    .expect(200);

  const events = parseSseEvents(res.text);
  const triageEvent = events.find((event) => event.event === 'triage_card');
  assert.ok(triageEvent, 'triage_card event should be present');
  const triageData = JSON.parse(triageEvent.data);
  assert.equal(triageData.agent, 'Jamie Agent');
  assert.equal(triageData.client, 'Example Client');
  assert.equal(triageData.category, 'technical');
  assert.ok(['P2', 'P3'].includes(triageData.severity));
  assert.ok(typeof triageData.read === 'string' && triageData.read.length > 0);
  assert.ok(typeof triageData.action === 'string' && triageData.action.length > 0);
});

// ---------- Phase 6: N-way parallelProviders route tests ----------

await t.test('POST /api/chat rejects parallelProviders with 1 provider', async () => {
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'test',
      mode: 'parallel',
      parallelProviders: ['claude'],
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'PARALLEL_PROVIDER_COUNT_INVALID');
});

await t.test('POST /api/chat rejects parallelProviders with 5 providers', async () => {
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'test',
      mode: 'parallel',
      parallelProviders: ['claude', 'chatgpt-5.3-codex-high', 'claude-sonnet-4-6', 'gpt-5-mini', 'claude'],
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'PARALLEL_PROVIDER_COUNT_INVALID');
});

await t.test('POST /api/chat rejects parallelProviders with invalid provider', async () => {
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'test',
      mode: 'parallel',
      parallelProviders: ['claude', 'invalid-provider'],
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_PARALLEL_PROVIDERS');
});

await t.test('POST /api/chat rejects parallelProviders when mode is not parallel', async () => {
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'test',
      mode: 'single',
      parallelProviders: ['claude', 'gpt-5-mini'],
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_PARALLEL_PROVIDERS');
});

await t.test('POST /api/chat rejects when primaryProvider not in parallelProviders', async () => {
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'test',
      mode: 'parallel',
      primaryProvider: 'gpt-5-mini',
      parallelProviders: ['claude', 'chatgpt-5.3-codex-high'],
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_PARALLEL_PROVIDERS');
});

await t.test('POST /api/chat parallel mode without parallelProviders still works (legacy)', async () => {
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'test legacy parallel',
      mode: 'parallel',
      provider: 'claude',
      fallbackProvider: 'gpt-5-mini',
    });

  assert.equal(res.status, 200);

  const events = parseSseEvents(res.text);
  const startEvent = events.find((e) => e.event === 'start');
  assert.ok(startEvent, 'start event must be present');
  const startData = JSON.parse(startEvent.data);
  assert.ok(Array.isArray(startData.parallelProviders));
  assert.equal(startData.parallelProviders.length, 2);
});

await t.test('parallel accept rejects provider not in requestedProviders for 3-way', async () => {
  const chatRes = await agent
    .post('/api/chat')
    .send({
      message: 'accept reject test',
      mode: 'parallel',
      parallelProviders: ['claude', 'chatgpt-5.3-codex-high', 'claude-sonnet-4-6'],
    });
  assert.equal(chatRes.status, 200);

  const events = parseSseEvents(chatRes.text);
  const startEvent = events.find((e) => e.event === 'start');
  const startData = JSON.parse(startEvent.data);
  const doneEvent = events.find((e) => e.event === 'done');
  const doneData = JSON.parse(doneEvent.data);

  // Try to accept gpt-5-mini which was NOT in the parallelProviders
  const acceptRes = await agent
    .post(`/api/chat/parallel/${doneData.turnId}/accept`)
    .send({
      conversationId: startData.conversationId,
      provider: 'gpt-5-mini',
    });
  assert.equal(acceptRes.status, 400);
  assert.equal(acceptRes.body.code, 'INVALID_PROVIDER');
});

await t.test('POST /api/chat rejects duplicate parallelProviders', async () => {
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'test',
      mode: 'parallel',
      parallelProviders: ['claude', 'claude', 'gpt-5-mini'],
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_PARALLEL_PROVIDERS');
});

await t.test('POST /api/chat rejects parallelProviders that is not an array', async () => {
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'test',
      mode: 'parallel',
      parallelProviders: 'claude',
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_PARALLEL_PROVIDERS');
});

await t.test('POST /api/chat/retry rejects invalid parallelProviders', async () => {
  // Create initial conversation
  const chatRes = await agent
    .post('/api/chat')
    .send({ message: 'retry validation setup', provider: 'claude' });
  assert.equal(chatRes.status, 200);

  const chatEvents = parseSseEvents(chatRes.text);
  const chatStart = chatEvents.find((e) => e.event === 'start');
  const chatStartData = JSON.parse(chatStart.data);

  const retryRes = await agent
    .post('/api/chat/retry')
    .send({
      conversationId: chatStartData.conversationId,
      mode: 'parallel',
      parallelProviders: ['claude', 'invalid-provider'],
    });

  assert.equal(retryRes.status, 400);
  assert.equal(retryRes.body.ok, false);
  assert.equal(retryRes.body.code, 'INVALID_PARALLEL_PROVIDERS');
});

// ──────────────────────────────────────────────
// COPILOT: improve-template
// ──────────────────────────────────────────────

await t.test('POST /api/copilot/improve-template returns 400 when templateContent is missing', async () => {
  const res = await agent
    .post('/api/copilot/improve-template')
    .send({});

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'VALIDATION');
});

await t.test('POST /api/copilot/improve-template returns 400 when templateContent is empty string', async () => {
  const res = await agent
    .post('/api/copilot/improve-template')
    .send({ templateContent: '' });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'VALIDATION');
});

await t.test('POST /api/copilot/improve-template returns 400 when templateContent is not a string', async () => {
  const res = await agent
    .post('/api/copilot/improve-template')
    .send({ templateContent: 123 });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'VALIDATION');
});

await t.test('POST /api/copilot/improve-template streams improvement for valid templateContent', async () => {
  const res = await agent
    .post('/api/copilot/improve-template')
    .send({ templateContent: 'Hello {{CLIENT_NAME}}, your issue has been resolved.' });

  assert.equal(res.status, 200);

  const events = parseSseEvents(res.text);
  const startEvent = events.find((e) => e.event === 'start');
  assert.ok(startEvent, 'start event must be present');
  const startData = JSON.parse(startEvent.data);
  assert.equal(startData.type, 'improve-template');

  const doneEvent = events.find((e) => e.event === 'done');
  assert.ok(doneEvent, 'done event must be present');
  const doneData = JSON.parse(doneEvent.data);
  assert.equal(doneData.fullResponse, 'mock assistant response');
});
});
