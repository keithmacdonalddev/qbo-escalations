const express = require('express');
const router = express.Router();
const Conversation = require('../models/Conversation');
const claude = require('../services/claude');
const { getSystemPrompt } = require('../lib/playbook-loader');

// POST /api/chat -- Send message to Claude, returns SSE stream
router.post('/', async (req, res) => {
  const { conversationId, message, images } = req.body;

  if (!message && (!images || images.length === 0)) {
    return res.status(400).json({ ok: false, code: 'MISSING_INPUT', error: 'Message or images required' });
  }

  // Get or create conversation
  let conversation;
  if (conversationId) {
    conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
    }
  } else {
    conversation = new Conversation({
      title: message ? message.slice(0, 80) : 'Image Upload',
      messages: [],
    });
    await conversation.save();
  }

  // Save user message
  const userMsg = {
    role: 'user',
    content: message || '(image attached)',
    images: images || [],
    timestamp: new Date(),
  };
  conversation.messages.push(userMsg);
  await conversation.save();

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send start event with conversation ID
  res.write('event: start\ndata: ' + JSON.stringify({ conversationId: conversation._id.toString() }) + '\n\n');

  // Load playbook system prompt
  const systemPrompt = getSystemPrompt();

  // Build messages for Claude (full history)
  const messagesForClaude = conversation.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Set up heartbeat
  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* client gone */ }
  }, 15000);

  let cleanupFn = null;

  cleanupFn = claude.chat({
    messages: messagesForClaude,
    systemPrompt: systemPrompt,
    images: images,
    onChunk: (text) => {
      try {
        res.write('event: chunk\ndata: ' + JSON.stringify({ text }) + '\n\n');
      } catch { /* client disconnected */ }
    },
    onDone: async (response) => {
      clearInterval(heartbeat);

      // Save assistant response to conversation
      conversation.messages.push({
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      });

      // Auto-generate title from first exchange if still default
      if (conversation.title === 'New Conversation' && conversation.messages.length >= 2) {
        const firstUserMsg = conversation.messages.find((m) => m.role === 'user');
        if (firstUserMsg) {
          conversation.title = firstUserMsg.content.slice(0, 80);
        }
      }

      await conversation.save();

      try {
        res.write('event: done\ndata: ' + JSON.stringify({
          conversationId: conversation._id.toString(),
          fullResponse: response,
        }) + '\n\n');
        res.end();
      } catch { /* client gone */ }
    },
    onError: (err) => {
      clearInterval(heartbeat);
      try {
        res.write('event: error\ndata: ' + JSON.stringify({ error: err.message }) + '\n\n');
        res.end();
      } catch { /* client gone */ }
    },
  });

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    if (cleanupFn) cleanupFn();
  });
});

// POST /api/chat/parse-escalation -- Parse escalation from image/text
router.post('/parse-escalation', async (req, res) => {
  const { image, text } = req.body;

  if (!image && !text) {
    return res.status(400).json({ ok: false, code: 'MISSING_INPUT', error: 'Image or text required' });
  }

  const input = image || text;
  const escalation = await claude.parseEscalation(input);
  res.json({ ok: true, escalation });
});

// GET /api/conversations -- List conversations (with optional search)
router.get('/conversations', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const skip = parseInt(req.query.skip) || parseInt(req.query.offset) || 0;
  const search = (req.query.search || '').trim();

  const filter = search
    ? { title: { $regex: search, $options: 'i' } }
    : {};

  const conversations = await Conversation.find(filter)
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  // Add preview of last message
  const items = conversations.map((c) => {
    const lastMsg = c.messages && c.messages.length > 0
      ? c.messages[c.messages.length - 1]
      : null;
    return {
      _id: c._id,
      title: c.title,
      messageCount: c.messages ? c.messages.length : 0,
      lastMessage: lastMsg ? {
        role: lastMsg.role,
        preview: lastMsg.content.slice(0, 120),
        timestamp: lastMsg.timestamp,
      } : null,
      escalationId: c.escalationId,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  });

  const total = await Conversation.countDocuments(filter);
  res.json({ ok: true, conversations: items, total });
});

// GET /api/conversations/:id -- Get full conversation
router.get('/conversations/:id', async (req, res) => {
  const conversation = await Conversation.findById(req.params.id).lean();
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }
  res.json({ ok: true, conversation });
});

// PATCH /api/conversations/:id -- Update conversation (rename, link to escalation)
router.patch('/conversations/:id', async (req, res) => {
  const { title, escalationId } = req.body;
  const update = {};
  if (typeof title === 'string') update.title = title.slice(0, 200);
  if (escalationId !== undefined) update.escalationId = escalationId || null;

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ ok: false, code: 'NO_FIELDS', error: 'No fields to update' });
  }

  const conversation = await Conversation.findByIdAndUpdate(
    req.params.id,
    { $set: update },
    { new: true }
  ).lean();

  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }
  res.json({ ok: true, conversation });
});

// GET /api/conversations/:id/export -- Export conversation as plain text
router.get('/conversations/:id/export', async (req, res) => {
  const conversation = await Conversation.findById(req.params.id).lean();
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }

  const lines = [
    `Conversation: ${conversation.title}`,
    `Date: ${new Date(conversation.createdAt).toLocaleString()}`,
    `Messages: ${conversation.messages.length}`,
    '---',
    '',
  ];

  for (const msg of conversation.messages) {
    const label = msg.role === 'user' ? 'Agent' : msg.role === 'assistant' ? 'Claude' : 'System';
    const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '';
    lines.push(`[${label}] ${time}`);
    lines.push(msg.content);
    lines.push('');
  }

  const text = lines.join('\n');
  res.json({ ok: true, text });
});

// POST /api/chat/retry -- Retry last message in a conversation (removes bad assistant response, re-sends)
router.post('/retry', async (req, res) => {
  const { conversationId } = req.body;
  if (!conversationId) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'conversationId required' });
  }

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }

  // Remove the last assistant message if it exists
  if (conversation.messages.length > 0) {
    const lastMsg = conversation.messages[conversation.messages.length - 1];
    if (lastMsg.role === 'assistant') {
      conversation.messages.pop();
      await conversation.save();
    }
  }

  // Find the last user message to re-send
  const lastUserMsg = [...conversation.messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) {
    return res.status(400).json({ ok: false, code: 'NO_USER_MSG', error: 'No user message to retry' });
  }

  // Set up SSE and re-run the chat flow
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write('event: start\ndata: ' + JSON.stringify({ conversationId: conversation._id.toString(), retry: true }) + '\n\n');

  const systemPrompt = getSystemPrompt();
  const messagesForClaude = conversation.messages.map((m) => ({ role: m.role, content: m.content }));

  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* gone */ }
  }, 15000);

  let cleanupFn = null;

  cleanupFn = claude.chat({
    messages: messagesForClaude,
    systemPrompt: systemPrompt,
    images: lastUserMsg.images || [],
    onChunk: (text) => {
      try { res.write('event: chunk\ndata: ' + JSON.stringify({ text }) + '\n\n'); } catch { /* gone */ }
    },
    onDone: async (response) => {
      clearInterval(heartbeat);
      conversation.messages.push({ role: 'assistant', content: response, timestamp: new Date() });
      await conversation.save();
      try {
        res.write('event: done\ndata: ' + JSON.stringify({ conversationId: conversation._id.toString(), fullResponse: response }) + '\n\n');
        res.end();
      } catch { /* gone */ }
    },
    onError: (err) => {
      clearInterval(heartbeat);
      try {
        res.write('event: error\ndata: ' + JSON.stringify({ error: err.message }) + '\n\n');
        res.end();
      } catch { /* gone */ }
    },
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    if (cleanupFn) cleanupFn();
  });
});

// DELETE /api/conversations/:id -- Delete conversation
router.delete('/conversations/:id', async (req, res) => {
  const result = await Conversation.findByIdAndDelete(req.params.id);
  if (!result) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Conversation not found' });
  }
  res.json({ ok: true });
});

module.exports = router;
