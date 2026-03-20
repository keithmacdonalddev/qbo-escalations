'use strict';

const express = require('express');
const gmail = require('../services/gmail');
const { chat } = require('../services/claude');
const {
  createAiOperation,
  updateAiOperation,
  recordAiChunk,
  recordAiEvent,
  attachAiOperationController,
  deleteAiOperation,
} = require('../services/ai-runtime');
const { reportServerError } = require('../lib/server-error-pipeline');
const { logUsage } = require('../lib/usage-writer');
const { calculateCost } = require('../lib/pricing');
const { randomUUID } = require('node:crypto');

const router = express.Router();

// ---------------------------------------------------------------------------
// Auth endpoints (placed BEFORE data endpoints)
// ---------------------------------------------------------------------------

// GET /api/gmail/auth/status — check if Gmail is connected
router.get('/auth/status', async (req, res) => {
  try {
    const result = await gmail.getAuthStatus();
    res.json(result);
  } catch (err) {
    console.error('[Gmail] auth/status error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// GET /api/gmail/auth/url — get Google OAuth consent URL
router.get('/auth/url', async (req, res) => {
  try {
    const { returnTo } = req.query;
    const url = gmail.getAuthUrl(returnTo || undefined);
    if (!url) {
      return res.status(500).json({
        ok: false,
        code: 'GMAIL_APP_NOT_CONFIGURED',
        error: 'Gmail API credentials are not configured on the server.',
      });
    }
    res.json({ ok: true, url });
  } catch (err) {
    console.error('[Gmail] auth/url error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// GET /api/gmail/auth/callback — Google redirects here after user consents
// This is a browser redirect, NOT a JSON API call — it returns HTML to redirect the user.
// In dev, Vite runs on a separate port so we redirect there; in prod the server serves the client.
const GMAIL_CLIENT_ORIGIN = process.env.GMAIL_CLIENT_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5174');
router.get('/auth/callback', async (req, res) => {
  const { code, error: authError, state } = req.query;

  // Parse returnTo from OAuth state (if provided)
  let returnTo = '/gmail';
  try {
    if (state) {
      const parsed = JSON.parse(state);
      if (parsed.returnTo && typeof parsed.returnTo === 'string') {
        returnTo = parsed.returnTo;
      }
    }
  } catch { /* ignore malformed state */ }

  if (authError) {
    console.error('[Gmail] OAuth callback error:', authError);
    return res.redirect(`${GMAIL_CLIENT_ORIGIN}/#${returnTo}?error=${encodeURIComponent(authError)}`);
  }

  if (!code) {
    return res.redirect(`${GMAIL_CLIENT_ORIGIN}/#${returnTo}?error=no_code`);
  }

  try {
    const { email } = await gmail.handleCallback(code);
    console.log(`[Gmail] Successfully connected: ${email}`);
    res.redirect(`${GMAIL_CLIENT_ORIGIN}/#${returnTo}?connected=true`);
  } catch (err) {
    console.error('[Gmail] OAuth callback exchange error:', err.message);
    res.redirect(`${GMAIL_CLIENT_ORIGIN}/#${returnTo}?error=${encodeURIComponent(err.message)}`);
  }
});

// POST /api/gmail/auth/disconnect — revoke tokens and disconnect
// Accepts optional { email } body to disconnect a specific account
router.post('/auth/disconnect', async (req, res) => {
  try {
    const { email } = req.body || {};
    await gmail.disconnect(email || undefined);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Gmail] disconnect error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Multi-account endpoints
// ---------------------------------------------------------------------------

// GET /api/gmail/accounts — list all connected accounts
router.get('/accounts', async (req, res) => {
  try {
    const result = await gmail.listAccounts();
    res.json(result);
  } catch (err) {
    console.error('[Gmail] listAccounts error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// POST /api/gmail/accounts/switch — switch active account
router.post('/accounts/switch', async (req, res) => {
  try {
    const { email } = req.body;
    const result = await gmail.switchAccount(email);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[Gmail] switchAccount error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Unified Inbox endpoints (cross-account merged view)
// ---------------------------------------------------------------------------

// GET /api/gmail/unified — merged inbox from ALL connected accounts
router.get('/unified', async (req, res) => {
  try {
    const { q, maxResults, pageTokens } = req.query;
    // pageTokens arrives as JSON-encoded object, e.g. ?pageTokens={"a@b.com":"token1"}
    let parsedPageTokens = {};
    if (pageTokens) {
      try { parsedPageTokens = JSON.parse(pageTokens); } catch { /* ignore malformed */ }
    }
    const result = await gmail.listUnifiedMessages({
      q: q || undefined,
      maxResults: maxResults && Number.isFinite(parseInt(maxResults, 10)) ? parseInt(maxResults, 10) : 25,
      pageTokens: parsedPageTokens,
    });
    res.json(result);
  } catch (err) {
    console.error('[Gmail] unified inbox error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// GET /api/gmail/unified/unread-counts — per-account unread counts
router.get('/unified/unread-counts', async (req, res) => {
  try {
    const result = await gmail.getUnifiedUnreadCounts();
    res.json(result);
  } catch (err) {
    console.error('[Gmail] unified unread-counts error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Filter endpoints
// ---------------------------------------------------------------------------

// GET /api/gmail/filters — list all Gmail filters
router.get('/filters', async (req, res) => {
  try {
    const result = await gmail.listFilters(req.query.account || undefined);
    res.json(result);
  } catch (err) {
    console.error('[Gmail] listFilters error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// POST /api/gmail/filters — create a new Gmail filter
router.post('/filters', async (req, res) => {
  try {
    const { criteria, action, account } = req.body;
    if (!criteria || !action) {
      return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'criteria and action are required' });
    }
    const result = await gmail.createFilter({ criteria, action, accountEmail: account || undefined });
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[Gmail] createFilter error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// DELETE /api/gmail/filters/:id — delete a Gmail filter
router.delete('/filters/:id', async (req, res) => {
  try {
    const result = await gmail.deleteFilter(req.params.id, req.query.account || undefined);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[Gmail] deleteFilter error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Data endpoints (require connected Gmail)
// ---------------------------------------------------------------------------

// GET /api/gmail/profile
router.get('/profile', async (req, res) => {
  try {
    const accountEmail = req.query.account;
    const result = await gmail.getProfile(accountEmail || undefined);
    res.json(result);
  } catch (err) {
    console.error('[Gmail] getProfile error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// GET /api/gmail/subscriptions — scan recent messages for subscription senders
router.get('/subscriptions', async (req, res) => {
  try {
    const { maxScan, account } = req.query;
    const result = await gmail.scanSubscriptions({
      maxScan: maxScan && Number.isFinite(parseInt(maxScan, 10)) ? parseInt(maxScan, 10) : 300,
      accountEmail: account || undefined,
    });
    res.json(result);
  } catch (err) {
    console.error('[Gmail] scanSubscriptions error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// GET /api/gmail/messages?q=...&maxResults=...&pageToken=...&labelIds=...&account=...&includeSpamTrash=...&idsOnly=...
router.get('/messages', async (req, res) => {
  try {
    const { q, maxResults, pageToken, labelIds, account, includeSpamTrash, idsOnly } = req.query;
    const result = await gmail.listMessages({
      q: q || undefined,
      maxResults: maxResults && Number.isFinite(parseInt(maxResults, 10)) ? parseInt(maxResults, 10) : 20,
      pageToken: pageToken || undefined,
      labelIds: labelIds || undefined,
      includeSpamTrash: includeSpamTrash === 'true' || includeSpamTrash === '1' || false,
      idsOnly: idsOnly === 'true' || idsOnly === '1' || false,
      accountEmail: account || undefined,
    });
    res.json(result);
  } catch (err) {
    console.error('[Gmail] listMessages error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// GET /api/gmail/messages/:id
router.get('/messages/:id', async (req, res) => {
  try {
    const accountEmail = req.query.account;
    const result = await gmail.getMessage(req.params.id, accountEmail || undefined);

    // Strip tracking pixels from HTML bodies
    if (result.ok && result.bodyType === 'html' && result.body) {
      const { cleanHtml, trackers, trackerCount } = gmail.stripTrackingPixels(result.body);
      result.body = cleanHtml;
      result.trackers = trackers;
      result.trackerCount = trackerCount;
    } else {
      result.trackers = [];
      result.trackerCount = 0;
    }

    res.json(result);
  } catch (err) {
    console.error('[Gmail] getMessage error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// GET /api/gmail/labels
router.get('/labels', async (req, res) => {
  try {
    const accountEmail = req.query.account;
    const result = await gmail.listLabels(accountEmail || undefined);
    res.json(result);
  } catch (err) {
    console.error('[Gmail] listLabels error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// POST /api/gmail/labels — create a new label
router.post('/labels', async (req, res) => {
  try {
    const { name, labelListVisibility, messageListVisibility, account } = req.body;
    const result = await gmail.createLabel(name, { labelListVisibility, messageListVisibility }, account || undefined);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[Gmail] createLabel error:', err.message);
    // Gmail API returns 409 if label already exists
    const status = err.code === 409 || err.status === 409 ? 409 : 500;
    res.status(status).json({ ok: false, code: status === 409 ? 'LABEL_EXISTS' : 'GMAIL_ERROR', error: err.message });
  }
});

// POST /api/gmail/drafts
router.post('/drafts', async (req, res) => {
  try {
    const { to, subject, body, cc, bcc, account } = req.body;
    const result = await gmail.createDraft({ to, subject, body, cc, bcc, accountEmail: account || undefined });
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[Gmail] createDraft error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Send endpoints
// ---------------------------------------------------------------------------

// POST /api/gmail/messages/send — send a new email
router.post('/messages/send', async (req, res) => {
  try {
    const { to, cc, bcc, subject, body, threadId, inReplyTo, references, account } = req.body;
    const result = await gmail.sendMessage({ to, cc, bcc, subject, body, threadId, inReplyTo, references, accountEmail: account || undefined });
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[Gmail] sendMessage error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// POST /api/gmail/drafts/:id/send — send an existing draft
router.post('/drafts/:id/send', async (req, res) => {
  try {
    const accountEmail = (req.body && req.body.account) || undefined;
    const result = await gmail.sendDraft(req.params.id, accountEmail);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[Gmail] sendDraft error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Message modification endpoints
// ---------------------------------------------------------------------------

// PATCH /api/gmail/messages/batch — bulk modify labels on multiple messages
// NOTE: this MUST come before /messages/:id to avoid matching "batch" as an :id
router.patch('/messages/batch', async (req, res) => {
  try {
    const { messageIds, addLabelIds, removeLabelIds, account } = req.body;
    const result = await gmail.batchModify(messageIds, { addLabelIds, removeLabelIds, accountEmail: account || undefined });
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[Gmail] batchModify error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// PATCH /api/gmail/messages/:id — modify labels on a single message
router.patch('/messages/:id', async (req, res) => {
  try {
    const { addLabelIds, removeLabelIds, account } = req.body;
    const result = await gmail.modifyMessage(req.params.id, { addLabelIds, removeLabelIds, accountEmail: account || undefined });
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[Gmail] modifyMessage error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// DELETE /api/gmail/messages/:id — trash a message
router.delete('/messages/:id', async (req, res) => {
  try {
    const accountEmail = req.query.account || undefined;
    const result = await gmail.trashMessage(req.params.id, accountEmail);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[Gmail] trashMessage error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// POST /api/gmail/messages/:id/untrash — restore from trash
router.post('/messages/:id/untrash', async (req, res) => {
  try {
    const accountEmail = (req.body && req.body.account) || undefined;
    const result = await gmail.untrashMessage(req.params.id, accountEmail);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[Gmail] untrashMessage error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// AI email assistant endpoint (SSE streaming)
// ---------------------------------------------------------------------------

const GMAIL_AI_SYSTEM_PROMPT = [
  'You are an AI email assistant integrated into a QBO escalation workspace.',
  'You help the user manage their Gmail: searching emails, summarizing threads,',
  'drafting replies, and answering questions about their inbox.',
  '',
  'Guidelines:',
  '- When asked to summarize an email, provide a concise summary with key points, action items, and sender intent.',
  '- When asked to draft a reply, write a professional, clear response that addresses the original email.',
  '- When given email context (subject, sender, body), use it to provide relevant, contextual assistance.',
  '- Keep responses focused and actionable.',
  '- Use markdown formatting for readability.',
  '- For draft replies, output ONLY the reply body text (no subject line, no "Dear..." unless appropriate).',
].join('\n');

// POST /api/gmail/ai — AI email assistant with SSE streaming
router.post('/ai', async (req, res) => {
  const { prompt, emailContext, conversationHistory } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ ok: false, code: 'MISSING_PROMPT', error: 'prompt is required' });
  }

  // Build the full prompt with optional email context
  let fullPrompt = prompt.trim();
  if (emailContext && typeof emailContext === 'object') {
    const contextParts = ['--- Current Email Context ---'];
    if (emailContext.from) contextParts.push(`From: ${emailContext.from}`);
    if (emailContext.fromEmail) contextParts.push(`Email: ${emailContext.fromEmail}`);
    if (emailContext.to) contextParts.push(`To: ${emailContext.to}`);
    if (emailContext.subject) contextParts.push(`Subject: ${emailContext.subject}`);
    if (emailContext.date) contextParts.push(`Date: ${emailContext.date}`);
    if (emailContext.body) {
      // Truncate very long email bodies to avoid exceeding context limits
      const bodyText = emailContext.body.length > 8000
        ? emailContext.body.slice(0, 8000) + '\n... (truncated)'
        : emailContext.body;
      contextParts.push(`\nBody:\n${bodyText}`);
    }
    contextParts.push('--- End Email Context ---\n');
    fullPrompt = contextParts.join('\n') + '\n' + fullPrompt;
  }

  // Build messages array for claude.js chat()
  const messages = [];
  if (Array.isArray(conversationHistory)) {
    for (const msg of conversationHistory.slice(-10)) {
      if (msg && (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
  }
  messages.push({ role: 'user', content: fullPrompt });

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send start event
  res.write('event: start\ndata: ' + JSON.stringify({ ok: true }) + '\n\n');

  const runtimeOperation = createAiOperation({
    kind: 'gmail',
    route: '/api/gmail/ai',
    action: 'gmail-ai',
    provider: 'claude',
    mode: 'single',
    promptPreview: prompt,
    hasImages: false,
    messageCount: messages.length,
    providers: ['claude'],
  });
  const runtimeOperationId = runtimeOperation.id;
  let streamSettled = false;

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* client gone */ }
  }, 15000);

  const cleanup = chat({
    messages,
    systemPrompt: GMAIL_AI_SYSTEM_PROMPT,
    onChunk: (text) => {
      recordAiChunk(runtimeOperationId, text, { provider: 'claude' });
      try {
        res.write('event: chunk\ndata: ' + JSON.stringify({ text }) + '\n\n');
      } catch { /* client disconnected */ }
    },
    onDone: (fullResponse, usageMeta) => {
      streamSettled = true;
      clearInterval(heartbeat);
      recordAiEvent(runtimeOperationId, 'completed', { provider: 'claude' });
      // Build usage payload for client
      const usageForClient = usageMeta ? (() => {
        const inp = usageMeta.inputTokens || 0;
        const out = usageMeta.outputTokens || 0;
        const c = calculateCost(inp, out, usageMeta.model || '', 'claude');
        return {
          inputTokens: inp,
          outputTokens: out,
          totalTokens: inp + out,
          model: usageMeta.model || '',
          totalCostMicros: c.totalCostMicros,
        };
      })() : null;
      try {
        res.write('event: done\ndata: ' + JSON.stringify({ ok: true, fullResponse, usage: usageForClient }) + '\n\n');
        res.end();
      } catch { /* client disconnected */ }
      deleteAiOperation(runtimeOperationId);
      // Log usage for Gmail AI
      const u = usageMeta || {};
      logUsage({
        requestId: randomUUID(),
        attemptIndex: 0,
        service: 'gmail',
        provider: 'claude',
        model: u.model,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        usageAvailable: !!usageMeta,
        usageComplete: u.usageComplete,
        rawUsage: u.rawUsage,
        mode: 'single',
        status: 'ok',
        latencyMs: 0,
      });
    },
    onError: (err) => {
      streamSettled = true;
      clearInterval(heartbeat);
      console.error('[Gmail AI] error:', err.message);
      recordAiEvent(runtimeOperationId, 'error', {
        lastError: {
          code: err.code || 'AI_ERROR',
          message: err.message || 'AI assistant error',
          detail: '',
        },
      });
      reportServerError({
        route: '/api/gmail/ai',
        message: err.message || 'Gmail AI assistant failed',
        code: err.code || 'AI_ERROR',
        detail: err.stack || '',
        severity: 'error',
      });
      try {
        res.write('event: error\ndata: ' + JSON.stringify({
          ok: false,
          code: err.code || 'AI_ERROR',
          error: err.message || 'AI assistant error',
        }) + '\n\n');
        res.end();
      } catch { /* client disconnected */ }
      deleteAiOperation(runtimeOperationId);
      // Log usage for Gmail AI error
      const eu = (err && err._usage) || {};
      logUsage({
        requestId: randomUUID(),
        attemptIndex: 0,
        service: 'gmail',
        provider: 'claude',
        model: eu.model,
        inputTokens: eu.inputTokens,
        outputTokens: eu.outputTokens,
        usageAvailable: !!(err && err._usage),
        usageComplete: eu.usageComplete,
        rawUsage: eu.rawUsage,
        mode: 'single',
        status: 'error',
        latencyMs: 0,
      });
    },
  });

  attachAiOperationController(runtimeOperationId, {
    abort: (reason = 'Gmail AI request aborted by supervisor') => {
      if (streamSettled) return;
      streamSettled = true;
      clearInterval(heartbeat);
      updateAiOperation(runtimeOperationId, {
        phase: 'aborting',
        lastError: {
          code: 'AUTO_ABORT',
          message: reason,
          detail: '',
        },
      });
      try { if (typeof cleanup === 'function') cleanup(); } catch { /* ignore */ }
      try {
        res.write('event: error\ndata: ' + JSON.stringify({
          ok: false,
          code: 'AUTO_ABORT',
          error: reason,
        }) + '\n\n');
        res.end();
      } catch { /* client disconnected */ }
      deleteAiOperation(runtimeOperationId);
    },
  });

  // Handle client disconnect
  res.on('close', () => {
    clearInterval(heartbeat);
    if (!streamSettled) {
      updateAiOperation(runtimeOperationId, {
        clientConnected: false,
        phase: 'aborting',
      });
      try { if (typeof cleanup === 'function') cleanup(); } catch { /* ignore */ }
      deleteAiOperation(runtimeOperationId);
    }
  });
});

module.exports = router;
