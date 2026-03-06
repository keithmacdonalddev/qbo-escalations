const mongoose = require('mongoose');
const dns = require('dns');
const path = require('path');
const { createApp } = require('./app');
const UsageLog = require('./models/UsageLog');
const { drainPendingWrites } = require('./lib/usage-writer');

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
  if (!uri) {
    console.error('MONGODB_URI is not set. Check server/.env');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  }

  // Ensure UsageLog indexes exist (dedup + TTL depend on them).
  // Failure is non-fatal to avoid blocking startup, but dedup and TTL
  // guarantees will be degraded until indexes are created manually.
  try {
    await UsageLog.syncIndexes();
  } catch (err) {
    console.error('UsageLog index sync failed (dedup/TTL may be degraded):', err.message);
  }

  httpServer = app.listen(PORT, HOST, () => {
    console.log(`QBO Escalation API listening on http://${HOST}:${PORT}`);

    // Warm up CLI providers in background (non-blocking)
    const { warmUp: warmClaude } = require('./services/claude');
    const { warmUp: warmCodex } = require('./services/codex');
    warmClaude().catch(() => { /* non-fatal */ });
    warmCodex().catch(() => { /* non-fatal */ });
  });
}

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected');
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down`);
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
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

start();
