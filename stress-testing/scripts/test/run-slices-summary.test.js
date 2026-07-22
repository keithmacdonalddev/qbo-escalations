'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSummary, main, parseArgs } = require('../run-slices');

test('stress summary contains one terminal entry for every selected slice', () => {
  const summary = createSummary(['one', 'two'], [
    { slice: 'one', status: 'passed', ok: true },
    { slice: 'two', status: 'failed', ok: false },
  ]);
  assert.equal(summary.verdict, 'failed');
  assert.equal(summary.selectedCount, 2);
  assert.equal(summary.terminalCount, 2);
  assert.equal(summary.passedCount, 1);
  assert.equal(summary.failedCount, 1);
});

function dependenciesFor(runSlice) {
  return {
    listRunnerIds: () => ['one'],
    getRunner: () => ({ runSlice }),
    startHarnessServer: async () => ({ stop: async () => {} }),
  };
}

async function runOne(t, runSlice) {
  const resultPath = path.join(os.tmpdir(), `stress-outcome-${process.pid}-${Date.now()}-${Math.random()}.json`);
  t.after(() => fs.rmSync(resultPath, { force: true }));
  const previousExitCode = process.exitCode;
  try {
    return await main(['--result-path', resultPath, 'one'], dependenciesFor(runSlice));
  } finally {
    process.exitCode = previousExitCode;
  }
}

test('thrown slice runner is incomplete rather than a completed failure', async (t) => {
  const result = await runOne(t, async () => { throw new Error('runner disconnected'); });
  assert.equal(result.verdict, 'incomplete');
  assert.equal(result.slices[0].status, 'incomplete');
});

test('missing durable report is incomplete', async (t) => {
  const result = await runOne(t, async () => ({ schemaVersion: 1, slice: 'one', runId: 'run-one', ok: true }));
  assert.equal(result.verdict, 'incomplete');
  assert.match(result.slices[0].error, /durable report/);
});

test('tool timeout and connection loss reports are incomplete', async (t) => {
  for (const error of ['Command timed out after 45000ms', 'connection failed with os error 10060']) {
    const result = await runOne(t, async () => ({
      schemaVersion: 1,
      slice: 'one',
      runId: 'run-one',
      ok: false,
      paths: { reportPath: 'report.json', latestPath: 'latest.json' },
      incomplete: true,
      incompleteReason: error,
      fixtures: [{ ok: false, incomplete: true, error }],
    }));
    assert.equal(result.verdict, 'incomplete');
    assert.equal(result.incompleteCount, 1);
  }
});

test('ordinary completed assertion failure remains failed', async (t) => {
  const result = await runOne(t, async () => ({
    schemaVersion: 1,
    slice: 'one',
    runId: 'run-one',
    ok: false,
    paths: { reportPath: 'report.json', latestPath: 'latest.json' },
    fixtures: [{ ok: false, assertions: { expected: false } }],
  }));
  assert.equal(result.verdict, 'failed');
  assert.equal(result.slices[0].status, 'failed');
});

test('structural fixture incompleteness remains incomplete without relying on error wording', async (t) => {
  const result = await runOne(t, async () => ({
    schemaVersion: 1,
    slice: 'one',
    runId: 'run-structural-incomplete',
    ok: false,
    incomplete: true,
    incompleteReason: 'cleanup outcome unavailable',
    paths: { reportPath: 'report.json', latestPath: 'latest.json' },
    fixtures: [{ id: 'browser-one', ok: false, incomplete: true, error: 'opaque failure' }],
  }));
  assert.equal(result.verdict, 'incomplete');
  assert.equal(result.slices[0].status, 'incomplete');
  assert.equal(result.terminalCount, 0);
});

test('harness boot failure marks every selected slice not run and incomplete', () => {
  const selected = ['one', 'two'];
  const summary = createSummary(selected, selected.map((slice) => ({ slice, status: 'not-run', ok: false })), {
    harnessError: 'safe harness refused to boot',
  });
  assert.equal(summary.verdict, 'incomplete');
  assert.equal(summary.terminalCount, 0);
  assert.equal(summary.slices.every((entry) => entry.status === 'not-run'), true);
});

test('stress runner options keep output paths separate from selected slice ids', () => {
  assert.deepEqual(parseArgs(['--result-path', 'summary.json', 'one']), {
    list: false,
    resultPath: 'summary.json',
    selected: ['one'],
  });
});

test('main writes not-run evidence for every selected slice when injected harness boot fails', async (t) => {
  const resultPath = path.join(os.tmpdir(), `stress-boot-${process.pid}-${Date.now()}.json`);
  t.after(() => fs.rmSync(resultPath, { force: true }));
  const previousExitCode = process.exitCode;
  t.after(() => { process.exitCode = previousExitCode; });

  let result;
  try {
    result = await main(['--result-path', resultPath, 'one', 'two'], {
      listRunnerIds: () => ['one', 'two'],
      getRunner: () => ({ runSlice: async () => ({ ok: true }) }),
      startHarnessServer: async () => { throw new Error('injected boot failure'); },
    });
  } finally {
    process.exitCode = previousExitCode;
  }

  assert.equal(result.verdict, 'incomplete');
  assert.equal(result.slices.length, 2);
  assert.equal(result.slices.every((slice) => slice.status === 'not-run'), true);
  assert.equal(JSON.parse(fs.readFileSync(resultPath, 'utf8')).harnessError, 'injected boot failure');
});
