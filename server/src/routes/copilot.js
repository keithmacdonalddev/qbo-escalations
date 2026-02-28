const express = require('express');
const router = express.Router();
const Escalation = require('../models/Escalation');

function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const Template = require('../models/Template');
const claude = require('../services/claude');
const { getSystemPrompt, getCategories } = require('../lib/playbook-loader');
const { createRateLimiter } = require('../middleware/rate-limit');
const { logUsage } = require('../lib/usage-writer');
const { randomUUID } = require('node:crypto');

// All copilot endpoints return SSE streams for real-time feedback.
// They use focused prompts for specific tasks rather than general chat.
router.use(createRateLimiter({ name: 'copilot', limit: 18, windowMs: 60_000 }));

// Helper: set up SSE response
function initSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* gone */ }
  }, 15000);
  return heartbeat;
}

// Helper: stream a Claude call and handle lifecycle
function streamClaude({ res, req, heartbeat, messages, systemPrompt, images, requestId, copilotAction }) {
  let cleanupFn = null;
  let streamSettled = false;

  cleanupFn = claude.chat({
    messages,
    systemPrompt: systemPrompt || getSystemPrompt(),
    images,
    onChunk: (text) => {
      try { res.write('event: chunk\ndata: ' + JSON.stringify({ text }) + '\n\n'); } catch { /* gone */ }
    },
    onDone: (response, usageMeta) => {
      streamSettled = true;
      clearInterval(heartbeat);
      if (requestId) {
        const u = usageMeta || {};
        logUsage({
          requestId, attemptIndex: 0, service: 'copilot', provider: 'claude',
          model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens,
          usageAvailable: !!usageMeta, usageComplete: u.usageComplete, rawUsage: u.rawUsage,
          category: copilotAction, status: 'ok',
        });
      }
      try {
        res.write('event: done\ndata: ' + JSON.stringify({
          fullResponse: response,
          usage: usageMeta || null,
          usageAvailable: !!usageMeta,
        }) + '\n\n');
        res.end();
      } catch { /* gone */ }
    },
    onError: (err) => {
      streamSettled = true;
      clearInterval(heartbeat);
      if (requestId) {
        const u = (err && err._usage) || {};
        const isTimeout = err && err.message && /timed?\s*out/i.test(err.message);
        logUsage({
          requestId, attemptIndex: 0, service: 'copilot', provider: 'claude',
          model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens,
          usageAvailable: !!(err && err._usage), usageComplete: u.usageComplete, rawUsage: u.rawUsage,
          category: copilotAction, status: isTimeout ? 'timeout' : 'error',
        });
      }
      try {
        res.write('event: error\ndata: ' + JSON.stringify({ error: (err && err.message) || 'Copilot request failed' }) + '\n\n');
        res.end();
      } catch { /* gone */ }
    },
  });

  // NOTE: must use res.on('close'), NOT req.on('close'). By the time this
  // async handler runs, Express 5 has already consumed and closed the request
  // body stream, so req's 'close' event has already fired before we can
  // register a listener. The response stream's 'close' event correctly fires
  // when the underlying TCP socket is torn down (e.g. client tab close).
  res.on('close', () => {
    clearInterval(heartbeat);
    if (!streamSettled && cleanupFn) {
      const abortData = cleanupFn();
      if (requestId) {
        const u = (abortData && abortData.usage) || {};
        logUsage({
          requestId, attemptIndex: 0, service: 'copilot', provider: 'claude',
          model: u.model, inputTokens: u.inputTokens, outputTokens: u.outputTokens,
          usageAvailable: !!(abortData && abortData.usage), usageComplete: u.usageComplete, rawUsage: u.rawUsage,
          category: copilotAction, status: 'abort',
        });
      }
    }
  });
}

// ──────────────────────────────────────────────
// ESCALATION CO-PILOT
// ──────────────────────────────────────────────

// POST /api/copilot/analyze-escalation -- Deep analysis of an escalation
router.post('/analyze-escalation', async (req, res) => {
  const { escalationId } = req.body;
  if (!escalationId) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'escalationId required' });
  }

  const escalation = await Escalation.findById(escalationId).lean();
  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }

  const heartbeat = initSSE(res);
  res.write('event: start\ndata: ' + JSON.stringify({ type: 'analyze-escalation' }) + '\n\n');

  const prompt = 'Analyze this QBO escalation in detail. Provide:\n' +
    '1. Root cause diagnosis (what is likely happening)\n' +
    '2. Step-by-step resolution path for the phone agent\n' +
    '3. Customer-facing explanation the agent can read aloud\n' +
    '4. Risk flags (data loss potential, time sensitivity, escalation triggers)\n' +
    '5. Similar known issues and their resolutions\n\n' +
    'Escalation details:\n' + JSON.stringify(escalation, null, 2);

  streamClaude({ res, req, heartbeat, messages: [{ role: 'user', content: prompt }], requestId: randomUUID(), copilotAction: 'analyze-escalation' });
});

// POST /api/copilot/find-similar -- Find similar past escalations
router.post('/find-similar', async (req, res) => {
  const { escalationId } = req.body;

  const escalation = await Escalation.findById(escalationId).lean();
  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }

  // Search for similar escalations by category and text
  const filter = { _id: { $ne: escalation._id } };
  if (escalation.category && escalation.category !== 'unknown') {
    filter.category = escalation.category;
  }

  const similar = await Escalation.find(filter)
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  if (similar.length === 0) {
    return res.json({ ok: true, similar: [], message: 'No similar escalations found' });
  }

  // Use Claude to rank by relevance
  const heartbeat = initSSE(res);
  res.write('event: start\ndata: ' + JSON.stringify({ type: 'find-similar', candidateCount: similar.length }) + '\n\n');

  const prompt = 'Given this escalation:\n' + JSON.stringify({
    attemptingTo: escalation.attemptingTo,
    actualOutcome: escalation.actualOutcome,
    category: escalation.category,
  }) + '\n\nRank these past escalations by similarity and explain how each relates. ' +
    'For each similar case, note if the resolution could apply to the current case.\n\n' +
    'Past escalations:\n' + JSON.stringify(similar.map((s) => ({
      id: s._id,
      attemptingTo: s.attemptingTo,
      actualOutcome: s.actualOutcome,
      category: s.category,
      status: s.status,
      resolution: s.resolution,
    })), null, 2);

  streamClaude({ res, req, heartbeat, messages: [{ role: 'user', content: prompt }], requestId: randomUUID(), copilotAction: 'find-similar' });
});

// ──────────────────────────────────────────────
// TEMPLATE CO-PILOT
// ──────────────────────────────────────────────

// POST /api/copilot/suggest-template -- Suggest best template for an escalation
router.post('/suggest-template', async (req, res) => {
  const { escalationId } = req.body;

  const escalation = await Escalation.findById(escalationId).lean();
  if (!escalation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Escalation not found' });
  }

  const templates = await Template.find().lean();
  if (templates.length === 0) {
    return res.json({ ok: true, suggestion: null, message: 'No templates available' });
  }

  const heartbeat = initSSE(res);
  res.write('event: start\ndata: ' + JSON.stringify({ type: 'suggest-template' }) + '\n\n');

  const prompt = 'Given this QBO escalation:\n' + JSON.stringify({
    category: escalation.category,
    attemptingTo: escalation.attemptingTo,
    actualOutcome: escalation.actualOutcome,
    clientContact: escalation.clientContact,
  }) + '\n\nAnd these available response templates:\n' +
    templates.map((t, i) => (i + 1) + '. [' + t.category + '] ' + t.title + ': ' + t.body.slice(0, 200)).join('\n') +
    '\n\n1. Which template best fits? Explain why.\n' +
    '2. What variable values should be filled in?\n' +
    '3. What customizations are needed for this specific case?\n' +
    '4. Draft the final customized response ready to send.';

  streamClaude({ res, req, heartbeat, messages: [{ role: 'user', content: prompt }], requestId: randomUUID(), copilotAction: 'suggest-template' });
});

// POST /api/copilot/generate-template -- Generate a new template from description
router.post('/generate-template', async (req, res) => {
  const { category, description } = req.body;
  if (!description) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'description required' });
  }

  const heartbeat = initSSE(res);
  res.write('event: start\ndata: ' + JSON.stringify({ type: 'generate-template' }) + '\n\n');

  const existingTemplates = await Template.find({ category: category || { $exists: true } }).limit(5).lean();
  const examples = existingTemplates.length > 0
    ? '\n\nHere are some existing templates for style reference:\n' + existingTemplates.map((t) => t.body.slice(0, 300)).join('\n---\n')
    : '';

  const prompt = 'Create a professional QBO escalation response template for this scenario:\n' +
    'Category: ' + (category || 'general') + '\n' +
    'Description: ' + description + examples +
    '\n\nRequirements:\n' +
    '1. Use {{VARIABLE_NAME}} placeholders for dynamic values (client name, case number, etc.)\n' +
    '2. Be professional but human -- not robotic\n' +
    '3. Include specific QBO navigation paths where relevant\n' +
    '4. Keep it concise -- phone agents read this to customers\n' +
    '5. Format the output as:\n' +
    '   TITLE: [template title]\n' +
    '   VARIABLES: [comma-separated list of variable names]\n' +
    '   BODY:\n   [template body]';

  streamClaude({ res, req, heartbeat, messages: [{ role: 'user', content: prompt }], requestId: randomUUID(), copilotAction: 'generate-template' });
});

// POST /api/copilot/improve-template -- Suggest improvements for pasted template content
router.post('/improve-template', async (req, res) => {
  const { templateContent } = req.body;

  if (!templateContent || typeof templateContent !== 'string' || !templateContent.trim()) {
    return res.status(400).json({ ok: false, code: 'VALIDATION', error: 'templateContent is required' });
  }

  const heartbeat = initSSE(res);
  res.write('event: start\ndata: ' + JSON.stringify({ type: 'improve-template' }) + '\n\n');

  const prompt = 'Review this QBO escalation response template and suggest improvements:\n\n' +
    templateContent.trim() + '\n\n' +
    'Evaluate and improve:\n' +
    '1. Clarity -- is it easy for a phone agent to read aloud?\n' +
    '2. Accuracy -- are the QBO navigation paths correct and specific?\n' +
    '3. Empathy -- does it acknowledge the customer frustration?\n' +
    '4. Completeness -- does it cover next steps and follow-up?\n' +
    '5. Variables -- are the right fields parameterized?\n\n' +
    'Provide the improved version with explanation of changes.';

  streamClaude({ res, req, heartbeat, messages: [{ role: 'user', content: prompt }], requestId: randomUUID(), copilotAction: 'improve-template' });
});

// ──────────────────────────────────────────────
// ANALYTICS CO-PILOT
// ──────────────────────────────────────────────

// POST /api/copilot/explain-trends -- Explain analytics trends in plain language
router.post('/explain-trends', async (req, res) => {
  // Gather recent analytics data
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [categories, statusCounts, recentEscalations] = await Promise.all([
    Escalation.aggregate([
      { $match: { createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Escalation.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Escalation.find({ createdAt: { $gte: thirtyDaysAgo } })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('category attemptingTo status createdAt')
      .lean(),
  ]);

  const heartbeat = initSSE(res);
  res.write('event: start\ndata: ' + JSON.stringify({ type: 'explain-trends' }) + '\n\n');

  const prompt = 'Analyze these QBO escalation metrics from the past 30 days and provide insights:\n\n' +
    'Category breakdown:\n' + JSON.stringify(categories) +
    '\n\nStatus distribution:\n' + JSON.stringify(statusCounts) +
    '\n\nRecent escalations (newest first):\n' + JSON.stringify(recentEscalations.map((e) => ({
      category: e.category,
      issue: e.attemptingTo,
      status: e.status,
      date: e.createdAt,
    }))) +
    '\n\nProvide:\n' +
    '1. Key trends and patterns (what categories are increasing/decreasing)\n' +
    '2. Potential root causes for spikes\n' +
    '3. Actionable recommendations (staffing, training, process changes)\n' +
    '4. Prediction for next week based on current trends\n' +
    '5. Any concerning patterns that need immediate attention';

  streamClaude({ res, req, heartbeat, messages: [{ role: 'user', content: prompt }], requestId: randomUUID(), copilotAction: 'explain-trends' });
});

// ──────────────────────────────────────────────
// PLAYBOOK CO-PILOT
// ──────────────────────────────────────────────

// POST /api/copilot/playbook-check -- Check if playbook needs updates
router.post('/playbook-check', async (req, res) => {
  const categories = getCategories();
  const systemPrompt = getSystemPrompt();

  // Get recent escalations to compare against playbook
  const recentUnresolved = await Escalation.find({ status: { $in: ['open', 'in-progress'] } })
    .sort({ createdAt: -1 })
    .limit(15)
    .select('category attemptingTo actualOutcome tsSteps')
    .lean();

  const heartbeat = initSSE(res);
  res.write('event: start\ndata: ' + JSON.stringify({ type: 'playbook-check' }) + '\n\n');

  const prompt = 'Review this QBO escalation playbook against recent unresolved escalations.\n\n' +
    'Current playbook categories: ' + categories.join(', ') + '\n\n' +
    'Playbook content (first 5000 chars):\n' + systemPrompt.slice(0, 5000) + '\n\n' +
    'Recent unresolved escalations:\n' + JSON.stringify(recentUnresolved) + '\n\n' +
    'Analyze:\n' +
    '1. Are there escalation patterns NOT covered by the current playbook?\n' +
    '2. Are any playbook sections potentially outdated based on recent issues?\n' +
    '3. What new categories or sections should be added?\n' +
    '4. Are there common troubleshooting steps missing from existing categories?\n' +
    '5. Rate the playbook coverage: what % of recent issues are well-covered?';

  streamClaude({ res, req, heartbeat, messages: [{ role: 'user', content: prompt }], requestId: randomUUID(), copilotAction: 'playbook-check' });
});

// ──────────────────────────────────────────────
// SEARCH CO-PILOT
// ──────────────────────────────────────────────

// POST /api/copilot/search -- Semantic search across escalations
router.post('/search', async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'query required' });
  }

  // First, do a text search for candidates
  let candidates;
  try {
    candidates = await Escalation.find({ $text: { $search: query } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(20)
      .lean();
  } catch {
    // If text index doesn't match, fall back to regex
    const safeQuery = escapeRegex(query);
    candidates = await Escalation.find({
      $or: [
        { attemptingTo: { $regex: safeQuery, $options: 'i' } },
        { actualOutcome: { $regex: safeQuery, $options: 'i' } },
        { tsSteps: { $regex: safeQuery, $options: 'i' } },
        { resolution: { $regex: safeQuery, $options: 'i' } },
        { clientContact: { $regex: safeQuery, $options: 'i' } },
        { caseNumber: { $regex: safeQuery, $options: 'i' } },
      ],
    }).limit(20).lean();
  }

  if (candidates.length === 0) {
    return res.json({ ok: true, results: [], message: 'No matching escalations found' });
  }

  // Use Claude to rank and summarize
  const heartbeat = initSSE(res);
  res.write('event: start\ndata: ' + JSON.stringify({ type: 'search', query, candidateCount: candidates.length }) + '\n\n');

  const prompt = 'The user searched for: "' + query + '"\n\n' +
    'Here are the matching QBO escalations. Rank them by relevance to the search query and provide:\n' +
    '1. A relevance-ranked list with brief explanation of why each matches\n' +
    '2. Key insights from the matching escalations\n' +
    '3. Common resolution patterns across the matches\n\n' +
    'Results:\n' + JSON.stringify(candidates.map((e) => ({
      id: e._id,
      category: e.category,
      status: e.status,
      caseNumber: e.caseNumber,
      clientContact: e.clientContact,
      attemptingTo: e.attemptingTo,
      actualOutcome: e.actualOutcome,
      resolution: e.resolution,
      date: e.createdAt,
    })), null, 2);

  streamClaude({ res, req, heartbeat, messages: [{ role: 'user', content: prompt }], requestId: randomUUID(), copilotAction: 'search' });
});

module.exports = router;
