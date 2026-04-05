const mongoose = require('mongoose');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const { createApp } = require('./app');
const { attachRealtimeServer, stopRealtimeServer } = require('./services/realtime-server');
const UsageLog = require('./models/UsageLog');
const { drainPendingWrites } = require('./lib/usage-writer');
const { reportServerError, stopErrorPipeline } = require('./lib/server-error-pipeline');
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
const { stopChainCleanup: stopUsageChainCleanup } = require('./lib/usage-writer');

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
let shutdownPromise = null;
let shutdownExitCode = 0;
const SHUTDOWN_TIMEOUT_MS = 10_000;

function formatImageParserProviderLogLine(name, info) {
  if (!info || typeof info !== 'object') {
    return `  ${name}: UNAVAILABLE`;
  }

  if (name === 'llm-gateway') {
    const model = info.model ? ` (${info.model})` : '';
    if (info.available) {
      return `  ${name}: AVAILABLE${model} - Authenticated`;
    }

    switch (String(info.code || '').toUpperCase()) {
      case 'NO_KEY':
        return `  ${name}: UNAVAILABLE - API key not configured`;
      case 'INVALID_KEY':
        return `  ${name}: UNAVAILABLE - API key rejected`;
      case 'PROVIDER_UNAVAILABLE':
        return `  ${name}: UNAVAILABLE - ${info.reason || 'Gateway authenticated, unavailable'}`;
      case 'TIMEOUT':
        return `  ${name}: UNAVAILABLE - Gateway validation timed out`;
      default:
        return `  ${name}: UNAVAILABLE - ${info.reason || 'Unavailable'}`;
    }
  }

  const tag = info.available ? 'AVAILABLE' : 'UNAVAILABLE';
  const model = info.model ? ` (${info.model})` : '';
  return `  ${name}: ${tag}${model} - ${info.reason || (info.available ? 'Available' : 'Unavailable')}`;
}

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

  // One-time migration: move API keys from JSON file to MongoDB
  const migrateKeysTaskId = startBackgroundTask('image-parser-keys-migration');
  try {
    const keysFilePath = path.join(__dirname, '..', 'data', 'image-parser-keys.json');
    if (fs.existsSync(keysFilePath)) {
      const ImageParserApiKey = require('./models/ImageParserApiKey');
      const raw = fs.readFileSync(keysFilePath, 'utf8');
      const keys = JSON.parse(raw);
      let migrated = 0;
      for (const [provider, key] of Object.entries(keys)) {
        if (key && typeof key === 'string' && key.trim()) {
          await ImageParserApiKey.findOneAndUpdate(
            { provider },
            { provider, key: key.trim() },
            { upsert: true }
          );
          migrated++;
        }
      }
      // Rename old file to mark migration complete
      fs.renameSync(keysFilePath, keysFilePath + '.migrated');
      console.log(`[image-parser] Migrated ${migrated} API key(s) from JSON file to MongoDB`);
    }
    completeBackgroundTask(migrateKeysTaskId, { ok: true });
  } catch (err) {
    console.warn('[image-parser] Key migration failed (non-fatal):', err.message);
    failBackgroundTask(migrateKeysTaskId, err, { ok: false });
  }

  httpServer = app.listen(PORT, HOST, () => {
    attachRealtimeServer(httpServer);
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

    // Start workspace morning briefing scheduler (checks every 5 min)
    startBriefingScheduler();

    // Start workspace background monitor (5-min alert scans + SSE push)
    startWorkspaceMonitor();

    // Image parser provider self-check on startup
    const { checkProviderAvailability } = require('./services/image-parser');
    checkProviderAvailability({ forceRefresh: true }).then((providers) => {
      const lines = Object.entries(providers).map(([name, info]) => formatImageParserProviderLogLine(name, info));
      console.log(`[image-parser] Provider availability:\n${lines.join('\n')}`);
    }).catch((err) => {
      console.warn('[image-parser] Startup self-check failed:', err.message);
    });

    // Scheduled image parser health check — every 5 minutes
    const IMAGE_PARSER_HEALTH_INTERVAL = 5 * 60 * 1000;
    let _imageParserHealthTimer = setInterval(async () => {
      try {
        const status = await checkProviderAvailability({ forceRefresh: true });
        const down = Object.entries(status).filter(([, info]) => !info.available);
        if (down.length > 0) {
          const names = down.map(([name, info]) => `${name} (${info.reason})`).join(', ');
          console.warn(`[image-parser] Health check: ${down.length} provider(s) down — ${names}`);
        }
      } catch (err) {
        console.warn('[image-parser] Health check error:', err.message);
      }
    }, IMAGE_PARSER_HEALTH_INTERVAL);
    _imageParserHealthTimer.unref(); // Don't block process exit
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
function shutdown(signal, { exitCode = 0 } = {}) {
  shutdownExitCode = Math.max(shutdownExitCode, exitCode);
  if (shutdownPromise) return shutdownPromise;

  console.log(`\n${signal} received — shutting down`);
  stopBriefingScheduler();
  stopWorkspaceMonitor();
  stopRealtimeServer();
  stopAiPruning();
  stopWorkspacePruning();
  stopBackgroundPruning();
  stopAgentSessionPruning();
  stopErrorPipeline();
  stopUsageChainCleanup();

  const forceExitTimer = setTimeout(() => {
    console.error(`[shutdown] Timed out after ${SHUTDOWN_TIMEOUT_MS}ms — forcing exit`);
    process.exit(shutdownExitCode || 1);
  }, SHUTDOWN_TIMEOUT_MS);
  if (forceExitTimer.unref) forceExitTimer.unref();

  shutdownPromise = (async () => {
    try {
      if (httpServer) {
        await new Promise((resolve) => {
          httpServer.close((err) => {
            if (err) {
              console.error('HTTP server close error:', err.message);
            } else {
              console.log('HTTP server closed');
            }
            resolve();
          });
        });
      }

      try {
        await drainPendingWrites(5000);
      } catch (err) {
        console.error('Pending write drain failed during shutdown:', err.message);
      }

      try {
        await mongoose.connection.close();
      } catch (err) {
        console.error('MongoDB close failed during shutdown:', err.message);
      }
    } finally {
      clearTimeout(forceExitTimer);
      process.exit(shutdownExitCode);
    }
  })();

  return shutdownPromise;
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  reportServerError({
    message: `Uncaught exception: ${err.message}`,
    detail: 'A synchronous exception was not caught by any try/catch. The process will shut down to avoid running in an undefined state.',
    stack: err.stack || '',
    source: 'process',
    category: 'runtime-error',
    severity: 'error',
  });
  shutdown('uncaughtException', { exitCode: 1 });
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  reportServerError({
    message: `Unhandled rejection: ${reason?.message || String(reason)}`,
    detail: 'A promise was rejected but no .catch() handled it. The process will shut down to avoid running in an undefined state.',
    stack: reason?.stack || '',
    source: 'process',
    category: 'runtime-error',
    severity: 'error',
  });
  shutdown('unhandledRejection', { exitCode: 1 });
});

start();
