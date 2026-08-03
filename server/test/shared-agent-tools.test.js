'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { connect, disconnect } = require('./_mongo-helper');
const Escalation = require('../src/models/Escalation');
const Investigation = require('../src/models/Investigation');
const { SHARED_AGENT_TOOL_HANDLERS } = require('../src/services/shared-agent-tools');

test.before(async () => {
  await connect();
});

test.after(async () => {
  await disconnect();
});

test.beforeEach(async () => {
  await Escalation.deleteMany({});
  await Investigation.deleteMany({});
});

test('shared detail tools return explicit safe projections with source evidence', async () => {
  await Investigation.create({
    invNumber: 'INV-SAFE-1',
    subject: 'Safe projection fixture',
    category: 'technical',
    status: 'in-progress',
    agentName: 'Internal Person',
    team: 'Internal Team',
    details: 'Visible operational detail',
  });
  const detail = await SHARED_AGENT_TOOL_HANDLERS['db.getInvestigation']({ invNumber: 'INV-SAFE-1' });
  assert.equal(detail.ok, true);
  assert.equal(detail.investigation.details, 'Visible operational detail');
  assert.equal(detail.investigation.agentName, undefined);
  assert.equal(detail.investigation.team, undefined);
  assert.equal(detail.investigation.source.type, 'investigation');
  assert.match(detail.investigation.source.hash, /^[a-f0-9]{64}$/);

  await Escalation.create({
    caseNumber: 'CASE-SAFE-1',
    clientContact: 'private.person@example.com',
    attemptingTo: 'Reconcile an account',
    category: 'reconciliation',
  });
  const search = await SHARED_AGENT_TOOL_HANDLERS['db.searchEscalations']({ query: 'Reconcile' });
  assert.equal(search.ok, true);
  assert.equal(search.results[0].clientContact, undefined);
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
