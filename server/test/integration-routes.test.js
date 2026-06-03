const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const Conversation = require('../src/models/Conversation');
const Escalation = require('../src/models/Escalation');
const EscalationAttentionItem = require('../src/models/EscalationAttentionItem');
const KnowledgeCandidate = require('../src/models/KnowledgeCandidate');
const Template = require('../src/models/Template');
const ParallelCandidateTurn = require('../src/models/ParallelCandidateTurn');
const claude = require('../src/services/claude');
const codex = require('../src/services/codex');

const SAMPLE_PNG_DATA_URL = 'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3Z8UkAAAAASUVORK5CYII=';
function parseSseEvents(payload) {
  const blocks = String(payload || '').split('\n\n');
  const events = [];
  for (const block of blocks) {
    if (!block || block.startsWith(':')) continue;
    const lines = block.split('\n');
    let event = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        data += (data ? '\n' : '') + line.slice('data:'.length).trim();
      }
    }
    if (event) events.push({ event, data });
  }
  return events;
}

test("integration-routes suite", async (t) => {
  let app;
  let agent;
  let originalClaudeChat;
  let originalCodexChat;
  let originalClaudeParse;
  let originalCodexParse;

t.before(async () => {
  process.env.NODE_ENV = 'test';
  delete process.env.ADMIN_API_KEY;
  delete process.env.EDITOR_API_KEY;
  delete process.env.VIEWER_API_KEY;

  originalClaudeChat = claude.chat;
  originalCodexChat = codex.chat;
  originalClaudeParse = claude.parseEscalation;
  originalCodexParse = codex.parseEscalation;

  const fakeStream = ({ onChunk, onDone }) => {
    if (onChunk) onChunk('mock assistant response');
    if (onDone) onDone('mock assistant response', null);
    return () => {};
  };
  claude.chat = fakeStream;
  codex.chat = fakeStream;
  claude.parseEscalation = async () => ({
    fields: {
      category: 'technical',
      attemptingTo: 'Sign in to QBO',
      actualOutcome: 'Login error shown',
      tsSteps: 'Cleared cache',
      triedTestAccount: 'unknown',
      coid: '12345',
    },
    usage: null,
  });
  codex.parseEscalation = async () => ({
    fields: {
      category: 'technical',
      attemptingTo: 'Sign in to QBO',
      actualOutcome: 'Login error shown',
      tsSteps: 'Cleared cache',
      triedTestAccount: 'unknown',
      coid: '12345',
    },
    usage: null,
  });

  await connect();

  app = createApp();
  agent = request(app);
});

t.after(async () => {
  claude.chat = originalClaudeChat;
  codex.chat = originalCodexChat;
  claude.parseEscalation = originalClaudeParse;
  codex.parseEscalation = originalCodexParse;

  await disconnect();
});

t.beforeEach(async () => {
  await Promise.all([
    Conversation.deleteMany({}),
    Escalation.deleteMany({}),
    EscalationAttentionItem.deleteMany({}),
    KnowledgeCandidate.deleteMany({}),
    Template.deleteMany({}),
    ParallelCandidateTurn.deleteMany({}),
  ]);
});

await t.test('template create/update/delete works without auth in local mode', async () => {
  const created = await agent
    .post('/api/templates')
    .send({ category: 'general', title: 'T1', body: 'Body' });
  assert.equal(created.status, 201);
  const templateId = created.body.template._id;

  const updated = await agent
    .patch(`/api/templates/${templateId}`)
    .send({ title: 'T2' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.template.title, 'T2');

  const deleted = await agent.delete(`/api/templates/${templateId}`);
  assert.equal(deleted.status, 200);
});

await t.test('from-conversation links both records and deleting conversation unlinks escalation', async () => {
  const conversation = await Conversation.create({
    title: 'Link test',
    messages: [{ role: 'user', content: 'Need help', timestamp: new Date() }],
    provider: 'claude',
  });

  const created = await agent
    .post('/api/escalations/from-conversation')
    .send({
      conversationId: conversation._id.toString(),
      category: 'general',
      attemptingTo: 'Do something in QBO',
    });
  assert.equal(created.status, 201);

  const escalationId = created.body.escalation._id;
  const conversationAfterLink = await Conversation.findById(conversation._id).lean();
  const escalationAfterLink = await Escalation.findById(escalationId).lean();

  assert.equal(String(conversationAfterLink.escalationId), escalationId);
  assert.equal(String(escalationAfterLink.conversationId), conversation._id.toString());

  const deletedConversation = await agent.delete(`/api/conversations/${conversation._id}`);
  assert.equal(deletedConversation.status, 200);

  const escalationAfterDelete = await Escalation.findById(escalationId).lean();
  assert.equal(escalationAfterDelete.conversationId, null);
});

await t.test('from-conversation is idempotent for the same conversation', async () => {
  const conversation = await Conversation.create({
    title: 'Idempotent link test',
    messages: [{ role: 'user', content: 'Need help', timestamp: new Date() }],
    provider: 'claude',
  });

  const first = await agent
    .post('/api/escalations/from-conversation')
    .send({
      conversationId: conversation._id.toString(),
      category: 'general',
      attemptingTo: 'Create an invoice',
    });
  assert.equal(first.status, 201);

  const second = await agent
    .post('/api/escalations/from-conversation')
    .send({
      conversationId: conversation._id.toString(),
      category: 'technical',
      attemptingTo: 'Retry should not create a second record',
    });
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicateSafety.reusedExisting, true);
  assert.equal(second.body.escalation._id, first.body.escalation._id);

  assert.equal(await Escalation.countDocuments({ conversationId: conversation._id }), 1);
  const conversationAfter = await Conversation.findById(conversation._id).lean();
  assert.equal(String(conversationAfter.escalationId), first.body.escalation._id);
});

await t.test('from-conversation warns but allows likely duplicates from different conversations', async () => {
  const [firstConversation, secondConversation] = await Conversation.create([
    {
      title: 'Original customer case',
      messages: [{ role: 'user', content: 'Payroll export fails', timestamp: new Date() }],
      provider: 'claude',
    },
    {
      title: 'Retry through a new conversation',
      messages: [{ role: 'user', content: 'Same payroll export issue', timestamp: new Date() }],
      provider: 'claude',
    },
  ]);

  const first = await agent
    .post('/api/escalations/from-conversation')
    .send({
      conversationId: firstConversation._id.toString(),
      category: 'payroll',
      coid: '987654',
      caseNumber: 'CS-2026-000777',
      attemptingTo: 'Export T4 XML',
      actualOutcome: 'T4 XML export fails before download',
    });
  assert.equal(first.status, 201);

  const second = await agent
    .post('/api/escalations/from-conversation')
    .send({
      conversationId: secondConversation._id.toString(),
      category: 'payroll',
      coid: '987654',
      caseNumber: 'CS-2026-000777',
      attemptingTo: 'Export T4 XML',
      actualOutcome: 'T4 XML export fails before download',
    });
  assert.equal(second.status, 201);
  assert.notEqual(second.body.escalation._id, first.body.escalation._id);
  assert.equal(second.body.duplicateSafety.reusedExisting, false);
  assert.equal(second.body.duplicateSafety.warnings.length, 1);
  assert.equal(second.body.duplicateSafety.warnings[0].code, 'POSSIBLE_DUPLICATE_ESCALATION');
  assert.equal(second.body.duplicateSafety.warnings[0].candidates[0].escalationId, first.body.escalation._id);
  assert.ok(second.body.duplicateSafety.warnings[0].candidates[0].signals.includes('same_case_number'));
  assert.equal(second.body.duplicateSafety.attentionItems.length, 1);

  assert.equal(await Escalation.countDocuments({ caseNumber: 'CS-2026-000777' }), 2);

  const listed = await agent.get('/api/escalations/attention-items?status=open');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.total, 1);
  assert.equal(listed.body.counts.open, 1);
  assert.equal(listed.body.items[0].kind, 'possible-duplicate');
  assert.equal(listed.body.items[0].sourceEscalationId._id, second.body.escalation._id);
  assert.equal(listed.body.items[0].candidates[0].escalationId._id, first.body.escalation._id);

  const markedSplit = await agent
    .patch(`/api/escalations/attention-items/${listed.body.items[0]._id}`)
    .send({ status: 'split', resolutionNote: 'Separate customer impact.' });
  assert.equal(markedSplit.status, 200);
  assert.equal(markedSplit.body.item.status, 'split');
  assert.ok(markedSplit.body.item.resolvedAt);

  const afterClose = await agent.get('/api/escalations/attention-items?status=open');
  assert.equal(afterClose.status, 200);
  assert.equal(afterClose.body.total, 0);
  assert.equal(afterClose.body.counts.split, 1);
});

await t.test('status update opens missing-resolution attention item and closes it when notes are added', async () => {
  const created = await agent
    .post('/api/escalations')
    .send({
      category: 'technical',
      coid: '445566',
      caseNumber: 'CS-2026-RES-001',
      attemptingTo: 'Restore bank feed sync',
      actualOutcome: 'Sync fails without a clear fix',
    });
  assert.equal(created.status, 201);
  const escalationId = created.body.escalation._id;

  const resolved = await agent
    .patch(`/api/escalations/${escalationId}`)
    .send({ status: 'resolved' });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.resolutionDiscipline.action, 'opened');
  assert.equal(resolved.body.resolutionDiscipline.item.kind, 'missing-resolution');

  let item = await EscalationAttentionItem.findOne({
    sourceEscalationId: escalationId,
    kind: 'missing-resolution',
  }).lean();
  assert.ok(item);
  assert.equal(item.status, 'open');
  assert.equal(item.title, 'Missing resolution notes');
  assert.ok(item.signals.includes('missing_resolution_notes'));

  const listed = await agent.get('/api/escalations/attention-items?status=open');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.total, 1);
  assert.equal(listed.body.items[0].kind, 'missing-resolution');
  assert.equal(listed.body.items[0].sourceEscalationId._id, escalationId);

  const updated = await agent
    .patch(`/api/escalations/${escalationId}`)
    .send({ resolutionNotes: 'Customer confirmed bank feed sync recovered after reconnecting the account.' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.resolutionDiscipline.action, 'closed');

  item = await EscalationAttentionItem.findOne({
    sourceEscalationId: escalationId,
    kind: 'missing-resolution',
  }).lean();
  assert.equal(item.status, 'resolved');
  assert.ok(item.resolvedAt);

  const afterClose = await agent.get('/api/escalations/attention-items?status=open');
  assert.equal(afterClose.status, 200);
  assert.equal(afterClose.body.total, 0);
  assert.equal(afterClose.body.counts.resolved, 1);
});

await t.test('transition to resolved with a reason does not create missing-resolution attention item', async () => {
  const created = await agent
    .post('/api/escalations')
    .send({
      category: 'payroll',
      caseNumber: 'CS-2026-RES-002',
      attemptingTo: 'Submit payroll',
      actualOutcome: 'Payroll submit was blocked',
    });
  assert.equal(created.status, 201);

  const transitioned = await agent
    .post(`/api/escalations/${created.body.escalation._id}/transition`)
    .send({ status: 'resolved', resolution: 'Payroll submitted after company tax settings were refreshed.' });
  assert.equal(transitioned.status, 200);
  assert.equal(transitioned.body.resolutionDiscipline.action, 'none');

  const count = await EscalationAttentionItem.countDocuments({
    sourceEscalationId: created.body.escalation._id,
    kind: 'missing-resolution',
  });
  assert.equal(count, 0);
});

await t.test('transition to escalated-further without a reason creates missing-resolution attention item', async () => {
  const created = await agent
    .post('/api/escalations')
    .send({
      category: 'billing',
      coid: '778899',
      attemptingTo: 'Correct subscription billing',
      actualOutcome: 'Billing correction needs specialist review',
    });
  assert.equal(created.status, 201);

  const transitioned = await agent
    .post(`/api/escalations/${created.body.escalation._id}/transition`)
    .send({ status: 'escalated-further' });
  assert.equal(transitioned.status, 200);
  assert.equal(transitioned.body.resolutionDiscipline.action, 'opened');

  const item = await EscalationAttentionItem.findOne({
    sourceEscalationId: created.body.escalation._id,
    kind: 'missing-resolution',
  }).lean();
  assert.ok(item);
  assert.equal(item.status, 'open');
  assert.equal(item.title, 'Missing escalation reason');
  assert.ok(item.signals.includes('missing_escalation_reason'));
});

await t.test('knowledge draft opens review attention item and closes after review', async () => {
  const created = await agent
    .post('/api/escalations')
    .send({
      category: 'bank-feeds',
      caseNumber: 'CS-2026-KNOW-001',
      attemptingTo: 'Reconnect a bank feed',
      actualOutcome: 'Transactions did not download',
    });
  assert.equal(created.status, 201);
  const escalationId = created.body.escalation._id;

  const resolved = await agent
    .patch(`/api/escalations/${escalationId}`)
    .send({
      status: 'resolved',
      resolution: 'Reconnected the bank feed and confirmed new transactions downloaded.',
    });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.resolutionDiscipline.action, 'none');

  const generated = await agent
    .post(`/api/escalations/${escalationId}/knowledge/generate`)
    .send({});
  assert.equal(generated.status, 200);
  assert.equal(generated.body.knowledge.reviewStatus, 'draft');
  assert.equal(generated.body.knowledgeReview.action, 'opened');

  let item = await EscalationAttentionItem.findOne({
    sourceEscalationId: escalationId,
    kind: 'knowledge-review',
  }).lean();
  assert.ok(item);
  assert.equal(item.status, 'open');
  assert.equal(item.title, 'Knowledge draft needs review');
  assert.equal(item.sourceLabel, 'case CS-2026-KNOW-001');
  assert.ok(item.signals.includes('knowledge_draft_review'));
  assert.equal(item.metadata.reviewStatus, 'draft');

  const listed = await agent.get('/api/escalations/attention-items?status=open');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.total, 1);
  assert.equal(listed.body.items[0].kind, 'knowledge-review');
  assert.equal(listed.body.items[0].sourceEscalationId._id, escalationId);

  const approved = await agent
    .patch(`/api/escalations/${escalationId}/knowledge`)
    .send({
      reviewStatus: 'approved',
      reviewNotes: 'Reviewed and safe to reuse.',
    });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.knowledgeReview.action, 'closed');

  item = await EscalationAttentionItem.findOne({
    sourceEscalationId: escalationId,
    kind: 'knowledge-review',
  }).lean();
  assert.equal(item.status, 'resolved');

  const rejected = await agent
    .patch(`/api/escalations/${escalationId}/knowledge`)
    .send({
      reviewStatus: 'rejected',
      reviewNotes: '',
    });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.knowledgeReview.action, 'opened');

  item = await EscalationAttentionItem.findOne({
    sourceEscalationId: escalationId,
    kind: 'knowledge-review',
  }).lean();
  assert.equal(item.status, 'open');
  assert.equal(item.title, 'Rejected knowledge needs notes');
  assert.ok(item.signals.includes('knowledge_rejected_without_notes'));

  const rejectedWithNotes = await agent
    .patch(`/api/escalations/${escalationId}/knowledge`)
    .send({
      reviewStatus: 'rejected',
      reviewNotes: 'Too customer-specific to reuse.',
    });
  assert.equal(rejectedWithNotes.status, 200);
  assert.equal(rejectedWithNotes.body.knowledgeReview.action, 'closed');

  item = await EscalationAttentionItem.findOne({
    sourceEscalationId: escalationId,
    kind: 'knowledge-review',
  }).lean();
  assert.equal(item.status, 'resolved');
});

await t.test('attention refresh opens and closes stale open case items', async () => {
  const created = await agent
    .post('/api/escalations')
    .send({
      category: 'technical',
      caseNumber: 'CS-2026-STALE-001',
      attemptingTo: 'Fix recurring sync error',
      actualOutcome: 'Case was left open',
    });
  assert.equal(created.status, 201);
  const escalationId = created.body.escalation._id;
  const staleDate = new Date(Date.now() - 20 * 86_400_000);
  await Escalation.findByIdAndUpdate(
    escalationId,
    { updatedAt: staleDate, createdAt: staleDate },
    { timestamps: false }
  );

  let listed = await agent.get('/api/escalations/attention-items?status=open&refresh=1');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.refresh.stale.scanned, 1);
  assert.equal(listed.body.total, 1);
  assert.equal(listed.body.items[0].kind, 'stale-open');
  assert.equal(listed.body.items[0].sourceEscalationId._id, escalationId);
  assert.ok(listed.body.items[0].signals.includes('stale_case'));

  let item = await EscalationAttentionItem.findOne({
    sourceEscalationId: escalationId,
    kind: 'stale-open',
  }).lean();
  assert.ok(item);
  assert.equal(item.status, 'open');
  assert.equal(item.title, 'Open case is stale');

  await Escalation.findByIdAndUpdate(
    escalationId,
    { status: 'resolved', resolution: 'Closed after customer confirmed the sync recovered.' },
    { timestamps: false }
  );

  listed = await agent.get('/api/escalations/attention-items?status=open&refresh=1');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.refresh.stale.closed, 1);
  assert.equal(listed.body.total, 0);

  item = await EscalationAttentionItem.findOne({
    sourceEscalationId: escalationId,
    kind: 'stale-open',
  }).lean();
  assert.equal(item.status, 'resolved');
});

await t.test('attention refresh opens and closes parser triage review items', async () => {
  const escalation = await Escalation.create({
    category: 'unknown',
    caseNumber: 'CS-2026-PARSE-001',
    source: 'screenshot',
    parseMeta: {
      mode: 'single',
      providerUsed: 'regex',
      validationScore: 0.32,
      validationConfidence: 'low',
      validationIssues: ['missing_attemptingTo', 'missing_actualOutcome'],
      usedRegexFallback: true,
      attempts: [
        {
          provider: 'claude',
          status: 'error',
          errorCode: 'TIMEOUT',
          errorMessage: 'Parser timed out',
        },
      ],
    },
  });

  let listed = await agent.get('/api/escalations/attention-items?status=open&refresh=1');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.refresh.parserTriage.scanned, 1);
  assert.equal(listed.body.total, 1);
  assert.equal(listed.body.items[0].kind, 'parse-review');
  assert.equal(listed.body.items[0].sourceEscalationId._id, escalation._id.toString());
  assert.equal(listed.body.items[0].severity, 'critical');
  assert.ok(listed.body.items[0].signals.includes('missing_attemptingTo'));
  assert.ok(listed.body.items[0].signals.includes('regex_fallback_used'));

  let item = await EscalationAttentionItem.findOne({
    sourceEscalationId: escalation._id,
    kind: 'parse-review',
  }).lean();
  assert.ok(item);
  assert.equal(item.status, 'open');
  assert.equal(item.title, 'Parser output needs review');

  await Escalation.findByIdAndUpdate(escalation._id, {
    parseMeta: {
      mode: 'single',
      providerUsed: 'claude',
      validationScore: 0.92,
      validationConfidence: 'high',
      validationIssues: [],
      usedRegexFallback: false,
      fallbackUsed: false,
      attempts: [],
    },
  });

  listed = await agent.get('/api/escalations/attention-items?status=open&refresh=1');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.refresh.parserTriage.closed, 1);
  assert.equal(listed.body.total, 0);

  item = await EscalationAttentionItem.findOne({
    sourceEscalationId: escalation._id,
    kind: 'parse-review',
  }).lean();
  assert.equal(item.status, 'resolved');
});

await t.test('attention refresh opens and closes missing link review items', async () => {
  const conversation = await Conversation.create({
    title: 'Broken backlink conversation',
    messages: [{ role: 'user', content: 'Need help with a linked escalation', timestamp: new Date() }],
    provider: 'claude',
  });
  const escalation = await Escalation.create({
    category: 'technical',
    caseNumber: 'CS-2026-LINK-001',
    attemptingTo: 'Review a linked case',
    actualOutcome: 'Conversation backlink is missing',
    conversationId: conversation._id,
  });

  let listed = await agent.get('/api/escalations/attention-items?status=open&refresh=1');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.refresh.missingLinks.scannedEscalations, 1);
  assert.equal(listed.body.total, 1);
  assert.equal(listed.body.items[0].kind, 'missing-link');
  assert.equal(listed.body.items[0].sourceEscalationId._id, escalation._id.toString());
  assert.ok(listed.body.items[0].signals.includes('conversation_backlink_mismatch'));

  let item = await EscalationAttentionItem.findOne({
    sourceEscalationId: escalation._id,
    kind: 'missing-link',
  }).lean();
  assert.ok(item);
  assert.equal(item.status, 'open');
  assert.equal(item.title, 'Escalation link mismatch');

  await Conversation.findByIdAndUpdate(conversation._id, { escalationId: escalation._id });

  listed = await agent.get('/api/escalations/attention-items?status=open&refresh=1');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.refresh.missingLinks.closed, 1);
  assert.equal(listed.body.total, 0);

  item = await EscalationAttentionItem.findOne({
    sourceEscalationId: escalation._id,
    kind: 'missing-link',
  }).lean();
  assert.equal(item.status, 'resolved');

  const escalationOnly = await Escalation.create({
    category: 'technical',
    caseNumber: 'CS-2026-LINK-002',
    attemptingTo: 'Review a conversation-owned link',
    actualOutcome: 'Escalation backlink is missing',
  });
  const conversationOnly = await Conversation.create({
    title: 'Conversation-owned broken link',
    messages: [{ role: 'user', content: 'This conversation points at an escalation', timestamp: new Date() }],
    provider: 'claude',
    escalationId: escalationOnly._id,
  });

  listed = await agent.get('/api/escalations/attention-items?status=open&refresh=1');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.total, 1);

  item = await EscalationAttentionItem.findOne({
    sourceConversationId: conversationOnly._id,
    kind: 'missing-link',
  }).lean();
  assert.ok(item);
  assert.equal(item.status, 'open');
  assert.equal(item.sourceType, 'conversation');
  assert.equal(item.title, 'Conversation link mismatch');
  assert.ok(item.signals.includes('escalation_backlink_mismatch'));

  await Escalation.findByIdAndUpdate(escalationOnly._id, { conversationId: conversationOnly._id });

  listed = await agent.get('/api/escalations/attention-items?status=open&refresh=1');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.total, 0);

  item = await EscalationAttentionItem.findOne({
    sourceConversationId: conversationOnly._id,
    kind: 'missing-link',
  }).lean();
  assert.equal(item.status, 'resolved');
});

await t.test('attention queue supports kind filters, priority sorting, and bulk updates', async () => {
  const oldInfo = await EscalationAttentionItem.create({
    kind: 'knowledge-review',
    severity: 'info',
    fingerprint: 'queue-ops-info',
    title: 'Info item',
    summary: 'Lowest priority review item.',
    lastDetectedAt: new Date(Date.now() - 60_000),
  });
  const warning = await EscalationAttentionItem.create({
    kind: 'missing-link',
    severity: 'warning',
    fingerprint: 'queue-ops-warning',
    title: 'Warning item',
    summary: 'Medium priority review item.',
    lastDetectedAt: new Date(Date.now() - 120_000),
  });
  const critical = await EscalationAttentionItem.create({
    kind: 'parse-review',
    severity: 'critical',
    fingerprint: 'queue-ops-critical',
    title: 'Critical item',
    summary: 'Highest priority review item.',
    lastDetectedAt: new Date(Date.now() - 180_000),
  });

  const prioritized = await agent.get('/api/escalations/attention-items?status=open&sort=priority');
  assert.equal(prioritized.status, 200);
  assert.equal(prioritized.body.total, 3);
  assert.deepEqual(
    prioritized.body.items.map((item) => item.fingerprint),
    ['queue-ops-critical', 'queue-ops-warning', 'queue-ops-info']
  );
  assert.equal(prioritized.body.kindCounts['parse-review'], 1);
  assert.equal(prioritized.body.kindCounts['missing-link'], 1);
  assert.equal(prioritized.body.kindCounts['knowledge-review'], 1);
  assert.equal(prioritized.body.severityCounts.critical, 1);
  assert.equal(prioritized.body.severityCounts.warning, 1);
  assert.equal(prioritized.body.severityCounts.info, 1);

  const parseOnly = await agent.get('/api/escalations/attention-items?status=open&kind=parse-review&sort=priority');
  assert.equal(parseOnly.status, 200);
  assert.equal(parseOnly.body.total, 1);
  assert.equal(parseOnly.body.items[0].fingerprint, 'queue-ops-critical');

  const invalidKind = await agent.get('/api/escalations/attention-items?status=open&kind=not-real');
  assert.equal(invalidKind.status, 400);
  assert.equal(invalidKind.body.code, 'INVALID_KIND');

  const bulk = await agent
    .patch('/api/escalations/attention-items/bulk')
    .send({
      ids: [critical._id.toString(), warning._id.toString(), 'not-an-id'],
      status: 'dismissed',
      resolutionNote: 'Bulk dismissed in queue operations test.',
    });
  assert.equal(bulk.status, 200);
  assert.equal(bulk.body.matched, 2);

  const dismissed = await agent.get('/api/escalations/attention-items?status=dismissed&sort=priority');
  assert.equal(dismissed.status, 200);
  assert.equal(dismissed.body.total, 2);
  assert.deepEqual(
    dismissed.body.items.map((item) => item.fingerprint).sort(),
    ['queue-ops-critical', 'queue-ops-warning']
  );

  const stillOpen = await EscalationAttentionItem.findById(oldInfo._id).lean();
  assert.equal(stillOpen.status, 'open');
});

await t.test('link route rejects accidental duplicate conversation links unless forced', async () => {
  const conversation = await Conversation.create({
    title: 'Duplicate link guard',
    messages: [{ role: 'user', content: 'Need help', timestamp: new Date() }],
    provider: 'claude',
  });

  const first = await agent
    .post('/api/escalations/from-conversation')
    .send({
      conversationId: conversation._id.toString(),
      category: 'general',
      attemptingTo: 'Initial linked escalation',
    });
  assert.equal(first.status, 201);

  const second = await agent
    .post('/api/escalations')
    .send({
      category: 'technical',
      attemptingTo: 'Separate manual escalation',
    });
  assert.equal(second.status, 201);

  const rejected = await agent
    .post(`/api/escalations/${second.body.escalation._id}/link`)
    .send({ conversationId: conversation._id.toString() });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, 'CONVERSATION_ALREADY_LINKED');

  const forced = await agent
    .post(`/api/escalations/${second.body.escalation._id}/link`)
    .send({ conversationId: conversation._id.toString(), force: true });
  assert.equal(forced.status, 200);
  assert.equal(forced.body.duplicateSafety.reason, 'forced_relink');

  const firstAfter = await Escalation.findById(first.body.escalation._id).lean();
  const secondAfter = await Escalation.findById(second.body.escalation._id).lean();
  const conversationAfter = await Conversation.findById(conversation._id).lean();
  assert.equal(firstAfter.conversationId, null);
  assert.equal(String(secondAfter.conversationId), conversation._id.toString());
  assert.equal(String(conversationAfter.escalationId), second.body.escalation._id);
});

// The 'parse with conversationId reuses the existing linked escalation on
// retry' test was removed 2026-05-19 (parser-harness-hardening DECISIONS.md
// D7) when POST /api/escalations/parse was retired. The same dedup behaviour
// (createLinkedEscalationFromConversation) is already covered by the
// 'from-conversation is idempotent for the same conversation' test above.

await t.test('deleting escalation unlinks linked conversation', async () => {
  const conversation = await Conversation.create({
    title: 'Unlink test',
    messages: [{ role: 'user', content: 'hello', timestamp: new Date() }],
    provider: 'claude',
  });

  const created = await agent
    .post('/api/escalations/from-conversation')
    .send({
      conversationId: conversation._id.toString(),
      category: 'technical',
      attemptingTo: 'Fix login issue',
    });
  assert.equal(created.status, 201);

  const escalationId = created.body.escalation._id;
  const deletedEscalation = await agent.delete(`/api/escalations/${escalationId}`);
  assert.equal(deletedEscalation.status, 200);

  const conversationAfter = await Conversation.findById(conversation._id).lean();
  assert.equal(conversationAfter.escalationId, null);
});

await t.test('conversations list escapes regex-like search input', async () => {
  await Conversation.create({
    title: 'Payroll [Bracket] incident',
    messages: [{ role: 'user', content: 'Need help', timestamp: new Date() }],
    provider: 'claude',
  });

  const res = await agent.get('/api/conversations?search=%5B');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.conversations.length, 1);
  assert.match(res.body.conversations[0].title, /\[Bracket\]/);
});

await t.test('conversations list tolerates non-string search and invalid paging values', async () => {
  await Conversation.create({
    title: 'Conversation A',
    messages: [{ role: 'user', content: 'A', timestamp: new Date() }],
    provider: 'claude',
  });
  await Conversation.create({
    title: 'Conversation B',
    messages: [{ role: 'user', content: 'B', timestamp: new Date() }],
    provider: 'claude',
  });

  const res = await agent.get('/api/conversations?search=a&search=b&limit=-5&skip=-20');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.total, 2);
  assert.equal(res.body.conversations.length, 1);
});

await t.test('conversation routes return 400 for invalid ids', async () => {
  const invalidId = 'not-an-object-id';

  const getRes = await agent.get(`/api/conversations/${invalidId}`);
  assert.equal(getRes.status, 400);
  assert.equal(getRes.body.code, 'INVALID_CONVERSATION_ID');

  const patchRes = await agent
    .patch(`/api/conversations/${invalidId}`)
    .send({ title: 'ignored' });
  assert.equal(patchRes.status, 400);
  assert.equal(patchRes.body.code, 'INVALID_CONVERSATION_ID');

  const exportRes = await agent.get(`/api/conversations/${invalidId}/export`);
  assert.equal(exportRes.status, 400);
  assert.equal(exportRes.body.code, 'INVALID_CONVERSATION_ID');
});

await t.test('chat and retry endpoints stream SSE and persist conversation updates', async () => {
  const chatRes = await agent
    .post('/api/chat')
    .send({ message: 'First message', provider: 'claude' });
  assert.equal(chatRes.status, 200);
  assert.match(chatRes.text, /event: start/);
  assert.match(chatRes.text, /event: chunk/);
  assert.match(chatRes.text, /event: done/);

  const startMatch = chatRes.text.match(/event: start\s+data: (.+)/);
  assert.ok(startMatch);
  const startData = JSON.parse(startMatch[1]);
  assert.ok(startData.conversationId);

  const retryRes = await agent
    .post('/api/chat/retry')
    .send({ conversationId: startData.conversationId, provider: 'claude' });
  assert.equal(retryRes.status, 200);
  assert.match(retryRes.text, /event: done/);

  const updatedConversation = await Conversation.findById(startData.conversationId).lean();
  assert.equal(updatedConversation.messages.length, 2);
  assert.equal(updatedConversation.messages[0].role, 'user');
  assert.equal(updatedConversation.messages[1].role, 'assistant');
  assert.equal(updatedConversation.messages[1].content, 'mock assistant response');
});

await t.test('chat and retry SSE expose per-request model overrides', async () => {
  const previousClaudeChat = claude.chat;
  const receivedModels = [];
  claude.chat = ({ model, onChunk, onThinkingChunk, onDone }) => {
    receivedModels.push(model || null);
    onThinkingChunk?.('override reasoning');
    onChunk('override response');
    onDone('override response');
    return () => {};
  };

  try {
    const chatRes = await agent
      .post('/api/chat')
      .send({
        message: 'Model override message',
        provider: 'claude',
        primaryModel: 'claude-chat-override',
      });
    assert.equal(chatRes.status, 200);

    const chatEvents = parseSseEvents(chatRes.text);
    const chatStart = JSON.parse(chatEvents.find((event) => event.event === 'start').data);
    const chatDone = JSON.parse(chatEvents.find((event) => event.event === 'done').data);

    assert.equal(chatStart.primaryModel, 'claude-chat-override');
    assert.equal(chatStart.fallbackModel, null);
    assert.ok(chatEvents.some((event) => event.event === 'thinking'));
    assert.ok(chatEvents.some((event) => event.event === 'chunk'));
    assert.equal(chatDone.modelUsed, 'claude-chat-override');
    assert.equal(receivedModels[0], 'claude-chat-override');
    let conversation = await Conversation.findById(chatStart.conversationId).lean();
    assert.equal(conversation.messages.at(-1).modelUsed, 'claude-chat-override');

    const retryRes = await agent
      .post('/api/chat/retry')
      .send({
        conversationId: chatStart.conversationId,
        provider: 'claude',
        primaryModel: 'claude-retry-override',
      });
    assert.equal(retryRes.status, 200);

    const retryEvents = parseSseEvents(retryRes.text);
    const retryStart = JSON.parse(retryEvents.find((event) => event.event === 'start').data);
    const retryDone = JSON.parse(retryEvents.find((event) => event.event === 'done').data);

    assert.equal(retryStart.primaryModel, 'claude-retry-override');
    assert.equal(retryStart.fallbackModel, null);
    assert.ok(retryEvents.some((event) => event.event === 'thinking'));
    assert.ok(retryEvents.some((event) => event.event === 'chunk'));
    assert.equal(retryDone.modelUsed, 'claude-retry-override');
    assert.equal(receivedModels[1], 'claude-retry-override');
    conversation = await Conversation.findById(chatStart.conversationId).lean();
    assert.equal(conversation.messages.at(-1).modelUsed, 'claude-retry-override');
  } finally {
    claude.chat = previousClaudeChat;
  }
});

await t.test('chat SSE forwards Codex reasoning items as thinking events', async () => {
  const previousCodexChat = codex.chat;
  codex.chat = ({ onThinkingChunk, onChunk, onDone }) => {
    onThinkingChunk?.('codex reasoning before final');
    onChunk('codex final');
    onDone('codex final');
    return () => {};
  };

  try {
    const res = await agent
      .post('/api/chat')
      .send({
        message: 'Codex reasoning stream test',
        provider: 'gpt-5.5',
      });
    assert.equal(res.status, 200);

    const events = parseSseEvents(res.text);
    const thinkingEvent = events.find((event) => event.event === 'thinking');
    const chunkEvent = events.find((event) => event.event === 'chunk');
    assert.ok(thinkingEvent, 'Codex thinking event should be present');
    assert.ok(chunkEvent, 'Codex chunk event should be present');
    assert.match(thinkingEvent.data, /codex reasoning before final/);
  } finally {
    codex.chat = previousCodexChat;
  }
});

await t.test('image chat is rejected and does not create a conversation', async () => {
  const beforeCount = await Conversation.countDocuments({});
  const chatRes = await agent
    .post('/api/chat')
    .send({ message: '', images: [SAMPLE_PNG_DATA_URL], provider: 'claude' });

  assert.equal(chatRes.status, 400);
  assert.equal(chatRes.body.code, 'CHAT_IMAGES_DISABLED');

  const afterCount = await Conversation.countDocuments({});
  assert.equal(afterCount, beforeCount);
});

await t.test('parallel chat mode persists both provider responses and retry replaces both', async () => {
  const chatRes = await agent
    .post('/api/chat')
    .send({
      message: 'Parallel test message',
      provider: 'claude',
      mode: 'parallel',
      fallbackProvider: 'gpt-5.5',
    });

  assert.equal(chatRes.status, 200);
  assert.match(chatRes.text, /event: start/);
  assert.match(chatRes.text, /event: done/);

  const startMatch = chatRes.text.match(/event: start\s+data: (.+)/);
  assert.ok(startMatch);
  const startData = JSON.parse(startMatch[1]);
  assert.equal(startData.mode, 'parallel');
  assert.deepEqual((startData.parallelProviders || []).sort(), ['claude', 'gpt-5.5']);

  const doneMatch = chatRes.text.match(/event: done\s+data: (.+)/);
  assert.ok(doneMatch);
  const doneData = JSON.parse(doneMatch[1]);
  assert.equal(doneData.mode, 'parallel');
  assert.equal(doneData.providerUsed, 'parallel');
  assert.ok(doneData.turnId);
  assert.ok(Array.isArray(doneData.results));
  assert.equal(doneData.results.length, 2);
  const firstTurn = await ParallelCandidateTurn.findOne({ turnId: doneData.turnId }).lean();
  assert.ok(firstTurn);
  assert.equal(firstTurn.status, 'open');
  assert.equal(firstTurn.service, 'chat');
  assert.equal(String(firstTurn.conversationId), startData.conversationId);
  assert.equal(firstTurn.candidates.length, 2);
  assert.deepEqual(firstTurn.candidates.map((c) => c.provider).sort(), ['claude', 'gpt-5.5']);

  const afterFirstRun = await Conversation.findById(startData.conversationId).lean();
  assert.equal(afterFirstRun.messages.length, 3);
  const firstAssistantProviders = afterFirstRun.messages
    .filter((m) => m.role === 'assistant')
    .map((m) => m.provider)
    .sort();
  assert.deepEqual(firstAssistantProviders, ['claude', 'gpt-5.5']);

  const retryRes = await agent
    .post('/api/chat/retry')
    .send({
      conversationId: startData.conversationId,
      provider: 'claude',
      mode: 'parallel',
      fallbackProvider: 'gpt-5.5',
    });

  assert.equal(retryRes.status, 200);
  assert.match(retryRes.text, /event: done/);
  const retryDoneMatch = retryRes.text.match(/event: done\s+data: (.+)/);
  assert.ok(retryDoneMatch);
  const retryDoneData = JSON.parse(retryDoneMatch[1]);
  assert.ok(retryDoneData.turnId);
  const retryTurn = await ParallelCandidateTurn.findOne({ turnId: retryDoneData.turnId }).lean();
  assert.ok(retryTurn);
  assert.equal(retryTurn.status, 'open');

  const afterRetry = await Conversation.findById(startData.conversationId).lean();
  assert.equal(afterRetry.messages.length, 3);
  const retryAssistantProviders = afterRetry.messages
    .filter((m) => m.role === 'assistant')
    .map((m) => m.provider)
    .sort();
  assert.deepEqual(retryAssistantProviders, ['claude', 'gpt-5.5']);
});

await t.test('parallel accept endpoint commits exactly one winner and is idempotent', async () => {
  const chatRes = await agent
    .post('/api/chat')
    .send({
      message: 'Parallel accept message',
      provider: 'claude',
      mode: 'parallel',
      fallbackProvider: 'gpt-5.5',
    });

  assert.equal(chatRes.status, 200);

  const startMatch = chatRes.text.match(/event: start\s+data: (.+)/);
  const doneMatch = chatRes.text.match(/event: done\s+data: (.+)/);
  assert.ok(startMatch);
  assert.ok(doneMatch);
  const startData = JSON.parse(startMatch[1]);
  const doneData = JSON.parse(doneMatch[1]);
  assert.ok(doneData.turnId);

  const acceptRes = await agent
    .post(`/api/chat/parallel/${doneData.turnId}/accept`)
    .send({
      conversationId: startData.conversationId,
      provider: 'claude',
    });
  assert.equal(acceptRes.status, 200);
  assert.equal(acceptRes.body.ok, true);
  assert.equal(acceptRes.body.idempotent, false);
  assert.equal(acceptRes.body.acceptedProvider, 'claude');

  const conversationAfterAccept = await Conversation.findById(startData.conversationId).lean();
  const assistantsAfterAccept = conversationAfterAccept.messages.filter((m) => m.role === 'assistant');
  assert.equal(assistantsAfterAccept.length, 1);
  assert.equal(assistantsAfterAccept[0].provider, 'claude');
  assert.equal(assistantsAfterAccept[0].attemptMeta.turnId, doneData.turnId);
  assert.equal(assistantsAfterAccept[0].attemptMeta.accepted, true);
  const turnAfterAccept = await ParallelCandidateTurn.findOne({ turnId: doneData.turnId }).lean();
  assert.ok(turnAfterAccept);
  assert.equal(turnAfterAccept.status, 'accepted');
  assert.equal(turnAfterAccept.acceptedProvider, 'claude');
  assert.equal(turnAfterAccept.acceptedContent, assistantsAfterAccept[0].content);

  const acceptAgainRes = await agent
    .post(`/api/chat/parallel/${doneData.turnId}/accept`)
    .send({
      conversationId: startData.conversationId,
      provider: 'claude',
    });
  assert.equal(acceptAgainRes.status, 200);
  assert.equal(acceptAgainRes.body.idempotent, true);
  assert.equal(acceptAgainRes.body.acceptedProvider, 'claude');

  const conflictingAccept = await agent
    .post(`/api/chat/parallel/${doneData.turnId}/accept`)
    .send({
      conversationId: startData.conversationId,
      provider: 'gpt-5.5',
    });
  assert.equal(conflictingAccept.status, 409);
  assert.equal(conflictingAccept.body.code, 'TURN_ALREADY_ACCEPTED');
});

await t.test('parallel unaccept endpoint restores both candidates after winner-only acceptance', async () => {
  const chatRes = await agent
    .post('/api/chat')
    .send({
      message: 'Parallel unaccept message',
      provider: 'claude',
      mode: 'parallel',
      fallbackProvider: 'gpt-5.5',
    });

  assert.equal(chatRes.status, 200);
  const startMatch = chatRes.text.match(/event: start\s+data: (.+)/);
  const doneMatch = chatRes.text.match(/event: done\s+data: (.+)/);
  assert.ok(startMatch);
  assert.ok(doneMatch);
  const startData = JSON.parse(startMatch[1]);
  const doneData = JSON.parse(doneMatch[1]);

  const acceptRes = await agent
    .post(`/api/chat/parallel/${doneData.turnId}/accept`)
    .send({
      conversationId: startData.conversationId,
      provider: 'claude',
    });
  assert.equal(acceptRes.status, 200);
  assert.equal(acceptRes.body.ok, true);

  const unacceptRes = await agent
    .post(`/api/chat/parallel/${doneData.turnId}/unaccept`)
    .send({ conversationId: startData.conversationId });
  assert.equal(unacceptRes.status, 200);
  assert.equal(unacceptRes.body.ok, true);

  const conversationAfterUnaccept = await Conversation.findById(startData.conversationId).lean();
  const assistantsAfterUnaccept = conversationAfterUnaccept.messages.filter((m) => (
    m.role === 'assistant' && m.mode === 'parallel' && m.attemptMeta?.turnId === doneData.turnId
  ));
  assert.equal(assistantsAfterUnaccept.length, 2);
  assert.deepEqual(
    assistantsAfterUnaccept.map((m) => m.provider).sort(),
    ['claude', 'gpt-5.5']
  );
  for (const assistant of assistantsAfterUnaccept) {
    assert.equal(assistant.attemptMeta.accepted, false);
    assert.equal(assistant.attemptMeta.rejected, false);
  }

  const turnAfterUnaccept = await ParallelCandidateTurn.findOne({ turnId: doneData.turnId }).lean();
  assert.ok(turnAfterUnaccept);
  assert.equal(turnAfterUnaccept.status, 'open');
  assert.equal(turnAfterUnaccept.acceptedProvider, null);
  assert.equal(turnAfterUnaccept.acceptedContent, null);
  assert.equal(turnAfterUnaccept.acceptedAt, null);
});

await t.test('parallel discard endpoint removes unaccepted candidates', async () => {
  const chatRes = await agent
    .post('/api/chat')
    .send({
      message: 'Parallel discard message',
      provider: 'claude',
      mode: 'parallel',
      fallbackProvider: 'gpt-5.5',
    });
  assert.equal(chatRes.status, 200);

  const startMatch = chatRes.text.match(/event: start\s+data: (.+)/);
  const doneMatch = chatRes.text.match(/event: done\s+data: (.+)/);
  assert.ok(startMatch);
  assert.ok(doneMatch);
  const startData = JSON.parse(startMatch[1]);
  const doneData = JSON.parse(doneMatch[1]);
  assert.ok(doneData.turnId);

  const discardRes = await agent
    .post(`/api/chat/parallel/${doneData.turnId}/discard`)
    .send({ conversationId: startData.conversationId });
  assert.equal(discardRes.status, 200);
  assert.equal(discardRes.body.ok, true);
  assert.equal(discardRes.body.discardedCount, 2);

  const conversationAfterDiscard = await Conversation.findById(startData.conversationId).lean();
  assert.equal(conversationAfterDiscard.messages.length, 1);
  assert.equal(conversationAfterDiscard.messages[0].role, 'user');
  const turnAfterDiscard = await ParallelCandidateTurn.findOne({ turnId: doneData.turnId }).lean();
  assert.ok(turnAfterDiscard);
  assert.equal(turnAfterDiscard.status, 'discarded');
});

await t.test('screenshot upload normalizes and deduplicates by hash', async () => {
  const createdEscalation = await agent
    .post('/api/escalations')
    .send({ category: 'general', attemptingTo: 'Upload screenshot test' });
  assert.equal(createdEscalation.status, 201);

  const escalationId = createdEscalation.body.escalation._id;
  const upload = await agent
    .post(`/api/escalations/${escalationId}/screenshots`)
    .send({ images: [SAMPLE_PNG_DATA_URL, SAMPLE_PNG_DATA_URL] });

  assert.equal(upload.status, 201);
  assert.equal(upload.body.createdCount, 1);
  assert.ok(upload.body.skippedDuplicates >= 1);
  assert.equal(upload.body.escalation.screenshotPaths.length, 1);
  assert.equal(upload.body.escalation.screenshotHashes.length, 1);

  const secondUpload = await agent
    .post(`/api/escalations/${escalationId}/screenshots`)
    .send({ images: [SAMPLE_PNG_DATA_URL] });
  assert.equal(secondUpload.status, 400);
  assert.ok(secondUpload.body.skippedDuplicates >= 1);
});

await t.test('screenshot upload warns when another escalation already has the same image hash', async () => {
  const firstEscalation = await agent
    .post('/api/escalations')
    .send({ category: 'technical', attemptingTo: 'Review screenshot A' });
  assert.equal(firstEscalation.status, 201);

  const firstUpload = await agent
    .post(`/api/escalations/${firstEscalation.body.escalation._id}/screenshots`)
    .send({ images: [SAMPLE_PNG_DATA_URL] });
  assert.equal(firstUpload.status, 201);
  assert.equal(firstUpload.body.duplicateSafety.warnings.length, 0);

  const secondEscalation = await agent
    .post('/api/escalations')
    .send({ category: 'technical', attemptingTo: 'Review screenshot B' });
  assert.equal(secondEscalation.status, 201);

  const secondUpload = await agent
    .post(`/api/escalations/${secondEscalation.body.escalation._id}/screenshots`)
    .send({ images: [SAMPLE_PNG_DATA_URL] });
  assert.equal(secondUpload.status, 201);
  assert.equal(secondUpload.body.duplicateSafety.warnings.length, 1);
  assert.equal(secondUpload.body.duplicateSafety.warnings[0].code, 'POSSIBLE_DUPLICATE_ESCALATION');
  assert.equal(secondUpload.body.duplicateSafety.warnings[0].candidates[0].escalationId, firstEscalation.body.escalation._id);
  assert.ok(secondUpload.body.duplicateSafety.warnings[0].candidates[0].signals.includes('same_screenshot_hash'));
  assert.equal(secondUpload.body.duplicateSafety.attentionItems.length, 1);
});

// ---------- Phase 5: New provider ID acceptance ----------

await t.test('P5: chat accepts claude-opus-4-8 as primaryProvider', async () => {
  const res = await agent
    .post('/api/chat')
    .send({ message: 'P5 test', primaryProvider: 'claude-opus-4-8' })
    .expect(200);

  assert.equal(res.headers['content-type'].includes('text/event-stream'), true);
});

await t.test('P5: chat accepts gpt-5.4-mini as primaryProvider', async () => {
  const res = await agent
    .post('/api/chat')
    .send({ message: 'P5 test', primaryProvider: 'gpt-5.4-mini' })
    .expect(200);

  assert.equal(res.headers['content-type'].includes('text/event-stream'), true);
});

await t.test('P5: chat rejects invalid provider ID', async () => {
  const res = await agent
    .post('/api/chat')
    .send({ message: 'test', primaryProvider: 'invalid-provider' })
    .expect(400);

  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_PROVIDER');
});

await t.test('P5: chat rejects removed provider IDs', async () => {
  for (const retiredProvider of ['claude-sonnet-4-6', 'gpt-5.4-pro', 'gpt-5-mini', 'gpt-5-nano']) {
    const res = await agent
      .post('/api/chat')
      .send({ message: 'retired provider test', primaryProvider: retiredProvider })
      .expect(400);

    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'INVALID_PROVIDER');
  }
});

await t.test('P5: chat fallback works across provider families', async () => {
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'P5 fallback test',
      primaryProvider: 'claude-opus-4-8',
      fallbackProvider: 'gpt-5.4-mini',
      mode: 'fallback',
    })
    .expect(200);

  assert.equal(res.headers['content-type'].includes('text/event-stream'), true);
});

await t.test('P5: conversation persists new provider IDs', async () => {
  await agent
    .post('/api/chat')
    .send({ message: 'P5 persist test', primaryProvider: 'claude-opus-4-8' })
    .expect(200);

  const Conversation = require('../src/models/Conversation');
  const conv = await Conversation.findOne({ title: /P5 persist test/ }).lean();
  assert.ok(conv, 'conversation should exist');
  assert.equal(conv.provider, 'claude-opus-4-8');
});

// The 'P5: escalation parse accepts new provider IDs' test was removed
// 2026-05-19 (parser-harness-hardening DECISIONS.md D7) when POST
// /api/escalations/parse was retired. Provider-id validation is still
// exercised by 'P5: chat accepts new provider IDs' (above) and 'P5: chat
// retry accepts new provider IDs' (below), which hit /api/chat and
// /api/chat/retry respectively — same isValidProvider gate, same registry.

await t.test('P5: chat retry accepts new provider IDs', async () => {
  // Create a conversation first
  await agent
    .post('/api/chat')
    .send({ message: 'P5 retry setup', primaryProvider: 'claude-opus-4-8' })
    .expect(200);

  const Conversation = require('../src/models/Conversation');
  const conv = await Conversation.findOne({ title: /P5 retry setup/ }).lean();
  assert.ok(conv);

  const retryRes = await agent
    .post('/api/chat/retry')
    .send({
      conversationId: conv._id.toString(),
      primaryProvider: 'gpt-5.4-mini',
    })
    .expect(200);

  assert.equal(retryRes.headers['content-type'].includes('text/event-stream'), true);
});

await t.test('P5: chat parse-escalation accepts new provider IDs', async () => {
  const res = await agent
    .post('/api/chat/parse-escalation')
    .send({
      text: 'P5 chat parse test',
      provider: 'claude-opus-4-8',
    });

  assert.ok([200, 201].includes(res.status));
  assert.equal(res.body.ok, true);
});

await t.test('POST /api/chat/parse-escalation returns parse payload without inline triage card', async () => {
  const res = await agent
    .post('/api/chat/parse-escalation')
    .send({
      text: [
        'COID/MID: 12345 / 67890',
        'CASE: CS-2026-002001',
        'CLIENT/CONTACT: Example Client',
        'AGENT: Jamie Agent',
        'CX IS ATTEMPTING TO: sign in to QuickBooks Online',
        'EXPECTED OUTCOME: customer signs in successfully',
        'ACTUAL OUTCOME: login error shown after MFA',
        'TS STEPS: cleared cache and retried in incognito',
        'TRIED TEST ACCOUNT: yes',
      ].join('\n'),
      provider: 'claude',
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.escalation);
  assert.equal(res.body.triageCard, null);
  assert.equal(res.body.triageMeta, null);
  assert.ok(res.body._meta);
});

await t.test('POST /api/chat does not emit triage_card for parsedEscalationText handoff', async () => {
  const extractedText = [
    'COID/MID: 12345 / 67890',
    'CASE: CS-2026-002001',
    'CLIENT/CONTACT: Example Client',
    'AGENT: Jamie Agent',
    'CX IS ATTEMPTING TO: sign in to QuickBooks Online',
    'EXPECTED OUTCOME: customer signs in successfully',
    'ACTUAL OUTCOME: login error shown after MFA',
    'TS STEPS: cleared cache and retried in incognito',
    'TRIED TEST ACCOUNT: yes',
  ].join('\n');

  const res = await agent
    .post('/api/chat')
    .send({
      message: [
        'Parsed escalation preview',
        'Case CS-2026-002001',
        'Client: Example Client',
        'Issue: login error shown after MFA',
      ].join('\n'),
      parsedEscalationText: extractedText,
      parsedEscalationSource: 'image-parser',
      parsedEscalationProvider: 'claude',
      provider: 'claude',
    })
    .expect(200);

  const events = parseSseEvents(res.text);
  const triageEvent = events.find((event) => event.event === 'triage_card');
  assert.equal(triageEvent, undefined, 'triage_card event should be emitted only by /api/triage');
  assert.ok(events.some((event) => event.event === 'start' || event.event === 'init'));
  assert.ok(events.some((event) => event.event === 'done'));
});

// ---------- Phase 6: N-way parallelProviders route tests ----------

await t.test('POST /api/chat rejects parallelProviders with 1 provider', async () => {
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'test',
      mode: 'parallel',
      parallelProviders: ['claude'],
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'PARALLEL_PROVIDER_COUNT_INVALID');
});

await t.test('POST /api/chat rejects parallelProviders with 5 providers', async () => {
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'test',
      mode: 'parallel',
      parallelProviders: ['claude', 'gpt-5.5', 'claude-opus-4-8', 'gpt-5.4-mini', 'claude'],
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'PARALLEL_PROVIDER_COUNT_INVALID');
});

await t.test('POST /api/chat rejects parallelProviders with invalid provider', async () => {
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'test',
      mode: 'parallel',
      parallelProviders: ['claude', 'invalid-provider'],
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_PARALLEL_PROVIDERS');
});

await t.test('POST /api/chat rejects parallelProviders when mode is not parallel', async () => {
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'test',
      mode: 'single',
      parallelProviders: ['claude', 'gpt-5.4-mini'],
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_PARALLEL_PROVIDERS');
});

await t.test('POST /api/chat rejects when primaryProvider not in parallelProviders', async () => {
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'test',
      mode: 'parallel',
      primaryProvider: 'gpt-5.4-mini',
      parallelProviders: ['claude', 'gpt-5.5'],
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_PARALLEL_PROVIDERS');
});

await t.test('POST /api/chat parallel mode without parallelProviders still works (legacy)', async () => {
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'test legacy parallel',
      mode: 'parallel',
      provider: 'claude',
      fallbackProvider: 'gpt-5.4-mini',
    });

  assert.equal(res.status, 200);

  const events = parseSseEvents(res.text);
  const startEvent = events.find((e) => e.event === 'start');
  assert.ok(startEvent, 'start event must be present');
  const startData = JSON.parse(startEvent.data);
  assert.ok(Array.isArray(startData.parallelProviders));
  assert.equal(startData.parallelProviders.length, 2);
});

await t.test('parallel accept rejects provider not in requestedProviders for 3-way', async () => {
  const chatRes = await agent
    .post('/api/chat')
    .send({
      message: 'accept reject test',
      mode: 'parallel',
      parallelProviders: ['claude', 'gpt-5.5', 'claude-opus-4-8'],
    });
  assert.equal(chatRes.status, 200);

  const events = parseSseEvents(chatRes.text);
  const startEvent = events.find((e) => e.event === 'start');
  const startData = JSON.parse(startEvent.data);
  const doneEvent = events.find((e) => e.event === 'done');
  const doneData = JSON.parse(doneEvent.data);

  // Try to accept gpt-5.4-mini which was NOT in the parallelProviders
  const acceptRes = await agent
    .post(`/api/chat/parallel/${doneData.turnId}/accept`)
    .send({
      conversationId: startData.conversationId,
      provider: 'gpt-5.4-mini',
    });
  assert.equal(acceptRes.status, 400);
  assert.equal(acceptRes.body.code, 'INVALID_PROVIDER');
});

await t.test('POST /api/chat rejects duplicate parallelProviders', async () => {
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'test',
      mode: 'parallel',
      parallelProviders: ['claude', 'claude', 'gpt-5.4-mini'],
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_PARALLEL_PROVIDERS');
});

await t.test('POST /api/chat rejects parallelProviders that is not an array', async () => {
  const res = await agent
    .post('/api/chat')
    .send({
      message: 'test',
      mode: 'parallel',
      parallelProviders: 'claude',
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'INVALID_PARALLEL_PROVIDERS');
});

await t.test('POST /api/chat/retry rejects invalid parallelProviders', async () => {
  // Create initial conversation
  const chatRes = await agent
    .post('/api/chat')
    .send({ message: 'retry validation setup', provider: 'claude' });
  assert.equal(chatRes.status, 200);

  const chatEvents = parseSseEvents(chatRes.text);
  const chatStart = chatEvents.find((e) => e.event === 'start');
  const chatStartData = JSON.parse(chatStart.data);

  const retryRes = await agent
    .post('/api/chat/retry')
    .send({
      conversationId: chatStartData.conversationId,
      mode: 'parallel',
      parallelProviders: ['claude', 'invalid-provider'],
    });

  assert.equal(retryRes.status, 400);
  assert.equal(retryRes.body.ok, false);
  assert.equal(retryRes.body.code, 'INVALID_PARALLEL_PROVIDERS');
});

// ──────────────────────────────────────────────
// COPILOT: improve-template
// ──────────────────────────────────────────────

await t.test('POST /api/copilot/improve-template returns 400 when templateContent is missing', async () => {
  const res = await agent
    .post('/api/copilot/improve-template')
    .send({});

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'VALIDATION');
});

await t.test('POST /api/copilot/improve-template returns 400 when templateContent is empty string', async () => {
  const res = await agent
    .post('/api/copilot/improve-template')
    .send({ templateContent: '' });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'VALIDATION');
});

await t.test('POST /api/copilot/improve-template returns 400 when templateContent is not a string', async () => {
  const res = await agent
    .post('/api/copilot/improve-template')
    .send({ templateContent: 123 });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'VALIDATION');
});

await t.test('POST /api/copilot/improve-template streams improvement for valid templateContent', async () => {
  const res = await agent
    .post('/api/copilot/improve-template')
    .send({ templateContent: 'Hello {{CLIENT_NAME}}, your issue has been resolved.' });

  assert.equal(res.status, 200);

  const events = parseSseEvents(res.text);
  const startEvent = events.find((e) => e.event === 'start');
  assert.ok(startEvent, 'start event must be present');
  const startData = JSON.parse(startEvent.data);
  assert.equal(startData.type, 'improve-template');

  const doneEvent = events.find((e) => e.event === 'done');
  assert.ok(doneEvent, 'done event must be present');
  const doneData = JSON.parse(doneEvent.data);
  assert.equal(doneData.fullResponse, 'mock assistant response');
});
});
