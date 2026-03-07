'use strict';

const express = require('express');
const gmail = require('../services/gmail');
const { chat } = require('../services/claude');

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
router.post('/auth/disconnect', async (req, res) => {
  try {
    await gmail.disconnect();
    res.json({ ok: true });
  } catch (err) {
    console.error('[Gmail] disconnect error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Data endpoints (require connected Gmail)
// ---------------------------------------------------------------------------

// GET /api/gmail/profile
router.get('/profile', async (req, res) => {
  try {
    const result = await gmail.getProfile();
    res.json(result);
  } catch (err) {
    console.error('[Gmail] getProfile error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// GET /api/gmail/messages?q=...&maxResults=...&pageToken=...&labelIds=...
router.get('/messages', async (req, res) => {
  try {
    const { q, maxResults, pageToken, labelIds } = req.query;
    const result = await gmail.listMessages({
      q: q || undefined,
      maxResults: maxResults && Number.isFinite(parseInt(maxResults, 10)) ? parseInt(maxResults, 10) : 20,
      pageToken: pageToken || undefined,
      labelIds: labelIds || undefined,
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
    const result = await gmail.getMessage(req.params.id);
    res.json(result);
  } catch (err) {
    console.error('[Gmail] getMessage error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// GET /api/gmail/labels
router.get('/labels', async (req, res) => {
  try {
    const result = await gmail.listLabels();
    res.json(result);
  } catch (err) {
    console.error('[Gmail] listLabels error:', err.message);
    res.status(500).json({ ok: false, code: 'GMAIL_ERROR', error: err.message });
  }
});

// POST /api/gmail/drafts
router.post('/drafts', async (req, res) => {
  try {
    const { to, subject, body, cc, bcc } = req.body;
    const result = await gmail.createDraft({ to, subject, body, cc, bcc });
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
    const { to, cc, bcc, subject, body, threadId, inReplyTo, references } = req.body;
    const result = await gmail.sendMessage({ to, cc, bcc, subject, body, threadId, inReplyTo, references });
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
    const result = await gmail.sendDraft(req.params.id);
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
    const { messageIds, addLabelIds, removeLabelIds } = req.body;
    const result = await gmail.batchModify(messageIds, { addLabelIds, removeLabelIds });
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
    const { addLabelIds, removeLabelIds } = req.body;
    const result = await gmail.modifyMessage(req.params.id, { addLabelIds, removeLabelIds });
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
    const result = await gmail.trashMessage(req.params.id);
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
    const result = await gmail.untrashMessage(req.params.id);
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

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* client gone */ }
  }, 15000);

  const cleanup = chat({
    messages,
    systemPrompt: GMAIL_AI_SYSTEM_PROMPT,
    onChunk: (text) => {
      try {
        res.write('event: chunk\ndata: ' + JSON.stringify({ text }) + '\n\n');
      } catch { /* client disconnected */ }
    },
    onDone: (fullResponse) => {
      clearInterval(heartbeat);
      try {
        res.write('event: done\ndata: ' + JSON.stringify({ ok: true, fullResponse }) + '\n\n');
        res.end();
      } catch { /* client disconnected */ }
    },
    onError: (err) => {
      clearInterval(heartbeat);
      console.error('[Gmail AI] error:', err.message);
      try {
        res.write('event: error\ndata: ' + JSON.stringify({
          ok: false,
          code: err.code || 'AI_ERROR',
          error: err.message || 'AI assistant error',
        }) + '\n\n');
        res.end();
      } catch { /* client disconnected */ }
    },
  });

  // Handle client disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    if (typeof cleanup === 'function') cleanup();
  });
});

module.exports = router;
