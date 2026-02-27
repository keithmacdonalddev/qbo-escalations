const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dns = require('dns');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// DNS override for MongoDB Atlas SRV resolution (some networks block default DNS)
const dnsServers = (process.env.MONGODB_DNS_SERVERS || '').split(',').map(s => s.trim()).filter(Boolean);
if (dnsServers.length) {
  dns.setServers(dnsServers);
  console.log(`DNS override: ${dnsServers.join(', ')}`);
}

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Route mounts
const { chatRouter, conversationsRouter } = require('./routes/chat');
app.use('/api/chat', chatRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/escalations', require('./routes/escalations'));
app.use('/api/playbook', require('./routes/playbook'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/analytics', require('./routes/analytics'));

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

  app.listen(PORT, () => {
    console.log(`QBO Escalation API listening on :${PORT}`);

    // Warm up Claude CLI in background (non-blocking)
    const { warmUp } = require('./services/claude');
    warmUp().catch(() => { /* non-fatal */ });
  });
}

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down`);
  mongoose.connection.close().then(() => {
    console.log('MongoDB disconnected');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
