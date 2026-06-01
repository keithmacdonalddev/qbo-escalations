'use strict';

// Regression coverage for the parsed-output pollution bug in claude.js
// (parseEscalation). The CLI is spawned with --output-format json and emits a
// wrapper object on stdout: { type, result, usage, duration_ms, ... }. The
// parse code reads the escalation fields from `parsed.structured_output ||
// parsed.result`. Previously, when BOTH were missing/empty, it fell through to
// the raw `parsed` wrapper and resolved `{ fields: <whole CLI envelope> }`,
// silently polluting the parse with metadata like type/usage/duration_ms.
//
// The fix replaces the `|| parsed` fallback with a clean default
// `{ category: 'unknown', attemptingTo: '' }`. These tests drive the real
// parse path (NOT the HARNESS_PROVIDERS_STUBBED stub, which would bypass the
// code under test) by mocking child_process.spawn so the fake `claude` child
// emits a controlled stdout payload and exits 0.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

// IMPORTANT: patch child_process.spawn BEFORE requiring claude.js. claude.js
// does `const { spawn } = require('child_process')` at module load, so the
// destructured reference must already point at our mock when it evaluates.
const childProcess = require('child_process');
const realSpawn = childProcess.spawn;

// Ensure no stub seam is active — we want the real spawn/parse path.
delete process.env.HARNESS_PROVIDERS_STUBBED;
delete process.env.HARNESS_PROVIDERS_NO_DEFAULT_STUBS;

// Holds the stdout payload the next fake `claude` invocation will emit.
let nextStdout = '';

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end() {} };
  child.kill = () => {};
  // Emit the canned stdout then close successfully on the next tick, after the
  // caller has attached its 'data' / 'close' listeners.
  setImmediate(() => {
    if (nextStdout) child.stdout.emit('data', Buffer.from(nextStdout));
    child.emit('close', 0);
  });
  return child;
}

childProcess.spawn = function spawnMock() {
  return makeFakeChild();
};

// Require AFTER the mock is installed so the destructured spawn is the mock.
const claude = require('../src/services/claude');

test.after(() => {
  childProcess.spawn = realSpawn;
});

test('claude.parseEscalation does not leak the CLI wrapper into fields', async (t) => {
  await t.test('empty result + no structured_output yields the clean default, not the wrapper', async () => {
    // A realistic CLI envelope with an EMPTY result and no structured_output.
    nextStdout = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: '',
      usage: { input_tokens: 10, output_tokens: 0 },
      duration_ms: 1234,
      is_error: false,
    });

    const out = await claude.parseEscalation('Agent reports a payroll sync error.');

    assert.ok(out && typeof out === 'object', 'expected a result object');
    assert.deepEqual(
      out.fields,
      { category: 'unknown', attemptingTo: '' },
      'fields should be the clean default'
    );
    // The wrapper envelope keys must NOT have leaked into fields.
    assert.equal(out.fields.type, undefined, 'wrapper "type" must not leak into fields');
    assert.equal(out.fields.result, undefined, 'wrapper "result" must not leak into fields');
    assert.equal(out.fields.usage, undefined, 'wrapper "usage" must not leak into fields');
    assert.equal(out.fields.duration_ms, undefined, 'wrapper "duration_ms" must not leak into fields');
    assert.equal(out.fields.is_error, undefined, 'wrapper "is_error" must not leak into fields');
  });

  await t.test('missing both result and structured_output yields the clean default', async () => {
    // Envelope with neither result nor structured_output present at all.
    nextStdout = JSON.stringify({
      type: 'result',
      subtype: 'success',
      usage: { input_tokens: 5, output_tokens: 0 },
      duration_ms: 42,
    });

    const out = await claude.parseEscalation('Some other escalation text.');

    assert.deepEqual(
      out.fields,
      { category: 'unknown', attemptingTo: '' },
      'fields should be the clean default'
    );
    assert.equal(out.fields.duration_ms, undefined, 'wrapper metadata must not leak into fields');
  });

  await t.test('a present structured_output is still passed through unchanged', async () => {
    // Guard against over-correction: valid structured_output must win.
    const fields = {
      coid: '12345',
      attemptingTo: 'reconnect bank feed',
      category: 'bank-feeds',
    };
    nextStdout = JSON.stringify({
      type: 'result',
      result: '',
      structured_output: fields,
      usage: { input_tokens: 20, output_tokens: 8 },
    });

    const out = await claude.parseEscalation('Bank feed disconnected for client.');

    assert.deepEqual(out.fields, fields, 'structured_output should pass through as fields');
  });

  await t.test('a present result string is still parsed into fields', async () => {
    // The other valid branch: result carries a JSON string of the fields.
    const fields = { coid: '999', attemptingTo: 'reset MFA', category: 'security' };
    nextStdout = JSON.stringify({
      type: 'result',
      result: JSON.stringify(fields),
      usage: { input_tokens: 15, output_tokens: 9 },
    });

    const out = await claude.parseEscalation('Client locked out by MFA.');

    assert.deepEqual(out.fields, fields, 'result JSON should be parsed into fields');
  });
});
