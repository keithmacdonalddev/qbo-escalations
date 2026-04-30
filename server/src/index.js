const mongoose = require('mongoose');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const { createApp } = require('./app');
const { attachRealtimeServer, stopRealtimeServer } = require('./services/realtime-server');
const { attachLiveCallAssistServer, stopLiveCallAssistServer } = require('./services/live-call-assist-server');
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
const { resolveStartupControls } = require('./lib/startup-controls');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// DNS override for MongoDB Atlas SRV resolution (some networks block default DNS)
const dnsServers = (process.env.MONGODB_DNS_SERVERS || '').split(',').map(s => s.trim()).filter(Boolean);
if (dnsServers.length) {
  dns.setServers(dnsServers);
  console.log(`DNS override: ${dnsServers.join(', ')}`);
}

const app = createApp();
let httpServer = null;
let imageParserHealthTimer = null;
let startPromise = null;
let shutdownPromise = null;
let shutdownExitCode = 0;
let processHandlersRegistered = false;
let runtimeOptions = {
  exitProcess: require.main === module,
  installSignalHandlers: require.main === module,
};
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

function stopImageParserHealthCheck() {
  if (imageParserHealthTimer) {
    clearInterval(imageParserHealthTimer);
    imageParserHealthTimer = null;
  }
}

function registerProcessHandlers() {
  if (processHandlersRegistered) return;
  processHandlersRegistered = true;

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
}

async function start(options = {}) {
  if (startPromise) return startPromise;

  runtimeOptions = {
    exitProcess: options.exitProcess ?? runtimeOptions.exitProcess,
    installSignalHandlers: options.installSignalHandlers ?? runtimeOptions.installSignalHandlers,
  };
  if (runtimeOptions.installSignalHandlers) {
    registerProcessHandlers();
  }

  startPromise = (async () => {
    const uri = process.env.MONGODB_URI;
    const host = options.host || process.env.HOST || '127.0.0.1';
    const requestedPort = options.port ?? process.env.PORT ?? 4000;
    const startupControls = resolveStartupControls(process.env, options.startupControls);

    updateBackgroundService('mongodb-connection', {
      state: 'starting',
      meta: { connected: false },
    });

    if (!uri) {
      throw new Error('MONGODB_URI is not set. Check server/.env');
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
      throw new Error(`MongoDB connection failed: ${err.message}`);
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
    if (startupControls.imageParserKeysMigration) {
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
          fs.renameSync(keysFilePath, keysFilePath + '.migrated');
          console.log(`[image-parser] Migrated ${migrated} API key(s) from JSON file to MongoDB`);
        }
        completeBackgroundTask(migrateKeysTaskId, { ok: true });
      } catch (err) {
        console.warn('[image-parser] Key migration failed (non-fatal):', err.message);
        failBackgroundTask(migrateKeysTaskId, err, { ok: false });
      }
    } else {
      console.log('[startup] Image parser keys migration disabled');
    }

    stopImageParserHealthCheck();

    await new Promise((resolve, reject) => {
      const onError = (err) => {
        if (httpServer) httpServer.off('listening', onListening);
        reject(err);
      };

      const onListening = () => {
        if (httpServer) httpServer.off('error', onError);
        attachRealtimeServer(httpServer);
        attachLiveCallAssistServer(httpServer);

        const address = httpServer.address();
        const listeningPort = typeof address === 'object' && address ? address.port : requestedPort;
        console.log(`QBO Escalation API listening on http://${host}:${listeningPort}`);

        if (startupControls.providerWarmup) {
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
        } else {
          console.log('[startup] Provider warmup disabled');
        }

        if (startupControls.workspaceScheduler) {
          startBriefingScheduler();
        } else {
          console.log('[startup] Workspace scheduler disabled');
        }

        if (startupControls.workspaceMonitor) {
          startWorkspaceMonitor();
        } else {
          console.log('[startup] Workspace monitor disabled');
        }

        if (startupControls.imageParserStartupCheck || startupControls.imageParserHealthCheck) {
          const { checkProviderAvailability } = require('./services/image-parser');

          if (startupControls.imageParserStartupCheck) {
            checkProviderAvailability({ forceRefresh: true }).then((providers) => {
              const lines = Object.entries(providers).map(([name, info]) => formatImageParserProviderLogLine(name, info));
              console.log(`[image-parser] Provider availability:\n${lines.join('\n')}`);
            }).catch((err) => {
              console.warn('[image-parser] Startup self-check failed:', err.message);
            });
          } else {
            console.log('[startup] Image parser startup self-check disabled');
          }

          if (startupControls.imageParserHealthCheck) {
            const IMAGE_PARSER_HEALTH_INTERVAL = 5 * 60 * 1000;
            imageParserHealthTimer = setInterval(async () => {
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
            if (imageParserHealthTimer.unref) imageParserHealthTimer.unref();
          } else {
            console.log('[startup] Image parser scheduled health check disabled');
          }
        } else {
          console.log('[startup] Image parser startup checks disabled');
        }

        resolve();
      };

      httpServer = app.listen(requestedPort, host);
      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
    });

    const address = httpServer.address();
    return {
      app,
      httpServer,
      host,
      port: typeof address === 'object' && address ? address.port : Number(requestedPort),
      startupControls,
    };
  })().catch((err) => {
    startPromise = null;
    throw err;
  });

  return startPromise;
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

function shutdown(signal, { exitCode = 0 } = {}) {
  shutdownExitCode = Math.max(shutdownExitCode, exitCode);
  if (shutdownPromise) return shutdownPromise;

  console.log(`\n${signal} received — shutting down`);
  stopImageParserHealthCheck();
  stopBriefingScheduler();
  stopWorkspaceMonitor();
  stopRealtimeServer();
  stopLiveCallAssistServer();
  stopAiPruning();
  stopWorkspacePruning();
  stopBackgroundPruning();
  stopAgentSessionPruning();
  stopErrorPipeline();
  stopUsageChainCleanup();

  const shouldExitProcess = runtimeOptions.exitProcess;
  const forceExitTimer = shouldExitProcess
    ? setTimeout(() => {
      console.error(`[shutdown] Timed out after ${SHUTDOWN_TIMEOUT_MS}ms — forcing exit`);
      process.exit(shutdownExitCode || 1);
    }, SHUTDOWN_TIMEOUT_MS)
    : null;
  if (forceExitTimer?.unref) forceExitTimer.unref();

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
      if (forceExitTimer) clearTimeout(forceExitTimer);
      httpServer = null;
      startPromise = null;
      const finalExitCode = shutdownExitCode;
      shutdownPromise = null;
      shutdownExitCode = 0;
      if (shouldExitProcess) {
        process.exit(finalExitCode);
      }
      return { exitCode: finalExitCode };
    }
  })();

  return shutdownPromise;
}

module.exports = {
  app,
  shutdown,
  start,
};

if (require.main === module) {
  start({ exitProcess: true, installSignalHandlers: true }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
