const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { createApp } = require('../src/app');
const Conversation = require('../src/models/Conversation');
const claude = require('../src/services/claude');
const codex = require('../src/services/codex');

const SAMPLE_IMAGE = 'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3Z8UkAAAAASUVORK5CYII=';

let mongod;
let app;
let agent;
let originalClaudeChat;
let originalCodexChat;

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

test.before(async () => {
  process.env.NODE_ENV = 'test';
  delete process.env.ADMIN_API_KEY;
  delete process.env.EDITOR_API_KEY;
  delete process.env.VIEWER_API_KEY;

  originalClaudeChat = claude.chat;
  originalCodexChat = codex.chat;
  setDefaultChatStubs();

  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp();
  agent = request(app);
});

test.after(async () => {
  claude.chat = originalClaudeChat;
  codex.chat = originalCodexChat;
  delete process.env.FEATURE_CHAT_PROVIDER_PARITY;
  delete process.env.FEATURE_CHAT_FALLBACK_MODE;
  delete process.env.CHAT_MAX_IMAGES_PER_REQUEST;
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test.beforeEach(async () => {
  setDefaultChatStubs();
  delete process.env.FEATURE_CHAT_PROVIDER_PARITY;
  delete process.env.FEATURE_CHAT_FALLBACK_MODE;
  delete process.env.CHAT_MAX_IMAGES_PER_REQUEST;
  await Conversation.deleteMany({});
});

test('chat fallback streams provider_error and fallback events then succeeds on alternate', async () => {
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
      fallbackProvider: 'chatgpt-5.3-codex-high',
    });

  assert.equal(res.status, 200);
  assert.match(res.text, /event: provider_error/);
  assert.match(res.text, /event: fallback/);
  assert.match(res.text, /event: done/);

  const done = parseEvent(res.text, 'done');
  assert.ok(done);
  assert.equal(done.providerUsed, 'chatgpt-5.3-codex-high');
  assert.equal(done.fallbackUsed, true);
  assert.equal(done.fallbackFrom, 'claude');
});

test('chat retry supports fallback policy and emits fallback metadata', async () => {
  const first = await agent
    .post('/api/chat')
    .send({ message: 'first', provider: 'claude' });
  assert.equal(first.status, 200);
  const start = parseEvent(first.text, 'start');
  assert.ok(start);

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
      fallbackProvider: 'chatgpt-5.3-codex-high',
    });

  assert.equal(retry.status, 200);
  assert.match(retry.text, /event: fallback/);
  const done = parseEvent(retry.text, 'done');
  assert.ok(done);
  assert.equal(done.providerUsed, 'chatgpt-5.3-codex-high');
  assert.equal(done.fallbackUsed, true);
  assert.equal(done.fallbackFrom, 'claude');
});

test('fallback mode flag disables fallback execution path', async () => {
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
      fallbackProvider: 'chatgpt-5.3-codex-high',
    });

  assert.equal(res.status, 200);
  const done = parseEvent(res.text, 'done');
  assert.ok(done);
  assert.equal(done.providerUsed, 'claude');
  assert.equal(done.fallbackUsed, false);
  assert.equal(codexCalled, false);
});

test('provider parity flag forces legacy default provider path', async () => {
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
      provider: 'chatgpt-5.3-codex-high',
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

test('chat image guardrails reject requests exceeding max image count', async () => {
  process.env.CHAT_MAX_IMAGES_PER_REQUEST = '1';
  const beforeCount = await Conversation.countDocuments({});

  const res = await agent
    .post('/api/chat')
    .send({
      images: [SAMPLE_IMAGE, SAMPLE_IMAGE],
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'TOO_MANY_IMAGES');

  const afterCount = await Conversation.countDocuments({});
  assert.equal(afterCount, beforeCount);
});
