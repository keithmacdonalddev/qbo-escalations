'use strict';
// READ-ONLY follow-up: codex:chat packages near 2026-06-11T01:03Z + conversation refs.
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

  // 1. Non-provider-status packages in window 00:30Z..01:40Z on 2026-06-11
  const t0 = new Date('2026-06-11T00:30:00Z');
  const t1 = new Date('2026-06-11T01:40:00Z');
  const nonStatus = await col.find({
    createdAt: { $gte: t0, $lte: t1 },
    operation: { $ne: 'provider-status' },
  }).project({ createdAt: 1, callSite: 1, operation: 1, providerId: 1, outcome: 1 })
    .sort({ createdAt: 1 }).toArray();
  out('NON-provider-status packages 00:30Z..01:40Z (2026-06-11)', nonStatus);

  // 2. Most recent codex:chat package — inspect keys for conversation/case refs
  const codexChat = await col.find({ callSite: 'codex:chat' }).sort({ createdAt: -1 }).limit(1).next();
  if (codexChat) {
    out('LATEST codex:chat createdAt', String(codexChat.createdAt));
    out('LATEST codex:chat top keys', Object.keys(codexChat));
    out('LATEST codex:chat source', codexChat.source);
    const cliKeys = codexChat.cli ? Object.keys(codexChat.cli) : null;
    out('LATEST codex:chat cli keys', cliKeys);
    // search whole doc (shallow-ish) for the conversation id / case number strings
    const docStr = JSON.stringify(codexChat);
    out('doc contains "6a2a09297e26577605056c80"?', String(docStr.includes('6a2a09297e26577605056c80')));
    out('doc contains "15154488745"?', String(docStr.includes('15154488745')));
  }

  // 3. codex:chat packages 2026-06-11T00:30Z..01:40Z specifically
  const codexNear = await col.find({
    callSite: 'codex:chat',
    createdAt: { $gte: t0, $lte: t1 },
  }).project({ createdAt: 1, outcome: 1 }).sort({ createdAt: 1 }).toArray();
  out('codex:chat packages in window', codexNear);

  // 4. Any package whose serialized doc references the conversation id (scan recent 100 chat-op docs)
  const recentChat = await col.find({ operation: 'chat' }).sort({ createdAt: -1 }).limit(100).toArray();
  const hits = recentChat.filter((d) => JSON.stringify(d).includes('6a2a09297e26577605056c80'));
  out('recent 100 chat packages referencing conv id', hits.map((d) => ({ _id: d._id, createdAt: d.createdAt, callSite: d.callSite })));
  // also date range of those 100
  out('recent 100 chat packages date range', {
    newest: recentChat[0] && recentChat[0].createdAt,
    oldest: recentChat[recentChat.length - 1] && recentChat[recentChat.length - 1].createdAt,
  });

  // 5. codex:chat daily counts last 7 days
  const daily = await col.aggregate([
    { $match: { callSite: 'codex:chat', createdAt: { $gte: new Date('2026-06-04T00:00:00Z') } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray();
  out('codex:chat daily counts since 2026-06-04', daily);

  await mongoose.disconnect();
}

main().catch((err) => { console.error('AUDIT FAILED:', err.message); process.exit(1); });
