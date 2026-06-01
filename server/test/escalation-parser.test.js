const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseEscalationText,
  classifyCategory,
  looksLikeEscalation,
} = require('../src/lib/escalation-parser');

test('parseEscalationText extracts core fields from standard escalation format', () => {
  const input = [
    'COID/MID: 123456 / 654321',
    'CASE: CS-2026-000111',
    'CLIENT/CONTACT: Jane Smith',
    'AGENT: John Doe',
    'CX IS ATTEMPTING TO: Connect their bank feed and import transactions',
    'EXPECTED OUTCOME: Transactions sync successfully',
    'ACTUAL OUTCOME: Connection error appears repeatedly',
    'KB/TOOLS USED: Help panel, Google',
    'TRIED TEST ACCOUNT: Yes',
    'TS STEPS: Cleared cache, tried incognito, reconnected bank',
  ].join('\n');

  const parsed = parseEscalationText(input);

  assert.equal(parsed.coid, '123456');
  assert.equal(parsed.mid, '654321');
  assert.equal(parsed.caseNumber, 'CS-2026-000111');
  assert.equal(parsed.clientContact, 'Jane Smith');
  assert.equal(parsed.agentName, 'John Doe');
  assert.equal(parsed.kbToolsUsed, 'Help panel, Google');
  assert.equal(parsed.triedTestAccount, 'yes');
  assert.ok(['bank-feeds', 'integrations'].includes(parsed.category));
  assert.equal(parsed._fieldsFound, 9);
});

test('classifyCategory returns unknown when no category keywords match', () => {
  const category = classifyCategory('This request is intentionally generic and does not map to any known workflow.');
  assert.equal(category, 'unknown');
});

test('looksLikeEscalation recognizes structured escalation text', () => {
  const looksStructured = looksLikeEscalation(
    'COID: 12345\nCASE: 9999\nEXPECTED OUTCOME: x\nACTUAL OUTCOME: y\nTS STEPS: z'
  );
  assert.equal(looksStructured, true);
});

test('parseEscalationText defaults missing optional fields safely', () => {
  const parsed = parseEscalationText('Customer says payroll sync fails with unknown timeout.');
  assert.equal(typeof parsed.coid, 'string');
  assert.equal(typeof parsed.caseNumber, 'string');
  assert.equal(typeof parsed.attemptingTo, 'string');
  assert.equal(typeof parsed.category, 'string');
  assert.ok(['yes', 'no', 'unknown'].includes(parsed.triedTestAccount));
});

test('parseEscalationText does not let MID spill into the next field when slash is missing', () => {
  const input = [
    'COID/MID: 123456789',
    'CASE: 55555',
    'CLIENT/CONTACT: Doug Mckensie',
    'ACTUAL OUTCOME: Missing T4 summary',
    'TS STEPS: Retried download',
  ].join('\n');

  const parsed = parseEscalationText(input);

  assert.equal(parsed.coid, '123456789');
  assert.equal(parsed.mid, '');
  assert.equal(parsed.clientContact, 'Doug Mckensie');
});

test('parseEscalationText keeps blank canonical fields blank for payroll suspended direct deposit case', () => {
  const input = [
    'COID/MID: 9341455791062508',
    'CASE: 15155571621',
    'CLIENT/CONTACT:',
    'CX IS ATTEMPTING TO: paying her employees via DD',
    'EXPECTED OUTCOME:',
    'ACTUAL OUTCOME: payroll suspended',
    'KB/TOOLS USED: Iboss, cs server',
    'TRIED TEST ACCOUNT: no',
    'TS STEPS:',
    'cs server and iboss are showing that the payroll as 12/26/2025 is suspended',
  ].join('\n');

  const parsed = parseEscalationText(input);

  assert.equal(parsed.coid, '9341455791062508');
  assert.equal(parsed.caseNumber, '15155571621');
  assert.equal(parsed.clientContact, '');
  assert.equal(parsed.attemptingTo, 'paying her employees via DD');
  assert.equal(parsed.expectedOutcome, '');
  assert.equal(parsed.actualOutcome, 'payroll suspended');
  assert.equal(parsed.kbToolsUsed, 'Iboss, cs server');
  assert.equal(parsed.triedTestAccount, 'no');
  assert.equal(
    parsed.tsSteps,
    'cs server and iboss are showing that the payroll as 12/26/2025 is suspended'
  );
  assert.equal(parsed.category, 'payroll');
});

test('looksLikeEscalation returns false for plain short text', () => {
  const looksStructured = looksLikeEscalation('Need help, nothing else here');
  assert.equal(looksStructured, false);
});
