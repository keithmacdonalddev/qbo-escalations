const test = require('node:test');
const assert = require('node:assert/strict');

const { connect, disconnect } = require('./_mongo-helper');
const Investigation = require('../src/models/Investigation');
const {
  matchInvestigations,
  matchFromParseFields,
} = require('../src/services/inv-matcher');

test.before(async () => {
  await connect();
});

test.after(async () => {
  await disconnect();
});

test.beforeEach(async () => {
  await Investigation.deleteMany({});
});

test('matchInvestigations favors the true T4/XML investigation over generic overlaps', async () => {
  await Investigation.insertMany([
    {
      invNumber: 'INV-147832',
      subject: 'System generated new duplicate account in COA. When merging the account gets error.',
      category: 'technical',
      status: 'in-progress',
      affectedCount: 9,
      reportedDate: new Date(),
      symptoms: ['duplicate', 'account', 'merge'],
    },
    {
      invNumber: 'INV-148133',
      subject: 'User with a custom role to access the Budget vs Actuals report error - Could not load this report',
      category: 'permissions',
      status: 'in-progress',
      affectedCount: 8,
      reportedDate: new Date(),
      symptoms: ['custom role', 'report', 'permissions'],
    },
    {
      invNumber: 'INV-148564',
      subject: 'When applying USD payments to an open USD invoice gets error Record all customers and supplier transactions in the currency assigned to them',
      category: 'invoicing',
      status: 'new',
      affectedCount: 10,
      reportedDate: new Date(),
      symptoms: ['invoice', 'payments', 'usd'],
    },
    {
      invNumber: 'INV-149001',
      subject: 'Downloading T4 XML does not include the T4 summary for CRA filing',
      category: 'payroll',
      status: 'in-progress',
      affectedCount: 2,
      reportedDate: new Date(),
      details: 'Customers can download the T4 XML but the T4 summary is missing when preparing CRA submission.',
      symptoms: ['t4', 'xml', 'summary', 'cra'],
    },
  ]);

  const text = [
    'COID/MID: ;9341452197744835',
    'CASE: ;15154531492',
    'CLIENT/CONTACT: ;Doug Mckensie',
    'CX IS ATTEMPTING TO: ; Customer is calling to download the XML for his T4 but for some reason it did not download the T4 summary when he downloaded the XML',
    'EXPECTED OUTCOME: ; wanted to send in his T4 to CRA',
    'ACTUAL OUTCOME: ; missing the T4 summary',
    'KB/TOOLS USED: ; HELP PANEL, KB ARTICLES, GOOGLE , SCREEN SHARE.',
    'TRIED TEST ACCOUNT: ; n/a',
    'TS STEPS: Customer is calling about downloading his T4 to CRA. When he downloaded the T4 XML the T4 summary did not download.',
  ].join('\n');

  const matches = await matchInvestigations(text, { limit: 5 });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].investigation.invNumber, 'INV-149001');
});

test('matchFromParseFields does not hard-filter on unknown category', async () => {
  await Investigation.create({
    invNumber: 'INV-149002',
    subject: 'T4 XML export omits summary sheet for CRA filing',
    category: 'payroll',
    status: 'new',
    affectedCount: 1,
    reportedDate: new Date(),
    details: 'The XML export succeeds, but the T4 summary is absent.',
    symptoms: ['t4', 'xml', 'summary', 'cra'],
  });

  const matches = await matchFromParseFields({
    category: 'unknown',
    attemptingTo: 'Download the XML for a T4 filing',
    expectedOutcome: 'Send the T4 package to CRA',
    actualOutcome: 'The T4 summary is missing from the download',
    tsSteps: 'Retried the download and checked the archive',
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].investigation.invNumber, 'INV-149002');
});
