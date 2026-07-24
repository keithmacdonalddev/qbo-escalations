const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { buildCorsOptions } = require('./lib/origin-policy');
const { normalizeApiError } = require('./lib/api-errors');
const { listProviderHealth } = require('./services/provider-health');
const { registerRequestRuntime, getRequestRuntimeHealth } = require('./services/request-runtime');
const { getAiRuntimeHealth } = require('./services/ai-runtime');
const { registerDomainRequestObserver } = require('./services/domain-health');
const { watchAgentPromptVersions } = require('./lib/agent-prompt-store');
const requestId = require('./middleware/request-id');
const responseTimeout = require('./middleware/response-timeout');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const PROTOTYPES_DIR = path.join(__dirname, '..', '..', 'prototypes');
const PIPELINE_TEST_IMAGE_FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'pipeline-tests', 'image-parser');

function createApp() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  if (process.env.NODE_ENV !== 'test') {
    try {
      watchAgentPromptVersions();
    } catch (err) {
      console.warn('[agent-prompts] Prompt version watcher failed:', err.message || err);
    }
  }

  const app = express();
  if (process.env.QBO_TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(cors(buildCorsOptions()));
  app.use(requestId);
  app.use(registerRequestRuntime);
  app.use(registerDomainRequestObserver);
  app.use(responseTimeout(30_000));
  // Body limit must accommodate base64 image uploads. The chat image caps allow
  // up to ~20MB/image and ~30MB total of *decoded* bytes; base64 inflates that
  // by ~33%, so the JSON payload can approach ~40MB plus overhead. 50MB matches
  // the documented limit and is the smallest value that covers those caps.
  app.use(express.json({ limit: '50mb' }));
  app.use('/uploads', express.static(UPLOADS_DIR));
  app.use('/prototypes', express.static(PROTOTYPES_DIR));
  app.use('/api/pipeline-tests/image-fixtures', express.static(PIPELINE_TEST_IMAGE_FIXTURES_DIR));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.get('/api/runtime/health', (req, res) => {
    res.json({
      ok: true,
      requests: getRequestRuntimeHealth(),
      ai: getAiRuntimeHealth(),
      checkedAt: new Date().toISOString(),
      server: {
        uptime: Math.floor(process.uptime()),
        pid: process.pid,
        nodeVersion: process.version,
      },
    });
  });

  app.get('/api/health/providers', (req, res) => {
    res.json({
      ok: true,
      providers: listProviderHealth(),
      updatedAt: new Date().toISOString(),
    });
  });

  const { chatRouter, conversationsRouter } = require('./routes/chat/index');
  app.use('/api/chat', chatRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/escalations', require('./routes/escalations'));
  app.use('/api/knowledge', require('./routes/knowledge'));
  app.use('/api/operational-intelligence', require('./routes/operational-intelligence'));
  app.use('/api/playbook', require('./routes/playbook'));
  app.use('/api/agent-prompts', require('./routes/agent-prompts'));
  app.use('/api/agent-identities', require('./routes/agent-identities'));
  app.use('/api/templates', require('./routes/templates'));
  app.use('/api/analytics', require('./routes/analytics'));
  app.use('/api/copilot', require('./routes/copilot'));
  app.use('/api/usage', require('./routes/usage'));
  app.use('/api/traces', require('./routes/traces'));
  app.use('/api/provider-packages', require('./routes/provider-packages'));
  app.use('/api/agents', require('./routes/agents'));
  app.use('/api/gmail', require('./routes/gmail'));
  app.use('/api/calendar', require('./routes/calendar'));
  app.use('/api/workspace', require('./routes/workspace/index'));
  app.use('/api/investigations', require('./routes/investigations'));
  app.use('/api/preferences', require('./routes/preferences'));
  app.use('/api/ai-management', require('./routes/ai-management'));
  app.use('/api/image-parser', require('./routes/image-parser'));
  app.use('/api/triage', require('./routes/triage'));
  app.use('/api/pipeline-tests', require('./routes/pipeline-tests'));
  app.use('/api/triage-tests', require('./routes/triage-tests'));
  app.use('/api/live-call-assist', require('./routes/live-call-assist'));
  app.use('/api/test-runner', require('./routes/test-runner'));
  app.use('/api/rooms', require('./routes/room'));
  app.use('/api/ticket-snitch', require('./routes/ticket-snitch'));

  // Catch-all for unmatched /api routes. Without this, an unknown /api path falls
  // through to Express's default finalizer and returns an HTML 404, which breaks
  // clients that call res.json() and violates the { ok, code, error } contract.
  // Scoped to /api so non-API paths (static uploads/prototypes, SPA assets) are
  // unaffected. Placed AFTER all /api route registrations (so real routes win)
  // and BEFORE the 4-arg error handler (so this is not treated as an error).
  app.use('/api', (req, res) => {
    res.status(404).json({
      ok: false,
      code: 'NOT_FOUND',
      error: 'Route not found',
    });
  });

  app.use((err, req, res, next) => {
    console.error(`[${req.method} ${req.path}]`, err.message || err);
    if (err?.stack) {
      console.error(err.stack);
    }

    // Map oversized request bodies (express.json / body-parser) to the standard
    // { ok:false, code, error } shape instead of a generic 500. body-parser sets
    // err.type to 'entity.too.large' and the status to 413.
    if (err && (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413)) {
      if (res.headersSent) return next(err);
      return res.status(413).json({
        ok: false,
        code: 'PAYLOAD_TOO_LARGE',
        error: 'Request body is too large. Reduce the image or attachment size and try again.',
      });
    }

    // Report to server error pipeline for dev agent visibility
    const { reportServerError } = require('./lib/server-error-pipeline');
    const normalized = normalizeApiError(err, 'INTERNAL', 'Internal server error');
    const status = normalized.status || 500;
    reportServerError({
      message: `Express error: ${normalized.message || 'Unknown'}`,
      detail: `${req.method} ${req.path} - ${normalized.message || 'Unknown error'}`,
      stack: err?.stack || '',
      source: `routes${req.path}`,
      category: status >= 500 ? 'runtime-error' : 'other',
      severity: status >= 500 ? 'error' : 'warning',
    });

    if (res.headersSent) return next(err);
    const isServerError = status >= 500;
    const payload = {
      ok: false,
      code: normalized.code || 'INTERNAL',
      error: isServerError ? 'Internal server error' : normalized.message,
    };
    if (normalized.detail) {
      payload.detail = normalized.detail;
    } else if (!isServerError && normalized.message && normalized.message !== payload.error) {
      payload.detail = normalized.message;
    }
    res.status(status).json(payload);
  });

  return app;
}

module.exports = { createApp, UPLOADS_DIR };
