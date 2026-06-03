const express = require('express');
const {
  buildAgentKnowledgeContext,
  getKnowledgeSummary,
  listKnowledgeRecords,
  parseBoolean,
  parseLimit,
  parseOffset,
  searchKnowledge,
} = require('../services/knowledgebase-service');
const {
  getKnowledgebaseAgentStatus,
  scanKnowledgebaseAgent,
} = require('../services/knowledgebase-agent-service');

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

// GET /api/knowledge/summary
router.get('/summary', async (req, res) => {
  const summary = await getKnowledgeSummary();
  res.json({
    ok: true,
    summary,
    generatedAt: new Date().toISOString(),
  });
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
  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const options = {
    limit: payload.limit ?? req.query.limit,
    staleTrustedDays: payload.staleTrustedDays ?? req.query.staleTrustedDays,
    dryRun: parseBoolean(payload.dryRun ?? req.query.dryRun, false),
    persistAttention: parseBoolean(payload.persistAttention ?? req.query.persistAttention, true),
    persistActivity: parseBoolean(payload.persistActivity ?? req.query.persistActivity, true),
  };
  const scan = await scanKnowledgebaseAgent(options);
  res.json({
    ok: true,
    scan,
  });
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

  const context = await buildAgentKnowledgeContext(options);
  res.json({
    ok: true,
    context,
  });
});

module.exports = router;
