const mongoose = require('mongoose');
const dns = require('dns');
const path = require('path');
const { createApp } = require('./app');
const UsageLog = require('./models/UsageLog');
const { drainPendingWrites } = require('./lib/usage-writer');
const { reportServerError } = require('./lib/server-error-pipeline');
const { startCleanupSchedule, stopCleanupSchedule } = require('./lib/cleanup');
const { startScheduler: startBriefingScheduler, stopScheduler: stopBriefingScheduler } = require('./services/workspace-scheduler');
const { startMonitor: startWorkspaceMonitor, stopMonitor: stopWorkspaceMonitor } = require('./services/workspace-monitor');
const {
  startBackgroundTask,
  completeBackgroundTask,
  failBackgroundTask,
  updateBackgroundService,
  stopPruning: stopBackgroundPruning,
} = require('./services/background-runtime');
const { stopPruning: stopAiPruning } = require('./services/ai-runtime');
const { stopPruning: stopWorkspacePruning } = require('./services/workspace-runtime');
const { stopPruning: stopAgentSessionPruning } = require('./services/agent-session-runtime');
const { stopErrorPipeline } = require('./lib/server-error-pipeline');
const { stopChainCleanup: stopUsageChainCleanup } = require('./lib/usage-writer');
const { stopIncidentPruning } = require('./services/monitor-incidents');
const { stopDevSessionPruning } = require('./routes/dev');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// DNS override for MongoDB Atlas SRV resolution (some networks block default DNS)
const dnsServers = (process.env.MONGODB_DNS_SERVERS || '').split(',').map(s => s.trim()).filter(Boolean);
if (dnsServers.length) {
  dns.setServers(dnsServers);
  console.log(`DNS override: ${dnsServers.join(', ')}`);
}

const app = createApp();
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '127.0.0.1';
let httpServer = null;

// MongoDB connection + server start
async function start() {
  const uri = process.env.MONGODB_URI;
  updateBackgroundService('mongodb-connection', {
    state: 'starting',
    meta: { connected: false },
  });
  if (!uri) {
    console.error('MONGODB_URI is not set. Check server/.env');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log('MongoDB connected');
    updateBackgroundService('mongodb-connection', {
      state: 'healthy',
      meta: { connected: true },
      lastCompletedAt: Date.now(),
      lastError: null,
    });
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  }

  // Ensure UsageLog indexes exist (dedup + TTL depend on them).
  // Failure is non-fatal to avoid blocking startup, but dedup and TTL
  // guarantees will be degraded until indexes are created manually.
  const syncIndexesTaskId = startBackgroundTask('usage-log-index-sync');
  try {
    await UsageLog.syncIndexes();
    completeBackgroundTask(syncIndexesTaskId, { ok: true });
  } catch (err) {
    console.error('UsageLog index sync failed (dedup/TTL may be degraded):', err.message);
    failBackgroundTask(syncIndexesTaskId, err, { ok: false });
  }

  httpServer = app.listen(PORT, HOST, () => {
    console.log(`QBO Escalation API listening on http://${HOST}:${PORT}`);

    // Warm up CLI providers in background (non-blocking)
    const { warmUp: warmClaude } = require('./services/claude');
    const { warmUp: warmCodex } = require('./services/codex');
    const claudeWarmTaskId = startBackgroundTask('claude-warmup');
    warmClaude()
      .then(() => completeBackgroundTask(claudeWarmTaskId, { ok: true }))
      .catch((err) => failBackgroundTask(claudeWarmTaskId, err, { ok: false }));
    const codexWarmTaskId = startBackgroundTask('codex-warmup');
    warmCodex()
      .then(() => completeBackgroundTask(codexWarmTaskId, { ok: true }))
      .catch((err) => failBackgroundTask(codexWarmTaskId, err, { ok: false }));

    // Start periodic DB cleanup (30s delay, then every 6h)
    startCleanupSchedule();

    // Start workspace morning briefing scheduler (checks every 5 min)
    startBriefingScheduler();

    // Start workspace background monitor (5-min alert scans + SSE push)
    startWorkspaceMonitor();
  });
}

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
  updateBackgroundService('mongodb-connection', {
    state: 'error',
    lastError: { message: 'MongoDB disconnected', stack: '' },
  });
  reportServerError({
    message: 'MongoDB disconnected',
    detail: 'The database connection was lost. Queries will fail until reconnection.',
    source: 'mongodb',
    category: 'runtime-error',
    severity: 'error',
  });
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err.message);
  updateBackgroundService('mongodb-connection', {
    state: 'error',
    lastError: { message: err.message, stack: err.stack || '' },
  });
  reportServerError({
    message: `MongoDB error: ${err.message}`,
    detail: 'A database-level error occurred on the active connection.',
    stack: err.stack || '',
    source: 'mongodb',
    category: 'runtime-error',
    severity: 'error',
  });
});

mongoose.connection.on('reconnected', () => {
  console.log('MongoDB reconnected');
  updateBackgroundService('mongodb-connection', {
    state: 'healthy',
    lastCompletedAt: Date.now(),
    lastError: null,
  });
  reportServerError({
    message: 'MongoDB reconnected',
    detail: 'Database connection restored after a disconnect.',
    source: 'mongodb',
    category: 'other',
    severity: 'info',
  });
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down`);
  stopCleanupSchedule();
  stopBriefingScheduler();
  stopWorkspaceMonitor();
  stopAiPruning();
  stopWorkspacePruning();
  stopBackgroundPruning();
  stopAgentSessionPruning();
  stopErrorPipeline();
  stopUsageChainCleanup();
  stopIncidentPruning();
  stopDevSessionPruning();
  if (httpServer) {
    httpServer.close(async () => {
      console.log('HTTP server closed');
      await drainPendingWrites(5000);
      await mongoose.connection.close();
      process.exit(0);
    });
  } else {
    drainPendingWrites(5000).then(() =>
      mongoose.connection.close()
    ).then(() => {
      process.exit(0);
    });
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  reportServerError({
    message: `Uncaught exception: ${err.message}`,
    detail: 'A synchronous exception was not caught by any try/catch. This could crash the server.',
    stack: err.stack || '',
    source: 'process',
    category: 'runtime-error',
    severity: 'error',
  });
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  reportServerError({
    message: `Unhandled rejection: ${reason?.message || String(reason)}`,
    detail: 'A promise was rejected but no .catch() handled it.',
    stack: reason?.stack || '',
    source: 'process',
    category: 'runtime-error',
    severity: 'error',
  });
});

start();
