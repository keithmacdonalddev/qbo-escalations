'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  QBO_KNOWN_ISSUE_FIXTURE,
  QBO_BROWSER_FIXTURE_IDS,
  QBO_TRIAGE_FIXTURE,
  assertHappyPathContract,
  assertLifecycleContract,
  assertResumeContract,
  buildBatchFailureFixture,
  classifyEvidenceTerminalText,
  runBrowserFixture,
} = require('../../slices/client-surfaces/harness/run');
const { buildSliceReport } = require('../harness-runner-utils');
const { runAgentBrowserSequence } = require('../agent-browser-utils');
const { createSummary, reportCompletionProblem } = require('../run-slices');

function expectedVisibleQboValues() {
  return {
    triageRead: QBO_TRIAGE_FIXTURE.read,
    triageAction: QBO_TRIAGE_FIXTURE.action,
    knownIssueStatus: QBO_KNOWN_ISSUE_FIXTURE.visibleStatus,
    knownIssueSummary: QBO_KNOWN_ISSUE_FIXTURE.visibleSummary,
  };
}

test('client surfaces declares exactly the five critical QBO browser journeys', () => {
  assert.deepEqual(QBO_BROWSER_FIXTURE_IDS, [
    'browser-qbo-happy-path',
    'browser-qbo-parser-failure-recovery',
    'browser-qbo-unsaved-navigation-protection',
    'browser-qbo-session-resume-integrity',
    'browser-qbo-escalation-lifecycle-handoff',
  ]);
});

test('happy path accepts documented completed evidence states and rejects settling or unknown evidence', () => {
  const base = {
    conversationHash: '#/chat/0123456789abcdef01234567',
    parseCountAfterReload: 1,
    answerCountAfterReload: 1,
    savedEvidence: {
      triageRead: QBO_TRIAGE_FIXTURE.read,
      triageAction: QBO_TRIAGE_FIXTURE.action,
      knownIssueStatus: QBO_KNOWN_ISSUE_FIXTURE.status,
      knownIssueSummary: QBO_KNOWN_ISSUE_FIXTURE.summary,
    },
    visibleBeforeReload: expectedVisibleQboValues(),
    visibleAfterReload: expectedVisibleQboValues(),
  };
  assert.equal(assertHappyPathContract({ ...base, evidenceText: 'Evidence complete' }), 'complete');
  assert.equal(
    assertHappyPathContract({ ...base, evidenceText: '2 expected evidence items are not saved.' }),
    'completed-with-missing-evidence',
  );
  assert.equal(classifyEvidenceTerminalText('Evidence is still settling, so completeness is not known yet.'), 'settling');
  assert.throws(
    () => assertHappyPathContract({ ...base, evidenceText: 'Evidence is still settling, so completeness is not known yet.' }),
    /documented completed evidence state, got settling/,
  );
  assert.throws(() => assertHappyPathContract({ ...base, evidenceText: '' }), /got unknown/);
});

test('happy, resume, and lifecycle contracts reject labels without exact saved or terminal truth', () => {
  const happy = {
    conversationHash: '#/chat/0123456789abcdef01234567',
    parseCountAfterReload: 1,
    answerCountAfterReload: 1,
    evidenceText: 'Evidence complete',
    savedEvidence: {
      triageRead: 'wrong saved triage',
      triageAction: QBO_TRIAGE_FIXTURE.action,
      knownIssueStatus: QBO_KNOWN_ISSUE_FIXTURE.status,
      knownIssueSummary: QBO_KNOWN_ISSUE_FIXTURE.summary,
    },
    visibleBeforeReload: { ...expectedVisibleQboValues(), knownIssueStatus: 'pending' },
    visibleAfterReload: expectedVisibleQboValues(),
  };
  assert.throws(() => assertHappyPathContract(happy), /wrong saved triage/);
  assert.throws(() => assertHappyPathContract({
    ...happy,
    savedEvidence: {
      triageRead: QBO_TRIAGE_FIXTURE.read,
      triageAction: QBO_TRIAGE_FIXTURE.action,
      knownIssueStatus: QBO_KNOWN_ISSUE_FIXTURE.status,
      knownIssueSummary: QBO_KNOWN_ISSUE_FIXTURE.summary,
    },
  }));
  assert.throws(() => assertResumeContract({
    parsedCount: 1,
    answerCount: 1,
    stageTerminalStates: { parser: 'done', inv: 'pending', triage: 'done', main: 'done' },
  }));
  assert.throws(() => assertLifecycleContract({
    outputs: { identityVisible: true, visibleIdentity: { coid: true, caseNumber: true, evidence: true } },
    saved: { conversationId: 'different', status: 'resolved' },
    conversationId: 'conversation-one',
    expectedIdentity: { coid: true, caseNumber: true, evidence: true },
  }));
});

test('browser fixture has one absolute deadline and short-bounded cleanup', async () => {
  const startedAt = Date.now();
  const closeCalls = [];
  const result = await runBrowserFixture({
    id: 'bounded-fixture',
    description: 'Controlled never-settling browser fixture.',
    session: 'isolated-bounded-session',
    timeoutMs: 35,
    execute: async () => new Promise(() => {}),
    closeImpl: async (session, options) => closeCalls.push({ session, options }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.incomplete, true);
  assert.match(result.error, /absolute deadline/);
  assert.ok(Date.now() - startedAt < 250, 'fixture should terminate close to its absolute deadline');
  assert.deepEqual(closeCalls, [{
    session: 'isolated-bounded-session',
    options: { timeoutMs: 7_000 },
  }]);
});

test('browser fixture finally hard-settles even when injected session cleanup never resolves', async () => {
  const startedAt = Date.now();
  const result = await runBrowserFixture({
    id: 'bounded-cleanup-fixture',
    description: 'Controlled never-settling cleanup.',
    session: 'isolated-never-close-session',
    timeoutMs: 25,
    closeTimeoutMs: 30,
    execute: async () => ({ id: 'bounded-cleanup-fixture', kind: 'browser', ok: true }),
    closeImpl: () => new Promise(() => {}),
  });

  assert.equal(result.ok, false);
  assert.equal(result.incomplete, true);
  assert.equal(result.cleanupVerified, false);
  assert.match(result.error, /cleanup could not be verified/);
  assert.ok(Date.now() - startedAt < 350, 'fixture cleanup should hard-settle within its close deadline plus grace');
});

test('absolute deadline and cleanup failure propagate to an incomplete slice report', async () => {
  const deadlineFixture = await runBrowserFixture({
    id: 'deadline-fixture',
    description: 'Never-settling execution.',
    session: 'deadline-session',
    timeoutMs: 20,
    closeTimeoutMs: 20,
    execute: () => new Promise(() => {}),
    closeImpl: async () => ({ closed: true }),
  });
  const cleanupFixture = await runBrowserFixture({
    id: 'cleanup-fixture',
    description: 'Never-settling cleanup.',
    session: 'cleanup-session',
    timeoutMs: 20,
    closeTimeoutMs: 20,
    execute: async () => ({ id: 'cleanup-fixture', kind: 'browser', ok: true }),
    closeImpl: () => new Promise(() => {}),
  });
  for (const fixture of [deadlineFixture, cleanupFixture]) {
    const report = buildSliceReport('client-surfaces', {
      runId: `run-${fixture.id}`,
      fixtures: [fixture],
    });
    report.paths = { reportPath: 'report.json', latestPath: 'latest.json' };
    assert.equal(report.ok, false);
    assert.equal(report.incomplete, true);
    assert.match(reportCompletionProblem(report, 'client-surfaces'), /deadline|cleanup/i);
  }
});

test('native connection loss propagates from command through fixture, slice, and run verdict', async () => {
  const sequence = await runAgentBrowserSequence('connection-loss-session', [['open', 'http://127.0.0.1']], {
    runImpl: async () => { throw Object.assign(new Error('connection failed with os error 10060'), { code: 1 }); },
  });
  const fixture = buildBatchFailureFixture({
    id: 'connection-loss-fixture',
    description: 'Injected native transport loss.',
    batchResult: sequence,
    outputs: {},
    screenshotPath: 'does-not-exist.png',
  });
  const report = buildSliceReport('client-surfaces', {
    runId: 'run-connection-loss',
    fixtures: [fixture],
  });
  report.paths = { reportPath: 'report.json', latestPath: 'latest.json' };
  const completionProblem = reportCompletionProblem(report, 'client-surfaces');
  const summary = createSummary(['client-surfaces'], [{
    slice: 'client-surfaces',
    status: completionProblem ? 'incomplete' : report.ok ? 'passed' : 'failed',
    ok: false,
    error: completionProblem,
  }]);

  assert.equal(sequence.parsed[0].completionLost, true);
  assert.equal(fixture.incomplete, true);
  assert.equal(report.incomplete, true);
  assert.match(completionProblem, /os error 10060/);
  assert.equal(summary.verdict, 'incomplete');
  assert.equal(summary.terminalCount, 0);
});
