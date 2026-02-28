const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const Escalation = require('../src/models/Escalation');
const Conversation = require('../src/models/Conversation');
const DevConversation = require('../src/models/DevConversation');
const UsageLog = require('../src/models/UsageLog');
const ParallelCandidateTurn = require('../src/models/ParallelCandidateTurn');
const Template = require('../src/models/Template');
const claude = require('../src/services/claude');
const codex = require('../src/services/codex');
const { drainPendingWrites, resetDrain } = require('../src/lib/usage-writer');

const FAKE_USAGE = Object.freeze({
  model: 'claude-sonnet-4-5-20250514',
  inputTokens: 500,
  outputTokens: 200,
  usageComplete: true,
  rawUsage: { input_tokens: 500, output_tokens: 200 },
});

const FAKE_USAGE_CODEX = Object.freeze({
  model: 'gpt-4o-mini',
  inputTokens: 300,
  outputTokens: 100,
  usageComplete: true,
  rawUsage: { input_tokens: 300, output_tokens: 100 },
});

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

test("usage-integration suite", async (t) => {
let app;
let agent;
let httpServer;
let httpPort;
let originalClaudeChat;
let originalCodexChat;
let originalClaudeParse;
let originalCodexParse;

// Configurable stub: tests override per-scenario before each request.
let currentClaudeStub;
let currentCodexStub;

function makeFakeStreamOk(usage) {
  return ({ onChunk, onDone }) => {
    if (onChunk) onChunk('mock assistant response');
    if (onDone) onDone('mock assistant response', usage);
    return () => ({});
  };
}

function makeFakeStreamError(usage) {
  return ({ onError }) => {
    const err = new Error('provider execution failed');
    err.code = 'PROVIDER_EXEC_FAILED';
    if (usage) err._usage = usage;
    if (onError) onError(err);
    return () => ({});
  };
}

/**
 * Create a stub that delays forever (never settles). Used for abort/disconnect tests.
 * The returned cleanup function returns the given abortUsage object.
 */
function makeFakeStreamHanging(abortUsage) {
  return () => {
    // Never call onChunk/onDone/onError — stream stays in-flight.
    return () => ({ usage: abortUsage || null });
  };
}

t.before(async () => {
  process.env.NODE_ENV = 'test';
  delete process.env.ADMIN_API_KEY;
  delete process.env.EDITOR_API_KEY;
  delete process.env.VIEWER_API_KEY;

  originalClaudeChat = claude.chat;
  originalCodexChat = codex.chat;
  originalClaudeParse = claude.parseEscalation;
  originalCodexParse = codex.parseEscalation;

  currentClaudeStub = makeFakeStreamOk(FAKE_USAGE);
  currentCodexStub = makeFakeStreamOk(FAKE_USAGE_CODEX);

  claude.chat = (opts) => currentClaudeStub(opts);
  codex.chat = (opts) => currentCodexStub(opts);
  claude.parseEscalation = async () => ({
    fields: {
      category: 'technical',
      attemptingTo: 'Sign in to QBO',
      actualOutcome: 'Login error shown',
      tsSteps: 'Cleared cache',
      triedTestAccount: 'unknown',
      coid: '12345',
    },
    usage: FAKE_USAGE,
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
    usage: FAKE_USAGE_CODEX,
  });

  await connect();
  await UsageLog.syncIndexes();

  app = createApp();
  agent = request(app);

  // Start an http server for raw request tests (abort/disconnect)
  httpServer = http.createServer(app);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  httpPort = httpServer.address().port;
});

t.after(async () => {
  claude.chat = originalClaudeChat;
  codex.chat = originalCodexChat;
  claude.parseEscalation = originalClaudeParse;
  codex.parseEscalation = originalCodexParse;

  if (httpServer) await new Promise((r) => httpServer.close(r));
  await disconnect();
});

t.beforeEach(async () => {
  resetDrain();
  currentClaudeStub = makeFakeStreamOk(FAKE_USAGE);
  currentCodexStub = makeFakeStreamOk(FAKE_USAGE_CODEX);
  await Promise.all([
    UsageLog.deleteMany({}),
    Conversation.deleteMany({}),
    DevConversation.deleteMany({}),
    Escalation.deleteMany({}),
    ParallelCandidateTurn.deleteMany({}),
    Template.deleteMany({}),
  ]);
});

// ================================================================
//  /api/chat — single mode, ok path
// ================================================================
await t.test('POST /api/chat (single, ok) → UsageLog service=chat, status=ok, correct tokens', async () => {
  const res = await agent
    .post('/api/chat')
    .send({ message: 'What is bank feeds?', mode: 'single' })
    .expect(200);

  const events = parseSseEvents(res.text);
  assert.ok(events.find((e) => e.event === 'done'), 'done event');

  await drainPendingWrites(5000);
  resetDrain();

  const docs = await UsageLog.find({ service: 'chat' }).lean();
  assert.ok(docs.length >= 1, 'at least one UsageLog for chat');

  const doc = docs[0];
  assert.equal(doc.service, 'chat');
  assert.equal(doc.provider, 'claude');
  assert.equal(doc.status, 'ok');
  assert.equal(doc.inputTokens, 500);
  assert.equal(doc.outputTokens, 200);
  assert.equal(doc.totalTokens, 700);
  assert.equal(doc.usageAvailable, true);
  assert.equal(doc.usageComplete, true);
  assert.ok(doc.totalCostNanos > 0, 'cost nanos positive');
  assert.ok(doc.requestId, 'requestId set');
});

// ================================================================
//  /api/chat — single mode, error path
// ================================================================
await t.test('POST /api/chat (single, error) → UsageLog status=error, partial usage', async () => {
  currentClaudeStub = makeFakeStreamError({ ...FAKE_USAGE, inputTokens: 100, outputTokens: 0 });

  const res = await agent
    .post('/api/chat')
    .send({ message: 'This should fail', mode: 'single' })
    .expect(200);

  assert.ok(parseSseEvents(res.text).find((e) => e.event === 'error'), 'error event');

  await drainPendingWrites(5000);
  resetDrain();

  const doc = await UsageLog.findOne({ service: 'chat' }).lean();
  assert.ok(doc);
  assert.equal(doc.status, 'error');
  assert.equal(doc.inputTokens, 100);
  assert.equal(doc.outputTokens, 0);
  assert.equal(doc.usageAvailable, true);
});

// ================================================================
//  /api/chat — fallback mode: primary fails → fallback succeeds
// ================================================================
await t.test('POST /api/chat (fallback) → UsageLog for primary error + fallback ok', async () => {
  currentClaudeStub = makeFakeStreamError(null);
  currentCodexStub = makeFakeStreamOk(FAKE_USAGE_CODEX);

  const res = await agent
    .post('/api/chat')
    .send({
      message: 'Fallback test',
      mode: 'fallback',
      primaryProvider: 'claude',
      fallbackProvider: 'chatgpt-5.3-codex-high',
    })
    .expect(200);

  assert.ok(parseSseEvents(res.text).find((e) => e.event === 'done'), 'done event via fallback');

  await drainPendingWrites(5000);
  resetDrain();

  const docs = await UsageLog.find({ service: 'chat' }).sort({ attemptIndex: 1 }).lean();
  assert.ok(docs.length >= 2, 'UsageLog for both attempts');

  const primary = docs.find((d) => d.provider === 'claude');
  assert.ok(primary, 'primary attempt log');
  assert.equal(primary.status, 'error');

  const fallback = docs.find((d) => d.provider === 'chatgpt-5.3-codex-high');
  assert.ok(fallback, 'fallback attempt log');
  assert.equal(fallback.status, 'ok');
  assert.equal(fallback.inputTokens, 300);
  assert.equal(fallback.outputTokens, 100);
});

// ================================================================
//  /api/chat — conversationId propagated to UsageLog
// ================================================================
await t.test('POST /api/chat writes conversationId into UsageLog', async () => {
  const res = await agent.post('/api/chat').send({ message: 'ConvId test' }).expect(200);

  const startEvent = parseSseEvents(res.text).find((e) => e.event === 'start');
  const conversationId = JSON.parse(startEvent.data).conversationId;
  assert.ok(conversationId);

  await drainPendingWrites(5000);
  resetDrain();

  const doc = await UsageLog.findOne({ service: 'chat' }).lean();
  assert.equal(String(doc.conversationId), conversationId);
});

// ================================================================
//  /api/chat — usageAvailable=false when provider returns no usage
// ================================================================
await t.test('POST /api/chat with null usage → usageAvailable=false', async () => {
  currentClaudeStub = makeFakeStreamOk(null);

  await agent.post('/api/chat').send({ message: 'No usage' }).expect(200);

  await drainPendingWrites(5000);
  resetDrain();

  const doc = await UsageLog.findOne({ service: 'chat' }).lean();
  assert.ok(doc);
  assert.equal(doc.usageAvailable, false);
  assert.equal(doc.usageComplete, false);
  assert.equal(doc.inputTokens, 0);
  assert.equal(doc.outputTokens, 0);
});

// ================================================================
//  /api/chat — mode field persisted correctly
// ================================================================
await t.test('POST /api/chat mode persisted in UsageLog for every attempt', async () => {
  currentClaudeStub = makeFakeStreamError(null);
  currentCodexStub = makeFakeStreamOk(FAKE_USAGE_CODEX);

  await agent
    .post('/api/chat')
    .send({
      message: 'Mode test',
      mode: 'fallback',
      primaryProvider: 'claude',
      fallbackProvider: 'chatgpt-5.3-codex-high',
    })
    .expect(200);

  await drainPendingWrites(5000);
  resetDrain();

  const docs = await UsageLog.find({ service: 'chat' }).lean();
  for (const doc of docs) {
    assert.equal(doc.mode, 'fallback');
  }
});

// ================================================================
//  /api/chat/retry — ok path
// ================================================================
await t.test('POST /api/chat/retry → UsageLog service=chat with correct conversationId', async () => {
  // First: create a conversation with a user + assistant turn
  const chatRes = await agent.post('/api/chat').send({ message: 'Initial message' }).expect(200);
  const conversationId = JSON.parse(parseSseEvents(chatRes.text).find((e) => e.event === 'start').data).conversationId;

  await drainPendingWrites(5000);
  resetDrain();
  await UsageLog.deleteMany({});

  // Retry the last turn
  const retryRes = await agent
    .post('/api/chat/retry')
    .send({ conversationId })
    .expect(200);

  assert.ok(parseSseEvents(retryRes.text).find((e) => e.event === 'done'), 'retry done event');

  await drainPendingWrites(5000);
  resetDrain();

  const doc = await UsageLog.findOne({ service: 'chat' }).lean();
  assert.ok(doc, 'UsageLog from retry');
  assert.equal(doc.service, 'chat');
  assert.equal(doc.status, 'ok');
  assert.equal(String(doc.conversationId), conversationId);
  assert.equal(doc.inputTokens, 500);
  assert.equal(doc.outputTokens, 200);
});

// ================================================================
//  /api/chat/retry — error path
// ================================================================
await t.test('POST /api/chat/retry (error) → UsageLog status=error', async () => {
  // Create conversation first with ok stub
  const chatRes = await agent.post('/api/chat').send({ message: 'Setup' }).expect(200);
  const conversationId = JSON.parse(parseSseEvents(chatRes.text).find((e) => e.event === 'start').data).conversationId;

  await drainPendingWrites(5000);
  resetDrain();
  await UsageLog.deleteMany({});

  // Now switch to error stub for the retry
  currentClaudeStub = makeFakeStreamError({ ...FAKE_USAGE, inputTokens: 80, outputTokens: 0 });

  const retryRes = await agent.post('/api/chat/retry').send({ conversationId }).expect(200);
  assert.ok(parseSseEvents(retryRes.text).find((e) => e.event === 'error'), 'retry error event');

  await drainPendingWrites(5000);
  resetDrain();

  const doc = await UsageLog.findOne({ service: 'chat' }).lean();
  assert.ok(doc, 'UsageLog from failed retry');
  assert.equal(doc.status, 'error');
  assert.equal(doc.inputTokens, 80);
});

// ================================================================
//  /api/chat — client disconnect / abort fires onAbort usage log
// ================================================================
await t.test('POST /api/chat client disconnect → abort path does not misclassify as ok', async () => {
  // Hanging stub: never resolves, returned cleanup carries abort usage
  currentClaudeStub = makeFakeStreamHanging({ model: 'claude-sonnet-4-5-20250514', inputTokens: 42, outputTokens: 0, usageComplete: false });

  // Use raw HTTP so we can destroy the connection mid-stream
  const payload = JSON.stringify({ message: 'abort me' });
  await new Promise((resolve) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: httpPort, path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        // As soon as we get the response headers (SSE started), destroy.
        res.once('data', () => {
          req.destroy();
        });
        res.on('error', () => { /* expected */ });
      },
    );
    req.on('error', () => { /* ECONNRESET expected */ });
    req.on('close', () => resolve());
    req.write(payload);
    req.end();
  });

  // Give the server a moment to process the close event and fire onAbort
  await new Promise((r) => setTimeout(r, 150));
  await drainPendingWrites(5000);
  resetDrain();

  // The orchestrator's onAbort only fires with settled attempts.
  // With the hanging stub, no attempts have settled, so logAttemptsUsage may
  // receive an empty array. The key regression guard: if any doc exists, it
  // must NOT be classified as 'ok' (the misclassification risk from the issue).
  const docs = await UsageLog.find({ service: 'chat' }).lean();
  for (const doc of docs) {
    assert.notEqual(doc.status, 'ok', 'abort scenario must not log status=ok');
  }
});

// ================================================================
//  /api/copilot — client disconnect fires abort usage log
// ================================================================
await t.test('POST /api/copilot/analyze-escalation client disconnect → UsageLog status=abort', async () => {
  const esc = await Escalation.create({
    category: 'billing',
    attemptingTo: 'Cancel subscription',
    actualOutcome: 'Button not clickable',
    status: 'open',
  });

  // Hanging stub: copilot's streamClaude never settles
  currentClaudeStub = makeFakeStreamHanging({ model: 'claude-sonnet-4-5-20250514', inputTokens: 10, outputTokens: 0 });

  const payload = JSON.stringify({ escalationId: esc._id.toString() });
  await new Promise((resolve) => {
    const req = http.request(
      { hostname: '127.0.0.1', port: httpPort, path: '/api/copilot/analyze-escalation', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        res.once('data', () => {
          req.destroy();
        });
        res.on('error', () => { /* expected */ });
      },
    );
    req.on('error', () => { /* ECONNRESET expected */ });
    req.on('close', () => resolve());
    req.write(payload);
    req.end();
  });

  await new Promise((r) => setTimeout(r, 150));
  await drainPendingWrites(5000);
  resetDrain();

  // Copilot's streamClaude abort path always logs with status='abort'
  const doc = await UsageLog.findOne({ service: 'copilot' }).lean();
  assert.ok(doc, 'abort usage log should exist for copilot');
  assert.equal(doc.status, 'abort');
  assert.equal(doc.category, 'analyze-escalation');
  assert.equal(doc.inputTokens, 10);
  assert.equal(doc.outputTokens, 0);
});

// ================================================================
//  /api/copilot — all 7 endpoints log with correct category
// ================================================================
await t.test('each copilot endpoint writes UsageLog with correct category', async () => {
  const esc = await Escalation.create({
    category: 'technical',
    attemptingTo: 'Export reports',
    actualOutcome: 'Export hangs',
    status: 'open',
  });
  // find-similar needs at least one other escalation with the same category
  await Escalation.create({
    category: 'technical',
    attemptingTo: 'Import data',
    actualOutcome: 'Import timeout',
    status: 'resolved',
  });

  // analyze-escalation
  await agent.post('/api/copilot/analyze-escalation').send({ escalationId: esc._id.toString() }).expect(200);
  // find-similar
  await agent.post('/api/copilot/find-similar').send({ escalationId: esc._id.toString() }).expect(200);
  // suggest-template (needs templates in DB)
  await Template.create({ title: 'T1', category: 'technical', body: 'Template body.' });
  await agent.post('/api/copilot/suggest-template').send({ escalationId: esc._id.toString() }).expect(200);
  // generate-template
  await agent.post('/api/copilot/generate-template').send({ description: 'test', category: 'billing' }).expect(200);
  // improve-template (expects templateContent string)
  await agent.post('/api/copilot/improve-template').send({ templateContent: 'Hello {{CLIENT}}, we are reviewing your case.' }).expect(200);
  // explain-trends
  await agent.post('/api/copilot/explain-trends').send({}).expect(200);
  // playbook-check
  await agent.post('/api/copilot/playbook-check').send({}).expect(200);

  await drainPendingWrites(5000);
  resetDrain();

  const docs = await UsageLog.find({ service: 'copilot' }).lean();
  const categories = docs.map((d) => d.category).sort();
  const expected = [
    'analyze-escalation',
    'explain-trends',
    'find-similar',
    'generate-template',
    'improve-template',
    'playbook-check',
    'suggest-template',
  ];

  for (const exp of expected) {
    assert.ok(
      categories.includes(exp),
      `missing copilot UsageLog for category="${exp}" (got: ${categories.join(', ')})`,
    );
  }

  for (const doc of docs) {
    assert.equal(doc.status, 'ok');
    assert.equal(doc.provider, 'claude');
    assert.equal(doc.usageAvailable, true);
  }
});

// ================================================================
//  /api/copilot — ok path (detailed field check)
// ================================================================
await t.test('POST /api/copilot/analyze-escalation (ok) → full field check', async () => {
  const esc = await Escalation.create({
    category: 'billing',
    attemptingTo: 'Cancel subscription',
    actualOutcome: 'Button not clickable',
    status: 'open',
  });

  const res = await agent
    .post('/api/copilot/analyze-escalation')
    .send({ escalationId: esc._id.toString() })
    .expect(200);

  assert.ok(parseSseEvents(res.text).find((e) => e.event === 'done'));

  await drainPendingWrites(5000);
  resetDrain();

  const doc = await UsageLog.findOne({ service: 'copilot' }).lean();
  assert.ok(doc);
  assert.equal(doc.service, 'copilot');
  assert.equal(doc.provider, 'claude');
  assert.equal(doc.status, 'ok');
  assert.equal(doc.inputTokens, 500);
  assert.equal(doc.outputTokens, 200);
  assert.equal(doc.usageAvailable, true);
  assert.equal(doc.category, 'analyze-escalation');
});

// ================================================================
//  /api/copilot — error path
// ================================================================
await t.test('POST /api/copilot/analyze-escalation (error) → UsageLog status=error', async () => {
  currentClaudeStub = makeFakeStreamError({ ...FAKE_USAGE, inputTokens: 50, outputTokens: 0 });

  const esc = await Escalation.create({
    category: 'payroll',
    attemptingTo: 'Run payroll',
    actualOutcome: 'Error 500',
    status: 'open',
  });

  const res = await agent
    .post('/api/copilot/analyze-escalation')
    .send({ escalationId: esc._id.toString() })
    .expect(200);

  assert.ok(parseSseEvents(res.text).find((e) => e.event === 'error'));

  await drainPendingWrites(5000);
  resetDrain();

  const doc = await UsageLog.findOne({ service: 'copilot' }).lean();
  assert.ok(doc);
  assert.equal(doc.status, 'error');
  assert.equal(doc.inputTokens, 50);
});

// ================================================================
//  /api/chat/parse-escalation — ok path
// ================================================================
await t.test('POST /api/chat/parse-escalation (ok) → UsageLog service=parse', async () => {
  const SAMPLE_PNG = 'data:image/png;base64,' +
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3Z8UkAAAAASUVORK5CYII=';

  const res = await agent
    .post('/api/chat/parse-escalation')
    .send({ image: SAMPLE_PNG })
    .expect(200);

  assert.equal(res.body.ok, true);

  await drainPendingWrites(5000);
  resetDrain();

  const docs = await UsageLog.find({ service: 'parse' }).lean();
  assert.ok(docs.length >= 1, 'at least one UsageLog for parse');
  assert.equal(docs[0].service, 'parse');
  assert.equal(docs[0].status, 'ok');
  assert.ok(docs[0].requestId);
});

// ================================================================
//  /api/dev/chat — skipped in this suite.
//  The dev route spawns real CLI processes (child_process.spawn)
//  which cannot be stubbed without module-level mocking. Testing
//  the dev→UsageLog pipeline requires either spawn mocking or a
//  dedicated test harness with a fake CLI binary.
// ================================================================

// ================================================================
//  400 validation errors do NOT create UsageLog entries
// ================================================================
await t.test('400 validation errors do not create UsageLog entries', async () => {
  await agent.post('/api/chat').send({}).expect(400);
  await agent.post('/api/copilot/analyze-escalation').send({}).expect(400);
  await agent.post('/api/copilot/generate-template').send({}).expect(400);

  await drainPendingWrites(5000);
  resetDrain();

  const count = await UsageLog.countDocuments({});
  assert.equal(count, 0, 'no UsageLog entries for 400 errors');
});
});
