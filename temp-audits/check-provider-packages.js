'use strict';
// READ-ONLY audit: providercallpackages distribution by call site / operation.
// find/aggregate only. Mirrors temp-audits/check-thinking-db.js connection setup.
const path = require('path');
require(path.join(__dirname, '..', 'server', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', 'server', '.env'),
});
const mongoose = require(path.join(__dirname, '..', 'server', 'node_modules', 'mongoose'));

const dns = require('dns');
const dnsServers = (process.env.MONGODB_DNS_SERVERS || '8.8.8.8,1.1.1.1')
  .split(',').map((s) => s.trim()).filter(Boolean);
if (dnsServers.length) dns.setServers(dnsServers);

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const col = db.collection('providercallpackages');
  const out = (label, val) => console.log(`\n=== ${label} ===\n${typeof val === 'string' ? val : JSON.stringify(val, null, 2)}`);

  // 0. Total count
  const total = await col.countDocuments();
  out('TOTAL providercallpackages', String(total));
  if (total === 0) { await mongoose.disconnect(); return; }

  // 1. Inspect one doc's top-level keys (and a couple nested) to find field names
  const sample = await col.find({}).sort({ _id: -1 }).limit(1).next();
  out('SAMPLE DOC top-level keys', Object.keys(sample));
  const nestedPreview = {};
  for (const k of Object.keys(sample)) {
    const v = sample[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v._bsontype)) {
      nestedPreview[k] = Object.keys(v);
    } else if (typeof v === 'string' && v.length < 120) {
      nestedPreview[k] = v;
    }
  }
  out('SAMPLE DOC scalar/nested preview', nestedPreview);

  // 2. Group by callSite + operation (try common locations)
  const groupings = [
    { name: 'callSite (top)', field: '$callSite' },
    { name: 'operation (top)', field: '$operation' },
    { name: 'captureContext.callSite', field: '$captureContext.callSite' },
    { name: 'context.callSite', field: '$context.callSite' },
    { name: 'callContext.callSite', field: '$callContext.callSite' },
    { name: 'providerId (top)', field: '$providerId' },
  ];
  for (const g of groupings) {
    const rows = await col.aggregate([
      { $group: { _id: g.field, n: { $sum: 1 }, latest: { $max: '$createdAt' }, earliest: { $min: '$createdAt' } } },
      { $sort: { n: -1 } },
      { $limit: 30 },
    ]).toArray();
    // Skip groupings where everything is null (wrong field path)
    const meaningful = rows.some((r) => r._id !== null && r._id !== undefined);
    if (meaningful) out(`GROUP BY ${g.name}`, rows);
    else console.log(`\n(group by ${g.name}: all null, skipping)`);
  }

  // 3. Chat-related packages? Search likely fields for 'chat'
  const chatish = await col.aggregate([
    { $match: { $or: [
      { callSite: /chat/i },
      { operation: /chat/i },
      { 'captureContext.callSite': /chat/i },
      { 'captureContext.operation': /chat/i },
      { 'context.callSite': /chat/i },
      { 'context.operation': /chat/i },
    ] } },
    { $group: { _id: { cs: { $ifNull: ['$callSite', '$captureContext.callSite'] }, op: { $ifNull: ['$operation', '$captureContext.operation'] } }, n: { $sum: 1 }, latest: { $max: '$createdAt' } } },
    { $sort: { n: -1 } },
  ]).toArray();
  out('CHAT-ish packages (callSite/operation matching /chat/i)', chatish);

  // 4. Packages referencing the specific conversation or case
  const convStr = '6a2a09297e26577605056c80';
  const refMatches = await col.find({
    $or: [
      { conversationId: convStr },
      { 'captureContext.conversationId': convStr },
      { 'context.conversationId': convStr },
      { caseNumber: /15154488745/ },
      { 'captureContext.caseNumber': /15154488745/ },
    ],
  }).project({ createdAt: 1, callSite: 1, operation: 1, providerId: 1, 'captureContext.callSite': 1, 'captureContext.operation': 1 }).limit(10).toArray();
  out(`PACKAGES referencing conv ${convStr} or case 15154488745`, refMatches);

  // 5. Packages created near 2026-06-11T01:03Z (window +/- 30 min)
  const t0 = new Date('2026-06-11T00:33:00Z');
  const t1 = new Date('2026-06-11T01:33:00Z');
  const nearTime = await col.find({ createdAt: { $gte: t0, $lte: t1 } })
    .project({ createdAt: 1, callSite: 1, operation: 1, providerId: 1, 'captureContext.callSite': 1, 'captureContext.operation': 1, modelRequested: 1, 'captureContext.modelRequested': 1 })
    .sort({ createdAt: 1 }).limit(25).toArray();
  out('PACKAGES created 2026-06-11T00:33Z..01:33Z', nearTime);

  // 6. Most recent 5 packages overall (orientation)
  const recent = await col.find({})
    .project({ createdAt: 1, callSite: 1, operation: 1, providerId: 1, 'captureContext.callSite': 1, 'captureContext.operation': 1 })
    .sort({ createdAt: -1 }).limit(5).toArray();
  out('MOST RECENT 5 packages', recent);

  await mongoose.disconnect();
}

main().catch((err) => { console.error('AUDIT FAILED:', err.message); process.exit(1); });
