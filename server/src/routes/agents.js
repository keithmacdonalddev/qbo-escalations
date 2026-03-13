'use strict';

const express = require('express');
const {
  createAgentSession,
  getAgentSession,
  updateAgentSession,
  appendAgentSessionEvent,
  getAgentSessionEventsSince,
  listAgentSessions,
  subscribeAgentSession,
  setAgentSessionController,
  abortAgentSession,
  attachAgentClient,
  detachAgentClient,
} = require('../services/agent-session-runtime');

const router = express.Router();

function getBaseUrl(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol = forwardedProto ? String(forwardedProto).split(',')[0].trim() : req.protocol || 'http';
  return `${protocol}://${req.get('host')}`;
}

function createSseParser(onEvent) {
  let buffer = '';
  let eventName = '';
  let dataLines = [];

  function reset() {
    eventName = '';
    dataLines = [];
  }

  function flush() {
    if (!eventName && dataLines.length === 0) return;
    const raw = dataLines.join('\n');
    if (!raw) {
      reset();
      return;
    }
    let parsed = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // keep raw text
    }
    onEvent(eventName || 'message', parsed);
    reset();
  }

  function processLine(rawLine) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line) {
      flush();
      return;
    }
    if (line.startsWith(':')) return;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      return;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  return {
    push(text) {
      if (!text) return;
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) processLine(line);
    },
    finish() {
      if (buffer) processLine(buffer);
      flush();
    },
  };
}

async function runWorkspaceSession(sessionId, baseUrl, input) {
  const controller = new AbortController();
  setAgentSessionController(sessionId, {
    abort(reason = 'Agent session aborted') {
      controller.abort(reason);
      updateAgentSession(sessionId, { status: 'aborted', lastError: reason });
      appendAgentSessionEvent(sessionId, 'error', {
        ok: false,
        code: 'ABORTED',
        error: reason,
      });
    },
  });

  updateAgentSession(sessionId, {
    status: 'running',
    metadata: {
      ...(input?.context?.view ? { view: input.context.view } : {}),
    },
  });

  try {
    const response = await fetch(`${baseUrl}/api/workspace/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input || {}),
      signal: controller.signal,
    });

    if (!response.ok) {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = { error: response.statusText };
      }
      updateAgentSession(sessionId, {
        status: 'error',
        lastError: payload?.error || 'Workspace session failed',
      });
      appendAgentSessionEvent(sessionId, 'error', {
        ok: false,
        code: payload?.code || 'SESSION_START_FAILED',
        error: payload?.error || 'Workspace session failed',
      });
      return;
    }

    const parser = createSseParser((eventType, data) => {
      if (eventType === 'start') {
        updateAgentSession(sessionId, {
          status: 'running',
          metadata: {
            conversationSessionId: data?.conversationSessionId || null,
            workspaceRuntimeSessionId: data?.sessionId || null,
            provider: data?.provider || data?.primaryProvider || null,
            fallbackProvider: data?.fallbackProvider || null,
            mode: data?.mode || null,
          },
        });
      } else if (eventType === 'done') {
        updateAgentSession(sessionId, { status: 'done' });
      } else if (eventType === 'error') {
        updateAgentSession(sessionId, {
          status: 'error',
          lastError: data?.error || 'Workspace session failed',
        });
      } else if (eventType === 'status') {
        updateAgentSession(sessionId, {
          metadata: {
            phase: data?.phase || null,
            elapsedMs: data?.elapsedMs || null,
          },
        });
      }

      appendAgentSessionEvent(sessionId, eventType, data);
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) {
      updateAgentSession(sessionId, {
        status: 'error',
        lastError: 'Workspace response stream missing',
      });
      appendAgentSessionEvent(sessionId, 'error', {
        ok: false,
        code: 'NO_STREAM',
        error: 'Workspace response stream missing',
      });
      return;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.finish();

    const finalSession = getAgentSession(sessionId);
    if (finalSession && finalSession.status === 'running') {
      updateAgentSession(sessionId, { status: 'done' });
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    updateAgentSession(sessionId, {
      status: 'error',
      lastError: err.message || 'Workspace session failed',
    });
    appendAgentSessionEvent(sessionId, 'error', {
      ok: false,
      code: 'SESSION_STREAM_FAILED',
      error: err.message || 'Workspace session failed',
    });
  } finally {
    setAgentSessionController(sessionId, null);
  }
}

router.get('/sessions', (req, res) => {
  const agentType = req.query.agentType ? String(req.query.agentType) : undefined;
  const activeOnly = req.query.activeOnly === 'true';
  res.json({
    ok: true,
    sessions: listAgentSessions({ agentType, activeOnly }),
  });
});

router.post('/sessions', (req, res) => {
  const { agentType, title, input } = req.body || {};
  if (agentType !== 'workspace') {
    return res.status(400).json({
      ok: false,
      code: 'UNSUPPORTED_AGENT_TYPE',
      error: 'Only workspace sessions are supported by the shared session runtime right now',
    });
  }
  if (!input || typeof input.prompt !== 'string' || !input.prompt.trim()) {
    return res.status(400).json({
      ok: false,
      code: 'MISSING_PROMPT',
      error: 'input.prompt is required',
    });
  }

  const session = createAgentSession({
    agentType,
    title: title || 'Workspace Agent',
    metadata: {
      view: input?.context?.view || null,
      promptPreview: String(input.prompt).trim().slice(0, 180),
    },
  });

  appendAgentSessionEvent(session.id, 'created', {
    ok: true,
    sessionId: session.id,
    createdAt: session.createdAt,
  });

  runWorkspaceSession(session.id, getBaseUrl(req), input);

  res.status(201).json({
    ok: true,
    session,
  });
});

router.get('/sessions/:id', (req, res) => {
  const session = getAgentSession(req.params.id);
  if (!session) {
    return res.status(404).json({ ok: false, code: 'SESSION_NOT_FOUND', error: 'Session not found' });
  }
  res.json({
    ok: true,
    session,
    events: getAgentSessionEventsSince(session.id, Number(req.query.since || 0)),
  });
});

router.get('/sessions/:id/stream', (req, res) => {
  const session = getAgentSession(req.params.id);
  if (!session) {
    return res.status(404).json({ ok: false, code: 'SESSION_NOT_FOUND', error: 'Session not found' });
  }

  attachAgentClient(session.id);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const since = Number(req.query.since || 0);
  const writeEvent = (type, data) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  writeEvent('session', getAgentSession(session.id));

  // Replay stored events and track the highest seq to prevent duplicate delivery
  let lastReplayedSeq = since;
  for (const event of getAgentSessionEventsSince(session.id, since)) {
    writeEvent(event.type, event.data);
    if (event.seq > lastReplayedSeq) lastReplayedSeq = event.seq;
  }

  const current = getAgentSession(session.id);
  if (current && ['done', 'error', 'aborted'].includes(current.status)) {
    res.end();
    detachAgentClient(session.id);
    return;
  }

  const unsubscribe = subscribeAgentSession(session.id, (event) => {
    try {
      // Only forward events newer than what we already replayed — prevents duplicates
      if (event.seq <= lastReplayedSeq) return;
      writeEvent(event.type, event.data);
      const latest = getAgentSession(session.id);
      if (latest && ['done', 'error', 'aborted'].includes(latest.status)) {
        res.end();
      }
    } catch {
      // Response closed.
    }
  });

  const heartbeat = setInterval(() => {
    try {
      res.write(':heartbeat\n\n');
    } catch {
      // ignore
    }
  }, 15000);

  res.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    detachAgentClient(session.id);
  });
});

router.post('/sessions/:id/abort', (req, res) => {
  const session = getAgentSession(req.params.id);
  if (!session) {
    return res.status(404).json({ ok: false, code: 'SESSION_NOT_FOUND', error: 'Session not found' });
  }
  const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
    ? req.body.reason.trim()
    : 'Agent session aborted by user';
  const result = abortAgentSession(session.id, reason);
  if (result.ok) {
    updateAgentSession(session.id, { status: 'aborted', lastError: reason });
  }
  res.status(result.ok ? 200 : 409).json({
    ok: result.ok,
    ...result,
  });
});

module.exports = router;
