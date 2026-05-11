'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildKnownIssueSearchPromptInput,
  buildKnownIssueSearchQueries,
  knownIssueSearchToInvMatchResult,
  parseKnownIssueAgentOutput,
} = require('../src/services/known-issue-search-agent');

const PAYROLL_FIELDS = {
  category: 'payroll',
  attemptingTo: 'Customer is trying to pay employees by direct deposit.',
  actualOutcome: 'Payroll is showing suspended in CS Server and iBoss as of 12/26/2025.',
  expectedOutcome: '',
  kbToolsUsed: 'iBoss, CS Server',
  triedTestAccount: 'no',
  tsSteps: 'CS Server and iBoss show payroll suspended.',
};

test('buildKnownIssueSearchQueries creates targeted case-fact queries', () => {
  const queries = buildKnownIssueSearchQueries(PAYROLL_FIELDS);

  assert.ok(queries.length >= 3);
  assert.ok(queries.some((query) => /payroll/i.test(query)));
  assert.ok(queries.some((query) => /suspended/i.test(query)));
  assert.ok(queries.some((query) => /direct deposit|iboss|cs server/i.test(query)));
});

test('buildKnownIssueSearchPromptInput includes case facts and suggested queries', () => {
  const input = buildKnownIssueSearchPromptInput({
    parserText: 'COID/MID: 123\nACTUAL OUTCOME: payroll suspended',
    parseFields: PAYROLL_FIELDS,
  });

  assert.match(input, /Case facts JSON/);
  assert.match(input, /Suggested query variants/);
  assert.match(input, /direct deposit/i);
  assert.match(input, /payroll suspended/i);
});

test('parseKnownIssueAgentOutput validates searched, fetched high-confidence matches', () => {
  const actionResults = [
    {
      tool: 'db.searchInvestigations',
      params: { query: 'payroll direct deposit suspended', category: 'payroll', status: 'active' },
      result: { ok: true, count: 1, results: [{ invNumber: 'INV-151000', subject: 'Payroll direct deposit suspended' }] },
    },
    {
      tool: 'db.getInvestigation',
      params: { invNumber: 'INV-151000' },
      result: {
        ok: true,
        investigation: {
          invNumber: 'INV-151000',
          subject: 'Payroll direct deposit suspended in iBoss',
          category: 'payroll',
          status: 'in-progress',
          workaround: 'Route to payroll suspension support.',
        },
      },
    },
  ];
  const output = JSON.stringify({
    status: 'match',
    summary: 'Likely active payroll suspension investigation.',
    searches: [{ query: 'payroll direct deposit suspended', category: 'payroll', status: 'active', resultCount: 1 }],
    matches: [{
      invNumber: 'INV-151000',
      confidence: 'high',
      subject: 'Payroll direct deposit suspended in iBoss',
      evidenceFor: ['Payroll direct deposit is suspended', 'iBoss is named in both records'],
      evidenceAgainst: [],
      missingConfirmations: ['Confirm suspension reason'],
      recommendedAction: 'Confirm customer is authorized payroll admin before adding to affected users.',
    }],
    rejectedCandidates: [],
    noMatchReason: '',
    needsMoreInfo: [],
  });

  const result = parseKnownIssueAgentOutput(output, actionResults);

  assert.equal(result.ok, true);
  assert.equal(result.status, 'match');
  assert.equal(result.matches[0].confidence, 'high');
  assert.equal(result.validation.passed, true);
});

test('parseKnownIssueAgentOutput rejects no-match claims without multiple searches', () => {
  const result = parseKnownIssueAgentOutput(JSON.stringify({
    status: 'no_reasonable_match',
    summary: 'No known issue found.',
    searches: [{ query: 'payroll', resultCount: 0 }],
    matches: [],
    rejectedCandidates: [],
    noMatchReason: 'Only generic payroll results appeared.',
    needsMoreInfo: [],
  }), [
    {
      tool: 'db.searchInvestigations',
      params: { query: 'payroll' },
      result: { ok: true, count: 0, results: [] },
    },
  ]);

  assert.equal(result.ok, false);
  assert.ok(result.validation.issues.includes('no_match_without_multiple_searches'));
});

test('knownIssueSearchToInvMatchResult converts validated matches for existing INV banner flow', () => {
  const searchResult = parseKnownIssueAgentOutput(JSON.stringify({
    status: 'match',
    summary: 'Known issue matched.',
    searches: [{ query: 'payroll direct deposit suspended', category: 'payroll', status: 'active', resultCount: 1 }],
    matches: [{
      invNumber: 'INV-151000',
      confidence: 'high',
      subject: 'Payroll direct deposit suspended in iBoss',
      evidenceFor: ['Payroll direct deposit is suspended', 'iBoss is named in both records'],
      evidenceAgainst: [],
      missingConfirmations: [],
      recommendedAction: 'Add to affected users after confirming the suspension reason.',
    }],
    rejectedCandidates: [],
    noMatchReason: '',
    needsMoreInfo: [],
  }), [
    {
      tool: 'db.searchInvestigations',
      params: { query: 'payroll direct deposit suspended', category: 'payroll', status: 'active' },
      result: { ok: true, count: 1 },
    },
    {
      tool: 'db.getInvestigation',
      params: { invNumber: 'INV-151000' },
      result: {
        ok: true,
        investigation: {
          _id: '507f1f77bcf86cd799439011',
          invNumber: 'INV-151000',
          subject: 'Payroll direct deposit suspended in iBoss',
          category: 'payroll',
          status: 'in-progress',
        },
      },
    },
  ]);
  searchResult.meta = { actions: [
    {
      tool: 'db.getInvestigation',
      result: {
        investigation: {
          _id: '507f1f77bcf86cd799439011',
          invNumber: 'INV-151000',
          subject: 'Payroll direct deposit suspended in iBoss',
          category: 'payroll',
          status: 'in-progress',
        },
      },
    },
  ] };

  const legacy = knownIssueSearchToInvMatchResult(searchResult);

  assert.equal(legacy.matches.length, 1);
  assert.equal(legacy.ssePayload[0].invNumber, 'INV-151000');
  assert.equal(legacy.ssePayload[0].confidence, 'high');
});
