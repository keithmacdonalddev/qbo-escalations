const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CANONICAL_ESCALATION_TEMPLATE_LABELS,
  buildCanonicalEscalationTemplateFormat,
  validateCanonicalEscalationTemplateText,
} = require('../src/lib/escalation-template-contract');

test('canonical template format exposes the strict Role 1 field order', () => {
  assert.deepEqual(CANONICAL_ESCALATION_TEMPLATE_LABELS, [
    'COID/MID',
    'CASE',
    'CLIENT/CONTACT',
    'CX IS ATTEMPTING TO',
    'EXPECTED OUTCOME',
    'ACTUAL OUTCOME',
    'KB/TOOLS USED',
    'TRIED TEST ACCOUNT',
    'TS STEPS',
  ]);

  assert.equal(buildCanonicalEscalationTemplateFormat(), [
    'COID/MID:',
    'CASE:',
    'CLIENT/CONTACT:',
    'CX IS ATTEMPTING TO:',
    'EXPECTED OUTCOME:',
    'ACTUAL OUTCOME:',
    'KB/TOOLS USED:',
    'TRIED TEST ACCOUNT:',
    'TS STEPS:',
  ].join('\n'));
});

test('validateCanonicalEscalationTemplateText accepts exact canonical parser output', () => {
  const input = [
    'COID/MID: 9341452197744835',
    'CASE: 15154531492',
    'CLIENT/CONTACT: Doug Mckensie',
    'CX IS ATTEMPTING TO: Customer is calling to download the XML for his T4',
    'EXPECTED OUTCOME: wanted to send in his T4 to CRA',
    'ACTUAL OUTCOME: missing the T4 summary',
    'KB/TOOLS USED: HELP PANEL, KB ARTICLES, GOOGLE, SCREEN SHARE.',
    'TRIED TEST ACCOUNT: n/a',
    'TS STEPS: Customer is calling about download his T4 to CRA',
    'downloaded the T4 XML the T4 summary didn\'t download',
  ].join('\n');

  const result = validateCanonicalEscalationTemplateText(input);

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.fields.clientContact, 'Doug Mckensie');
  assert.match(result.fields.tsSteps, /downloaded the T4 XML/);
});

test('validateCanonicalEscalationTemplateText rejects non-canonical AGENT field', () => {
  const input = [
    'COID/MID: 123 / 456',
    'CASE: CS-1',
    'CLIENT/CONTACT: Jane',
    'AGENT: John Doe',
    'CX IS ATTEMPTING TO: connect bank feed',
    'EXPECTED OUTCOME: sync',
    'ACTUAL OUTCOME: error',
    'KB/TOOLS USED: help panel',
    'TRIED TEST ACCOUNT: yes',
    'TS STEPS: retried',
  ].join('\n');

  const result = validateCanonicalEscalationTemplateText(input);

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'FIELD_ORDER_OR_LABEL_MISMATCH'));
  assert.ok(result.issues.some((issue) => issue.code === 'NON_CANONICAL_FIELD'));
});

test('validateCanonicalEscalationTemplateText rejects reordered canonical fields', () => {
  const input = [
    'COID/MID: 123 / 456',
    'CASE: CS-1',
    'CLIENT/CONTACT: Jane',
    'CX IS ATTEMPTING TO: connect bank feed',
    'EXPECTED OUTCOME: sync',
    'ACTUAL OUTCOME: error',
    'KB/TOOLS USED: help panel',
    'TS STEPS: retried',
    'TRIED TEST ACCOUNT: yes',
  ].join('\n');

  const result = validateCanonicalEscalationTemplateText(input);

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === 'FIELD_ORDER_OR_LABEL_MISMATCH'));
});
