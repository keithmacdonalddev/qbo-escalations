const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const DevConversation = require('../models/DevConversation');
const { createRateLimiter } = require('../middleware/rate-limit');
const {
  isValidProvider,
  normalizeProvider,
  getDefaultProvider,
  getProviderFamily,
} = require('../services/providers/registry');
const {
  VALID_MODES,
  resolvePolicy,
} = require('../services/chat-orchestrator');
const { randomUUID } = require('node:crypto');
const { extractUsageFromMessage } = require('../lib/usage-extractor');
const { logUsage } = require('../lib/usage-writer');
const { calculateCost } = require('../lib/pricing');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_PROVIDER = getDefaultProvider();
function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DEV_CHAT_TIMEOUT_MS = parsePositiveInt(process.env.DEV_CHAT_TIMEOUT_MS, 600000);
const CODEX_DEV_MODEL = process.env.CODEX_DEV_MODEL || process.env.CODEX_CHAT_MODEL || 'gpt-5.3-codex';
const CODEX_DEV_REASONING_EFFORT = process.env.CODEX_DEV_REASONING_EFFORT || process.env.CODEX_REASONING_EFFORT || 'high';
const DEFAULT_DEV_MAX_IMAGES = 6;
const DEFAULT_DEV_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_DEV_MAX_TOTAL_IMAGE_BYTES = 30 * 1024 * 1024;

// Active dev sessions: sessionKey -> { child, killed, provider, conversationId }
const activeSessions = new Map();
const devChatRateLimit = createRateLimiter({ name: 'dev-chat', limit: 8, windowMs: 60_000 });

function isValidMode(mode) {
  return mode === undefined || VALID_MODES.has(mode);
}

function shouldResumeClaudeSession(primaryProvider, previousProvider) {
  return getProviderFamily(primaryProvider) === 'claude' && getProviderFamily(previousProvider) === 'claude';
}

function didCliExitSuccessfully(code) {
  return code === 0;
}

function isPathWithinRoot(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function formatDevCliFailure(provider, code, stderr) {
  const preview = (stderr || '').slice(0, 500);
  const lower = preview.toLowerCase();
  const missingBinary =
    lower.includes('not recognized as an internal or external command') ||
    lower.includes('command not found') ||
    lower.includes('enoent');

  const family = getProviderFamily(provider);
  const label = family === 'codex' ? 'Codex CLI' : 'Claude CLI';
  if (missingBinary) {
    if (family === 'codex') {
      return 'Codex CLI command not found. Ensure `codex` is installed and available on PATH.';
    }
    return 'Claude CLI command not found. Ensure `claude` is installed and available on PATH.';
  }
  return `${label} exited with code ${code}: ${preview}`;
}

function normalizeProviderError(provider, err, defaultCode = 'PROVIDER_EXEC_FAILED') {
  return {
    provider,
    code: err && err.code ? err.code : defaultCode,
    message: err && err.message ? err.message : `${provider} request failed`,
  };
}

function buildCodexPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  const lines = [];
  for (const msg of messages) {
    const prefix = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
    lines.push(prefix + ': ' + (msg.content || ''));
  }
  lines.push('Assistant:');
  return lines.join('\n\n');
}

function classifyEvent(msg, options = {}) {
  const provider = options.provider || 'claude';
  if (!msg) return 'unknown';

  if (getProviderFamily(provider) === 'codex') {
    if (msg.item && msg.item.type) {
      const type = String(msg.item.type).toLowerCase();
      if (type.includes('tool') && type.includes('result')) return 'tool_result';
      if (type.includes('tool')) return 'tool_use';
      if (type === 'agent_message') return 'text';
    }
    if (msg.type === 'tool_result') return 'tool_result';
    if (msg.type === 'result') return 'result';
    if (typeof msg.delta === 'string' || (msg.delta && typeof msg.delta.text === 'string')) return 'delta';
    return 'unknown';
  }

  if (!msg.type) return 'unknown';
  switch (msg.type) {
    case 'system':
      return 'system';
    case 'assistant':
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

function extractTextChunk(msg, options = {}) {
  const provider = options.provider || 'claude';
  const seenAgentTextByItem = options.seenAgentTextByItem || new Map();
  if (!msg) return '';

  if (getProviderFamily(provider) === 'codex') {
    if (msg.item && msg.item.type === 'agent_message' && typeof msg.item.text === 'string') {
      const id = msg.item.id || '__default__';
      const prevText = seenAgentTextByItem.get(id) || '';
      const nextText = msg.item.text;
      seenAgentTextByItem.set(id, nextText);
      if (nextText.startsWith(prevText)) return nextText.slice(prevText.length);
      return nextText;
    }
    if (typeof msg.delta === 'string') return msg.delta;
    if (msg.delta && typeof msg.delta.text === 'string') return msg.delta.text;
    if (msg.type === 'result' && typeof msg.result === 'string') return msg.result;
    return '';
  }

  if (!msg.type) return '';
  if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
    return msg.message.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
  }
  if (msg.type === 'content_block_delta' && msg.delta && typeof msg.delta.text === 'string') {
    return msg.delta.text;
  }
  if (msg.type === 'result' && typeof msg.result === 'string') {
    return msg.result;
  }
  return '';
}

function toToolEvents(msg, options = {}) {
  const provider = options.provider || 'claude';
  if (!msg) return [];

  if (getProviderFamily(provider) === 'codex') {
    if (msg.type === 'tool_result') {
      return [{
        tool: msg.name || 'tool_result',
        status: msg.is_error ? 'error' : 'success',
        details: msg,
      }];
    }
    if (msg.item && msg.item.type) {
      const type = String(msg.item.type).toLowerCase();
      const toolName = msg.item.name || msg.item.tool_name || msg.item.tool || msg.item.type;
      if (type.includes('tool') && type.includes('result')) {
        const status = msg.item.is_error || msg.item.error ? 'error' : 'success';
        return [{
          tool: toolName,
          status,
          details: msg.item,
        }];
      }
      if (type.includes('tool')) {
        return [{
          tool: toolName,
          status: 'started',
          details: msg.item.input || msg.item,
        }];
      }
    }
    return [];
  }

  if (!msg.type) return [];
  if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
    return msg.message.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        tool: block.name || 'tool_use',
        status: 'started',
        details: block.input || {},
      }));
  }
  if (msg.type === 'tool_result') {
    return [{
      tool: msg.name || 'tool_result',
      status: msg.is_error ? 'error' : 'success',
      details: msg,
    }];
  }
  return [];
}

function toToolEvent(msg, options = {}) {
  const events = toToolEvents(msg, options);
  return events.length > 0 ? events[0] : null;
}

function getDevChatMaxImages() {
  return parsePositiveInt(process.env.DEV_CHAT_MAX_IMAGES_PER_REQUEST, DEFAULT_DEV_MAX_IMAGES);
}

function getDevChatMaxImageBytes() {
  return parsePositiveInt(process.env.DEV_CHAT_MAX_IMAGE_BYTES, DEFAULT_DEV_MAX_IMAGE_BYTES);
}

function getDevChatMaxTotalImageBytes() {
  return parsePositiveInt(process.env.DEV_CHAT_MAX_TOTAL_IMAGE_BYTES, DEFAULT_DEV_MAX_TOTAL_IMAGE_BYTES);
}

function extractBase64Payload(image) {
  const trimmed = typeof image === 'string' ? image.trim() : '';
  const dataUrlMatch = trimmed.match(/^data:image\/[a-zA-Z0-9+.-]+;base64,([\s\S]+)$/);
  return dataUrlMatch ? dataUrlMatch[1].replace(/\s+/g, '') : trimmed.replace(/\s+/g, '');
}

function normalizeDevImages(images) {
  if (images === undefined || images === null) {
    return { ok: true, images: [], totalBytes: 0 };
  }
  if (!Array.isArray(images)) {
    return { ok: false, code: 'INVALID_IMAGES', error: 'images must be an array of base64 strings' };
  }
  if (images.length > getDevChatMaxImages()) {
    return {
      ok: false,
      code: 'TOO_MANY_IMAGES',
      error: `Maximum ${getDevChatMaxImages()} images per request`,
    };
  }

  const maxImageBytes = getDevChatMaxImageBytes();
  const maxTotalBytes = getDevChatMaxTotalImageBytes();
  const normalizedImages = [];
  let totalBytes = 0;

  for (const rawImage of images) {
    if (typeof rawImage !== 'string') {
      return { ok: false, code: 'INVALID_IMAGE', error: 'Each image must be a base64 string' };
    }
    const trimmed = rawImage.trim();
    if (!trimmed) {
      return { ok: false, code: 'INVALID_IMAGE', error: 'Each image must be a non-empty base64 string' };
    }

    const payload = extractBase64Payload(trimmed);
    if (!payload || !/^[A-Za-z0-9+/=]+$/.test(payload)) {
      return { ok: false, code: 'INVALID_IMAGE', error: 'Unable to decode image payload' };
    }

    const bytes = Buffer.from(payload, 'base64').length;
    if (!bytes) {
      return { ok: false, code: 'INVALID_IMAGE', error: 'Unable to decode image payload' };
    }
    if (bytes > maxImageBytes) {
      return {
        ok: false,
        code: 'IMAGE_TOO_LARGE',
        error: `Image exceeds ${maxImageBytes} bytes`,
      };
    }

    totalBytes += bytes;
    if (totalBytes > maxTotalBytes) {
      return {
        ok: false,
        code: 'IMAGES_TOO_LARGE',
        error: `Total image payload exceeds ${maxTotalBytes} bytes`,
      };
    }
    normalizedImages.push(trimmed);
  }

  return { ok: true, images: normalizedImages, totalBytes };
}

/** Write base64 images to temp files, return paths for CLI --image flags */
function writeImageTempFiles(images) {
  const tempFiles = [];
  if (!Array.isArray(images) || images.length === 0) return tempFiles;
  for (let i = 0; i < images.length; i++) {
    const raw = typeof images[i] === 'string' ? images[i] : '';
    if (!raw) continue;
    const base64Data = extractBase64Payload(raw);
    if (!base64Data) continue;
    const tmpPath = path.join(os.tmpdir(), `qbo-dev-img-${Date.now()}-${i}.png`);
    fs.writeFileSync(tmpPath, Buffer.from(base64Data, 'base64'));
    tempFiles.push(tmpPath);
  }
  return tempFiles;
}

function cleanupTempFiles(tempFiles) {
  for (const f of tempFiles) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
}

function buildProviderCommand({
  providerId,
  message,
  resumeSessionId,
  historyMessages,
  imagePaths,
}) {
  const family = getProviderFamily(providerId);
  if (family === 'codex') {
    const codexModel = providerId === 'gpt-5-mini' ? 'gpt-5-mini' : CODEX_DEV_MODEL;
    const args = [
      'exec',
      '--json',
      '--model', codexModel,
      '-c', `reasoning_effort="${CODEX_DEV_REASONING_EFFORT}"`,
      '--skip-git-repo-check',
    ];
    if (Array.isArray(imagePaths)) {
      for (const imgPath of imagePaths) {
        args.push('--image', imgPath);
      }
    }
    args.push('-');
    return {
      command: 'codex',
      args,
      stdinText: buildCodexPrompt(historyMessages),
      supportsSessionResume: false,
    };
  }

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];
  if (providerId === 'claude-sonnet-4-6') args.push('--model', 'claude-sonnet-4-6');
  if (resumeSessionId) args.push('--resume', resumeSessionId);
  if (Array.isArray(imagePaths)) {
    for (const imgPath of imagePaths) {
      args.push('--image', imgPath);
    }
  }
  return {
    command: 'claude',
    args,
    stdinText: message,           // pipe user content via stdin, never as a CLI argument
    supportsSessionResume: true,
  };
}

function runDevAttempt({
  providerId,
  message,
  resumeSessionId,
  historyMessages,
  imagePaths,
  timeoutMs,
  sessionEntry,
  writeEvent,
  onSession,
}) {
  const startedAt = Date.now();
  const seenAgentTextByItem = new Map();
  const cmd = buildProviderCommand({
    providerId,
    message,
    resumeSessionId,
    historyMessages,
    imagePaths,
  });

  return new Promise((resolve) => {
    let settled = false;
    let killed = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let stderrRaw = '';
    let assistantText = '';
    const capturedToolEvents = [];
    let capturedSessionId = resumeSessionId || null;
    let capturedUsage = null;

    // shell: true required on Windows where claude/codex may be .cmd shims.
    // User content is piped via stdin — never passed as a CLI argument.
    const child = spawn(cmd.command, cmd.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      cwd: PROJECT_ROOT,
      env: { ...process.env, CLAUDECODE: undefined },
    });

    sessionEntry.child = child;
    sessionEntry.provider = providerId;

    if (cmd.stdinText) {
      child.stdin.write(cmd.stdinText);
      child.stdin.end();
    }

    function finalize(result) {
      if (settled) return;
      settled = true;
      resolve(result);
    }

    function processParsedMessage(msg) {
      if (getProviderFamily(providerId) === 'claude' && msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
        capturedSessionId = msg.session_id;
        onSession?.(capturedSessionId);
        writeEvent('session', { provider: providerId, sessionId: capturedSessionId });
      }

      const textChunk = extractTextChunk(msg, { provider: providerId, seenAgentTextByItem });
      if (textChunk) {
        assistantText += textChunk;
        writeEvent('chunk', { provider: providerId, text: textChunk });
      }

      const usageFromMsg = extractUsageFromMessage(msg, providerId);
      if (usageFromMsg) capturedUsage = usageFromMsg;

      const toolEvents = toToolEvents(msg, { provider: providerId });
      for (const toolEvent of toolEvents) {
        capturedToolEvents.push(toolEvent);
        const eventName = toolEvent.status === 'started' ? 'tool_use' : 'tool_result';
        writeEvent(eventName, { provider: providerId, ...toolEvent });
      }
    }

    const timeout = setTimeout(() => {
      if (settled) return;
      killed = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      const error = normalizeProviderError(providerId, {
        code: 'TIMEOUT',
        message: `Dev attempt timed out after ${timeoutMs}ms`,
      }, 'TIMEOUT');
      finalize({
        ok: false,
        provider: providerId,
        error,
        usage: capturedUsage,
        latencyMs: Date.now() - startedAt,
      });
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      if (settled) return;
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          processParsedMessage(msg);
        } catch {
          writeEvent('log', { provider: providerId, text: line });
        }
      }
    });

    child.stderr.on('data', (data) => {
      if (settled) return;
      stderrRaw += data.toString();
      stderrBuffer += data.toString();
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        writeEvent('stderr', { provider: providerId, text: line });
      }
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      sessionEntry.child = null;

      if (stdoutBuffer.trim()) {
        try {
          processParsedMessage(JSON.parse(stdoutBuffer));
        } catch { /* ignore */ }
      }

      if (killed || sessionEntry.killed) {
        const error = normalizeProviderError(providerId, {
          code: 'ABORTED',
          message: 'Dev session aborted',
        }, 'ABORTED');
        finalize({
          ok: false,
          provider: providerId,
          error,
          usage: capturedUsage,
          latencyMs: Date.now() - startedAt,
        });
        return;
      }

      if (!didCliExitSuccessfully(code)) {
        const baseMessage = formatDevCliFailure(providerId, code, stderrRaw || stderrBuffer);
        const error = normalizeProviderError(providerId, {
          code: 'PROVIDER_EXEC_FAILED',
          message: assistantText ? `${baseMessage} (partial output discarded)` : baseMessage,
        });
        finalize({
          ok: false,
          provider: providerId,
          error,
          usage: capturedUsage,
          latencyMs: Date.now() - startedAt,
        });
        return;
      }

      finalize({
        ok: true,
        provider: providerId,
        sessionId: cmd.supportsSessionResume ? capturedSessionId : null,
        assistantText,
        toolEvents: capturedToolEvents,
        usage: capturedUsage,
        latencyMs: Date.now() - startedAt,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      if (settled) return;
      sessionEntry.child = null;
      const error = normalizeProviderError(providerId, err);
      finalize({
        ok: false,
        provider: providerId,
        error,
        usage: capturedUsage,
        latencyMs: Date.now() - startedAt,
      });
    });
  });
}

// POST /api/dev/chat -- Developer mode stream with persistent dev conversations
router.post('/chat', devChatRateLimit, async (req, res) => {
  const {
    message,
    images,
    conversationId,
    sessionId,
    provider, // backward-compat alias for primaryProvider
    primaryProvider,
    mode,
    fallbackProvider,
    timeoutMs,
  } = req.body || {};

  if (message !== undefined && typeof message !== 'string') {
    return res.status(400).json({ ok: false, code: 'INVALID_MESSAGE', error: 'message must be a string' });
  }
  const normalizedImagesResult = normalizeDevImages(images);
  if (!normalizedImagesResult.ok) {
    return res.status(400).json({
      ok: false,
      code: normalizedImagesResult.code,
      error: normalizedImagesResult.error,
    });
  }
  const normalizedImages = normalizedImagesResult.images;
  const normalizedMessage = typeof message === 'string' ? message.trim() : '';
  if (!normalizedMessage && normalizedImages.length === 0) {
    return res.status(400).json({ ok: false, code: 'MISSING_INPUT', error: 'message or images required' });
  }
  if (provider !== undefined && !isValidProvider(provider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported provider' });
  }
  if (primaryProvider !== undefined && !isValidProvider(primaryProvider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported primary provider' });
  }
  if (fallbackProvider !== undefined && !isValidProvider(fallbackProvider)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: 'Unsupported fallback provider' });
  }
  if (!isValidMode(mode)) {
    return res.status(400).json({ ok: false, code: 'INVALID_MODE', error: 'Unsupported mode' });
  }
  if (mode === 'parallel') {
    return res.status(400).json({ ok: false, code: 'UNSUPPORTED_MODE', error: 'Dev mode does not support parallel' });
  }

  let conversation = null;
  if (conversationId) {
    conversation = await DevConversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Dev conversation not found' });
    }
  } else {
    conversation = new DevConversation({
      title: normalizedMessage.slice(0, 80) || 'New Dev Session',
      provider: normalizeProvider(primaryProvider || provider || DEFAULT_PROVIDER),
      messages: [],
    });
    await conversation.save();
  }

  const previousProvider = conversation.provider || DEFAULT_PROVIDER;
  const requestedPrimary = primaryProvider || provider || conversation.provider || DEFAULT_PROVIDER;
  const policy = resolvePolicy({
    mode,
    primaryProvider: requestedPrimary,
    fallbackProvider,
  });
  if (policy.mode === 'fallback' && policy.fallbackProvider === policy.primaryProvider) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_FALLBACK_PROVIDER',
      error: 'fallbackProvider must differ from primaryProvider in fallback mode',
    });
  }

  conversation.provider = policy.primaryProvider;
  if (getProviderFamily(policy.primaryProvider) !== 'claude') {
    conversation.sessionId = '';
  }
  conversation.messages.push({
    role: 'user',
    content: normalizedMessage || '(image attached)',
    timestamp: new Date(),
  });
  await conversation.save();

  const resumeSessionId = shouldResumeClaudeSession(policy.primaryProvider, previousProvider)
    ? (sessionId || conversation.sessionId || null)
    : null;
  const historyMessages = conversation.messages.map((m) => ({
    role: m.role,
    content: m.content || '',
  }));
  const imagePaths = writeImageTempFiles(normalizedImages);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let streamClosed = false;
  function writeEvent(eventName, payload) {
    if (streamClosed) return false;
    try {
      res.write('event: ' + eventName + '\ndata: ' + JSON.stringify(payload) + '\n\n');
      return true;
    } catch {
      return false;
    }
  }

  function endStream() {
    if (streamClosed) return;
    streamClosed = true;
    try { res.end(); } catch { /* ignore */ }
  }

  const sessionKey = Date.now().toString(36);
  const sessionEntry = {
    child: null,
    killed: false,
    provider: policy.primaryProvider,
    conversationId: conversation._id.toString(),
  };
  activeSessions.set(sessionKey, sessionEntry);

  const sequence = policy.mode === 'fallback' && policy.fallbackProvider !== policy.primaryProvider
    ? [policy.primaryProvider, policy.fallbackProvider]
    : [policy.primaryProvider];
  const attempts = [];
  let finalSessionId = resumeSessionId;
  let fallbackFrom = null;

  writeEvent('start', {
    sessionKey,
    conversationId: conversation._id.toString(),
    provider: policy.primaryProvider, // backward-compat
    primaryProvider: policy.primaryProvider,
    fallbackProvider: policy.mode === 'fallback' ? policy.fallbackProvider : null,
    mode: policy.mode,
  });

  const devRequestId = randomUUID();
  let devStreamSettled = false;

  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* client gone */ }
  }, 15000);

  const cleanup = () => {
    clearInterval(heartbeat);
    sessionEntry.killed = true;
    cleanupTempFiles(imagePaths);
    if (sessionEntry.child) {
      try { sessionEntry.child.kill('SIGTERM'); } catch { /* ignore */ }
      sessionEntry.child = null;
    }
    activeSessions.delete(sessionKey);
  };

  req.on('close', () => {
    if (!devStreamSettled) cleanup();
  });

  (async () => {
    try {
      for (let i = 0; i < sequence.length; i++) {
        if (sessionEntry.killed || streamClosed) return;

        const providerId = sequence[i];
        const effectiveTimeoutMs = parsePositiveInt(timeoutMs, DEV_CHAT_TIMEOUT_MS);

        const attemptResult = await runDevAttempt({
          providerId,
          message: normalizedMessage || '(image attached)',
          resumeSessionId: finalSessionId,
          historyMessages,
          imagePaths,
          timeoutMs: effectiveTimeoutMs,
          sessionEntry,
          writeEvent,
          onSession: (newSessionId) => {
            finalSessionId = newSessionId;
          },
        });

        // R17: Always log usage BEFORE checking killed guard
        const attemptUsage = attemptResult.usage || {};
        logUsage({
          requestId: devRequestId, attemptIndex: i, service: 'dev', provider: providerId,
          model: attemptUsage.model, inputTokens: attemptUsage.inputTokens, outputTokens: attemptUsage.outputTokens,
          usageAvailable: !!attemptResult.usage, usageComplete: attemptUsage.usageComplete, rawUsage: attemptUsage.rawUsage,
          conversationId: conversation._id, mode: policy.mode,
          status: attemptResult.ok ? 'ok'
            : sessionEntry.killed ? 'abort'
            : (attemptResult.error && attemptResult.error.code === 'TIMEOUT') ? 'timeout'
            : 'error',
          latencyMs: attemptResult.latencyMs,
        });

        if (sessionEntry.killed || streamClosed) return;

        if (attemptResult.ok) {
          attempts.push({
            provider: providerId,
            status: 'ok',
            latencyMs: attemptResult.latencyMs,
          });

          conversation.provider = providerId;
          if (getProviderFamily(providerId) === 'claude') {
            if (attemptResult.sessionId) {
              conversation.sessionId = attemptResult.sessionId;
              finalSessionId = attemptResult.sessionId;
            }
          } else {
            conversation.sessionId = '';
            finalSessionId = null;
          }
          const devUsageSubdoc = attemptResult.usage ? {
            inputTokens: attemptResult.usage.inputTokens || 0,
            outputTokens: attemptResult.usage.outputTokens || 0,
            totalTokens: (attemptResult.usage.inputTokens || 0) + (attemptResult.usage.outputTokens || 0),
            model: attemptResult.usage.model || null,
            totalCostMicros: calculateCost(attemptResult.usage.inputTokens || 0, attemptResult.usage.outputTokens || 0, attemptResult.usage.model, null).totalCostMicros,
            usageAvailable: true,
            rawUsage: attemptResult.usage.rawUsage || null,
          } : null;
          conversation.messages.push({
            role: 'assistant',
            content: attemptResult.assistantText || '',
            toolEvents: attemptResult.toolEvents || [],
            provider: providerId,
            mode: policy.mode,
            fallbackFrom: fallbackFrom || null,
            attemptMeta: { attempts },
            usage: devUsageSubdoc,
            timestamp: new Date(),
          });
          await conversation.save();

          devStreamSettled = true;
          writeEvent('done', {
            sessionId: getProviderFamily(providerId) === 'claude' ? (finalSessionId || null) : null,
            conversationId: conversation._id.toString(),
            provider: providerId, // backward-compat
            providerUsed: providerId,
            fallbackUsed: Boolean(fallbackFrom),
            fallbackFrom,
            mode: policy.mode,
            attempts,
            usage: devUsageSubdoc,
            usageAvailable: !!attemptResult.usage,
          });
          endStream();
          cleanup();
          return;
        }

        attempts.push({
          provider: providerId,
          status: 'error',
          latencyMs: attemptResult.latencyMs,
          errorCode: attemptResult.error.code,
          errorMessage: attemptResult.error.message,
        });

        writeEvent('provider_error', {
          provider: providerId,
          code: attemptResult.error.code,
          message: attemptResult.error.message,
          retriable: i < sequence.length - 1,
        });

        const hasNext = i < sequence.length - 1;
        if (!hasNext) {
          devStreamSettled = true;
          writeEvent('error', {
            error: attemptResult.error.message || 'Dev chat failed',
            code: attemptResult.error.code || 'PROVIDER_EXEC_FAILED',
            attempts,
          });
          endStream();
          cleanup();
          return;
        }

        const nextProvider = sequence[i + 1];
        fallbackFrom = providerId;
        writeEvent('fallback', {
          from: providerId,
          to: nextProvider,
          reason: attemptResult.error.code || 'PROVIDER_EXEC_FAILED',
        });
      }
    } catch (err) {
      if (sessionEntry.killed || streamClosed) return;
      const normalized = normalizeProviderError(policy.primaryProvider, err, 'INTERNAL');
      writeEvent('error', {
        error: normalized.message,
        code: normalized.code,
        attempts,
      });
      endStream();
      cleanup();
    }
  })();
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
  if (session.child) {
    try { session.child.kill('SIGTERM'); } catch { /* ignore */ }
    session.child = null;
  }
  activeSessions.delete(sessionKey);

  res.json({ ok: true });
});

// GET /api/dev/sessions -- List active dev sessions
router.get('/sessions', (req, res) => {
  const sessions = [];
  for (const [key, session] of activeSessions) {
    sessions.push({
      sessionKey: key,
      provider: session.provider || null,
      killed: session.killed,
      conversationId: session.conversationId || null,
    });
  }
  res.json({ ok: true, sessions, count: sessions.length });
});

// GET /api/dev/conversations -- List persistent dev conversations
router.get('/conversations', async (req, res) => {
  // Fail fast when DB is not connected — prevents requests from hanging
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ ok: false, code: 'DB_UNAVAILABLE', error: 'Database is not available' });
  }

  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const skip = parseInt(req.query.skip) || parseInt(req.query.offset) || 0;
  const search = (req.query.search || '').trim();

  // Escape regex special chars to prevent regex injection / ReDoS
  const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = escapedSearch ? { title: { $regex: escapedSearch, $options: 'i' } } : {};

  try {
    // Aggregation pipeline projects only needed fields server-side,
    // avoiding transfer of the full messages array per conversation.
    const docs = await DevConversation.aggregate([
      { $match: filter },
      { $sort: { updatedAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      { $project: {
        title: 1,
        provider: 1,
        sessionId: 1,
        createdAt: 1,
        updatedAt: 1,
        messageCount: { $size: { $ifNull: ['$messages', []] } },
        lastMessage: { $arrayElemAt: ['$messages', -1] },
      }},
    ]).option({ maxTimeMS: 8000 });

    const items = docs.map((doc) => {
      const lastMsg = doc.lastMessage || null;
      return {
        _id: doc._id,
        title: doc.title,
        provider: normalizeProvider(doc.provider),
        sessionId: doc.sessionId || null,
        messageCount: doc.messageCount || 0,
        lastMessage: lastMsg
          ? {
              role: lastMsg.role,
              preview: (lastMsg.content || '').slice(0, 120),
              provider: lastMsg.provider || null,
              timestamp: lastMsg.timestamp,
            }
          : null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    });

    const total = await DevConversation.countDocuments(filter).maxTimeMS(5000);
    res.json({ ok: true, conversations: items, total });
  } catch (err) {
    const isTimeout = err.codeName === 'MaxTimeMSExpired' || err.code === 50;
    res.status(isTimeout ? 504 : 500).json({
      ok: false,
      code: isTimeout ? 'QUERY_TIMEOUT' : 'LIST_FAILED',
      error: isTimeout ? 'Query timed out' : 'Failed to list dev conversations',
    });
  }
});

// GET /api/dev/conversations/:id -- Get full persistent dev conversation
router.get('/conversations/:id', async (req, res) => {
  const conversation = await DevConversation.findById(req.params.id).lean();
  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Dev conversation not found' });
  }
  res.json({ ok: true, conversation });
});

// PATCH /api/dev/conversations/:id -- Rename dev conversation
router.patch('/conversations/:id', async (req, res) => {
  const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
  if (!title) {
    return res.status(400).json({ ok: false, code: 'MISSING_TITLE', error: 'title required' });
  }

  const conversation = await DevConversation.findByIdAndUpdate(
    req.params.id,
    { $set: { title: title.slice(0, 200) } },
    { returnDocument: 'after' }
  ).lean();

  if (!conversation) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Dev conversation not found' });
  }
  res.json({ ok: true, conversation });
});

// DELETE /api/dev/conversations/:id -- Delete persistent dev conversation
router.delete('/conversations/:id', async (req, res) => {
  const deleted = await DevConversation.findByIdAndDelete(req.params.id);
  if (!deleted) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Dev conversation not found' });
  }
  res.json({ ok: true });
});

// GET /api/dev/file -- Read a project file (for diff display)
router.get('/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    return res.status(400).json({ ok: false, code: 'MISSING_PATH', error: 'path query param required' });
  }

  const resolved = path.resolve(PROJECT_ROOT, filePath);
  if (!isPathWithinRoot(PROJECT_ROOT, resolved)) {
    return res.status(403).json({ ok: false, code: 'PATH_TRAVERSAL', error: 'Path must be within project' });
  }

  const basename = path.basename(resolved);
  if (basename === '.env' || basename.startsWith('.env.')) {
    return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'Cannot read environment files' });
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
    } catch { /* ignore */ }

    return entries;
  }

  res.json({ ok: true, root: PROJECT_ROOT, tree: buildTree(PROJECT_ROOT, 0) });
});

module.exports = router;
module.exports._internal = {
  classifyEvent,
  extractTextChunk,
  toToolEvent,
  toToolEvents,
  extractBase64Payload,
  normalizeDevImages,
  buildProviderCommand,
  parsePositiveInt,
  isPathWithinRoot,
  shouldResumeClaudeSession,
  didCliExitSuccessfully,
};
