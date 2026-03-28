const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { listProviderHealth } = require('./services/provider-health');
const { registerRequestRuntime, getRequestRuntimeHealth } = require('./services/request-runtime');
const { getAiRuntimeHealth } = require('./services/ai-runtime');
const { registerDomainRequestObserver } = require('./services/domain-health');
const requestId = require('./middleware/request-id');
const responseTimeout = require('./middleware/response-timeout');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const PROTOTYPES_DIR = path.join(__dirname, '..', '..', 'prototypes');
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function getAllowedCorsOrigins() {
  const raw = (process.env.CORS_ALLOWED_ORIGINS || '').trim();
  if (!raw) return null;
  return new Set(
    raw.split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function isLoopbackOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return true;
  if (allowedOrigins && allowedOrigins.size > 0) return allowedOrigins.has(origin);
  return isLoopbackOrigin(origin);
}

function buildCorsOptions() {
  const allowedOrigins = getAllowedCorsOrigins();
  return {
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin, allowedOrigins));
    },
  };
}

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

  app.use((err, req, res, next) => {
    console.error(`[${req.method} ${req.path}]`, err.message || err);

    // Report to server error pipeline for dev agent visibility
    const { reportServerError } = require('./lib/server-error-pipeline');
    const status = err.status || 500;
    reportServerError({
      message: `Express error: ${err.message || 'Unknown'}`,
      detail: `${req.method} ${req.path} - ${err.message || 'Unknown error'}`,
      stack: err.stack || '',
      source: `routes${req.path}`,
      category: status >= 500 ? 'runtime-error' : 'other',
      severity: status >= 500 ? 'error' : 'warning',
    });

    if (res.headersSent) return next(err);
    res.status(status).json({ ok: false, code: 'INTERNAL', error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp, UPLOADS_DIR };
