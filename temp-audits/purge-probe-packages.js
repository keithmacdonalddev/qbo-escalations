'use strict';
// ONE-OFF APPROVED CLEANUP (Batch 3, 2026-06-11): delete provider HEALTH-PROBE
// packages (operation 'provider-status') from the live providercallpackages
// collection, and idempotently ensure the TTL index on expiresAt exists so
// future probe packages (stamped with a short expiresAt by the recorder)
// self-clean. The ONLY write operations are:
//   1. deleteMany({ operation: 'provider-status' })
//   2. createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })  (idempotent)
// Nothing else is modified. Real evidence (chat/triage/parse/kb-draft
// packages) does not carry operation 'provider-status' and is untouched.
// Connection pattern mirrors temp-audits/check-provider-packages.js.
const path = require('path');
require(path.join(__dirname, '..', 'server', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', 'server', '.env'),
});
const mongoose = require(path.join(__dirname, '..', 'server', 'node_modules', 'mongoose'));

const dns = require('dns');
const dnsServers = (process.env.MONGODB_DNS_SERVERS || '8.8.8.8,1.1.1.1')
  .split(',').map((s) => s.trim()).filter(Boolean);
if (dnsServers.length) dns.setServers(dnsServers);

// Exact probe discriminator — set only by buildProviderStatusCaptureContext in
// server/src/services/image-parser.js (health monitor + preflight checks).
const PROBE_FILTER = { operation: 'provider-status' };

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const col = mongoose.connection.db.collection('providercallpackages');
  const out = (label, val) => console.log(`\n=== ${label} ===\n${typeof val === 'string' ? val : JSON.stringify(val, null, 2)}`);

  // 1. Counts before
  const totalBefore = await col.countDocuments();
  const probeCount = await col.countDocuments(PROBE_FILTER);
  out('TOTAL docs before', String(totalBefore));
  out('PROBE docs matching filter { operation: "provider-status" }', String(probeCount));

  // Full breakdown by operation so anything ambiguous is visible and reported
  // (the delete filter is exact equality; everything else is left alone).
  const byOperation = await col.aggregate([
    { $group: { _id: '$operation', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]).toArray();
  out('BREAKDOWN by operation (everything not provider-status is left alone)', byOperation);

  // 2. Sample 3 matching docs to prove the filter is right before deleting
  const samples = await col.find(PROBE_FILTER)
    .project({ callSite: 1, operation: 1, providerId: 1, createdAt: 1, expiresAt: 1 })
    .sort({ createdAt: -1 }).limit(3).toArray();
  out('SAMPLE 3 matching docs (callSite/operation)', samples);

  if (probeCount === 0) {
    out('NOTHING TO DELETE', 'No docs match the probe filter.');
  } else {
    // 3. Delete
    out('ABOUT TO DELETE', `${probeCount} docs matching ${JSON.stringify(PROBE_FILTER)}`);
    const result = await col.deleteMany(PROBE_FILTER);
    out('DELETED (deletedCount)', String(result.deletedCount));
  }

  // 4. Counts after
  const totalAfter = await col.countDocuments();
  const probeAfter = await col.countDocuments(PROBE_FILTER);
  out('TOTAL docs after', String(totalAfter));
  out('PROBE docs remaining', String(probeAfter));

  const remainingByCallSite = await col.aggregate([
    { $group: { _id: '$callSite', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 10 },
  ]).toArray();
  out('REMAINING docs by callSite (top 10)', remainingByCallSite);

  // 5. Idempotently ensure the TTL index on expiresAt (matches the schema
  // declaration in server/src/models/ProviderCallPackage.js). createIndex is
  // a no-op when an identical index already exists.
  try {
    const indexName = await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    out('TTL INDEX ensured', indexName);
  } catch (err) {
    out('TTL INDEX createIndex FAILED (existing conflicting index?)', err.message);
  }
  const indexes = await col.indexes();
  out('ALL indexes on providercallpackages', indexes.map((ix) => ({
    name: ix.name,
    key: ix.key,
    expireAfterSeconds: ix.expireAfterSeconds,
  })));

  await mongoose.disconnect();
}

main().catch((err) => { console.error('PURGE FAILED:', err.message); process.exit(1); });
