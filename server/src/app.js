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
const requestId = require('./middleware/request-id');
const responseTimeout = require('./middleware/response-timeout');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const PROTOTYPES_DIR = path.join(__dirname, '..', '..', 'prototypes');

function createApp() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  const app = express();
  app.use(cors(buildCorsOptions()));
  app.use(requestId);
  app.use(registerRequestRuntime);
  app.use(registerDomainRequestObserver);
  app.use(responseTimeout(30_000));
  app.use(express.json({ limit: '12mb' }));
  app.use('/uploads', express.static(UPLOADS_DIR));
  app.use('/prototypes', express.static(PROTOTYPES_DIR));

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
  app.use('/api/playbook', require('./routes/playbook'));
  app.use('/api/agent-prompts', require('./routes/agent-prompts'));
  app.use('/api/agent-identities', require('./routes/agent-identities'));
  app.use('/api/templates', require('./routes/templates'));
  app.use('/api/analytics', require('./routes/analytics'));
  app.use('/api/copilot', require('./routes/copilot'));
  app.use('/api/usage', require('./routes/usage'));
  app.use('/api/traces', require('./routes/traces'));
  app.use('/api/agents', require('./routes/agents'));
  app.use('/api/gmail', require('./routes/gmail'));
  app.use('/api/calendar', require('./routes/calendar'));
  app.use('/api/workspace', require('./routes/workspace/index'));
  app.use('/api/investigations', require('./routes/investigations'));
  app.use('/api/preferences', require('./routes/preferences'));
  app.use('/api/image-parser', require('./routes/image-parser'));
  app.use('/api/test-runner', require('./routes/test-runner'));
  app.use('/api/rooms', require('./routes/room'));

  app.use((err, req, res, next) => {
    console.error(`[${req.method} ${req.path}]`, err.message || err);
    if (err?.stack) {
      console.error(err.stack);
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
