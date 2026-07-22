'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parseArgs, summarizeResults } = require('../scripts/run-tests');

const serverRoot = path.resolve(__dirname, '..');

function runFixtureSet(t, { continueOnFailure = false, timeoutMs = 1000, interrupt = false } = {}) {
  const nonce = `${process.pid}-${crypto.randomUUID()}`;
  const fail = path.join(__dirname, `.runner-${nonce}-fail.test.js`);
  const pass = path.join(__dirname, `.runner-${nonce}-pass.test.js`);
  const hang = path.join(__dirname, `.runner-${nonce}-hang.test.js`);
  const signal = path.join(__dirname, `.runner-${nonce}-signal.test.js`);
  const resultPath = path.join(os.tmpdir(), `.server-runner-${nonce}.json`);
  fs.writeFileSync(fail, "require('node:test')('fails',()=>{throw new Error('fixture failure')})");
  fs.writeFileSync(pass, "require('node:test')('passes',()=>{})");
  fs.writeFileSync(hang, "require('node:test')('hangs',async()=>new Promise(()=>{}))");
  fs.writeFileSync(signal, "require('node:test')('signals',()=>{process.kill(process.pid,'SIGTERM')})");
  t.after(() => {
    for (const file of [fail, pass, hang, signal, resultPath]) fs.rmSync(file, { force: true });
  });
  const relative = (file) => path.relative(serverRoot, file).replace(/\\/g, '/');
  const files = interrupt ? [signal, pass] : timeoutMs < 1000 ? [hang, pass] : [fail, pass];
  const args = ['scripts/run-tests.js'];
  if (continueOnFailure) args.push('--continue');
  args.push('--result-path', resultPath, ...files.map(relative));
  const result = spawnSync(process.execPath, args, {
    cwd: serverRoot,
    env: { ...process.env, TEST_FILE_TIMEOUT_MS: String(timeoutMs) },
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  return { result, summary: JSON.parse(fs.readFileSync(resultPath, 'utf8')) };
}

test('server runner keeps fail-first default and enables continuation explicitly', () => {
  assert.deepEqual(parseArgs(['test/example.test.js']), {
    continueOnFailure: false,
    resultPath: null,
    files: ['test/example.test.js'],
  });
  assert.deepEqual(parseArgs(['--continue', '--result-path', 'result.json', 'test/a.test.js']), {
    continueOnFailure: true,
    resultPath: 'result.json',
    files: ['test/a.test.js'],
  });
});

test('ordinary completed failures are failed only when every discovered file reached a terminal result', () => {
  const summary = summarizeResults(['a', 'b'], [
    { file: 'a', status: 'failed', terminal: true, timedOut: false },
    { file: 'b', status: 'passed', terminal: true, timedOut: false },
  ]);
  assert.equal(summary.verdict, 'failed');
  assert.deepEqual(summary.counts, { discovered: 2, started: 2, completed: 2, passed: 1, failed: 1, timedOut: 0, interrupted: 0, notRun: 0 });
});

test('a timeout or an undispatched discovered file makes server evidence incomplete', () => {
  assert.equal(summarizeResults(['a', 'b'], [
    { file: 'a', status: 'timed-out', terminal: false, timedOut: true },
    { file: 'b', status: 'passed', terminal: true, timedOut: false },
  ]).verdict, 'incomplete');
  assert.equal(summarizeResults(['a', 'b'], [
    { file: 'a', status: 'failed', terminal: true, timedOut: false },
  ]).verdict, 'incomplete');
});

test('a signaled child is interrupted and excluded from completed work', () => {
  const summary = summarizeResults(['a', 'b'], [
    { file: 'a', status: 'interrupted', terminal: false, timedOut: false, signal: 'SIGTERM' },
    { file: 'b', status: 'passed', terminal: true, timedOut: false, signal: null },
  ]);
  assert.equal(summary.verdict, 'incomplete');
  assert.equal(summary.counts.interrupted, 1);
  assert.equal(summary.counts.completed, 1);
});

test('actual fail-first mode stops before the later fixture and preserves exit code 1', (t) => {
  const { result, summary } = runFixtureSet(t);
  assert.equal(result.status, 1, JSON.stringify({ summary, stdout: result.stdout, stderr: result.stderr }, null, 2));
  assert.equal(summary.counts.started, 1);
  assert.equal(summary.counts.notRun, 1);
});

test('actual continue mode records a later passing file after a failure', (t) => {
  const { result, summary } = runFixtureSet(t, { continueOnFailure: true });
  assert.equal(result.status, 1, JSON.stringify({ summary, stdout: result.stdout, stderr: result.stderr }, null, 2));
  assert.equal(summary.verdict, 'failed');
  assert.equal(summary.counts.started, 2);
  assert.equal(summary.counts.passed, 1);
  assert.equal(summary.counts.failed, 1);
});

test('actual timeout cleanup continues to the later fixture and exits incomplete', (t) => {
  const { result, summary } = runFixtureSet(t, { continueOnFailure: true, timeoutMs: 300 });
  assert.equal(result.status, 124);
  assert.equal(summary.verdict, 'incomplete');
  assert.equal(summary.counts.timedOut, 1);
  assert.equal(summary.counts.passed, 1);
});

test('actual self-signal is recorded as interrupted and the parent runner exits incomplete', (t) => {
  const { result, summary } = runFixtureSet(t, { continueOnFailure: true, interrupt: true });
  assert.equal(result.status, 124);
  assert.equal(summary.verdict, 'incomplete');
  assert.equal(summary.counts.interrupted, 1);
  assert.equal(summary.counts.completed, 1);
  assert.equal(summary.counts.passed, 1);
  assert.equal(summary.files[0].status, 'interrupted');
  assert.equal(summary.files[0].terminal, false);
  assert.ok(summary.files[0].signal || summary.files[0].interruptionReason);
});
