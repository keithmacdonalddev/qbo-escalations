const express = require('express');
const {
  getKnowledgeRecordById,
  getKnowledgeSummary,
  listKnowledgeRecords,
  parseBoolean,
  parseLimit,
  parseOffset,
  searchKnowledge,
} = require('../services/knowledgebase-service');
const {
  buildOperationalIntelligenceContext,
} = require('../services/operational-intelligence-service');
const {
  getKnowledgebaseAgentStatus,
  runKnowledgebaseDraftHarness,
  scanKnowledgebaseAgent,
} = require('../services/knowledgebase-agent-service');
const {
  addKnowledgeRelationship,
  assertKnowledgePermission,
  deprecateKnowledgeRecord,
  exportKnowledgeRecords,
  getKnowledgeOntologySummary,
  publishKnowledgeRecord,
  redactKnowledgeRecord,
  recordKnowledgeFeedback,
  resolveKnowledgeActor,
  updateKnowledgeRecord,
} = require('../services/knowledgebase-management-service');
const {
  answerKnowledgeBaseAgentQuestion,
  getKnowledgeBaseAgentRecordContext,
} = require('../services/knowledgebase-agent-context-service');

const router = express.Router();

function readCommonQuery(req, defaults = {}) {
  return {
    query: req.query.query || req.query.q || '',
    reviewStatus: req.query.reviewStatus || '',
    category: req.query.category || '',
    reusableOutcome: req.query.reusableOutcome || '',
    trustState: req.query.trustState || '',
    allowedUse: req.query.allowedUse || '',
    sort: req.query.sort || defaults.sort || '-updatedAt',
    limit: parseLimit(req.query.limit, defaults.limit || 50, defaults.maxLimit || 200),
    offset: parseOffset(req.query.offset),
    includeLegacy: parseBoolean(req.query.includeLegacy, defaults.includeLegacy ?? true),
    includeCandidates: parseBoolean(req.query.includeCandidates, defaults.includeCandidates ?? true),
  };
}

function knowledgeError(res, err, fallbackCode = 'KNOWLEDGE_ERROR') {
  const status = err?.status || 500;
  return res.status(status).json({
    ok: false,
    code: err?.code || fallbackCode,
    error: status >= 500 ? 'Knowledgebase operation failed' : (err?.message || 'Knowledgebase operation failed'),
  });
}

// GET /api/knowledge/summary
router.get('/summary', async (req, res) => {
  const summary = await getKnowledgeSummary();
  res.json({
    ok: true,
    summary,
    generatedAt: new Date().toISOString(),
  });
});

// GET /api/knowledge/ontology/summary
router.get('/ontology/summary', async (req, res) => {
  const summary = await getKnowledgeOntologySummary();
  res.json({
    ok: true,
    summary,
    generatedAt: new Date().toISOString(),
  });
});

// GET /api/knowledge/export?format=json|markdown
router.get('/export', async (req, res) => {
  try {
    const actor = resolveKnowledgeActor(req);
    const result = await exportKnowledgeRecords({
      ...readCommonQuery(req, {
        includeLegacy: false,
        includeCandidates: true,
        limit: 500,
        maxLimit: 1000,
      }),
      format: req.query.format || 'json',
    }, actor);
    if (parseBoolean(req.query.download, false)) {
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return res.send(result.content);
    }
    return res.json({
      ok: true,
      export: result,
    });
  } catch (err) {
    return knowledgeError(res, err, 'KNOWLEDGE_EXPORT_FAILED');
  }
});

// GET /api/knowledge/agent/status
router.get('/agent/status', async (req, res) => {
  const status = await getKnowledgebaseAgentStatus();
  res.json({
    ok: true,
    status,
    generatedAt: new Date().toISOString(),
  });
});

// POST /api/knowledge/agent/scan
router.post('/agent/scan', async (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const options = {
      limit: payload.limit ?? req.query.limit,
      staleTrustedDays: payload.staleTrustedDays ?? req.query.staleTrustedDays,
      dryRun: parseBoolean(payload.dryRun ?? req.query.dryRun, false),
      persistAttention: parseBoolean(payload.persistAttention ?? req.query.persistAttention, true),
      persistActivity: parseBoolean(payload.persistActivity ?? req.query.persistActivity, true),
    };
    const willPersist = !options.dryRun && (options.persistAttention || options.persistActivity);
    if (willPersist) {
      assertKnowledgePermission(resolveKnowledgeActor(req), 'review');
    }
    const scan = await scanKnowledgebaseAgent(options);
    return res.json({
      ok: true,
      scan,
    });
  } catch (err) {
    return knowledgeError(res, err, 'KNOWLEDGE_AGENT_SCAN_FAILED');
  }
});

// POST /api/knowledge/agent/harness/run
router.post('/agent/harness/run', async (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const harness = await runKnowledgebaseDraftHarness({
      escalationId: payload.escalationId || '',
    });
    return res.json({ ok: true, harness });
  } catch (err) {
    return knowledgeError(res, err, 'KNOWLEDGE_AGENT_HARNESS_FAILED');
  }
});

// GET /api/knowledge/records
router.get('/records', async (req, res) => {
  const options = readCommonQuery(req, {
    includeLegacy: false,
    includeCandidates: true,
    limit: 50,
    maxLimit: 200,
  });
  const result = await listKnowledgeRecords(options);
  res.json({
    ok: true,
    ...result,
  });
});

// GET /api/knowledge/records/:recordId
router.get('/records/:recordId', async (req, res) => {
  const record = await getKnowledgeRecordById(req.params.recordId);
  if (!record) {
    return res.status(404).json({ ok: false, code: 'KNOWLEDGE_RECORD_NOT_FOUND', error: 'Knowledge record not found' });
  }
  return res.json({
    ok: true,
    record,
  });
});

// GET /api/knowledge/records/:recordId/agent-context
router.get('/records/:recordId/agent-context', async (req, res) => {
  try {
    const result = await getKnowledgeBaseAgentRecordContext(req.params.recordId);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return knowledgeError(res, err, 'KNOWLEDGE_AGENT_CONTEXT_FAILED');
  }
});

// POST /api/knowledge/records/:recordId/agent-chat
router.post('/records/:recordId/agent-chat', async (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const result = await answerKnowledgeBaseAgentQuestion(req.params.recordId, payload.message);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return knowledgeError(res, err, 'KNOWLEDGE_AGENT_CHAT_FAILED');
  }
});

// PATCH /api/knowledge/records/:recordId
router.patch('/records/:recordId', async (req, res) => {
  try {
    const result = await updateKnowledgeRecord(req.params.recordId, req.body || {}, resolveKnowledgeActor(req));
    return res.json({ ok: true, ...result });
  } catch (err) {
    return knowledgeError(res, err, 'KNOWLEDGE_UPDATE_FAILED');
  }
});

// POST /api/knowledge/records/:recordId/publish
router.post('/records/:recordId/publish', async (req, res) => {
  try {
    const result = await publishKnowledgeRecord(req.params.recordId, req.body || {}, resolveKnowledgeActor(req));
    return res.json({ ok: true, ...result });
  } catch (err) {
    return knowledgeError(res, err, 'KNOWLEDGE_PUBLISH_FAILED');
  }
});

// POST /api/knowledge/records/:recordId/deprecate
router.post('/records/:recordId/deprecate', async (req, res) => {
  try {
    const result = await deprecateKnowledgeRecord(req.params.recordId, req.body || {}, resolveKnowledgeActor(req));
    return res.json({ ok: true, ...result });
  } catch (err) {
    return knowledgeError(res, err, 'KNOWLEDGE_DEPRECATE_FAILED');
  }
});

// POST /api/knowledge/records/:recordId/redact
router.post('/records/:recordId/redact', async (req, res) => {
  try {
    const record = await redactKnowledgeRecord(req.params.recordId, req.body || {}, resolveKnowledgeActor(req));
    return res.json({ ok: true, record });
  } catch (err) {
    return knowledgeError(res, err, 'KNOWLEDGE_REDACT_FAILED');
  }
});

// POST /api/knowledge/records/:recordId/relationships
router.post('/records/:recordId/relationships', async (req, res) => {
  try {
    const record = await addKnowledgeRelationship(req.params.recordId, req.body || {}, resolveKnowledgeActor(req));
    return res.json({ ok: true, record });
  } catch (err) {
    return knowledgeError(res, err, 'KNOWLEDGE_RELATIONSHIP_FAILED');
  }
});

// POST /api/knowledge/records/:recordId/feedback
router.post('/records/:recordId/feedback', async (req, res) => {
  try {
    const record = await recordKnowledgeFeedback(req.params.recordId, req.body || {}, resolveKnowledgeActor(req));
    return res.json({ ok: true, record });
  } catch (err) {
    return knowledgeError(res, err, 'KNOWLEDGE_FEEDBACK_FAILED');
  }
});

// GET /api/knowledge/search?q=...
router.get('/search', async (req, res) => {
  const options = readCommonQuery(req, {
    includeLegacy: true,
    includeCandidates: true,
    limit: 10,
    maxLimit: 50,
  });
  const result = await searchKnowledge(options);
  res.json({
    ok: true,
    ...result,
  });
});

// GET /api/knowledge/agent-context?q=...&allowedUse=triage
router.get('/agent-context', async (req, res) => {
  const options = readCommonQuery(req, {
    includeLegacy: true,
    includeCandidates: false,
    limit: 6,
    maxLimit: 20,
  });
  options.allowedUse = options.allowedUse || 'agent-response';

  const context = await buildOperationalIntelligenceContext(options);
  res.json({
    ok: true,
    context,
  });
});

module.exports = router;
