'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const AgentIdentity = require('../src/models/AgentIdentity');
const Conversation = require('../src/models/Conversation');
const Escalation = require('../src/models/Escalation');
const EscalationAttentionItem = require('../src/models/EscalationAttentionItem');
const KnowledgeCandidate = require('../src/models/KnowledgeCandidate');
const {
  clearProviderStubs,
  registerProviderStub,
} = require('../src/lib/harness-provider-gate');

process.env.NODE_ENV = 'test';

function makeEscalation(fields = {}) {
  return Escalation.create({
    category: 'payroll',
    status: 'resolved',
    caseNumber: `CASE-KB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    attemptingTo: 'Finish a QBO payroll workflow',
    actualOutcome: 'Payroll archive employer summary appears missing after filing',
    resolution: 'Open Archived Forms, choose the tax year, and confirm the employer summary.',
    resolutionNotes: 'Confirmed from a finalized support case.',
    resolvedAt: new Date('2026-05-01T12:00:00.000Z'),
    ...fields,
  });
}

async function makeCandidate(escalation, fields = {}) {
  return KnowledgeCandidate.create({
    escalationId: escalation._id,
    conversationId: null,
    reviewStatus: 'draft',
    publishTarget: 'case-history-only',
    reusableOutcome: 'case-history-only',
    title: 'Payroll archive summary draft',
    category: escalation.category || 'unknown',
    summary: 'Candidate summary',
    symptom: escalation.actualOutcome || '',
    rootCause: '',
    exactFix: '',
    escalationPath: '',
    keySignals: [],
    confidence: 0.6,
    sourceSnapshot: {
      status: escalation.status,
      category: escalation.category,
      coid: escalation.coid || '',
      caseNumber: escalation.caseNumber || '',
      attemptingTo: escalation.attemptingTo || '',
      actualOutcome: escalation.actualOutcome || '',
      tsSteps: escalation.tsSteps || '',
      resolution: escalation.resolution || '',
      resolutionNotes: escalation.resolutionNotes || '',
      resolvedAt: escalation.resolvedAt || null,
    },
    generatedAt: new Date('2026-05-02T12:00:00.000Z'),
    ...fields,
  });
}

test.before(async () => {
  await connect();
});

test.after(async () => {
  await disconnect();
});

test.beforeEach(async () => {
  clearProviderStubs();
  await AgentIdentity.deleteMany({});
  await Conversation.deleteMany({});
  await Escalation.deleteMany({});
  await EscalationAttentionItem.deleteMany({});
  await KnowledgeCandidate.deleteMany({});
});

test('knowledgebase agent status exposes monitor boundaries', async () => {
  const app = createApp();
  const res = await request(app).get('/api/knowledge/agent/status');

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.status.agentId, 'knowledgebase-agent');
  assert.equal(res.body.status.dbReady, true);
  assert.equal(res.body.status.capabilities.attentionItems, true);
  assert.equal(res.body.status.capabilities.qboCanadaDraftGeneration, true);
  assert.equal(res.body.status.capabilities.draftHarness, true);
  assert.equal(res.body.status.capabilities.approvesKnowledge, false);
  assert.equal(res.body.status.capabilities.publishesKnowledge, false);
  assert.equal(res.body.status.profileRoute, '/api/agent-identities/knowledgebase-agent');
});

test('knowledgebase agent harness drafts QBO Canada KB fields from a finalized escalation', async () => {
  const app = createApp();
  const agent = request(app);
  const escalation = await makeEscalation({
    caseNumber: 'CASE-KB-HARNESS',
    category: 'bank-feeds',
    attemptingTo: 'Reconnect a Chase bank feed in QBO Canada',
    actualOutcome: 'Duplicate downloaded transactions appeared after reconnecting Chase',
    triedTestAccount: 'yes',
    tsSteps: 'Checked Banking tab. Compared duplicate rows by date, amount, and description. INV-123456 was mentioned by the INV agent but not confirmed relevant.',
    resolution: 'Excluded only the duplicate downloaded transactions and verified the register balance did not change.',
    resolutionNotes: 'Customer confirmed the bank feed review queue was clean after exclusion.',
  });

  const res = await agent
    .post('/api/knowledge/agent/harness/run')
    .send({ escalationId: String(escalation._id) });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.harness.agentId, 'knowledgebase-agent');
  assert.equal(res.body.harness.status, 'pass');
  assert.equal(res.body.harness.fixture.caseNumber, 'CASE-KB-HARNESS');
  assert.match(res.body.harness.draft.customerGoal, /Reconnect a Chase bank feed/);
  assert.match(res.body.harness.draft.reportedProblem, /Duplicate downloaded transactions/);
  assert.match(res.body.harness.draft.evidenceFromCase, /CASE-KB-HARNESS/);
  assert.match(res.body.harness.draft.troubleshootingTried, /Compared duplicate rows/);
  assert.match(res.body.harness.draft.finalOutcome, /Excluded only the duplicate/);
  assert.match(res.body.harness.draft.invEscalationStatus, /INV-123456/);

  const requiredChecks = res.body.harness.checks.filter((check) => !check.optional);
  assert.ok(requiredChecks.length >= 7);
  assert.equal(requiredChecks.every((check) => check.passed), true);
});

test('finalizing an escalation automatically creates a KB agent draft without chat-page involvement', async () => {
  const app = createApp();
  const agent = request(app);
  const escalation = await makeEscalation({
    status: 'in-progress',
    resolvedAt: null,
    caseNumber: 'CASE-KB-AUTO-DRAFT',
    category: 'tax',
    attemptingTo: 'File a GST/HST return in QBO Canada',
    actualOutcome: 'The return page showed an unexpected balance mismatch',
    tsSteps: 'Checked tax settings and compared the return to the sales tax liability report.',
    resolution: '',
    resolutionNotes: '',
  });

  const res = await agent
    .patch(`/api/escalations/${escalation._id}`)
    .send({
      status: 'resolved',
      resolution: 'Updated the filing period selection and confirmed the GST/HST return matched the liability report.',
      resolutionNotes: 'Customer confirmed the filing screen balance matched after selecting the correct period.',
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.knowledgeDraft.generated, true);

  const draft = await KnowledgeCandidate.findOne({ escalationId: escalation._id }).lean();
  assert.ok(draft);
  assert.equal(draft.reviewStatus, 'draft');
  assert.equal(draft.category, 'tax');
  assert.match(draft.customerGoal, /GST\/HST return/);
  assert.match(draft.reportedProblem, /balance mismatch/);
  assert.match(draft.troubleshootingTried, /sales tax liability report/);
  assert.match(draft.finalOutcome, /GST\/HST return matched/);
  assert.match(draft.exactFix, /GST\/HST return matched/);
});

test('knowledgebase agent record context carries escalation workflow, chat, images, and related saved KB', async () => {
  const app = createApp();
  const agent = request(app);
  const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const conversation = await Conversation.create({
    title: 'T4 XML missing T4 summary chat',
    messages: [
      {
        role: 'user',
        content: 'Uploaded the raw payroll screenshot showing the T4 Summary is missing after downloading XML.',
        images: [imageData],
        imageMeta: [{ fileName: 't4-summary-missing.png', mimeType: 'image/png' }],
        provider: 'claude',
        modelUsed: 'claude-test',
      },
      {
        role: 'assistant',
        content: 'QBO Assistant checked archived forms and noted the T4 Summary did not regenerate after deleting the archived filing.',
        provider: 'claude',
        modelUsed: 'claude-test',
      },
    ],
    caseIntake: {
      status: 'complete',
      canonicalTemplate: 'CS is attempting to download the T4 XML and T4 Summary for CRA filing.',
      parseFields: {
        attemptingTo: 'Download the T4 XML and T4 Summary',
        actualOutcome: 'The XML downloaded but the T4 Summary did not download.',
      },
      parseMeta: { parser: 'template-parser', confidence: 0.91 },
      knownIssueSearchResult: {
        query: 'T4 Summary missing XML',
        matches: [{ id: 'INV-CA-12345', title: 'T4 Summary generation delay' }],
      },
      triageCard: {
        category: 'payroll',
        outcome: 'Needs resolved-case KB review',
        nextStep: 'Verify whether the final outcome was product limitation or new escalation.',
      },
      runs: [
        {
          id: 'inv-run-1',
          agentId: 'inv-agent',
          agentName: 'INV Agent',
          phase: 'investigation',
          status: 'complete',
          provider: 'claude',
          model: 'claude-test',
          summary: 'Searched INV-CA-12345 and found it was mentioned but not proven relevant.',
          events: [{ type: 'inv.search', summary: 'INV-CA-12345 checked' }],
        },
        {
          id: 'triage-run-1',
          agentId: 'triage-agent',
          agentName: 'Triage Agent',
          phase: 'triage',
          status: 'complete',
          summary: 'Categorized the escalation as payroll.',
          events: [{ type: 'triage.output', summary: 'Payroll / T4 summary issue' }],
        },
      ],
      followUps: [{ actor: 'user', content: 'Customer later confirmed the summary was still missing.' }],
    },
  });

  const escalation = await makeEscalation({
    caseNumber: 'CASE-KB-CONTEXT',
    category: 'payroll',
    conversationId: conversation._id,
    attemptingTo: 'Download the T4 XML and T4 Summary for CRA filing',
    actualOutcome: 'The XML downloaded but the T4 Summary did not download.',
    tsSteps: 'Deleted archived filing and tried to repopulate the summary.',
    resolution: 'The case was escalated further because the final outcome was not proven.',
    resolutionNotes: 'INV-CA-12345 was checked but not confirmed as the cause.',
  });
  conversation.escalationId = escalation._id;
  await conversation.save();

  const candidate = await makeCandidate(escalation, {
    conversationId: conversation._id,
    title: 'T4 Summary missing after XML download',
    reportedProblem: 'The XML downloaded but the T4 Summary did not download.',
    finalOutcome: 'Escalated further because the final outcome was not proven.',
    keySignals: ['T4 Summary missing', 'XML downloaded'],
  });

  const relatedEscalation = await makeEscalation({
    caseNumber: 'CASE-KB-RELATED-T4',
    category: 'payroll',
    attemptingTo: 'Download T4 Summary after XML filing',
    actualOutcome: 'T4 Summary missing after XML download',
    resolution: 'Use archived forms once QBO generates the T4 Summary.',
  });
  await makeCandidate(relatedEscalation, {
    reviewStatus: 'approved',
    title: 'T4 Summary missing after XML download related record',
    summary: 'Related saved KB record for T4 Summary missing after XML download.',
    finalOutcome: 'Use archived forms once QBO generates the T4 Summary.',
    keySignals: ['T4 Summary missing', 'XML downloaded'],
  });

  const res = await agent.get(`/api/knowledge/records/${encodeURIComponent(`candidate:${candidate._id}`)}/agent-context`);

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.context.escalation.caseNumber, 'CASE-KB-CONTEXT');
  assert.equal(res.body.context.conversation.messageCount, 2);
  assert.equal(res.body.context.sourceCounts.conversationImages, 1);
  assert.equal(res.body.context.workflow.caseIntake.canonicalTemplate, 'CS is attempting to download the T4 XML and T4 Summary for CRA filing.');
  assert.equal(res.body.context.workflow.caseIntake.knownIssueSearchResult.matches[0].id, 'INV-CA-12345');
  assert.equal(res.body.context.workflow.caseIntake.triageCard.category, 'payroll');
  assert.deepEqual(res.body.context.workflowAgents, ['inv-agent', 'triage-agent']);
  assert.equal(res.body.context.attachments.conversationImages[0].imageId, 'msg-0-img-0');
  assert.ok(res.body.context.relatedKnowledge.some((item) => item.title.includes('related record')));

  const saved = await KnowledgeCandidate.findById(candidate._id).lean();
  assert.equal(saved.kbAgent.promptId, 'knowledgebase-agent');
  assert.match(saved.kbAgent.sourceSummary, /2 chat messages/);
  assert.deepEqual(saved.kbAgent.workflowAgents, ['inv-agent', 'triage-agent']);
});

test('knowledgebase agent draft chat uses selected record context and persists thread', async () => {
  const previousStubbed = process.env.HARNESS_PROVIDERS_STUBBED;
  process.env.HARNESS_PROVIDERS_STUBBED = '1';
  registerProviderStub('claude', 'chat', ({ messages, images, onDone }) => {
    const contextMessage = messages[0]?.content || '';
    assert.match(contextMessage, /CASE-KB-CHAT/);
    assert.match(contextMessage, /QBO Assistant saw duplicate bank feed rows/);
    assert.equal(images.length, 0);
    onDone('Use the saved evidence to keep this as case history unless the final outcome is proven.', {
      model: 'claude-test',
      usageAvailable: true,
    });
    return () => {};
  });

  try {
    const app = createApp();
    const agent = request(app);
    const conversation = await Conversation.create({
      title: 'Bank feed duplicate chat',
      messages: [
        {
          role: 'assistant',
          content: 'QBO Assistant saw duplicate bank feed rows after reconnecting Chase.',
          provider: 'claude',
          modelUsed: 'claude-test',
        },
      ],
      caseIntake: {
        status: 'complete',
        runs: [{ agentId: 'triage-agent', agentName: 'Triage Agent', status: 'complete' }],
      },
    });
    const escalation = await makeEscalation({
      caseNumber: 'CASE-KB-CHAT',
      category: 'bank-feeds',
      conversationId: conversation._id,
      attemptingTo: 'Reconnect a Chase bank feed',
      actualOutcome: 'Duplicate bank feed rows appeared after reconnect.',
      resolution: 'Excluded duplicate imported rows.',
    });
    const candidate = await makeCandidate(escalation, {
      conversationId: conversation._id,
      title: 'Chase bank feed duplicates after reconnect',
      reportedProblem: 'Duplicate bank feed rows appeared after reconnect.',
    });

    const res = await agent
      .post(`/api/knowledge/records/${encodeURIComponent(`candidate:${candidate._id}`)}/agent-chat`)
      .send({ message: 'Is the final outcome proven?' });

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.match(res.body.answer, /case history/);
    assert.equal(res.body.messages.length, 2);
    assert.equal(res.body.messages[0].role, 'user');
    assert.equal(res.body.messages[1].role, 'assistant');

    const saved = await KnowledgeCandidate.findById(candidate._id).lean();
    assert.equal(saved.kbAgentMessages.length, 2);
    assert.equal(saved.kbAgent.promptId, 'knowledgebase-agent');
    assert.equal(saved.kbAgent.sourceCounts.conversationMessages, 1);
  } finally {
    clearProviderStubs();
    if (previousStubbed === undefined) {
      delete process.env.HARNESS_PROVIDERS_STUBBED;
    } else {
      process.env.HARNESS_PROVIDERS_STUBBED = previousStubbed;
    }
  }
});

test('knowledgebase agent scan opens review attention for finalized cases without drafts', async () => {
  const app = createApp();
  const agent = request(app);
  const escalation = await makeEscalation({
    caseNumber: 'CASE-KB-MISSING-DRAFT',
    actualOutcome: 'Payroll archive employer summary is missing after forms were filed',
  });

  const res = await agent
    .post('/api/knowledge/agent/scan')
    .send({ limit: 20 });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.scan.agentId, 'knowledgebase-agent');
  assert.equal(res.body.scan.dbReady, true);
  assert.equal(res.body.scan.dryRun, false);
  assert.equal(res.body.scan.counts.missingDraft, 1);
  assert.equal(res.body.scan.counts.proposals, 1);
  assert.equal(res.body.scan.attention.opened, 1);

  const proposal = res.body.scan.proposals[0];
  assert.equal(proposal.type, 'missing-knowledge-draft');
  assert.equal(proposal.suggestedDraft.category, 'payroll');
  assert.match(proposal.suggestedDraft.exactFix, /Archived Forms/);
  assert.equal(proposal.sourceEvidence[0].id, String(escalation._id));

  const item = await EscalationAttentionItem.findOne({
    fingerprint: `knowledge-review:${escalation._id}`,
  }).lean();
  assert.ok(item);
  assert.equal(item.kind, 'knowledge-review');
  assert.equal(item.status, 'open');
  assert.equal(item.sourceType, 'agent');
  assert.equal(String(item.sourceEscalationId), String(escalation._id));
  assert.equal(item.metadata.agentId, 'knowledgebase-agent');
  assert.equal(item.metadata.proposalType, 'missing-knowledge-draft');
  assert.equal(item.metadata.suggestedDraft.category, 'payroll');

  const identity = await AgentIdentity.findOne({ agentId: 'knowledgebase-agent' }).lean();
  assert.ok(identity);
  assert.equal(identity.activity.entries[0].type, 'knowledgebase-scan');
  assert.equal(identity.activity.entries[0].status, 'review-needed');
});

test('knowledgebase agent dry run reports quality, duplicate, and stale proposals without writes', async () => {
  const app = createApp();
  const agent = request(app);

  const qualityEscalation = await makeEscalation({ caseNumber: 'CASE-KB-QUALITY' });
  await makeCandidate(qualityEscalation, {
    title: 'Low confidence payroll draft',
    rootCause: '',
    exactFix: '',
    confidence: 0.4,
  });

  const duplicateA = await makeEscalation({ caseNumber: 'CASE-KB-DUP-A' });
  const duplicateB = await makeEscalation({ caseNumber: 'CASE-KB-DUP-B' });
  await makeCandidate(duplicateA, {
    reviewStatus: 'approved',
    title: 'Payroll archive employer summary duplicate A',
    symptom: 'Payroll archive employer summary missing after filing',
    rootCause: 'The user is checking the active forms area instead of archived forms.',
    exactFix: 'Open Archived Forms and select the filed year.',
    confidence: 0.8,
  });
  await makeCandidate(duplicateB, {
    reviewStatus: 'approved',
    title: 'Payroll archive employer summary duplicate B',
    symptom: 'Payroll archive employer summary missing after filing',
    rootCause: 'The user is checking the active forms area instead of archived forms.',
    exactFix: 'Open Archived Forms and select the filed year.',
    confidence: 0.82,
  });

  const staleEscalation = await makeEscalation({
    caseNumber: 'CASE-KB-STALE',
    actualOutcome: 'Payroll liability adjustment old trusted guidance',
  });
  await makeCandidate(staleEscalation, {
    reviewStatus: 'published',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
    title: 'Old payroll liability adjustment guidance',
    symptom: 'Payroll liability adjustment old trusted guidance',
    rootCause: 'Historical QBO workflow behavior.',
    exactFix: 'Use the older liability adjustment workflow.',
    confidence: 0.9,
    publishedAt: new Date('2025-01-01T12:00:00.000Z'),
  });

  const res = await agent
    .post('/api/knowledge/agent/scan')
    .send({ limit: 50, dryRun: true, staleTrustedDays: 30 });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.scan.dryRun, true);
  assert.equal(res.body.scan.attention.opened, 0);
  assert.equal(res.body.scan.activity.recorded, false);

  const types = new Set(res.body.scan.proposals.map((proposal) => proposal.type));
  assert.ok(types.has('candidate-quality-review'));
  assert.ok(types.has('duplicate-candidate-review'));
  assert.ok(types.has('stale-trusted-review'));

  const quality = res.body.scan.proposals.find((proposal) => proposal.type === 'candidate-quality-review');
  assert.ok(quality.qualityIssues.includes('missing_confirmed_cause'));
  assert.ok(quality.qualityIssues.includes('missing_fix_or_escalation_path'));
  assert.ok(quality.qualityIssues.includes('low_confidence'));

  const duplicate = res.body.scan.proposals.find((proposal) => proposal.type === 'duplicate-candidate-review');
  assert.equal(duplicate.candidateIds.length, 2);

  const stale = res.body.scan.proposals.find((proposal) => proposal.type === 'stale-trusted-review');
  assert.equal(stale.staleTrustedDays, 30);
  assert.ok(stale.staleDays >= 30);

  assert.equal(await EscalationAttentionItem.countDocuments({}), 0);
  assert.equal(await AgentIdentity.countDocuments({ agentId: 'knowledgebase-agent' }), 0);
});
