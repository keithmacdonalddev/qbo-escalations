const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
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
    caseNumber: `CASE-MGMT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    coid: `COID-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    attemptingTo: 'Use a QBO workflow',
    actualOutcome: 'The customer needs a reusable support pattern',
    resolution: 'Use the reviewed QBO workflow and validate the result.',
    resolutionNotes: 'Confirmed in a finalized case.',
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
    title: 'Draft QBO learning',
    category: escalation.category || 'unknown',
    summary: 'Draft summary',
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
  process.env.NODE_ENV = 'test';
  await Escalation.deleteMany({});
  await EscalationAttentionItem.deleteMany({});
  await KnowledgeCandidate.deleteMany({});
  delete process.env.KNOWLEDGE_DEFAULT_ROLE;
  delete process.env.KNOWLEDGE_MARKDOWN_PUBLISH_DISABLED;
});

test('knowledge management routes support review edits and database-first publish', async () => {
  const app = createApp();
  const agent = request(app);
  const escalation = await makeEscalation({
    caseNumber: 'CASE-MGMT-PUBLISH',
    actualOutcome: 'Payroll archive employer summary appears missing',
  });
  const candidate = await makeCandidate(escalation);

  const update = await agent
    .patch(`/api/knowledge/records/candidate:${candidate._id}`)
    .set('x-knowledge-role', 'admin')
    .set('x-knowledge-actor', 'reviewer-a')
    .send({
      reviewStatus: 'approved',
      publishTarget: 'category',
      reusableOutcome: 'canonical',
      title: 'Payroll archive employer summary fix',
      summary: 'Use Archived Forms when the employer summary appears missing.',
      symptom: 'Employer summary appears missing after filing.',
      rootCause: 'The summary is available in the archived form area after filing.',
      exactFix: 'Open Archived Forms, choose the correct tax year, and confirm the employer summary.',
      confidence: 0.9,
      keySignals: ['archived forms', 'employer summary'],
      scope: {
        appliesTo: ['QBO payroll year-end forms'],
        excludes: ['unfiled forms'],
        versionNotes: 'Validated against the 2026 workflow.',
      },
    });

  assert.equal(update.status, 200);
  assert.equal(update.body.ok, true);
  assert.equal(update.body.record.reviewStatus, 'approved');
  assert.equal(update.body.record.trustState, 'reviewed');
  assert.equal(update.body.record.scope.appliesTo[0], 'QBO payroll year-end forms');
  assert.equal(update.body.record.auditEvents[0].action, 'record.update');
  assert.equal(update.body.record.reviewedBy, 'reviewer-a');

  const bypass = await agent
    .patch(`/api/knowledge/records/candidate:${candidate._id}`)
    .set('x-knowledge-role', 'reviewer')
    .send({ reviewStatus: 'published' });
  assert.equal(bypass.status, 400);
  assert.equal(bypass.body.code, 'INVALID_REVIEW_STATUS');

  const finalUseOverride = await agent
    .patch(`/api/knowledge/records/candidate:${candidate._id}`)
    .set('x-knowledge-role', 'reviewer')
    .send({ allowedUsesOverride: ['agent-response'] });
  assert.equal(finalUseOverride.status, 400);
  assert.equal(finalUseOverride.body.code, 'INVALID_ALLOWED_USE_OVERRIDE');

  const trustedOverride = await agent
    .patch(`/api/knowledge/records/candidate:${candidate._id}`)
    .set('x-knowledge-role', 'reviewer')
    .send({ trustStateOverride: 'trusted' });
  assert.equal(trustedOverride.status, 400);
  assert.equal(trustedOverride.body.code, 'INVALID_TRUST_STATE');

  const publish = await agent
    .post(`/api/knowledge/records/candidate:${candidate._id}/publish`)
    .set('x-knowledge-role', 'publisher')
    .set('x-knowledge-actor', 'publisher-a')
    .send({ exportMarkdown: false });

  assert.equal(publish.status, 200);
  assert.equal(publish.body.ok, true);
  assert.equal(publish.body.published, true);
  assert.equal(publish.body.export, null);
  assert.equal(publish.body.record.reviewStatus, 'published');
  assert.equal(publish.body.record.trustState, 'trusted');
  assert.equal(publish.body.record.lineage.publishedDocType, 'database');
  assert.ok(publish.body.record.allowedUses.includes('agent-response'));
  assert.equal(publish.body.record.auditEvents[0].action, 'record.publish.database');

  const locked = await agent
    .patch(`/api/knowledge/records/candidate:${candidate._id}`)
    .set('x-knowledge-role', 'admin')
    .send({ title: 'Edited after publish' });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.code, 'KNOWLEDGE_PUBLISHED_LOCKED');

  const context = await agent
    .get('/api/knowledge/agent-context')
    .query({ query: 'archived forms employer summary', allowedUse: 'agent-response', includeLegacy: 'false' });
  assert.equal(context.status, 200);
  assert.equal(context.body.context.records[0].id, `candidate:${candidate._id}`);
});

test('knowledge publish rejects attempted steps that are not a proven final fix', async () => {
  const app = createApp();
  const agent = request(app);
  const escalation = await makeEscalation({
    caseNumber: 'CASE-MGMT-UNPROVEN',
    actualOutcome: 'T4 XML export is missing the T4 Summary',
  });
  const candidate = await makeCandidate(escalation, {
    reviewStatus: 'approved',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
    title: 'Missing T4 summary',
    summary: 'The XML export was missing the T4 Summary.',
    symptom: 'T4 slips download in the XML but the T4 Summary section is absent.',
    rootCause: 'The underlying root cause is undetermined.',
    exactFix: 'Deleting the archived T4 and attempting to repopulate did not restore the summary. The data does not specify the final working fix.',
    keySignals: ['T4 XML export missing T4 Summary'],
  });

  const publish = await agent
    .post(`/api/knowledge/records/candidate:${candidate._id}/publish`)
    .set('x-knowledge-role', 'publisher')
    .set('x-knowledge-actor', 'publisher-a')
    .send({ exportMarkdown: false });

  assert.equal(publish.status, 409);
  assert.equal(publish.body.code, 'KNOWLEDGE_PUBLISH_BLOCKED');
  assert.match(publish.body.error, /proven final fix/i);
});

test('draft override data cannot enter final agent context', async () => {
  const app = createApp();
  const agent = request(app);
  const escalation = await makeEscalation({
    caseNumber: 'CASE-MGMT-OVERRIDE',
    actualOutcome: 'Override safety regression',
  });
  const candidate = await makeCandidate(escalation, {
    reviewStatus: 'draft',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
    title: 'Override safety draft',
    summary: 'This draft should not become final context through overrides.',
    symptom: 'Override safety regression',
    rootCause: 'Draft root cause',
    exactFix: 'Draft fix',
    trustStateOverride: 'trusted',
    allowedUsesOverride: ['agent-response', 'triage'],
  });

  const detail = await agent.get(`/api/knowledge/records/candidate:${candidate._id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.record.trustState, 'candidate');
  assert.deepEqual(detail.body.record.allowedUses, ['review-only']);

  const context = await agent
    .get('/api/knowledge/agent-context')
    .query({
      query: 'override safety regression',
      allowedUse: 'agent-response',
      includeLegacy: 'false',
    });
  assert.equal(context.status, 200);
  assert.equal(context.body.context.records.length, 0);
});

test('knowledge management routes deprecate records and remove them from final agent context', async () => {
  const app = createApp();
  const agent = request(app);
  const escalation = await makeEscalation({ caseNumber: 'CASE-MGMT-DEPRECATE' });
  const candidate = await makeCandidate(escalation, {
    reviewStatus: 'published',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
    title: 'Deprecated payroll guidance',
    summary: 'Old payroll guidance.',
    symptom: 'Old workflow symptom.',
    rootCause: 'Historical workflow behavior.',
    exactFix: 'Use the old workflow.',
    publishedAt: new Date('2026-05-03T12:00:00.000Z'),
    publishedDocType: 'database',
  });

  const deprecated = await agent
    .post(`/api/knowledge/records/candidate:${candidate._id}/deprecate`)
    .set('x-knowledge-role', 'publisher')
    .set('x-knowledge-actor', 'publisher-a')
    .send({ reason: 'QBO workflow changed.' });

  assert.equal(deprecated.status, 200);
  assert.equal(deprecated.body.record.trustState, 'deprecated');
  assert.equal(deprecated.body.record.deprecatedReason, 'QBO workflow changed.');
  assert.ok(deprecated.body.record.allowedUses.includes('deprecated-warning'));
  assert.ok(deprecated.body.record.warnings.includes('deprecated_guidance'));

  const context = await agent
    .get('/api/knowledge/agent-context')
    .query({ query: 'old payroll guidance', allowedUse: 'agent-response', includeLegacy: 'false' });
  assert.equal(context.status, 200);
  assert.equal(context.body.context.records.length, 0);
});

test('agent context applies trust policy before pagination', async () => {
  const app = createApp();
  const agent = request(app);
  const trustedEscalation = await makeEscalation({
    caseNumber: 'CASE-MGMT-POLICY-TRUSTED',
    actualOutcome: 'Payroll archive policy pagination regression',
  });
  const trusted = await makeCandidate(trustedEscalation, {
    reviewStatus: 'published',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
    title: 'Payroll archive policy pagination trusted',
    summary: 'Trusted record should survive derived policy filtering.',
    symptom: 'Payroll archive policy pagination regression',
    rootCause: 'The trusted record is older than newer drafts.',
    exactFix: 'Filter by policy before returning the requested page.',
    confidence: 0.9,
    publishedAt: new Date('2026-05-03T12:00:00.000Z'),
    updatedAt: new Date('2026-05-03T12:00:00.000Z'),
  });
  const edgeEscalation = await makeEscalation({
    caseNumber: 'CASE-MGMT-POLICY-EDGE',
    actualOutcome: 'Payroll archive policy pagination regression',
  });
  const edge = await makeCandidate(edgeEscalation, {
    reviewStatus: 'published',
    publishTarget: 'edge-case',
    reusableOutcome: 'edge-case',
    title: 'Payroll archive policy pagination edge case',
    summary: 'Edge-case record should be returned when explicitly filtered.',
    symptom: 'Payroll archive policy pagination regression',
    rootCause: 'The case has a scoped edge condition.',
    exactFix: 'Return only the scoped edge-case record when requested.',
    confidence: 0.88,
    publishedAt: new Date('2026-05-04T12:00:00.000Z'),
    updatedAt: new Date('2026-05-04T12:00:00.000Z'),
  });

  for (let index = 0; index < 8; index += 1) {
    const escalation = await makeEscalation({
      caseNumber: `CASE-MGMT-POLICY-DRAFT-${index}`,
      actualOutcome: 'Payroll archive policy pagination regression',
    });
    await makeCandidate(escalation, {
      title: `Payroll archive policy pagination draft ${index}`,
      summary: 'Newer draft that must not crowd out trusted context.',
      symptom: 'Payroll archive policy pagination regression',
      rootCause: 'Draft root cause',
      exactFix: 'Draft fix',
      reusableOutcome: 'canonical',
      updatedAt: new Date(`2026-05-${10 + index}T12:00:00.000Z`),
    });
  }

  const context = await agent
    .get('/api/knowledge/agent-context')
    .query({
      query: 'payroll archive policy pagination regression',
      allowedUse: 'agent-response',
      includeLegacy: 'false',
      limit: 1,
    });

  assert.equal(context.status, 200);
  assert.equal(context.body.context.records.length, 1);
  assert.ok([`candidate:${trusted._id}`, `candidate:${edge._id}`].includes(context.body.context.records[0].id));

  const edgeOnly = await agent
    .get('/api/knowledge/agent-context')
    .query({
      query: 'payroll archive policy pagination regression',
      reusableOutcome: 'edge-case',
      allowedUse: 'agent-response',
      includeLegacy: 'false',
      limit: 10,
    });
  assert.equal(edgeOnly.status, 200);
  const edgeIds = edgeOnly.body.context.records.map((record) => record.id);
  assert.deepEqual(edgeIds, [`candidate:${edge._id}`]);

  const impossibleContext = await agent
    .get('/api/knowledge/agent-context')
    .query({
      query: 'payroll archive policy pagination regression',
      reviewStatus: 'draft',
      allowedUse: 'agent-response',
      includeLegacy: 'false',
      limit: 1,
    });
  assert.equal(impossibleContext.status, 200);
  assert.equal(impossibleContext.body.context.records.length, 0);
});

test('knowledge management routes store relationships, feedback, and ontology counts', async () => {
  const app = createApp();
  const agent = request(app);
  const sourceEscalation = await makeEscalation({ category: 'bank-feeds', caseNumber: 'CASE-MGMT-REL-A' });
  const targetEscalation = await makeEscalation({ category: 'bank-feeds', caseNumber: 'CASE-MGMT-REL-B' });
  const source = await makeCandidate(sourceEscalation, {
    title: 'Bank feed duplicate source',
    evidenceRefs: [{ type: 'case', label: 'Repeated bank feed evidence', strength: 0.8 }],
  });
  const target = await makeCandidate(targetEscalation, {
    title: 'Bank feed duplicate target',
    evidenceRefs: [{ type: 'case', label: 'Second repeated bank feed evidence', strength: 0.7 }],
  });

  const invalid = await agent
    .post(`/api/knowledge/records/candidate:${source._id}/relationships`)
    .set('x-knowledge-role', 'reviewer')
    .send({ targetRecordId: 'candidate:not-an-object-id', type: 'related' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, 'INVALID_RELATIONSHIP_TARGET');

  const related = await agent
    .post(`/api/knowledge/records/candidate:${source._id}/relationships`)
    .set('x-knowledge-role', 'reviewer')
    .set('x-knowledge-actor', 'reviewer-a')
    .send({
      targetRecordId: `candidate:${target._id}`,
      type: 'duplicate-of',
      status: 'confirmed',
      strength: 0.85,
      summary: 'Same bank feed duplicate pattern.',
    });
  assert.equal(related.status, 200);
  assert.equal(related.body.record.relationships[0].type, 'duplicate-of');
  assert.equal(related.body.record.relationships[0].targetRecordId, `candidate:${target._id}`);

  const feedback = await agent
    .post(`/api/knowledge/records/candidate:${source._id}/feedback`)
    .set('x-knowledge-role', 'reviewer')
    .set('x-knowledge-actor', 'reviewer-a')
    .send({ outcome: 'worked', source: 'manual-review', notes: 'Guidance matched another case.' });
  assert.equal(feedback.status, 200);
  assert.equal(feedback.body.record.outcomeFeedback[0].outcome, 'worked');

  const ontology = await agent.get('/api/knowledge/ontology/summary');
  assert.equal(ontology.status, 200);
  assert.equal(ontology.body.summary.relationshipCounts['duplicate-of'], 1);
  assert.equal(ontology.body.summary.feedbackCounts.worked, 1);
  assert.equal(ontology.body.summary.evidenceStrength.strong, 1);
});

test('knowledge export uses normalized redacted records', async () => {
  const app = createApp();
  const agent = request(app);
  const escalation = await makeEscalation({
    caseNumber: 'CASE-SECRET-123',
    coid: 'COID-SECRET-456',
  });
  const candidate = await makeCandidate(escalation, {
    reviewStatus: 'published',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
    title: 'Redacted export candidate',
    summary: 'Redaction should apply to exported evidence.',
    rootCause: 'The source identifiers are not needed for reuse.',
    exactFix: 'Use the normalized record.',
    publishedAt: new Date('2026-05-04T12:00:00.000Z'),
    publishedDocType: 'database',
  });

  const redacted = await agent
    .post(`/api/knowledge/records/candidate:${candidate._id}/redact`)
    .set('x-knowledge-role', 'admin')
    .send({ customerIdentifiersRedacted: true, fields: ['caseNumber', 'coid'] });
  assert.equal(redacted.status, 200);
  assert.equal(redacted.body.record.evidence[0].label, 'Case [redacted]');
  assert.equal(redacted.body.record.evidence[0].coid, '[redacted]');

  const json = await agent
    .get('/api/knowledge/export')
    .set('x-knowledge-role', 'reviewer')
    .query({ format: 'json', includeCandidates: 'true', includeLegacy: 'false' });
  assert.equal(json.status, 200);
  assert.equal(json.body.export.count, 1);
  assert.doesNotMatch(json.body.export.content, /CASE-SECRET-123/);
  assert.doesNotMatch(json.body.export.content, /COID-SECRET-456/);
  assert.match(json.body.export.content, /Case \[redacted\]/);

  const markdown = await agent
    .get('/api/knowledge/export')
    .set('x-knowledge-role', 'reviewer')
    .query({ format: 'markdown', includeCandidates: 'true', includeLegacy: 'false' });
  assert.equal(markdown.status, 200);
  assert.equal(markdown.body.export.count, 1);
  // Redaction masks body/free-text content on read — the raw title must not
  // appear in the markdown export (the old assertion here encoded the bug).
  assert.doesNotMatch(markdown.body.export.content, /Redacted export candidate/);
  assert.match(markdown.body.export.content, /# \[redacted\]/);
});

test('knowledge management writes are role gated for deployed defaults', async () => {
  const app = createApp();
  const agent = request(app);
  process.env.KNOWLEDGE_DEFAULT_ROLE = 'viewer';

  const escalation = await makeEscalation({ caseNumber: 'CASE-MGMT-ROLE' });
  const candidate = await makeCandidate(escalation);

  const denied = await agent
    .patch(`/api/knowledge/records/candidate:${candidate._id}`)
    .send({ reviewStatus: 'approved' });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'KNOWLEDGE_PERMISSION_DENIED');

  const allowed = await agent
    .patch(`/api/knowledge/records/candidate:${candidate._id}`)
    .set('x-knowledge-role', 'reviewer')
    .send({ reviewStatus: 'approved', publishTarget: 'category', reusableOutcome: 'canonical' });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.record.reviewStatus, 'approved');
});

test('production ignores spoofed knowledge role headers by default', async () => {
  const app = createApp();
  const agent = request(app);
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  process.env.KNOWLEDGE_DEFAULT_ROLE = 'viewer';
  try {
    const escalation = await makeEscalation({ caseNumber: 'CASE-MGMT-PROD-SPOOF' });
    const candidate = await makeCandidate(escalation);

    const denied = await agent
      .patch(`/api/knowledge/records/candidate:${candidate._id}`)
      .set('x-knowledge-role', 'admin')
      .set('x-knowledge-actor', 'spoofed-admin')
      .send({ reviewStatus: 'approved' });

    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'KNOWLEDGE_PERMISSION_DENIED');
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    delete process.env.KNOWLEDGE_DEFAULT_ROLE;
    delete process.env.KNOWLEDGE_TRUST_REQUEST_ROLE_HEADERS;
  }
});

test('persisted knowledgebase agent scans require reviewer permission', async () => {
  const app = createApp();
  const agent = request(app);
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  process.env.KNOWLEDGE_DEFAULT_ROLE = 'viewer';
  try {
    const denied = await agent
      .post('/api/knowledge/agent/scan')
      .set('x-knowledge-role', 'admin')
      .send({ dryRun: false });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, 'KNOWLEDGE_PERMISSION_DENIED');

    const dryRun = await agent
      .post('/api/knowledge/agent/scan')
      .send({ dryRun: true });
    assert.equal(dryRun.status, 200);
    assert.equal(dryRun.body.scan.dryRun, true);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    delete process.env.KNOWLEDGE_DEFAULT_ROLE;
    delete process.env.KNOWLEDGE_TRUST_REQUEST_ROLE_HEADERS;
  }
});

test('legacy escalation knowledge routes use production role gates', async () => {
  const app = createApp();
  const agent = request(app);
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  process.env.KNOWLEDGE_DEFAULT_ROLE = 'viewer';
  try {
    const patchEscalation = await makeEscalation({ caseNumber: 'CASE-MGMT-LEGACY-PATCH-DENY' });
    await makeCandidate(patchEscalation);

    const deniedPatch = await agent
      .patch(`/api/escalations/${patchEscalation._id}/knowledge`)
      .set('x-knowledge-role', 'admin')
      .send({ reviewStatus: 'approved' });
    assert.equal(deniedPatch.status, 403);
    assert.equal(deniedPatch.body.code, 'KNOWLEDGE_PERMISSION_DENIED');

    const publishEscalation = await makeEscalation({ caseNumber: 'CASE-MGMT-LEGACY-PUBLISH-DENY' });
    await makeCandidate(publishEscalation, {
      reviewStatus: 'approved',
      publishTarget: 'category',
      reusableOutcome: 'canonical',
      title: 'Legacy denied publish',
      summary: 'Approved candidate should still require publisher permission.',
      symptom: 'Legacy route publish denial',
      rootCause: 'Production role headers are not trusted by default.',
      exactFix: 'Use auth-backed publisher permission.',
    });

    const deniedPublish = await agent
      .post(`/api/escalations/${publishEscalation._id}/knowledge/publish`)
      .set('x-knowledge-role', 'publisher')
      .send({ exportMarkdown: false });
    assert.equal(deniedPublish.status, 403);
    assert.equal(deniedPublish.body.code, 'KNOWLEDGE_PERMISSION_DENIED');

    const publishedEscalation = await makeEscalation({ caseNumber: 'CASE-MGMT-LEGACY-IDEMPOTENT-DENY' });
    await makeCandidate(publishedEscalation, {
      reviewStatus: 'published',
      publishTarget: 'category',
      reusableOutcome: 'canonical',
      title: 'Legacy idempotent denied publish',
      summary: 'Already-published state should still require permission on publish endpoint.',
      symptom: 'Legacy route idempotent publish denial',
      rootCause: 'Published state should not be probed through publish.',
      exactFix: 'Require publish permission before idempotent response.',
      publishedAt: new Date('2026-05-03T12:00:00.000Z'),
      publishedDocType: 'database',
    });
    const deniedIdempotent = await agent
      .post(`/api/escalations/${publishedEscalation._id}/knowledge/publish`)
      .set('x-knowledge-role', 'publisher')
      .send({ exportMarkdown: false });
    assert.equal(deniedIdempotent.status, 403);
    assert.equal(deniedIdempotent.body.code, 'KNOWLEDGE_PERMISSION_DENIED');
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    delete process.env.KNOWLEDGE_DEFAULT_ROLE;
    delete process.env.KNOWLEDGE_TRUST_REQUEST_ROLE_HEADERS;
  }
});

test('legacy escalation knowledge publish can run database-only for web deployments', async () => {
  const app = createApp();
  const agent = request(app);
  const escalation = await makeEscalation({ caseNumber: 'CASE-MGMT-LEGACY-DB' });
  await makeCandidate(escalation, {
    reviewStatus: 'approved',
    publishTarget: 'category',
    reusableOutcome: 'canonical',
    title: 'Legacy route database publish',
    summary: 'Existing escalation route can publish without markdown writes.',
    symptom: 'Deployment should not depend on local markdown writes.',
    rootCause: 'The database is the deployed source of truth.',
    exactFix: 'Publish the candidate as trusted database knowledge.',
    confidence: 0.9,
  });

  const res = await agent
    .post(`/api/escalations/${escalation._id}/knowledge/publish`)
    .set('x-knowledge-role', 'publisher')
    .send({ exportMarkdown: false });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.published, true);
  assert.equal(res.body.publish, null);
  assert.equal(res.body.publishMode, 'database');
  assert.equal(res.body.knowledge.reviewStatus, 'published');
  assert.equal(res.body.knowledge.publishedDocType, 'database');
  assert.equal(res.body.knowledge.publishedDocPath, '');
});

test('publish kill-switch forces markdown export off for the knowledge records route', async () => {
  // Regression: POST /api/knowledge/records/:recordId/publish previously ignored
  // KNOWLEDGE_MARKDOWN_PUBLISH_DISABLED, so { exportMarkdown: true } still wrote
  // markdown into playbook/ while the legacy escalations route enforced the flag.
  // The guard now lives in publishKnowledgeRecord so every caller is covered.
  const app = createApp();
  const agent = request(app);
  process.env.KNOWLEDGE_MARKDOWN_PUBLISH_DISABLED = '1';
  try {
    const escalation = await makeEscalation({ caseNumber: 'CASE-MGMT-KILL-SWITCH' });
    const candidate = await makeCandidate(escalation, {
      reviewStatus: 'approved',
      publishTarget: 'category',
      reusableOutcome: 'canonical',
      title: 'Kill-switch markdown publish',
      summary: 'Markdown export must stay off while the kill-switch is set.',
      symptom: 'Publish requested with exportMarkdown true while disabled.',
      rootCause: 'The env kill-switch must override the caller payload.',
      exactFix: 'Publish the candidate as trusted database knowledge.',
      confidence: 0.9,
    });

    const publish = await agent
      .post(`/api/knowledge/records/candidate:${candidate._id}/publish`)
      .set('x-knowledge-role', 'publisher')
      .set('x-knowledge-actor', 'publisher-a')
      .send({ exportMarkdown: true });

    assert.equal(publish.status, 200);
    assert.equal(publish.body.ok, true);
    assert.equal(publish.body.published, true);
    // The markdown promotion path must not run: no export payload, no doc path,
    // and the audit trail records a database-only publish.
    assert.equal(publish.body.export, null);
    assert.equal(publish.body.record.lineage.publishedDocType, 'database');
    assert.equal(publish.body.record.lineage.publishedDocPath, '');
    assert.equal(publish.body.record.auditEvents[0].action, 'record.publish.database');
    assert.equal(publish.body.record.auditEvents[0].metadata.exportMarkdown, false);
  } finally {
    delete process.env.KNOWLEDGE_MARKDOWN_PUBLISH_DISABLED;
  }
});

test('agent-chat applies a kb.updateDraft edit and returns appliedChanges with prior values', async () => {
  // The KB sidebar chat now runs through the tool loop. We stub the chat so the
  // model emits an ACTION line that calls kb.updateDraft on turn 1, then a plain
  // final answer on turn 2. The route must surface appliedChanges (with prior
  // values) and the field must be saved — proving the agent can actually edit.
  const previousStubbed = process.env.HARNESS_PROVIDERS_STUBBED;
  process.env.HARNESS_PROVIDERS_STUBBED = '1';
  let turn = 0;
  registerProviderStub('claude', 'chat', ({ onDone }) => {
    turn += 1;
    if (turn === 1) {
      onDone(
        'I will fill in the customer goal.\nACTION: {"tool": "kb.updateDraft", "params": {"fields": {"customerGoal": "Confirm the archived employer payroll summary after filing."}, "mode": "explicit"}}',
        { model: 'claude-test', usageAvailable: true }
      );
    } else {
      onDone('I updated the Customer Goal field for you.', { model: 'claude-test', usageAvailable: true });
    }
    return () => {};
  });

  try {
    const app = createApp();
    const agent = request(app);
    const escalation = await makeEscalation({ caseNumber: 'CASE-MGMT-AGENT-EDIT' });
    const candidate = await makeCandidate(escalation, { customerGoal: '' });

    const chat = await agent
      .post(`/api/knowledge/records/candidate:${candidate._id}/agent-chat`)
      .send({ message: 'Please fill in the customer goal.' });

    assert.equal(chat.status, 200);
    assert.equal(chat.body.ok, true);
    assert.ok(Array.isArray(chat.body.appliedChanges));
    assert.equal(chat.body.appliedChanges.length, 1);
    assert.equal(chat.body.appliedChanges[0].field, 'customerGoal');
    assert.equal(chat.body.appliedChanges[0].prior, ''); // prior value for undo
    assert.match(chat.body.appliedChanges[0].next, /archived employer payroll summary/i);

    const saved = await KnowledgeCandidate.findById(candidate._id).lean();
    assert.match(saved.customerGoal, /archived employer payroll summary/i);
    assert.equal(saved.reviewStatus, 'draft'); // never approved by the agent
    // The conversation thread is still persisted alongside the edit.
    assert.equal(saved.kbAgentMessages.length, 2);

    // Undo: PATCH the prior value back (what the client's per-field Undo does).
    const undo = await agent
      .patch(`/api/knowledge/records/candidate:${candidate._id}`)
      .send({ customerGoal: chat.body.appliedChanges[0].prior });
    assert.equal(undo.status, 200);
    const reverted = await KnowledgeCandidate.findById(candidate._id).lean();
    assert.equal(reverted.customerGoal, '');
  } finally {
    clearProviderStubs();
    if (previousStubbed === undefined) {
      delete process.env.HARNESS_PROVIDERS_STUBBED;
    } else {
      process.env.HARNESS_PROVIDERS_STUBBED = previousStubbed;
    }
  }
});
