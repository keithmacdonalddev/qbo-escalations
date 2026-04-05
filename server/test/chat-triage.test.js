'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildServerTriageCard,
  buildFallbackTriageCard,
} = require('../src/lib/chat-triage');

test('buildServerTriageCard produces a focused payroll export triage for missing tax-form summary downloads', () => {
  const triage = buildServerTriageCard({
    clientContact: 'Doug Mckensie',
    category: 'payroll',
    attemptingTo: "Customer is calling to download the XML for his T4 but the T4 summary didn't download with the XML",
    expectedOutcome: 'wanted to send in his T4 to CRA',
    actualOutcome: 'missing the T4 summary',
    tsSteps: "Went into the archive, deleted it, and tried to get it to repopulate but it didn't work",
  });

  assert.equal(triage.category, 'payroll');
  assert.equal(triage.severity, 'P3');
  assert.match(triage.read, /T4 export is incomplete/i);
  assert.match(triage.read, /missing from the download package/i);
  assert.match(triage.read, /archive/i);
  assert.match(triage.action, /tax year/i);
  assert.match(triage.action, /Archived Forms/i);
  assert.doesNotMatch(triage.action, /Tell the agent/i);
});

test('buildFallbackTriageCard uses the stronger generic next-step wording', () => {
  const triage = buildFallbackTriageCard();

  assert.equal(triage.severity, 'P3');
  assert.match(triage.action, /Reproduce the exact failing step once/i);
  assert.match(triage.action, /isolated or company-wide/i);
});
