const crypto = require('crypto');
const express = require('express');
const {
  attachEvidence,
  checkConnection,
  commentOnWork,
  getConnectorConfig,
  getWork,
  reportWork,
  transitionWork,
  updateWork,
} = require('../services/ticket-snitch-client');
const { createRateLimiter } = require('../middleware/rate-limit');

const router = express.Router();
const TYPES = new Set(['problem_report', 'feature_request', 'improvement', 'task', 'maintenance', 'incident', 'idea', 'decision', 'question', 'agent_discovered_problem']);
const PRIORITIES = new Set(['none', 'low', 'medium', 'high', 'urgent']);
const SEVERITIES = new Set(['none', 'minor', 'moderate', 'major', 'critical']);

function requireReportProxySecret(req, res, next) {
  const expected = String(process.env.TICKET_SNITCH_REPORT_PROXY_SECRET || '');
  if (expected.length < 32) return res.status(503).json({ ok: false, code: 'TICKET_SNITCH_REPORT_PROXY_DISABLED', error: 'The Ticket Snitch report proxy is disabled.' });
  const provided = String(req.headers['x-ticket-snitch-proxy-secret'] || '');
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return res.status(401).json({ ok: false, code: 'TICKET_SNITCH_REPORT_PROXY_UNAUTHORIZED', error: 'This report source is not authorized.' });
  }
  return next();
}

function connectorError(res, error, requestId) {
  return res.status(error.status || 502).json({
    ok: false,
    code: error.code || 'TICKET_SNITCH_REQUEST_FAILED',
    error: error.message,
    requestId: error.requestId || requestId,
  });
}

router.use(requireReportProxySecret);

router.get('/status', async (req, res) => {
  const config = getConnectorConfig();
  if (!config.configured) return res.json({ ok: true, configured: false, connected: false });
  try {
    const result = await checkConnection(req.requestId);
    return res.json({ ok: true, configured: true, connected: true, project: { id: result.data.id, key: result.data.key, name: result.data.name }, requestId: req.requestId });
  } catch (error) {
    return connectorError(res, error, req.requestId);
  }
});

const mutationRateLimit = createRateLimiter({ name: 'ticket-snitch-mutation', limit: 60 });

router.post('/report', mutationRateLimit, async (req, res) => {
  const input = req.body || {};
  const type = String(input.type || 'problem_report');
  const title = String(input.title || '').trim();
  const originalReport = String(input.originalReport || '').trim();
  if (!TYPES.has(type)) return res.status(400).json({ ok: false, code: 'INVALID_REPORT_TYPE', error: 'Choose a supported report type.' });
  if (title.length < 3 || title.length > 240) return res.status(400).json({ ok: false, code: 'INVALID_REPORT_TITLE', error: 'Report title must contain 3 to 240 characters.' });
  if (!originalReport || originalReport.length > 40_000) return res.status(400).json({ ok: false, code: 'INVALID_ORIGINAL_REPORT', error: 'Original report is required and may contain at most 40,000 characters.' });
  const priority = PRIORITIES.has(input.priority) ? input.priority : 'none';
  const severity = SEVERITIES.has(input.severity) ? input.severity : 'none';
  try {
    const result = await reportWork({ ...input, type, title, originalReport, priority, severity }, input.context || {}, req.requestId);
    return res.status(result.idempotentReplay ? 200 : 201).json({ ok: true, ticket: { id: result.data.id, key: result.data.key }, idempotentReplay: Boolean(result.idempotentReplay), requestId: req.requestId });
  } catch (error) {
    return connectorError(res, error, req.requestId);
  }
});

router.get('/work/:identifier', async (req, res) => {
  try {
    const result = await getWork(req.params.identifier, req.requestId);
    return res.json({ ok: true, data: result.data, requestId: req.requestId });
  } catch (error) {
    return connectorError(res, error, req.requestId);
  }
});

router.patch('/work/:identifier', mutationRateLimit, async (req, res) => {
  try {
    const result = await updateWork(req.params.identifier, req.body || {}, req.requestId);
    return res.json({ ok: true, data: result.data, requestId: req.requestId });
  } catch (error) {
    return connectorError(res, error, req.requestId);
  }
});

router.post('/work/:identifier/comments', mutationRateLimit, async (req, res) => {
  try {
    const result = await commentOnWork(req.params.identifier, req.body || {}, req.requestId);
    return res.status(201).json({ ok: true, data: result.data, requestId: req.requestId });
  } catch (error) {
    return connectorError(res, error, req.requestId);
  }
});

router.post('/work/:identifier/transitions', mutationRateLimit, async (req, res) => {
  try {
    const result = await transitionWork(req.params.identifier, req.body || {}, req.requestId);
    return res.json({ ok: true, data: result.data, requestId: req.requestId });
  } catch (error) {
    return connectorError(res, error, req.requestId);
  }
});

router.post('/work/:identifier/evidence', mutationRateLimit, async (req, res) => {
  try {
    const result = await attachEvidence(req.params.identifier, req.body || {}, req.requestId);
    return res.status(201).json({ ok: true, data: result.data, requestId: req.requestId });
  } catch (error) {
    return connectorError(res, error, req.requestId);
  }
});

module.exports = router;
module.exports.requireReportProxySecret = requireReportProxySecret;
