'use strict';
// READ-ONLY audit: is AI thinking/reasoning persisted anywhere for case 1511448ETAS?
// Uses raw driver collections via mongoose connection. find/findOne/aggregate only.
const path = require('path');
require(path.join(__dirname, '..', 'server', 'node_modules', 'dotenv')).config({
  path: path.join(__dirname, '..', 'server', '.env'),
});
const mongoose = require(path.join(__dirname, '..', 'server', 'node_modules', 'mongoose'));

// Mirror server/src/index.js: custom DNS servers for Atlas SRV resolution.
const dns = require('dns');
const dnsServers = (process.env.MONGODB_DNS_SERVERS || '8.8.8.8,1.1.1.1')
  .split(',').map((s) => s.trim()).filter(Boolean);
if (dnsServers.length) dns.setServers(dnsServers);

const THINKY = /think|reason|thought/i;

function findThinkingKeys(obj, prefix = '', out = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return out;
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (THINKY.test(k)) {
      const desc = typeof v === 'string' ? `string len=${v.length}` : typeof v === 'number' ? `number=${v}` : Array.isArray(v) ? `array len=${v.length}` : typeof v;
      out.push(`${p} (${desc})`);
    }
    if (v && typeof v === 'object') {
      if (Array.isArray(v)) {
        // sample first 3 elements to keep output bounded, but scan ALL for non-empty thinking strings
        v.forEach((el, i) => {
          if (el && typeof el === 'object') findThinkingKeys(el, `${p}[${i}]`, out, depth + 1);
        });
      } else {
        findThinkingKeys(v, p, out, depth + 1);
      }
    }
  }
  return out;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const out = (label, val) => console.log(`\n=== ${label} ===\n${typeof val === 'string' ? val : JSON.stringify(val, null, 2)}`);

  // 0. Cross-check: KB drafts whose title matches the known draft title
  const titleHits = await db.collection('knowledgecandidates')
    .find({ title: /Cpp.*charged|Terminated EE/i }, { projection: { title: 1, escalationId: 1, createdAt: 1, 'sourceSnapshot.caseNumber': 1 } })
    .sort({ createdAt: -1 }).limit(5).toArray();
  out('KB DRAFTS matching title', titleHits);

  // 1. Escalation: try /1511448/, fall back to most recent
  let esc = await db.collection('escalations').findOne({ caseNumber: /1511448/i });
  if (!esc) {
    console.log('NO escalation matching /1511448/ — falling back to MOST RECENT escalation.');
    esc = await db.collection('escalations').find({}).sort({ createdAt: -1 }).limit(1).next();
  }
  if (esc) {
    out('ESCALATION', { _id: esc._id, caseNumber: esc.caseNumber, status: esc.status, createdAt: esc.createdAt, topLevelKeys: Object.keys(esc) });
    out('ESCALATION thinking-ish keys', findThinkingKeys(esc));
  }
  if (!esc) { await mongoose.disconnect(); return; }

  // 2. KnowledgeCandidate
  const kc = await db.collection('knowledgecandidates').findOne({ escalationId: esc._id });
  if (!kc) {
    out('KNOWLEDGE CANDIDATE', 'NOT FOUND by escalationId; trying sourceSnapshot.caseNumber');
    const kc2 = await db.collection('knowledgecandidates').findOne({ 'sourceSnapshot.caseNumber': /1511448/i });
    if (kc2) out('KC via snapshot', { _id: kc2._id, keys: Object.keys(kc2) });
  } else {
    out('KNOWLEDGE CANDIDATE', {
      _id: kc._id,
      title: kc.title,
      reviewStatus: kc.reviewStatus,
      createdAt: kc.createdAt,
      topLevelKeys: Object.keys(kc),
      kbAgentKeys: kc.kbAgent ? Object.keys(kc.kbAgent) : null,
      kbAgentMessagesCount: Array.isArray(kc.kbAgentMessages) ? kc.kbAgentMessages.length : 0,
      kbAgentMessageKeys: kc.kbAgentMessages && kc.kbAgentMessages[0] ? Object.keys(kc.kbAgentMessages[0]) : null,
      auditEventsCount: Array.isArray(kc.auditEvents) ? kc.auditEvents.length : 0,
    });
    out('KC thinking-ish keys', findThinkingKeys(kc));
  }

  // 3. Conversation(s) tied to escalation
  const convs = await db.collection('conversations').find({ escalationId: esc._id }).toArray();
  out('CONVERSATIONS for escalation', `count=${convs.length}`);
  for (const c of convs) {
    const msgs = Array.isArray(c.messages) ? c.messages : [];
    const withThinking = msgs
      .map((m, i) => ({ i, role: m.role, provider: m.provider, modelUsed: m.modelUsed, thinkingLen: typeof m.thinking === 'string' ? m.thinking.length : 0, keys: Object.keys(m) }))
      .filter((m) => m.thinkingLen > 0);
    out(`CONV ${c._id}`, {
      title: c.title,
      messageCount: msgs.length,
      messagesWithNonEmptyThinking: withThinking.map(({ i, role, provider, modelUsed, thinkingLen }) => ({ i, role, provider, modelUsed, thinkingLen })),
      sampleMessageKeys: msgs[0] ? Object.keys(msgs[0]) : null,
      caseIntakeStatus: c.caseIntake && c.caseIntake.status,
      caseIntakeRunCount: c.caseIntake && Array.isArray(c.caseIntake.runs) ? c.caseIntake.runs.length : 0,
    });
    if (withThinking.length > 0) {
      const first = msgs[withThinking[0].i];
      out('FIRST THINKING SNIPPET (200 chars)', String(first.thinking).slice(0, 200));
    }
    if (c.caseIntake && Array.isArray(c.caseIntake.runs) && c.caseIntake.runs.length) {
      out('caseIntake.runs[0] keys', Object.keys(c.caseIntake.runs[0]));
      out('caseIntake thinking-ish keys', findThinkingKeys(c.caseIntake));
    }
  }

  // 4. AiTrace for those conversations / recent
  const convIds = convs.map((c) => String(c._id));
  const traces = await db.collection('aitraces').find({ conversationId: { $in: convIds.concat(convs.map((c) => c._id)) } }).sort({ createdAt: -1 }).limit(5).toArray();
  out('AITRACES tied to conversation', `count=${traces.length}`);
  for (const t of traces) {
    out(`TRACE ${t._id}`, { createdAt: t.createdAt, topLevelKeys: Object.keys(t), thinkingish: findThinkingKeys(t) });
  }

  // 5. ParallelCandidateTurns tied to conversation
  const turns = await db.collection('parallelcandidateturns').find({ conversationId: { $in: convs.map((c) => c._id).concat(convIds) } }).limit(5).toArray();
  out('PARALLEL CANDIDATE TURNS', `count=${turns.length}`);
  for (const t of turns) {
    out(`TURN ${t._id}`, { keys: Object.keys(t), thinkingLen: typeof t.thinking === 'string' ? t.thinking.length : 0 });
  }

  await mongoose.disconnect();
}

main().catch((err) => { console.error('AUDIT FAILED:', err.message); process.exit(1); });
