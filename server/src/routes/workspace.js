'use strict';

const express = require('express');
const gmail = require('../services/gmail');
const calendar = require('../services/calendar');
const { chat } = require('../services/claude');

const router = express.Router();

// ---------------------------------------------------------------------------
// Workspace Agent — System Prompt (role)
// ---------------------------------------------------------------------------

const WORKSPACE_ROLE = [
  'You are the Workspace Agent for the QBO Escalations app.',
  'You manage the user\'s email (Gmail) and calendar (Google Calendar).',
  'The user is Keith MacDonald, a QBO escalation specialist.',
  '',
  'CORE BEHAVIORS:',
  '- When asked to DO something (send, archive, schedule, delete): EXECUTE it using ACTION commands, then confirm what you did.',
  '- When asked to FIND something: search and present structured results.',
  '- When asked to DRAFT: generate content and present for approval before sending.',
  '- Be proactive: if you notice something relevant (upcoming meeting related to an email), mention it.',
  '- Be concise. Execute first, explain second.',
  '',
  'AVAILABLE TOOLS:',
  '- gmail.search: Search emails. Params: { q }',
  '- gmail.send: Send email. Params: { to, subject, body, cc?, bcc?, threadId?, inReplyTo?, references? }',
  '- gmail.archive: Archive message (remove from inbox). Params: { messageId }',
  '- gmail.trash: Trash message. Params: { messageId }',
  '- gmail.star: Star message. Params: { messageId }',
  '- gmail.unstar: Unstar message. Params: { messageId }',
  '- gmail.markRead: Mark as read. Params: { messageId }',
  '- gmail.markUnread: Mark as unread. Params: { messageId }',
  '- gmail.label: Apply label. Params: { messageId, labelId }',
  '- gmail.removeLabel: Remove label. Params: { messageId, labelId }',
  '- gmail.draft: Create draft. Params: { to, subject, body, cc?, bcc? }',
  '- gmail.getMessage: Read a specific email by ID. Params: { messageId }',
  '- gmail.listLabels: List all Gmail labels. Params: none',
  '- calendar.listEvents: List events in a time range. Params: { timeMin, timeMax, q?, calendarId? }',
  '- calendar.createEvent: Create event. Params: { summary, start, end, location?, description?, attendees?, allDay?, timeZone? }',
  '- calendar.updateEvent: Update event. Params: { eventId, summary?, start?, end?, location?, description?, attendees?, calendarId? }',
  '- calendar.deleteEvent: Delete event. Params: { eventId, calendarId? }',
  '- calendar.freeTime: Find free/busy time. Params: { timeMin, timeMax, calendarIds?, timeZone? }',
  '',
  'ACTION FORMAT:',
  'When you need to execute an action, output exactly:',
  'ACTION: {"tool": "tool.name", "params": {...}}',
  'You can execute multiple actions in one response — one ACTION per line.',
  'After actions are executed, you will receive the results and should summarize for the user.',
  '',
  'RULES:',
  '- NEVER fabricate email IDs, event IDs, or other identifiers — always search first.',
  '- When asked to reply to or act on "the email from X" or "my last email", search for it first.',
  '- For dates/times, use ISO 8601 format (e.g., 2026-03-07T14:00:00-05:00).',
  '- Current date/time context will be provided with each prompt.',
  '- Use markdown formatting for readability.',
].join('\n');

// ---------------------------------------------------------------------------
// Tool executor — maps ACTION tool names to service calls
// ---------------------------------------------------------------------------

const TOOL_HANDLERS = {
  'gmail.search': async (params) => {
    return gmail.listMessages({ q: params.q, maxResults: params.maxResults || 10 });
  },
  'gmail.send': async (params) => {
    return gmail.sendMessage({
      to: params.to,
      subject: params.subject,
      body: params.body,
      cc: params.cc,
      bcc: params.bcc,
      threadId: params.threadId,
      inReplyTo: params.inReplyTo,
      references: params.references,
    });
  },
  'gmail.archive': async (params) => {
    return gmail.modifyMessage(params.messageId, { removeLabelIds: ['INBOX'] });
  },
  'gmail.trash': async (params) => {
    return gmail.trashMessage(params.messageId);
  },
  'gmail.star': async (params) => {
    return gmail.modifyMessage(params.messageId, { addLabelIds: ['STARRED'] });
  },
  'gmail.unstar': async (params) => {
    return gmail.modifyMessage(params.messageId, { removeLabelIds: ['STARRED'] });
  },
  'gmail.markRead': async (params) => {
    return gmail.modifyMessage(params.messageId, { removeLabelIds: ['UNREAD'] });
  },
  'gmail.markUnread': async (params) => {
    return gmail.modifyMessage(params.messageId, { addLabelIds: ['UNREAD'] });
  },
  'gmail.label': async (params) => {
    return gmail.modifyMessage(params.messageId, { addLabelIds: [params.labelId] });
  },
  'gmail.removeLabel': async (params) => {
    return gmail.modifyMessage(params.messageId, { removeLabelIds: [params.labelId] });
  },
  'gmail.draft': async (params) => {
    return gmail.createDraft({
      to: params.to,
      subject: params.subject,
      body: params.body,
      cc: params.cc,
      bcc: params.bcc,
    });
  },
  'gmail.getMessage': async (params) => {
    return gmail.getMessage(params.messageId);
  },
  'gmail.listLabels': async () => {
    return gmail.listLabels();
  },
  'calendar.listEvents': async (params) => {
    return calendar.listEvents({
      calendarId: params.calendarId || 'primary',
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      q: params.q,
      maxResults: params.maxResults || 50,
    });
  },
  'calendar.createEvent': async (params) => {
    return calendar.createEvent(params.calendarId || 'primary', {
      summary: params.summary,
      description: params.description,
      location: params.location,
      start: params.start,
      end: params.end,
      allDay: params.allDay,
      timeZone: params.timeZone,
      attendees: params.attendees,
    });
  },
  'calendar.updateEvent': async (params) => {
    const { eventId, calendarId, ...updates } = params;
    return calendar.updateEvent(calendarId || 'primary', eventId, updates);
  },
  'calendar.deleteEvent': async (params) => {
    return calendar.deleteEvent(params.calendarId || 'primary', params.eventId);
  },
  'calendar.freeTime': async (params) => {
    return calendar.findFreeTime(
      params.calendarIds || ['primary'],
      params.timeMin,
      params.timeMax,
      params.timeZone,
    );
  },
};

/**
 * Parse ACTION: {...} blocks from Claude's response text.
 * Returns an array of { tool, params } objects.
 */
function parseActions(text) {
  const actions = [];
  const regex = /ACTION:\s*(\{[\s\S]*?\})\s*(?=\n|$)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.tool && typeof parsed.tool === 'string') {
        actions.push({ tool: parsed.tool, params: parsed.params || {} });
      }
    } catch {
      // Malformed JSON — skip this action
    }
  }
  return actions;
}

/**
 * Execute a list of parsed actions and return results.
 */
async function executeActions(actions) {
  const results = [];
  for (const action of actions) {
    const handler = TOOL_HANDLERS[action.tool];
    if (!handler) {
      results.push({ tool: action.tool, error: `Unknown tool: ${action.tool}` });
      continue;
    }
    try {
      const result = await handler(action.params);
      results.push({ tool: action.tool, result });
    } catch (err) {
      results.push({ tool: action.tool, error: err.message || 'Execution failed' });
    }
  }
  return results;
}

/**
 * Collect the full response from a Claude CLI chat() call.
 * Returns a promise that resolves with the full text.
 */
function collectChatResponse({ messages, systemPrompt }) {
  return new Promise((resolve, reject) => {
    let fullText = '';
    chat({
      messages,
      systemPrompt,
      onChunk: (text) => { fullText += text; },
      onDone: () => { resolve(fullText); },
      onError: (err) => { reject(err); },
    });
  });
}

// ---------------------------------------------------------------------------
// POST /api/workspace/ai — Workspace Agent endpoint with SSE streaming
//
// Two-pass approach:
//   Pass 1: Send user prompt to Claude, collect full response.
//   Pass 2: If response contains ACTION blocks, execute them,
//           then ask Claude for a user-facing summary. Stream pass 2.
//   If no actions, stream pass 1 directly.
// ---------------------------------------------------------------------------

router.post('/ai', async (req, res) => {
  const { prompt, context, conversationHistory } = req.body || {};

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ ok: false, code: 'MISSING_PROMPT', error: 'prompt is required' });
  }

  // Build the full prompt with context
  const now = new Date();
  let fullPrompt = `[Current time: ${now.toISOString()} | ${now.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}]\n\n`;

  if (context && typeof context === 'object') {
    const parts = [];
    if (context.view) parts.push(`Current view: ${context.view}`);
    if (context.emailId) parts.push(`Currently viewing email ID: ${context.emailId}`);
    if (context.emailSubject) parts.push(`Email subject: ${context.emailSubject}`);
    if (context.emailFrom) parts.push(`Email from: ${context.emailFrom}`);
    if (context.emailBody) {
      const bodyText = context.emailBody.length > 4000
        ? context.emailBody.slice(0, 4000) + '\n... (truncated)'
        : context.emailBody;
      parts.push(`Email body:\n${bodyText}`);
    }
    if (context.selectedDate) parts.push(`Selected calendar date: ${context.selectedDate}`);
    if (context.selectedEvent) parts.push(`Selected event: ${JSON.stringify(context.selectedEvent)}`);
    if (parts.length > 0) {
      fullPrompt += '--- Current Context ---\n' + parts.join('\n') + '\n--- End Context ---\n\n';
    }
  }

  fullPrompt += prompt.trim();

  // Build messages array from conversation history
  const messages = [];
  if (Array.isArray(conversationHistory)) {
    for (const msg of conversationHistory.slice(-20)) {
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

  res.write('event: start\ndata: ' + JSON.stringify({ ok: true }) + '\n\n');

  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* client gone */ }
  }, 15000);

  let clientDisconnected = false;
  req.on('close', () => { clientDisconnected = true; clearInterval(heartbeat); });

  try {
    // Pass 1: Get Claude's response (may contain ACTION blocks)
    const pass1Response = await collectChatResponse({
      messages,
      systemPrompt: WORKSPACE_ROLE,
    });

    if (clientDisconnected) return;

    // Check for ACTION blocks
    const actions = parseActions(pass1Response);

    if (actions.length === 0) {
      // No actions — stream the response as-is (send as one chunk since we already collected it)
      try {
        res.write('event: chunk\ndata: ' + JSON.stringify({ text: pass1Response }) + '\n\n');
        res.write('event: done\ndata: ' + JSON.stringify({ ok: true, fullResponse: pass1Response, actions: [] }) + '\n\n');
        res.end();
      } catch { /* client disconnected */ }
      clearInterval(heartbeat);
      return;
    }

    // Send a status event so the client knows actions are being executed
    try {
      res.write('event: status\ndata: ' + JSON.stringify({
        message: `Executing ${actions.length} action${actions.length > 1 ? 's' : ''}...`,
        actions: actions.map((a) => a.tool),
      }) + '\n\n');
    } catch { /* client disconnected */ }

    // Execute actions
    const actionResults = await executeActions(actions);

    if (clientDisconnected) return;

    // Send action results event
    try {
      res.write('event: actions\ndata: ' + JSON.stringify({ results: actionResults }) + '\n\n');
    } catch { /* client disconnected */ }

    // Pass 2: Ask Claude for a user-facing summary with the action results
    const resultsPrompt = [
      'You just attempted to execute the following actions. Here are the results:',
      '',
      JSON.stringify(actionResults, null, 2),
      '',
      'Summarize what happened for the user in a clear, concise way.',
      'If any actions failed, explain the failure.',
      'If actions returned data (like search results), present the most relevant information.',
      'Do NOT include any ACTION commands in your response this time.',
    ].join('\n');

    // Build pass 2 messages: original conversation + pass 1 + results
    const pass2Messages = [
      ...messages,
      { role: 'assistant', content: pass1Response },
      { role: 'user', content: resultsPrompt },
    ];

    // Stream pass 2 response directly to client
    const cleanup = chat({
      messages: pass2Messages,
      systemPrompt: WORKSPACE_ROLE,
      onChunk: (text) => {
        if (clientDisconnected) return;
        try {
          res.write('event: chunk\ndata: ' + JSON.stringify({ text }) + '\n\n');
        } catch { /* client disconnected */ }
      },
      onDone: (fullResponse) => {
        clearInterval(heartbeat);
        if (clientDisconnected) return;
        try {
          res.write('event: done\ndata: ' + JSON.stringify({
            ok: true,
            fullResponse,
            actions: actionResults,
          }) + '\n\n');
          res.end();
        } catch { /* client disconnected */ }
      },
      onError: (err) => {
        clearInterval(heartbeat);
        console.error('[Workspace AI] Pass 2 error:', err.message);
        if (clientDisconnected) return;
        try {
          // Fall back to a simple summary of action results
          const fallback = actionResults.map((r) => {
            if (r.error) return `- ${r.tool}: FAILED — ${r.error}`;
            return `- ${r.tool}: completed successfully`;
          }).join('\n');
          res.write('event: chunk\ndata: ' + JSON.stringify({ text: fallback }) + '\n\n');
          res.write('event: done\ndata: ' + JSON.stringify({ ok: true, fullResponse: fallback, actions: actionResults }) + '\n\n');
          res.end();
        } catch { /* client disconnected */ }
      },
    });

    req.on('close', () => {
      if (typeof cleanup === 'function') cleanup();
    });

  } catch (err) {
    clearInterval(heartbeat);
    console.error('[Workspace AI] error:', err.message);
    if (!clientDisconnected) {
      try {
        res.write('event: error\ndata: ' + JSON.stringify({
          ok: false,
          code: err.code || 'AI_ERROR',
          error: err.message || 'Workspace agent error',
        }) + '\n\n');
        res.end();
      } catch { /* client disconnected */ }
    }
  }
});

module.exports = router;
