/**
 * Phase 2 contract tests — verify onDone(text, usage), err._usage,
 * cleanup() abort payload, and parseEscalation { fields, usage }
 * by exercising real claude.js / codex.js stream-parsing code paths
 * with mocked child processes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Writable } = require('stream');
const childProcess = require('child_process');

const originalSpawn = childProcess.spawn;

test("provider-usage-contract suite", async (t) => {

t.after(() => {
  childProcess.spawn = originalSpawn;
});

// --- Fake child process factory ---
// Uses plain EventEmitters for stdout/stderr to avoid Readable buffering issues.

function createFakeChild() {
  const child = new EventEmitter();
  child.stdin = new Writable({ write(_, __, cb) { cb(); } });
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  child.pid = 99999;
  return child;
}

function emitLines(child, lines) {
  child.stdout.emit('data', Buffer.from(lines.join('\n') + '\n'));
}

function closeChild(child, code = 0) {
  child.emit('close', code);
}

function withMock(fn) {
  const fakeChild = createFakeChild();
  childProcess.spawn = () => fakeChild;
  return fn(fakeChild);
}

function requireFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

// ============================================================
// Claude chat() contract
// ============================================================

await t.test('claude chat() onDone receives usage as second argument', (t, done) => {
  withMock((fakeChild) => {
    const claude = requireFresh('../src/services/claude');
    claude.chat({
      messages: [{ role: 'user', content: 'hello' }],
      onChunk() {},
      onDone(text, usage) {
        assert.equal(text, 'Hello there');
        assert.ok(usage, 'usage should not be null');
        assert.equal(usage.inputTokens, 10);
        assert.equal(usage.outputTokens, 25);
        assert.equal(usage.model, 'claude-sonnet-4-6');
        done();
      },
      onError(err) { done(err); },
    });

    emitLines(fakeChild, [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello there' }] } }),
      JSON.stringify({
        type: 'result', result: '', model: 'claude-sonnet-4-6',
        usage: { input_tokens: 10, output_tokens: 25 },
      }),
    ]);
    closeChild(fakeChild, 0);
  });
});

await t.test('claude chat() onError receives err._usage on CLI failure', (t, done) => {
  withMock((fakeChild) => {
    const claude = requireFresh('../src/services/claude');
    claude.chat({
      messages: [{ role: 'user', content: 'hello' }],
      onChunk() {},
      onDone() { done(new Error('should not succeed')); },
      onError(err) {
        assert.ok(err._usage, 'err._usage should be set');
        assert.equal(err._usage.inputTokens, 5);
        assert.equal(err._usage.outputTokens, 0);
        done();
      },
    });

    emitLines(fakeChild, [
      JSON.stringify({
        type: 'result', result: '', model: 'claude-sonnet-4-6',
        usage: { input_tokens: 5, output_tokens: 0 },
      }),
    ]);
    closeChild(fakeChild, 1);
  });
});

await t.test('claude chat() cleanup() returns usage and partialResponse', (t, done) => {
  withMock((fakeChild) => {
    const claude = requireFresh('../src/services/claude');
    const cleanup = claude.chat({
      messages: [{ role: 'user', content: 'hello' }],
      onChunk() {},
      onDone() {},
      onError() {},
    });

    emitLines(fakeChild, [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } }),
      JSON.stringify({
        type: 'result', result: '', model: 'claude-sonnet-4-6',
        usage: { input_tokens: 3, output_tokens: 7 },
      }),
    ]);

    const abortData = cleanup();
    assert.ok(abortData, 'cleanup should return abort data');
    assert.ok(abortData.usage, 'abort data should include usage');
    assert.equal(abortData.usage.inputTokens, 3);
    assert.equal(abortData.partialResponse, 'partial');
    done();
  });
});

// ============================================================
// Claude parseEscalation() contract
// ============================================================

await t.test('claude parseEscalation() returns { fields, usage } wrapper', async () => {
  const result = await withMock((fakeChild) => {
    const claude = requireFresh('../src/services/claude');
    const promise = claude.parseEscalation('some escalation text');

    const response = {
      type: 'result',
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 50, output_tokens: 30 },
      structured_output: {
        category: 'payroll',
        attemptingTo: 'Submit payroll',
        actualOutcome: 'Error on submission',
        tsSteps: 'Retried twice',
        triedTestAccount: 'no',
      },
    };

    // parseEscalation accumulates stdout as raw text, then parses on close
    fakeChild.stdout.emit('data', Buffer.from(JSON.stringify(response)));
    closeChild(fakeChild, 0);
    return promise;
  });

  assert.ok(result.fields, 'result should have fields');
  assert.ok(result.usage, 'result should have usage');
  assert.equal(result.fields.category, 'payroll');
  assert.equal(result.usage.inputTokens, 50);
  assert.equal(result.usage.outputTokens, 30);
  assert.equal(result.usage.model, 'claude-sonnet-4-6');
});

await t.test('claude parseEscalation() catch fallback extracts usage from non-canonical stdout', async () => {
  const result = await withMock((fakeChild) => {
    const claude = requireFresh('../src/services/claude');
    const promise = claude.parseEscalation('some escalation text');

    // Simulate non-canonical output: usage event line + text wrapping a JSON escalation.
    // JSON.parse(stdout) fails (multi-line, not a single JSON blob).
    // Catch path: line-by-line usage extraction + regex field extraction.
    const usageLine = JSON.stringify({
      type: 'result', model: 'claude-sonnet-4-6',
      usage: { input_tokens: 20, output_tokens: 15 }, result: '',
    });
    // Second line: plain text wrapping a JSON escalation object
    const wrappedFields = 'Here are the fields: {"category":"billing","attemptingTo":"Pay invoice","actualOutcome":"Error","tsSteps":"Retried","triedTestAccount":"no"}';

    fakeChild.stdout.emit('data', Buffer.from(usageLine + '\n' + wrappedFields));
    closeChild(fakeChild, 0);
    return promise;
  });

  assert.ok(result.fields, 'result should have fields');
  // Regex extracts the embedded escalation JSON (greedy match picks the largest
  // brace-delimited span, but the first JSON.parse attempt in the catch gets the
  // fields object since the usage line's braces are a subset of the full match)
  assert.ok(result.usage, 'usage should be extracted from line-by-line fallback');
  assert.equal(result.usage.inputTokens, 20);
  assert.equal(result.usage.outputTokens, 15);
  assert.equal(result.usage.model, 'claude-sonnet-4-6');
});

// ============================================================
// Codex chat() contract
// ============================================================

await t.test('codex chat() onDone receives usage as second argument', (t, done) => {
  withMock((fakeChild) => {
    const codex = requireFresh('../src/services/codex');
    codex.chat({
      messages: [{ role: 'user', content: 'hello' }],
      onChunk() {},
      onDone(text, usage) {
        assert.equal(text, 'Codex says hi');
        assert.ok(usage, 'usage should not be null');
        assert.equal(usage.inputTokens, 15);
        assert.equal(usage.outputTokens, 20);
        done();
      },
      onError(err) { done(err); },
    });

    emitLines(fakeChild, [
      JSON.stringify({ item: { type: 'agent_message', id: 'a1', text: 'Codex says hi' } }),
      JSON.stringify({ type: 'usage', prompt_tokens: 15, completion_tokens: 20, model: 'gpt-5.5' }),
    ]);
    closeChild(fakeChild, 0);
  });
});

await t.test('codex chat() onError receives err._usage on failure', (t, done) => {
  withMock((fakeChild) => {
    const codex = requireFresh('../src/services/codex');
    codex.chat({
      messages: [{ role: 'user', content: 'hello' }],
      onChunk() {},
      onDone() { done(new Error('should not succeed')); },
      onError(err) {
        assert.ok(err._usage, 'err._usage should be set');
        assert.equal(err._usage.inputTokens, 8);
        done();
      },
    });

    emitLines(fakeChild, [
      JSON.stringify({ type: 'usage', prompt_tokens: 8, completion_tokens: 0, model: 'gpt-5.5' }),
    ]);
    closeChild(fakeChild, 1);
  });
});

await t.test('codex chat() cleanup() returns usage and partialResponse', (t, done) => {
  withMock((fakeChild) => {
    const codex = requireFresh('../src/services/codex');
    const cleanup = codex.chat({
      messages: [{ role: 'user', content: 'hello' }],
      onChunk() {},
      onDone() {},
      onError() {},
    });

    emitLines(fakeChild, [
      JSON.stringify({ item: { type: 'agent_message', id: 'a1', text: 'partial codex' } }),
      JSON.stringify({ type: 'usage', prompt_tokens: 4, completion_tokens: 6, model: 'gpt-5.5' }),
    ]);

    const abortData = cleanup();
    assert.ok(abortData, 'cleanup should return abort data');
    assert.ok(abortData.usage, 'abort data should include usage');
    assert.equal(abortData.usage.inputTokens, 4);
    assert.equal(abortData.partialResponse, 'partial codex');
    done();
  });
});

// ============================================================
// Codex parseEscalation() contract
// ============================================================

await t.test('codex parseEscalation() returns { fields, usage } wrapper', async () => {
  const result = await withMock((fakeChild) => {
    const codex = requireFresh('../src/services/codex');
    const promise = codex.parseEscalation('some escalation text');

    emitLines(fakeChild, [
      JSON.stringify({
        item: { type: 'agent_message', id: 'a1',
          text: '{"category":"tax","attemptingTo":"File GST","actualOutcome":"Error","tsSteps":"Retried","triedTestAccount":"no"}',
        },
      }),
      JSON.stringify({ type: 'usage', prompt_tokens: 40, completion_tokens: 35, model: 'gpt-5.5' }),
    ]);
    closeChild(fakeChild, 0);
    return promise;
  });

  assert.ok(result.fields, 'result should have fields');
  assert.ok(result.usage, 'result should have usage');
  assert.equal(result.fields.category, 'tax');
  assert.equal(result.usage.inputTokens, 40);
  assert.equal(result.usage.outputTokens, 35);
});

// ============================================================
// Model attribution — event model preferred over env fallback
// ============================================================

await t.test('claude chat() usage prefers model from event over env fallback', (t, done) => {
  withMock((fakeChild) => {
    const claude = requireFresh('../src/services/claude');
    claude.chat({
      messages: [{ role: 'user', content: 'test' }],
      onChunk() {},
      onDone(_, usage) {
        assert.ok(usage, 'usage should not be null');
        assert.equal(usage.model, 'claude-opus-4-7', 'should use model from event');
        done();
      },
      onError(err) { done(err); },
    });

    emitLines(fakeChild, [
      JSON.stringify({
        type: 'result', result: 'ok', model: 'claude-opus-4-7',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    ]);
    closeChild(fakeChild, 0);
  });
});

await t.test('codex chat() usage prefers model from event over env fallback', (t, done) => {
  withMock((fakeChild) => {
    const codex = requireFresh('../src/services/codex');
    codex.chat({
      messages: [{ role: 'user', content: 'test' }],
      onChunk() {},
      onDone(_, usage) {
        assert.ok(usage, 'usage should not be null');
        assert.equal(usage.model, 'gpt-4o', 'should use model from event');
        done();
      },
      onError(err) { done(err); },
    });

    emitLines(fakeChild, [
      JSON.stringify({ item: { type: 'agent_message', id: 'a1', text: 'hi' } }),
      JSON.stringify({ type: 'usage', prompt_tokens: 1, completion_tokens: 1, model: 'gpt-4o' }),
    ]);
    closeChild(fakeChild, 0);
  });
});
});
