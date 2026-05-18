'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  appendCaseIntakeFollowUp,
  buildCaseIntakeFromParsedEscalation,
  completeCaseIntakeAnalystRun,
  failCaseIntakeAnalystRun,
} = require('../src/lib/case-intake');

const STARTED_AT = new Date('2026-04-29T12:00:00.000Z');
const COMPLETED_AT = new Date('2026-04-29T12:00:05.000Z');

test('buildCaseIntakeFromParsedEscalation records parser, triage, and running analyst runs', () => {
  const intake = buildCaseIntakeFromParsedEscalation({
    sourceText: 'COID/MID: 123\nCASE: 456',
    imageTriageContext: {
      parseFields: { coid: '123', caseNumber: '456' },
      parseMeta: {
        providerUsed: 'llm-gateway',
        model: 'auto',
        latencyMs: 1250,
        validation: { passed: true, score: 0.98 },
      },
      elapsedMs: 2400,
      triageCard: {
        category: 'payroll',
        severity: 'P3',
        read: 'Payroll export issue.',
        action: 'Verify the tax form export path.',
        confidence: 'medium',
        generation: {
          source: 'agent',
          label: 'Agent generated',
          latencyMs: 2400,
          provider: 'claude',
          model: 'claude-opus-4-7',
        },
      },
    },
    parserProvider: 'llm-gateway',
    parserModel: 'auto',
    analystProvider: 'gpt-5.5',
    analystModel: 'gpt-5.5',
    traceId: 'trace-1',
    startedAt: STARTED_AT,
  });

  assert.equal(intake.status, 'analyst-running');
  assert.equal(intake.canonicalTemplate, 'COID/MID: 123\nCASE: 456');
  assert.equal(intake.parseFields.coid, '123');
  assert.equal(intake.triageCard.category, 'payroll');
  assert.equal(intake.runs.length, 3);
  assert.deepEqual(intake.runs.map((run) => run.phase), ['parse-template', 'triage', 'analyst']);
  assert.deepEqual(intake.runs.map((run) => run.status), ['completed', 'completed', 'running']);
  assert.equal(intake.runs[0].provider, 'llm-gateway');
  assert.equal(intake.runs[0].durationMs, 1250);
  assert.equal(intake.runs[1].durationMs, 2400);
  assert.equal(intake.runs[1].detail.generation.source, 'agent');
  assert.equal(intake.runs[1].detail.generation.label, 'Agent generated');
  assert.equal(intake.runs[2].provider, 'gpt-5.5');
  assert.equal(intake.activeRunId, intake.runs[2].id);
});

test('buildCaseIntakeFromParsedEscalation records known issue search run when available', () => {
  const intake = buildCaseIntakeFromParsedEscalation({
    sourceText: 'COID/MID: 123\nCASE: 456',
    imageTriageContext: {
      parseFields: { coid: '123', caseNumber: '456' },
      parseMeta: {
        providerUsed: 'llm-gateway',
        model: 'auto',
        validation: { passed: true, score: 0.98 },
      },
      knownIssueSearchResult: {
        ok: true,
        status: 'match',
        summary: '1 known issue candidate found.',
        searches: [{ query: 'payroll direct deposit suspended', category: 'payroll', status: 'active', resultCount: 1 }],
        matches: [{ invNumber: 'INV-151000', confidence: 'high', subject: 'Payroll suspended' }],
        rejectedCandidates: [],
        validation: { passed: true, issues: [], toolSearchCount: 1, fetchedInvestigationCount: 1 },
        meta: { providerUsed: 'claude', model: 'claude-opus-4-7', latencyMs: 850, runtimeConfigured: true },
      },
      triageCard: {
        category: 'payroll',
        severity: 'P3',
        read: 'Payroll suspension issue.',
        action: 'Confirm the suspension reason.',
        confidence: 'medium',
      },
    },
    parserProvider: 'llm-gateway',
    parserModel: 'auto',
    analystProvider: 'gpt-5.5',
    analystModel: 'gpt-5.5',
    traceId: 'trace-1',
    startedAt: STARTED_AT,
  });

  assert.deepEqual(
    intake.runs.map((run) => run.phase),
    ['parse-template', 'known-issue-search', 'triage', 'analyst']
  );
  const knownIssueRun = intake.runs.find((run) => run.phase === 'known-issue-search');
  assert.equal(knownIssueRun.status, 'completed');
  assert.equal(knownIssueRun.agentId, 'known-issue-search-agent');
  assert.equal(knownIssueRun.durationMs, 850);
  assert.equal(knownIssueRun.detail.matches[0].invNumber, 'INV-151000');
  assert.equal(intake.knownIssueSearchResult.status, 'match');
});

test('completeCaseIntakeAnalystRun closes the active analyst run without losing parse state', () => {
  const intake = buildCaseIntakeFromParsedEscalation({
    sourceText: 'COID/MID: 123\nCASE: 456',
    imageTriageContext: {
      parseFields: { coid: '123' },
      triageCard: { category: 'payroll', severity: 'P3', read: 'Payroll issue.' },
    },
    analystProvider: 'gpt-5.5',
    analystModel: 'gpt-5.5',
    startedAt: STARTED_AT,
  });

  const completed = completeCaseIntakeAnalystRun(intake, {
    provider: 'gpt-5.5',
    model: 'gpt-5.5',
    traceId: 'trace-1',
    summary: 'Ask the phone agent for payroll tax-year details.',
    detail: { attempts: 1 },
    completedAt: COMPLETED_AT,
  });

  const analyst = completed.runs.find((run) => run.phase === 'analyst');
  assert.equal(completed.status, 'analyst-complete');
  assert.equal(completed.parseFields.coid, '123');
  assert.equal(completed.activeRunId, '');
  assert.equal(analyst.status, 'completed');
  assert.equal(analyst.durationMs, 5000);
  assert.equal(analyst.summary, 'Ask the phone agent for payroll tax-year details.');
  assert.deepEqual(analyst.detail, { attempts: 1 });
});

test('failCaseIntakeAnalystRun marks analyst failures for review', () => {
  const intake = buildCaseIntakeFromParsedEscalation({
    sourceText: 'COID/MID: 123\nCASE: 456',
    imageTriageContext: {
      parseFields: { coid: '123' },
      triageCard: { category: 'payroll', severity: 'P3', read: 'Payroll issue.' },
    },
    analystProvider: 'gpt-5.5',
    analystModel: 'gpt-5.5',
    startedAt: STARTED_AT,
  });

  const failed = failCaseIntakeAnalystRun(intake, {
    provider: 'gpt-5.5',
    model: 'gpt-5.5',
    traceId: 'trace-1',
    error: { code: 'TIMEOUT', message: 'Timed out' },
    completedAt: COMPLETED_AT,
  });

  const analyst = failed.runs.find((run) => run.phase === 'analyst');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.activeRunId, '');
  assert.equal(analyst.status, 'failed');
  assert.equal(analyst.durationMs, 5000);
  assert.equal(analyst.summary, 'Timed out');
  assert.deepEqual(analyst.detail, { code: 'TIMEOUT', message: 'Timed out' });
});

test('buildCaseIntakeFromParsedEscalation treats rule fallback as completed with fallback.used=true', () => {
  const intake = buildCaseIntakeFromParsedEscalation({
    sourceText: 'COID/MID: 123\nCASE: 456',
    imageTriageContext: {
      parseFields: { coid: '123', caseNumber: '456' },
      parseMeta: { providerUsed: 'llm-gateway', model: 'auto', validation: { passed: true, score: 0.95 } },
      triageMeta: {
        providerUsed: 'claude',
        model: 'claude-opus-4-7',
        usedRuleFallback: true,
        fallbackFrom: 'agent-shape',
        fallbackReason: 'Triage Agent response did not match the required field format.',
      },
      triageCard: {
        category: 'payroll',
        severity: 'P3',
        read: 'Payroll export issue.',
        action: 'Verify the tax form export path.',
        confidence: 'low',
        source: 'rule-fallback',
        fallback: {
          used: true,
          reason: 'Triage Agent response did not match the required field format.',
        },
      },
      elapsedMs: 2400,
    },
    parserProvider: 'llm-gateway',
    parserModel: 'auto',
    analystProvider: 'gpt-5.5',
    analystModel: 'gpt-5.5',
    traceId: 'trace-fallback',
    startedAt: STARTED_AT,
  });

  const triageRun = intake.runs.find((run) => run.phase === 'triage');
  assert.equal(triageRun.status, 'completed');
  assert.equal(triageRun.fallback.used, true);
  assert.equal(triageRun.fallback.from, 'agent-shape');
  assert.match(triageRun.fallback.reason, /did not match the required field format/);
  assert.equal(triageRun.fallbackUsed, true);
  assert.equal(triageRun.summary, triageRun.fallback.reason);
});

test('buildCaseIntakeFromParsedEscalation marks triage as failed only when the run errors', () => {
  const intake = buildCaseIntakeFromParsedEscalation({
    sourceText: 'COID/MID: 123\nCASE: 456',
    imageTriageContext: {
      parseFields: { coid: '123', caseNumber: '456' },
      parseMeta: { providerUsed: 'llm-gateway', model: 'auto', validation: { passed: true, score: 0.95 } },
      triageMeta: null,
      triageCard: null,
      error: { code: 'TRIAGE_AGENT_TIMEOUT', message: 'Triage Agent timed out before responding.' },
      elapsedMs: 30_000,
    },
    parserProvider: 'llm-gateway',
    parserModel: 'auto',
    analystProvider: 'gpt-5.5',
    analystModel: 'gpt-5.5',
    traceId: 'trace-error',
    startedAt: STARTED_AT,
  });

  const triageRun = intake.runs.find((run) => run.phase === 'triage');
  assert.equal(triageRun.status, 'failed');
  assert.equal(triageRun.fallback.used, false);
  assert.equal(triageRun.fallback.reason, '');
  assert.equal(triageRun.fallback.from, '');
  assert.equal(triageRun.fallbackUsed, false);
  assert.match(triageRun.summary, /timed out/i);
});

test('appendCaseIntakeFollowUp stores parsed phone-agent chat context without changing analyst status', () => {
  const intake = buildCaseIntakeFromParsedEscalation({
    sourceText: 'COID/MID: 123\nCASE: 456',
    imageTriageContext: {
      parseFields: { coid: '123' },
      triageCard: { category: 'payroll', severity: 'P3', read: 'Payroll issue.' },
    },
    analystProvider: 'gpt-5.5',
    analystModel: 'gpt-5.5',
    startedAt: STARTED_AT,
  });

  const updated = appendCaseIntakeFollowUp(intake, {
    transcript: 'Context type: phone-agent-follow-up\n\nVerbatim transcript:\nAgent: Customer confirmed the payroll year.\n\nParser note:\nThis is follow-up context.',
    parserProvider: 'llm-gateway',
    parserModel: 'auto',
    traceId: 'trace-2',
    createdAt: COMPLETED_AT,
  });

  assert.equal(updated.status, 'analyst-running');
  assert.equal(updated.followUps.length, 1);
  assert.equal(updated.followUps[0].source, 'follow-up-chat-parser');
  assert.match(updated.followUps[0].transcript, /Customer confirmed/);
  assert.equal(updated.followUps[0].parserProvider, 'llm-gateway');
  assert.equal(updated.followUps[0].traceId, 'trace-2');
  assert.equal(updated.canonicalTemplate, intake.canonicalTemplate);
});
