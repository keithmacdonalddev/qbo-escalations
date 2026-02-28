const test = require('node:test');
const assert = require('node:assert/strict');
const { _internal } = require('../src/routes/dev');

test('classifyEvent maps assistant tool use and text events', () => {
  const toolUseEvent = _internal.classifyEvent({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Read' }] },
  });
  const textEvent = _internal.classifyEvent({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'hello' }] },
  });

  assert.equal(toolUseEvent, 'tool_use');
  assert.equal(textEvent, 'text');
});

test('extractTextChunk reads assistant, delta, and result text payloads', () => {
  const assistantText = _internal.extractTextChunk({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] },
  });
  const deltaText = _internal.extractTextChunk({
    type: 'content_block_delta',
    delta: { text: 'C' },
  });
  const resultText = _internal.extractTextChunk({
    type: 'result',
    result: 'D',
  });

  assert.equal(assistantText, 'AB');
  assert.equal(deltaText, 'C');
  assert.equal(resultText, 'D');
});

test('toToolEvent normalizes tool_use and tool_result payloads', () => {
  const started = _internal.toToolEvent({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Read', input: { path: 'a' } }] },
  });
  const success = _internal.toToolEvent({
    type: 'tool_result',
    name: 'Read',
    is_error: false,
    output: 'ok',
  });
  const failure = _internal.toToolEvent({
    type: 'tool_result',
    name: 'Write',
    is_error: true,
    error: 'denied',
  });

  assert.equal(started.tool, 'Read');
  assert.equal(started.status, 'started');
  assert.equal(success.status, 'success');
  assert.equal(failure.status, 'error');
});

test('classifyEvent and extractTextChunk support codex-style stream items', () => {
  const eventType = _internal.classifyEvent(
    { item: { type: 'agent_message', id: '1', text: 'hello' } },
    { provider: 'chatgpt-5.3-codex-high' }
  );
  const seen = new Map();
  const first = _internal.extractTextChunk(
    { item: { type: 'agent_message', id: '1', text: 'hello' } },
    { provider: 'chatgpt-5.3-codex-high', seenAgentTextByItem: seen }
  );
  const second = _internal.extractTextChunk(
    { item: { type: 'agent_message', id: '1', text: 'hello world' } },
    { provider: 'chatgpt-5.3-codex-high', seenAgentTextByItem: seen }
  );

  assert.equal(eventType, 'text');
  assert.equal(first, 'hello');
  assert.equal(second, ' world');
});

test('toToolEvents supports codex-style tool items', () => {
  const started = _internal.toToolEvents(
    { item: { type: 'tool_use', name: 'read_file', input: { path: 'a.js' } } },
    { provider: 'chatgpt-5.3-codex-high' }
  );
  const finished = _internal.toToolEvents(
    { item: { type: 'tool_result', name: 'read_file', is_error: false, output: 'ok' } },
    { provider: 'chatgpt-5.3-codex-high' }
  );

  assert.equal(started.length, 1);
  assert.equal(started[0].status, 'started');
  assert.equal(finished.length, 1);
  assert.equal(finished[0].status, 'success');
});

test('normalizeDevImages accepts valid payload and rejects invalid payload', () => {
  const sample = 'data:image/png;base64,' + Buffer.from('abc').toString('base64');
  const ok = _internal.normalizeDevImages([sample]);
  const invalid = _internal.normalizeDevImages(['not-valid-base64###']);

  assert.equal(ok.ok, true);
  assert.equal(ok.images.length, 1);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'INVALID_IMAGE');
});

test('buildProviderCommand includes image args for codex and claude', () => {
  const codex = _internal.buildProviderCommand({
    providerId: 'chatgpt-5.3-codex-high',
    message: 'hello',
    historyMessages: [{ role: 'user', content: 'hello' }],
    imagePaths: ['C:\\tmp\\a.png'],
  });
  const claude = _internal.buildProviderCommand({
    providerId: 'claude',
    message: 'hello',
    resumeSessionId: 'session-1',
    historyMessages: [],
    imagePaths: ['/tmp/a.png'],
  });

  const codexImageFlagIndex = codex.args.indexOf('--image');
  const claudeImageFlagIndex = claude.args.indexOf('--image');

  assert.equal(codex.command, 'codex');
  assert.equal(codexImageFlagIndex > -1, true);
  assert.equal(codex.args[codexImageFlagIndex + 1], 'C:\\tmp\\a.png');
  assert.equal(codex.args[codex.args.length - 1], '-');

  assert.equal(claude.command, 'claude');
  assert.equal(claude.args.includes('--resume'), true);
  assert.equal(claudeImageFlagIndex > -1, true);
  assert.equal(claude.args[claudeImageFlagIndex + 1], '/tmp/a.png');
});

test('buildProviderCommand uses correct CLI and model for new providers', () => {
  const sonnet = _internal.buildProviderCommand({
    providerId: 'claude-sonnet-4-6',
    message: 'hi',
    historyMessages: [],
    imagePaths: [],
  });
  assert.equal(sonnet.command, 'claude');
  assert.equal(sonnet.supportsSessionResume, true);
  assert.equal(sonnet.args.includes('--model'), true);
  assert.equal(sonnet.args[sonnet.args.indexOf('--model') + 1], 'claude-sonnet-4-6');

  const mini = _internal.buildProviderCommand({
    providerId: 'gpt-5-mini',
    message: 'hi',
    historyMessages: [{ role: 'user', content: 'hi' }],
    imagePaths: [],
  });
  assert.equal(mini.command, 'codex');
  assert.equal(mini.supportsSessionResume, false);
  assert.equal(mini.args.includes('--model'), true);
  assert.equal(mini.args[mini.args.indexOf('--model') + 1], 'gpt-5-mini');
});

test('classifyEvent and extractTextChunk work with gpt-5-mini provider', () => {
  const eventType = _internal.classifyEvent(
    { item: { type: 'agent_message', id: '1', text: 'hello' } },
    { provider: 'gpt-5-mini' }
  );
  assert.equal(eventType, 'text');

  const seen = new Map();
  const text = _internal.extractTextChunk(
    { item: { type: 'agent_message', id: '1', text: 'hello' } },
    { provider: 'gpt-5-mini', seenAgentTextByItem: seen }
  );
  assert.equal(text, 'hello');
});

test('toToolEvents works with gpt-5-mini provider', () => {
  const started = _internal.toToolEvents(
    { item: { type: 'tool_use', name: 'read_file', input: { path: 'a.js' } } },
    { provider: 'gpt-5-mini' }
  );
  assert.equal(started.length, 1);
  assert.equal(started[0].status, 'started');
});

test('parsePositiveInt returns fallback for invalid timeout env values', () => {
  assert.equal(_internal.parsePositiveInt('120000', 600000), 120000);
  assert.equal(_internal.parsePositiveInt('0', 600000), 600000);
  assert.equal(_internal.parsePositiveInt('-10', 600000), 600000);
  assert.equal(_internal.parsePositiveInt('not-a-number', 600000), 600000);
});

test('shouldResumeClaudeSession only resumes when both providers are Claude family', () => {
  assert.equal(_internal.shouldResumeClaudeSession('claude', 'claude'), true);
  assert.equal(_internal.shouldResumeClaudeSession('claude-sonnet-4-6', 'claude'), true);
  assert.equal(_internal.shouldResumeClaudeSession('claude', 'claude-sonnet-4-6'), true);
  assert.equal(_internal.shouldResumeClaudeSession('claude-sonnet-4-6', 'claude-sonnet-4-6'), true);
  assert.equal(_internal.shouldResumeClaudeSession('claude', 'chatgpt-5.3-codex-high'), false);
  assert.equal(_internal.shouldResumeClaudeSession('chatgpt-5.3-codex-high', 'claude'), false);
  assert.equal(_internal.shouldResumeClaudeSession('chatgpt-5.3-codex-high', 'chatgpt-5.3-codex-high'), false);
  assert.equal(_internal.shouldResumeClaudeSession('gpt-5-mini', 'gpt-5-mini'), false);
  assert.equal(_internal.shouldResumeClaudeSession('gpt-5-mini', 'claude'), false);
  assert.equal(_internal.shouldResumeClaudeSession('claude', 'gpt-5-mini'), false);
});

test('didCliExitSuccessfully fails closed on non-zero exit code', () => {
  assert.equal(_internal.didCliExitSuccessfully(0), true);
  assert.equal(_internal.didCliExitSuccessfully(1), false);
  assert.equal(_internal.didCliExitSuccessfully(2), false);
});

test('isPathWithinRoot blocks sibling-prefix traversal', () => {
  const root = 'C:\\repo\\app';
  assert.equal(_internal.isPathWithinRoot(root, 'C:\\repo\\app\\file.txt'), true);
  assert.equal(_internal.isPathWithinRoot(root, 'C:\\repo\\app-sub\\file.txt'), false);
  assert.equal(_internal.isPathWithinRoot(root, 'C:\\repo\\app\\..\\secret.txt'), false);
});
