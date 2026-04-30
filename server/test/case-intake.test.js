'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
        validation: { passed: true, score: 0.98 },
      },
      triageCard: {
        category: 'payroll',
        severity: 'P3',
        read: 'Payroll export issue.',
        action: 'Verify the tax form export path.',
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

  assert.equal(intake.status, 'analyst-running');
  assert.equal(intake.canonicalTemplate, 'COID/MID: 123\nCASE: 456');
  assert.equal(intake.parseFields.coid, '123');
  assert.equal(intake.triageCard.category, 'payroll');
  assert.equal(intake.runs.length, 3);
  assert.deepEqual(intake.runs.map((run) => run.phase), ['parse-template', 'triage', 'analyst']);
  assert.deepEqual(intake.runs.map((run) => run.status), ['completed', 'completed', 'running']);
  assert.equal(intake.runs[0].provider, 'llm-gateway');
  assert.equal(intake.runs[2].provider, 'gpt-5.5');
  assert.equal(intake.activeRunId, intake.runs[2].id);
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
  assert.equal(analyst.summary, 'Timed out');
  assert.deepEqual(analyst.detail, { code: 'TIMEOUT', message: 'Timed out' });
});
