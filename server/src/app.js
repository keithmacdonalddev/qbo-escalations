const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { listProviderHealth } = require('./services/provider-health');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

function createApp() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use('/uploads', express.static(UPLOADS_DIR));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.get('/api/health/providers', (req, res) => {
    res.json({
      ok: true,
      providers: listProviderHealth(),
      updatedAt: new Date().toISOString(),
    });
  });

  const { chatRouter, conversationsRouter } = require('./routes/chat');
  app.use('/api/chat', chatRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/escalations', require('./routes/escalations'));
  app.use('/api/playbook', require('./routes/playbook'));
  app.use('/api/templates', require('./routes/templates'));
  app.use('/api/analytics', require('./routes/analytics'));
  app.use('/api/copilot', require('./routes/copilot'));
  app.use('/api/dev', require('./routes/dev'));
  app.use('/api/usage', require('./routes/usage'));

  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ ok: false, code: 'INTERNAL', error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp, UPLOADS_DIR };
