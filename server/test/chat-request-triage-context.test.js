'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildParserDerivedTriageContext,
} = require('../src/services/chat-request-service');

const CANONICAL_TEMPLATE = [
  'COID/MID: 9341452197744835',
  'CASE: 15154531492',
  'CLIENT/CONTACT: Doug Mckensie',
  'CX IS ATTEMPTING TO: Customer is calling to download the XML for his T4 but for some reason it didn\'t download the T4 summary when he downloaded the XML',
  'EXPECTED OUTCOME: wanted to send in his T4 to CRA',
  'ACTUAL OUTCOME: missing the T4 summary',
  'KB/TOOLS USED: HELP PANEL, KB ARTICLES, GOOGLE, SCREEN SHARE.',
  'TRIED TEST ACCOUNT: n/a',
  'TS STEPS: Customer is calling about to download his T4 to CRA when he downloaded the T4 XML the T4 summary didn\'t download',
].join('\n');

test('buildParserDerivedTriageContext accepts canonical escalation template text', () => {
  const context = buildParserDerivedTriageContext({
    parserText: CANONICAL_TEMPLATE,
    parserProvider: 'gemini',
    parserModel: 'gemini-3-flash-preview',
    elapsedMs: 123,
  });

  assert.equal(context.error, null);
  assert.equal(context.parseFields.clientContact, 'Doug Mckensie');
  assert.equal(context.triageCard.category, 'payroll');
  assert.equal(context.triageCard.confidence, 'high');
  assert.equal(context.parseMeta.validation.passed, true);
  assert.equal(context.parseMeta.validation.canonicalTemplate.passed, true);
});

test('buildParserDerivedTriageContext rejects non-canonical parser fields before triage', () => {
  const withAgent = CANONICAL_TEMPLATE.replace(
    'CLIENT/CONTACT: Doug Mckensie\n',
    'CLIENT/CONTACT: Doug Mckensie\nAGENT: Phone Agent\n'
  );
  const context = buildParserDerivedTriageContext({
    parserText: withAgent,
    parserProvider: 'gemini',
    parserModel: 'gemini-3-flash-preview',
    elapsedMs: 123,
  });

  assert.equal(context.error.code, 'CANONICAL_TEMPLATE_VALIDATION_FAILED');
  assert.deepEqual(context.parseFields, {});
  assert.equal(context.triageCard.confidence, 'low');
  assert.equal(context.parseMeta.validation.passed, false);
  assert.ok(context.parseMeta.validation.issues.includes('canonical_NON_CANONICAL_FIELD'));
  assert.equal(context.parseMeta.validation.canonicalTemplate.passed, false);
});
