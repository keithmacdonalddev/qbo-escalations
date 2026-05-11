'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { connect, disconnect } = require('./_mongo-helper');
const Investigation = require('../src/models/Investigation');
const { SHARED_AGENT_TOOL_HANDLERS } = require('../src/services/shared-agent-tools');

test.before(async () => {
  await connect();
});

test.after(async () => {
  await disconnect();
});

test.beforeEach(async () => {
  await Investigation.deleteMany({});
});

test('db.searchInvestigations searches active investigations by category and symptom text', async () => {
  await Investigation.insertMany([
    {
      invNumber: 'INV-151000',
      subject: 'Direct deposit payroll suspended in iBoss',
      category: 'payroll',
      status: 'in-progress',
      details: 'Payroll direct deposit cannot proceed because payroll is suspended in CS Server.',
      symptoms: ['payroll', 'direct deposit', 'suspended', 'iboss'],
    },
    {
      invNumber: 'INV-151001',
      subject: 'Bank feed connection refresh fails',
      category: 'bank-feeds',
      status: 'in-progress',
      details: 'OAuth refresh for bank feeds.',
      symptoms: ['bank feeds'],
    },
  ]);

  const result = await SHARED_AGENT_TOOL_HANDLERS['db.searchInvestigations']({
    query: 'payroll direct deposit suspended',
    category: 'payroll',
    status: 'active',
    limit: 5,
  });

  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.results[0].invNumber, 'INV-151000');
  assert.equal(result.results[0].category, 'payroll');
});
