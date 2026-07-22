'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
  ACTIVE_CHILDREN,
  buildCapabilitySummary,
  buildChildEnvironment,
  computeVerdict,
  createRunController,
  readChildSummary,
  runGroup,
  runProfile,
  validateChildSummary,
  validateConfig,
} = require('../run-app-checks');

test('production build groups do not inherit a forced NODE_ENV=test', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    assert.equal(buildChildEnvironment({ environment: 'production' }).NODE_ENV, undefined);
    assert.equal(buildChildEnvironment({}).NODE_ENV, 'test');
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('child result validation rejects malformed and internally inconsistent evidence', () => {
  assert.throws(() => validateChildSummary('server-tests', { schemaVersion: 1, verdict: 'passed', counts: {}, files: [] }), /invalid discovered/);
  assert.throws(() => validateChildSummary('stress-slices', {
    schemaVersion: 1,
    verdict: 'passed',
    selectedCount: 2,
    terminalCount: 1,
    passedCount: 1,
    failedCount: 0,
    incompleteCount: 0,
    notRunCount: 0,
    slices: [{ slice: 'one', status: 'passed' }],
  }), /selected count/);
});

function validServerChild() {
  return {
    schemaVersion: 1,
    verdict: 'incomplete',
    counts: { discovered: 3, started: 3, completed: 2, passed: 1, failed: 1, timedOut: 1, interrupted: 0, notRun: 0 },
    files: [
      { file: 'test/a.test.js', status: 'passed', terminal: true, timedOut: false, exitCode: 0 },
      { file: 'test/b.test.js', status: 'failed', terminal: true, timedOut: false, exitCode: 1 },
      { file: 'test/c.test.js', status: 'timed-out', terminal: false, timedOut: true, exitCode: null },
    ],
  };
}

test('server child contract rejects every contradictory inventory, arithmetic, status, flag, and verdict case', () => {
  const expected = ['test/a.test.js', 'test/b.test.js', 'test/c.test.js'];
  assert.equal(validateChildSummary('server-tests', validServerChild(), expected).verdict, 'incomplete');
  const mutate = (fn) => { const value = structuredClone(validServerChild()); fn(value); return value; };
  assert.throws(() => validateChildSummary('server-tests', mutate((s) => { s.files[1].file = s.files[0].file; }), expected), /duplicate/);
  assert.throws(() => validateChildSummary('server-tests', mutate((s) => { s.files[2].file = 'test/unexpected.test.js'; }), expected), /expected inventory/);
  assert.throws(() => validateChildSummary('server-tests', mutate((s) => { s.files[0].status = 'skipped'; }), expected), /invalid status/);
  assert.throws(() => validateChildSummary('server-tests', mutate((s) => { s.files[2].terminal = true; }), expected), /terminal flags/);
  assert.throws(() => validateChildSummary('server-tests', mutate((s) => { s.files[0].exitCode = 1; }), expected), /nonzero exit/);
  for (const invalidExitCode of [0, null, undefined, '1']) {
    assert.throws(() => validateChildSummary('server-tests', mutate((s) => {
      if (invalidExitCode === undefined) delete s.files[1].exitCode;
      else s.files[1].exitCode = invalidExitCode;
    }), expected), /integer nonzero exitCode/);
  }
  assert.throws(() => validateChildSummary('server-tests', mutate((s) => { s.files[0].signal = 'SIGTERM'; }), expected), /signal-bearing/);
  assert.throws(() => validateChildSummary('server-tests', mutate((s) => {
    s.files[2] = { ...s.files[2], status: 'interrupted', timedOut: false, signal: null };
    s.counts.timedOut = 0;
    s.counts.interrupted = 1;
  }), expected), /without a signal or disconnection reason/);
  assert.throws(() => validateChildSummary('server-tests', mutate((s) => { s.counts.passed = 2; }), expected), /aggregate status/);
  assert.throws(() => validateChildSummary('server-tests', mutate((s) => { s.counts.completed = 1; }), expected), /completed count/);
  assert.throws(() => validateChildSummary('server-tests', mutate((s) => { s.counts.started = 2; }), expected), /started count/);
  assert.throws(() => validateChildSummary('server-tests', mutate((s) => { s.counts.discovered = 4; }), expected), /expected inventory/);
  assert.throws(() => validateChildSummary('server-tests', mutate((s) => { s.verdict = 'failed'; }), expected), /contradicts file evidence/);
});

function validStressChild() {
  return {
    schemaVersion: 1,
    verdict: 'incomplete',
    selectedCount: 4,
    terminalCount: 2,
    passedCount: 1,
    failedCount: 1,
    incompleteCount: 1,
    notRunCount: 1,
    harnessError: null,
    slices: [
      { slice: 'one', runId: 'run-one', status: 'passed', ok: true, reportPath: 'one-report.json', latestPath: 'one-latest.json' },
      { slice: 'two', runId: 'run-two', status: 'failed', ok: false, reportPath: 'two-report.json', latestPath: 'two-latest.json' },
      { slice: 'three', status: 'incomplete', ok: false, error: 'tool completion missing' },
      { slice: 'four', status: 'not-run', ok: false, reason: 'harness did not start' },
    ],
  };
}

test('stress child contract rejects duplicate or unexpected slices, bad states, totals, ok flags, and verdicts', () => {
  const expected = ['one', 'two', 'three', 'four'];
  assert.equal(validateChildSummary('stress-slices', validStressChild(), expected).verdict, 'incomplete');
  const mutate = (fn) => { const value = structuredClone(validStressChild()); fn(value); return value; };
  assert.throws(() => validateChildSummary('stress-slices', mutate((s) => { s.slices[1].slice = 'one'; }), expected), /duplicate/);
  assert.throws(() => validateChildSummary('stress-slices', mutate((s) => { s.slices[3].slice = 'unexpected'; }), expected), /expected inventory/);
  assert.throws(() => validateChildSummary('stress-slices', mutate((s) => { s.slices[2].status = 'timeout'; }), expected), /invalid status/);
  assert.throws(() => validateChildSummary('stress-slices', mutate((s) => { s.slices[1].ok = true; }), expected), /contradictory/);
  assert.throws(() => validateChildSummary('stress-slices', mutate((s) => { s.slices[0].reportPath = null; }), expected), /durable reportPath/);
  assert.throws(() => validateChildSummary('stress-slices', mutate((s) => { s.slices[1].latestPath = ''; }), expected), /durable reportPath/);
  assert.throws(() => validateChildSummary('stress-slices', mutate((s) => { delete s.slices[2].error; }), expected), /incomplete reason/);
  assert.throws(() => validateChildSummary('stress-slices', mutate((s) => { delete s.slices[3].reason; }), expected), /incomplete reason/);
  assert.throws(() => validateChildSummary('stress-slices', mutate((s) => { s.terminalCount = 3; }), expected), /terminal count/);
  assert.throws(() => validateChildSummary('stress-slices', mutate((s) => { s.incompleteCount = 0; }), expected), /incompleteCount/);
  assert.throws(() => validateChildSummary('stress-slices', mutate((s) => { s.verdict = 'failed'; }), expected), /contradicts slice evidence/);
});

test('real stress child validation rejects nonexistent durable report files', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-check-child-artifacts-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const childPath = path.join(temp, 'stress-child.json');
  const group = {
    resultContract: 'stress-slices',
    args: ['stress-testing/scripts/run-slices.js', 'one'],
  };
  const child = validStressChild();
  child.selectedCount = 1;
  child.terminalCount = 1;
  child.passedCount = 1;
  child.failedCount = 0;
  child.incompleteCount = 0;
  child.notRunCount = 0;
  child.verdict = 'passed';
  child.slices = [{ slice: 'one', runId: 'run-one', status: 'passed', ok: true, reportPath: path.join(temp, 'missing-report.json'), latestPath: path.join(temp, 'missing-latest.json') }];
  fs.writeFileSync(childPath, JSON.stringify(child));
  assert.throws(() => readChildSummary(group, childPath), /not readable/);

  child.slices[0].reportPath = path.join(temp, 'report.json');
  child.slices[0].latestPath = path.join(temp, 'latest.json');
  const validArtifact = { schemaVersion: 1, slice: 'one', runId: 'run-one', ok: true };
  for (const name of ['report.json', 'latest.json']) fs.writeFileSync(path.join(temp, name), JSON.stringify(validArtifact));
  fs.writeFileSync(childPath, JSON.stringify(child));
  assert.equal(readChildSummary(group, childPath).verdict, 'passed');
});

test('stress artifact validation rejects empty, malformed, stale, mismatched, and contradictory evidence', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-check-artifact-integrity-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const childPath = path.join(temp, 'stress-child.json');
  const reportPath = path.join(temp, 'report.json');
  const latestPath = path.join(temp, 'latest.json');
  const group = { resultContract: 'stress-slices', args: ['stress-testing/scripts/run-slices.js', 'one'] };
  const child = {
    schemaVersion: 1,
    verdict: 'passed',
    selectedCount: 1,
    terminalCount: 1,
    passedCount: 1,
    failedCount: 0,
    incompleteCount: 0,
    notRunCount: 0,
    harnessError: null,
    slices: [{ slice: 'one', runId: 'run-current', status: 'passed', ok: true, reportPath, latestPath }],
  };
  const valid = { schemaVersion: 1, slice: 'one', runId: 'run-current', ok: true };
  const attempt = (report, latest = valid) => {
    fs.writeFileSync(reportPath, typeof report === 'string' ? report : JSON.stringify(report));
    fs.writeFileSync(latestPath, typeof latest === 'string' ? latest : JSON.stringify(latest));
    fs.writeFileSync(childPath, JSON.stringify(child));
    return () => readChildSummary(group, childPath);
  };

  assert.throws(attempt({}), /invalid report schema/);
  assert.throws(attempt('{broken'), /not readable valid JSON/);
  assert.throws(attempt({ ...valid, runId: 'run-stale' }), /stale or mismatched run identity/);
  assert.throws(attempt({ ...valid, slice: 'two' }), /mismatched slice identity/);
  assert.throws(attempt({ ...valid, ok: false }), /outcome disagrees/);
  assert.throws(attempt(valid, { ...valid, runId: 'run-stale' }), /stale or mismatched run identity/);
});

test('capability evidence joins to completed group results without an AI model', () => {
  const result = buildCapabilitySummary({
    capabilities: [{
      id: 'saved-work',
      requiredCheckTypes: ['component', 'server'],
      evidence: [
        { type: 'component', groupId: 'client' },
        { type: 'server', groupId: 'server' },
      ],
      knownGaps: [],
      lastHumanReviewDate: '2026-07-22',
    }],
  }, [
    { id: 'client', status: 'passed' },
    { id: 'server', status: 'passed' },
  ]);

  assert.equal(result['saved-work'].assessment, 'strongly-tested');
  assert.deepEqual(result['saved-work'].checkStatuses, ['passed']);
});

test('fixed verdict rules prefer incomplete over failed and require every required group', () => {
  assert.equal(computeVerdict([{ required: true, status: 'passed' }]), 'passed');
  assert.equal(computeVerdict([{ required: true, status: 'failed' }, { required: true, status: 'passed' }]), 'failed');
  assert.equal(computeVerdict([{ required: true, status: 'failed' }, { required: true, status: 'incomplete' }]), 'incomplete');
  assert.equal(computeVerdict([]), 'incomplete');
});

test('config validation rejects malformed profiles before children can start', () => {
  assert.throws(
    () => validateConfig({ schemaVersion: 1, groups: {}, profiles: { core: ['missing'] } }, 'core'),
    /malformed group missing/,
  );
  assert.throws(
    () => validateConfig({ schemaVersion: 1, groups: {}, profiles: {} }, 'core'),
    /Unknown or empty profile/,
  );
});

test('preflight rejects a missing later executable before any group starts', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-check-preflight-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const configPath = path.join(temp, 'profiles.json');
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    groups: {
      first: { label: 'First', command: 'node', args: [], cwd: '.', timeoutMs: 100 },
      later: { label: 'Later', command: `missing-executable-${Date.now()}`, args: [], cwd: '.', timeoutMs: 100 },
    },
    profiles: { test: ['first', 'later'] },
  }));
  const called = [];
  const { summary } = await runProfile({
    profileName: 'test',
    configPath,
    outputRoot: path.join(temp, 'results'),
    runGroupImpl: async (group) => { called.push(group.id); return { status: 'passed', exitCode: 0, durationMs: 1 }; },
  });
  assert.deepEqual(called, []);
  assert.equal(summary.verdict, 'incomplete');
  assert.deepEqual(summary.incompleteGroups, ['first', 'later']);
  assert.match(summary.groups[0].error, /Preflight failed before any group started/);
});

test('one failed group does not prevent a later independent group from being recorded', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-check-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const configPath = path.join(temp, 'profiles.json');
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    groups: {
      first: { label: 'First', command: 'node', args: [], cwd: '.', timeoutMs: 100 },
      second: { label: 'Second', command: 'node', args: [], cwd: '.', timeoutMs: 100 },
    },
    profiles: { test: ['first', 'second'] },
  }));
  const called = [];
  const { summary, summaryPath } = await runProfile({
    profileName: 'test',
    configPath,
    outputRoot: path.join(temp, 'results'),
    runGroupImpl: async (group) => {
      called.push(group.id);
      return { status: group.id === 'first' ? 'failed' : 'passed', exitCode: group.id === 'first' ? 1 : 0, durationMs: 1 };
    },
  });
  assert.deepEqual(called, ['first', 'second']);
  assert.equal(summary.verdict, 'failed');
  assert.deepEqual(summary.failedGroups, ['first']);
  assert.equal(JSON.parse(fs.readFileSync(summaryPath, 'utf8')).schemaVersion, 1);
});

test('all-pass profile writes the full versioned summary contract and exact gaps', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-check-pass-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const configPath = path.join(temp, 'profiles.json');
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    groups: { only: { label: 'Only', command: 'node', args: [], cwd: '.', timeoutMs: 100 } },
    profiles: { test: ['only'] },
  }));
  const { summary, summaryPath } = await runProfile({
    profileName: 'test',
    configPath,
    outputRoot: path.join(temp, 'results'),
    runGroupImpl: async () => ({ status: 'passed', exitCode: 0, durationMs: 1 }),
  });
  const saved = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  assert.equal(summary.verdict, 'passed');
  assert.equal(saved.schemaVersion, 1);
  assert.ok(Array.isArray(saved.knownGlobalGaps));
  assert.equal(typeof saved.capabilityGaps, 'object');
  assert.deepEqual(saved.quarantined, { tests: [], slices: [] });
});

test('parent interruption cleans its active child and records current and remaining groups incomplete', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-check-interrupt-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const configPath = path.join(temp, 'profiles.json');
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    groups: {
      active: { label: 'Active', command: 'node', args: ['-e', 'setInterval(() => {}, 1000)'], cwd: '.', timeoutMs: 5000 },
      remaining: { label: 'Remaining', command: 'node', args: ['-e', 'process.exit(0)'], cwd: '.', timeoutMs: 5000 },
    },
    profiles: { test: ['active', 'remaining'] },
  }));
  const controller = createRunController();
  const timer = setTimeout(() => controller.interrupt('SIGTERM'), 75);
  const { summary } = await runProfile({ profileName: 'test', configPath, outputRoot: path.join(temp, 'results'), controller });
  clearTimeout(timer);
  assert.equal(summary.verdict, 'incomplete');
  assert.deepEqual(summary.incompleteGroups, ['active', 'remaining']);
  assert.equal(ACTIVE_CHILDREN.size, 0);
});

test('timeout and missing executable are incomplete', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-check-process-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const timeoutResult = await runGroup({ command: 'node', args: ['-e', 'setInterval(() => {}, 1000)'], cwd: temp, timeoutMs: 25 });
  assert.equal(timeoutResult.status, 'incomplete');
  assert.equal(timeoutResult.timedOut, true);

  const missingResult = await runGroup({ command: `missing-executable-${Date.now()}`, args: [], cwd: temp, timeoutMs: 1000 });
  assert.equal(missingResult.status, 'incomplete');
  assert.match(missingResult.error, /ENOENT|not found/i);
});

test('a child disconnect or signal is incomplete', async () => {
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.pid = 999999;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    process.nextTick(() => child.emit('close', null, 'SIGTERM'));
    return child;
  };
  const result = await runGroup(
    { command: 'node', args: [], cwd: process.cwd(), timeoutMs: 1000 },
    { spawnImpl: fakeSpawn },
  );
  assert.equal(result.status, 'incomplete');
  assert.equal(result.signal, 'SIGTERM');
});

test('actual self-signaled server child remains incomplete through the parent contract', async (t) => {
  const nonce = `${process.pid}-${Date.now()}`;
  const fixturePath = path.join(process.cwd(), 'server', 'test', `.parent-signal-${nonce}.test.js`);
  const relativeFixture = `test/${path.basename(fixturePath)}`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-check-parent-signal-'));
  const configPath = path.join(temp, 'profiles.json');
  fs.writeFileSync(fixturePath, "require('node:test')('signals',()=>{process.kill(process.pid,'SIGTERM')})");
  fs.writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    groups: {
      server: {
        label: 'Signal server fixture',
        command: 'node',
        args: ['server/scripts/run-tests.js', '--continue', relativeFixture],
        resultContract: 'server-tests',
        cwd: '.',
        timeoutMs: 10_000,
      },
    },
    profiles: { test: ['server'] },
  }));
  t.after(() => {
    fs.rmSync(fixturePath, { force: true });
    fs.rmSync(temp, { recursive: true, force: true });
  });

  const { summary } = await runProfile({ profileName: 'test', configPath, outputRoot: path.join(temp, 'results') });
  assert.equal(summary.verdict, 'incomplete');
  assert.equal(summary.groups[0].status, 'incomplete');
  assert.equal(summary.groups[0].childSummary.counts.interrupted, 1);
  assert.equal(summary.groups[0].childSummary.counts.completed, 0);
  assert.equal(summary.groups[0].childSummary.files[0].status, 'interrupted');
});
