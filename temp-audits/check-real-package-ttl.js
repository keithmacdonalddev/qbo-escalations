'use strict';
// READ-ONLY: verify the expiresAt-vs-createdAt spread on recent REAL evidence
// packages (operation != provider-status) — sanity check that the running
// server is not stamping a 1-day expiry on real evidence.
const path = require('path');
require(path.join(__dirname, '..', 'server', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', 'server', '.env'),
});
const mongoose = require(path.join(__dirname, '..', 'server', 'node_modules', 'mongoose'));
const dns = require('dns');
dns.setServers((process.env.MONGODB_DNS_SERVERS || '8.8.8.8,1.1.1.1').split(','));

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const col = mongoose.connection.db.collection('providercallpackages');
  const docs = await col.find({ operation: { $ne: 'provider-status' } })
    .project({ operation: 1, callSite: 1, createdAt: 1, expiresAt: 1 })
    .sort({ createdAt: -1 }).limit(8).toArray();
  for (const d of docs) {
    const days = d.expiresAt && d.createdAt
      ? ((d.expiresAt - d.createdAt) / 86400000).toFixed(2)
      : 'none';
    console.log(d.operation, '|', d.callSite, '|', d.createdAt && d.createdAt.toISOString(), '| ttlDays:', days);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
