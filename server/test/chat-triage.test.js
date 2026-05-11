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
  assert.equal(triage.confidence, 'medium');
  assert.deepEqual(triage.missingInfo, [
    'COID/MID or case number',
    'Whether this reproduces in a test account',
  ]);
  assert.match(triage.categoryCheck, /T4 forms are generated from payroll workflows/i);
});

test('buildServerTriageCard treats class imports through Products and Services as workflow guidance', () => {
  const triage = buildServerTriageCard({
    clientContact: 'Joe Charest',
    category: 'technical',
    attemptingTo: 'Import Classes under product and services',
    expectedOutcome: 'to be able to import Classes',
    actualOutcome: 'getting error',
    triedTestAccount: 'yes',
    tsSteps: 'tried changing classes on customer csv file and name them category / getting error / no option for classes importation',
  });

  assert.equal(triage.category, 'technical');
  assert.equal(triage.severity, 'P3');
  assert.equal(triage.confidence, 'high');
  assert.match(triage.read, /workflow mismatch/i);
  assert.match(triage.read, /Products and Services/i);
  assert.match(triage.action, /proper Classes workflow/i);
  assert.match(triage.action, /Escalate only if/i);
  assert.ok(triage.missingInfo.includes('Whether Gear > All lists > Classes reproduces an error'));
  assert.match(triage.categoryCheck, /workflow correction/i);
});

test('buildFallbackTriageCard uses the stronger generic next-step wording', () => {
  const triage = buildFallbackTriageCard();

  assert.equal(triage.severity, 'P3');
  assert.equal(triage.confidence, 'low');
  assert.match(triage.action, /Reproduce the exact failing step once/i);
  assert.match(triage.action, /isolated or company-wide/i);
  assert.ok(triage.missingInfo.includes('Canonical escalation fields did not validate'));
});
