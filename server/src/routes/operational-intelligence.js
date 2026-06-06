const express = require('express');
const {
  buildOperationalIntelligenceContext,
  getOperationalIntelligenceForRecord,
  getOperationalIntelligenceSummary,
  listOperationalClaims,
} = require('../services/operational-intelligence-service');
const {
  parseBoolean,
  parseLimit,
  parseOffset,
} = require('../services/knowledgebase-service');

const router = express.Router();

function intelligenceError(res, err, fallbackCode = 'OPERATIONAL_INTELLIGENCE_FAILED') {
  const status = err?.status || 500;
  return res.status(status).json({
    ok: false,
    code: err?.code || fallbackCode,
    error: status >= 500 ? 'Operational intelligence operation failed' : (err?.message || 'Operational intelligence operation failed'),
  });
}

function readContextQuery(req, defaults = {}) {
  return {
    query: req.query.query || req.query.q || '',
    allowedUse: req.query.allowedUse || defaults.allowedUse || 'agent-response',
    includeLegacy: parseBoolean(req.query.includeLegacy, defaults.includeLegacy ?? true),
    includeCandidates: parseBoolean(req.query.includeCandidates, defaults.includeCandidates ?? false),
    includeDeprecated: parseBoolean(req.query.includeDeprecated, defaults.includeDeprecated ?? false),
    limit: parseLimit(req.query.limit, defaults.limit || 6, defaults.maxLimit || 20),
    offset: parseOffset(req.query.offset),
  };
}

// GET /api/operational-intelligence/summary
router.get('/summary', async (req, res) => {
  try {
    const summary = await getOperationalIntelligenceSummary();
    return res.json({
      ok: true,
      summary,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return intelligenceError(res, err, 'OPERATIONAL_INTELLIGENCE_SUMMARY_FAILED');
  }
});

// GET /api/operational-intelligence/claims?q=...&allowedUse=agent-response
router.get('/claims', async (req, res) => {
  try {
    const claims = await listOperationalClaims(readContextQuery(req, {
      includeCandidates: false,
      limit: 10,
      maxLimit: 50,
    }));
    return res.json({
      ok: true,
      claims,
      count: claims.length,
    });
  } catch (err) {
    return intelligenceError(res, err, 'OPERATIONAL_CLAIMS_FAILED');
  }
});

// GET /api/operational-intelligence/context?q=...&allowedUse=triage
router.get('/context', async (req, res) => {
  try {
    const context = await buildOperationalIntelligenceContext(readContextQuery(req, {
      includeLegacy: true,
      includeCandidates: false,
      limit: 6,
      maxLimit: 20,
    }));
    return res.json({
      ok: true,
      context,
    });
  } catch (err) {
    return intelligenceError(res, err, 'OPERATIONAL_CONTEXT_FAILED');
  }
});

// GET /api/operational-intelligence/records/:recordId
router.get('/records/:recordId', async (req, res) => {
  try {
    const intelligence = await getOperationalIntelligenceForRecord(req.params.recordId, {
      syncIfMissing: parseBoolean(req.query.syncIfMissing, true),
    });
    return res.json({
      ok: true,
      intelligence,
    });
  } catch (err) {
    return intelligenceError(res, err, 'OPERATIONAL_RECORD_FAILED');
  }
});

module.exports = router;
