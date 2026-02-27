const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

// Active dev sessions: sessionId -> { child, killed }
const activeSessions = new Map();

// POST /api/dev/chat -- Developer mode: Claude with full tool access, streams raw events
router.post('/chat', (req, res) => {
  const { message, sessionId } = req.body;

  if (!message) {
    return res.status(400).json({ ok: false, code: 'MISSING_INPUT', error: 'message required' });
  }

  // Build claude CLI args with full tool access
  const args = [
    '-p', message,
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];

  // Resume session if provided
  if (sessionId) {
    args.push('--resume', sessionId);
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const child = spawn('claude', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
    cwd: PROJECT_ROOT,
    env: { ...process.env },
  });

  let killed = false;
  let capturedSessionId = sessionId || null;
  let stdoutBuffer = '';

  // Track this session
  const sessionKey = Date.now().toString(36);
  activeSessions.set(sessionKey, { child, killed: false });

  // Send session key to client
  res.write('event: start\ndata: ' + JSON.stringify({ sessionKey }) + '\n\n');

  child.stdout.on('data', (data) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);

        // Capture session ID from init message
        if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
          capturedSessionId = msg.session_id;
          try {
            res.write('event: session\ndata: ' + JSON.stringify({ sessionId: msg.session_id }) + '\n\n');
          } catch { /* gone */ }
        }

        // Classify and emit different event types for the client
        const eventType = classifyEvent(msg);
        try {
          res.write('event: ' + eventType + '\ndata: ' + JSON.stringify(msg) + '\n\n');
        } catch { /* client gone */ }
      } catch {
        // Non-JSON verbose output -- emit as log
        try {
          res.write('event: log\ndata: ' + JSON.stringify({ text: line }) + '\n\n');
        } catch { /* gone */ }
      }
    }
  });

  let stderrBuffer = '';
  child.stderr.on('data', (data) => {
    stderrBuffer += data.toString();
    // Emit stderr in chunks for real-time feedback
    const lines = stderrBuffer.split('\n');
    stderrBuffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) {
        try {
          res.write('event: stderr\ndata: ' + JSON.stringify({ text: line }) + '\n\n');
        } catch { /* gone */ }
      }
    }
  });

  child.on('close', (code) => {
    activeSessions.delete(sessionKey);

    // Flush remaining buffer
    if (stdoutBuffer.trim()) {
      try {
        const msg = JSON.parse(stdoutBuffer);
        const eventType = classifyEvent(msg);
        res.write('event: ' + eventType + '\ndata: ' + JSON.stringify(msg) + '\n\n');
      } catch { /* ignore */ }
    }

    if (!killed) {
      try {
        res.write('event: done\ndata: ' + JSON.stringify({
          sessionId: capturedSessionId,
          exitCode: code,
        }) + '\n\n');
        res.end();
      } catch { /* gone */ }
    }
  });

  child.on('error', (err) => {
    activeSessions.delete(sessionKey);
    if (!killed) {
      try {
        res.write('event: error\ndata: ' + JSON.stringify({ error: err.message }) + '\n\n');
        res.end();
      } catch { /* gone */ }
    }
  });

  // Heartbeat
  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* gone */ }
  }, 15000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    killed = true;
    const session = activeSessions.get(sessionKey);
    if (session) {
      session.killed = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      activeSessions.delete(sessionKey);
    }
  });
});

// POST /api/dev/abort -- Abort a running dev session
router.post('/abort', (req, res) => {
  const { sessionKey } = req.body;
  if (!sessionKey) {
    return res.status(400).json({ ok: false, code: 'MISSING_FIELD', error: 'sessionKey required' });
  }

  const session = activeSessions.get(sessionKey);
  if (!session) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Session not found or already ended' });
  }

  session.killed = true;
  try { session.child.kill('SIGTERM'); } catch { /* ignore */ }
  activeSessions.delete(sessionKey);

  res.json({ ok: true });
});

// GET /api/dev/sessions -- List active dev sessions
router.get('/sessions', (req, res) => {
  const sessions = [];
  for (const [key, session] of activeSessions) {
    sessions.push({ sessionKey: key, killed: session.killed });
  }
  res.json({ ok: true, sessions, count: sessions.length });
});

// GET /api/dev/file -- Read a project file (for diff display)
router.get('/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ ok: false, code: 'MISSING_PATH', error: 'path query param required' });
  }

  // Security: ensure path is within project root
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!resolved.startsWith(PROJECT_ROOT)) {
    return res.status(403).json({ ok: false, code: 'PATH_TRAVERSAL', error: 'Path must be within project' });
  }

  const fs = require('fs');
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'File not found' });
  }

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(resolved, { withFileTypes: true }).map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      size: e.isFile() ? fs.statSync(path.join(resolved, e.name)).size : null,
    }));
    return res.json({ ok: true, type: 'directory', entries });
  }

  // Don't serve binary or huge files
  if (stat.size > 1024 * 1024) {
    return res.status(413).json({ ok: false, code: 'TOO_LARGE', error: 'File too large (>1MB)' });
  }

  const content = fs.readFileSync(resolved, 'utf-8');
  const ext = path.extname(resolved).slice(1);

  res.json({ ok: true, type: 'file', path: filePath, content, ext, size: stat.size });
});

// GET /api/dev/tree -- Project file tree (for navigation)
router.get('/tree', (req, res) => {
  const fs = require('fs');
  const maxDepth = parseInt(req.query.depth) || 3;

  const IGNORE = new Set(['node_modules', '.git', '.claude', 'dist', 'build', '.next', '__pycache__', '.DS_Store', 'NUL']);

  function buildTree(dir, depth) {
    if (depth > maxDepth) return [];
    const entries = [];

    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (IGNORE.has(item.name)) continue;
        if (item.name.startsWith('.') && item.name !== '.env.example') continue;

        const fullPath = path.join(dir, item.name);
        const relativePath = path.relative(PROJECT_ROOT, fullPath).replace(/\\/g, '/');

        if (item.isDirectory()) {
          entries.push({
            name: item.name,
            path: relativePath,
            type: 'dir',
            children: buildTree(fullPath, depth + 1),
          });
        } else {
          entries.push({
            name: item.name,
            path: relativePath,
            type: 'file',
            ext: path.extname(item.name).slice(1),
          });
        }
      }
    } catch { /* permission denied, etc. */ }

    return entries;
  }

  res.json({ ok: true, root: PROJECT_ROOT, tree: buildTree(PROJECT_ROOT, 0) });
});

/**
 * Classify a stream-json message into an SSE event type.
 * This lets the client render different UI for different event types.
 */
function classifyEvent(msg) {
  if (!msg || !msg.type) return 'unknown';

  switch (msg.type) {
    case 'system':
      return 'system';

    case 'assistant':
      // Check if it contains tool_use blocks
      if (msg.message && msg.message.content) {
        const hasToolUse = msg.message.content.some((b) => b.type === 'tool_use');
        if (hasToolUse) return 'tool_use';
        const hasText = msg.message.content.some((b) => b.type === 'text');
        if (hasText) return 'text';
      }
      return 'assistant';

    case 'tool_result':
      return 'tool_result';

    case 'result':
      return 'result';

    case 'content_block_delta':
      return 'delta';

    default:
      return 'unknown';
  }
}

module.exports = router;
