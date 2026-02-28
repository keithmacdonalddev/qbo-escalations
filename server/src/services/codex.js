const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { extractCodexUsage } = require('../lib/usage-extractor');

const DEFAULT_MODEL = process.env.CODEX_CHAT_MODEL || 'gpt-5.3-codex';
const DEFAULT_REASONING_EFFORT = process.env.CODEX_REASONING_EFFORT || 'high';
function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function didCliExitSuccessfully(code) {
  return code === 0;
}

const CHAT_TIMEOUT_MS = parsePositiveInt(process.env.CODEX_CHAT_TIMEOUT_MS, 180000);
const PARSE_MODEL = process.env.CODEX_PARSE_MODEL || DEFAULT_MODEL;
const PARSE_REASONING_EFFORT = process.env.CODEX_PARSE_REASONING_EFFORT || DEFAULT_REASONING_EFFORT;
const PARSE_TIMEOUT_MS = parsePositiveInt(process.env.CODEX_PARSE_TIMEOUT_MS, 120000);

function createImagePayloadError(detail) {
  const err = new Error(detail || 'Invalid image payload');
  err.code = 'INVALID_IMAGE_PAYLOAD';
  return err;
}

function mimeSubtypeToExtension(subtype) {
  const normalized = String(subtype || '').toLowerCase();
  if (!normalized) return 'png';
  if (normalized === 'jpeg' || normalized === 'pjpeg') return 'jpg';
  if (normalized === 'svg+xml') return 'svg';
  if (normalized === 'x-icon' || normalized === 'vnd.microsoft.icon') return 'ico';
  if (normalized === 'heic' || normalized === 'heif' || normalized === 'avif' || normalized === 'webp') {
    return normalized;
  }
  const clean = normalized.replace(/[^a-z0-9]/g, '');
  return clean || 'png';
}

function decodeImageInput(imageInput) {
  const input = typeof imageInput === 'string' ? imageInput.trim() : '';
  if (!input) {
    throw createImagePayloadError('Image payload is empty');
  }

  const dataUrlMatch = input.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,([\s\S]+)$/);
  const subtype = dataUrlMatch ? dataUrlMatch[1] : '';
  const base64Payload = (dataUrlMatch ? dataUrlMatch[2] : input).replace(/\s+/g, '');

  if (!base64Payload || !/^[A-Za-z0-9+/=]+$/.test(base64Payload)) {
    throw createImagePayloadError('Image payload is not valid base64 data');
  }

  const buffer = Buffer.from(base64Payload, 'base64');
  if (!buffer || buffer.length === 0) {
    throw createImagePayloadError('Image payload decoded to an empty file');
  }

  return {
    buffer,
    extension: mimeSubtypeToExtension(subtype),
  };
}

function formatCliFailure(code, stderr) {
  const preview = (stderr || '').slice(0, 500);
  const lower = preview.toLowerCase();
  const missingBinary =
    lower.includes('not recognized as an internal or external command') ||
    lower.includes('command not found') ||
    lower.includes('enoent');

  if (missingBinary) {
    return 'Codex CLI command not found. Ensure `codex` is installed and available on PATH.';
  }
  return 'Codex CLI exited with code ' + code + ': ' + preview;
}

/**
 * Chat with Codex CLI via subprocess.
 *
 * @param {Object} opts
 * @param {Array<{role: string, content: string}>} opts.messages
 * @param {string} [opts.systemPrompt]
 * @param {string[]} [opts.images] - Base64-encoded images
 * @param {function} opts.onChunk
 * @param {function} opts.onDone
 * @param {function} opts.onError
 * @returns {function} cleanup
 */
function chat({ messages, systemPrompt, images, model, onChunk, onDone, onError }) {
  const prompt = buildPrompt(messages, systemPrompt);
  const tempFiles = writeImageTempFiles(images);
  const effectiveModel = model || DEFAULT_MODEL;

  const args = [
    'exec',
    '--json',
    '--model', effectiveModel,
    '-c', `reasoning_effort="${DEFAULT_REASONING_EFFORT}"`,
    '--skip-git-repo-check',
  ];

  for (const file of tempFiles) {
    args.push('--image', shellEscapeArg(file));
  }
  args.push('-');

  let fullResponse = '';
  let killed = false;
  let settled = false;
  let capturedUsage = null;
  const seenAgentTextByItem = new Map();

  // shell: true required on Windows where codex may be a .cmd shim.
  // User content is piped via stdin — never passed as a CLI argument.
  const child = spawn('codex', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
    env: { ...process.env, CLAUDECODE: undefined },
  });
  child.stdin.write(prompt);
  child.stdin.end();

  function finishWithError(err) {
    if (settled || killed) return;
    settled = true;
    cleanupTempFiles(tempFiles);
    const error = err instanceof Error ? err : new Error(String(err));
    error._usage = capturedUsage || null;
    onError(error);
  }

  function finishWithSuccess(text) {
    if (settled || killed) return;
    settled = true;
    cleanupTempFiles(tempFiles);
    onDone(text, capturedUsage || null);
  }

  const timeout = setTimeout(() => {
    if (killed || settled) return;
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    const timeoutErr = new Error('Codex CLI timed out after ' + CHAT_TIMEOUT_MS + 'ms');
    timeoutErr.code = 'TIMEOUT';
    finishWithError(timeoutErr);
  }, CHAT_TIMEOUT_MS);

  let stdoutBuffer = '';
  child.stdout.on('data', (data) => {
    if (settled || killed) return;
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        const usage = extractCodexUsage(event, { fallbackModel: effectiveModel });
        if (usage) capturedUsage = usage;
      } catch { /* non-JSON line */ }
      const delta = extractDeltaFromEventLine(line, seenAgentTextByItem);
      if (delta) {
        fullResponse += delta;
        try { onChunk(delta); } catch { /* ignore callback errors */ }
      }
    }
  });

  let stderrOutput = '';
  child.stderr.on('data', (data) => {
    stderrOutput += data.toString();
  });

  child.on('close', (code) => {
    clearTimeout(timeout);
    if (settled || killed) return;

    try {
      const event = JSON.parse(stdoutBuffer);
      const usage = extractCodexUsage(event, { fallbackModel: effectiveModel });
      if (usage) capturedUsage = usage;
    } catch { /* ignore */ }

    const tailDelta = extractDeltaFromEventLine(stdoutBuffer, seenAgentTextByItem);
    if (tailDelta) {
      fullResponse += tailDelta;
      try { onChunk(tailDelta); } catch { /* ignore callback errors */ }
    }
    if (!didCliExitSuccessfully(code)) {
      finishWithError(new Error(formatCliFailure(code, stderrOutput)));
    } else {
      finishWithSuccess(fullResponse);
    }
  });

  child.on('error', (err) => {
    clearTimeout(timeout);
    if (!killed) finishWithError(err);
  });

  return function cleanup() {
    killed = true;
    clearTimeout(timeout);
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    cleanupTempFiles(tempFiles);
    return { usage: capturedUsage || null, partialResponse: fullResponse };
  };
}

async function warmUp() {
  return new Promise((resolve) => {
    const child = spawn('codex', [
      'exec',
      '--json',
      '--model', DEFAULT_MODEL,
      '-c', `reasoning_effort="${DEFAULT_REASONING_EFFORT}"`,
      '--skip-git-repo-check',
      '-',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,               // required on Windows where codex may be a .cmd shim
      env: { ...process.env, CLAUDECODE: undefined },
    });
    child.stdin.write('Reply with exactly: ok');
    child.stdin.end();

    const timeout = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      console.log('Codex CLI warm-up timed out (30s) -- continuing anyway');
      resolve();
    }, 30000);

    child.on('close', () => {
      clearTimeout(timeout);
      console.log('Codex CLI warm-up complete');
      resolve();
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      console.warn('Codex CLI warm-up failed:', err.message);
      resolve();
    });
  });
}

/**
 * Parse escalation fields from image or text.
 *
 * @param {string} imageBase64OrText
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{fields: Object, usage: Object|null}>} Wrapper with parsed fields and usage metadata
 */
async function parseEscalation(imageBase64OrText, options = {}) {
  const input = typeof imageBase64OrText === 'string' ? imageBase64OrText : '';
  const isBase64Image = input.startsWith('data:image') || /^[A-Za-z0-9+/=]{100,}$/.test(input);
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : PARSE_TIMEOUT_MS;
  const effectiveParseModel = options.model || PARSE_MODEL;

  const schemaExample = JSON.stringify({
    coid: '',
    mid: '',
    caseNumber: '',
    clientContact: '',
    agentName: '',
    attemptingTo: '',
    expectedOutcome: '',
    actualOutcome: '',
    tsSteps: '',
    triedTestAccount: 'unknown',
    category: 'unknown',
  }, null, 2);

  const instructions = [
    'Extract escalation fields and reply with JSON only.',
    'Use this exact shape and key names:',
    schemaExample,
    'Rules:',
    '- category must be one of: payroll, bank-feeds, reconciliation, permissions, billing, tax, invoicing, reporting, inventory, payments, integrations, general, technical, unknown',
    '- triedTestAccount must be one of: yes, no, unknown',
    '- use empty strings for missing text fields',
    '- do not include markdown fences',
  ].join('\n');

  const prompt = isBase64Image
    ? instructions
    : `${instructions}\n\nEscalation text:\n${input}`;

  const tempFiles = isBase64Image ? writeImageTempFiles([input]) : [];
  const args = [
    'exec',
    '--json',
    '--model', effectiveParseModel,
    '-c', `reasoning_effort="${PARSE_REASONING_EFFORT}"`,
    '--skip-git-repo-check',
  ];
  for (const file of tempFiles) {
    args.push('--image', shellEscapeArg(file));
  }
  args.push('-');

  return new Promise((resolve, reject) => {
    // shell: true required on Windows where codex may be a .cmd shim.
    // User content is piped via stdin — never passed as a CLI argument.
    const child = spawn('codex', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env, CLAUDECODE: undefined },
    });

    let settled = false;
    let stdoutBuffer = '';
    let stderrOutput = '';
    let fullResponse = '';
    let capturedUsage = null;
    const seenAgentTextByItem = new Map();

    function finishOk(result) {
      if (settled) return;
      settled = true;
      cleanupTempFiles(tempFiles);
      resolve({ fields: result, usage: capturedUsage });
    }

    function finishErr(err) {
      if (settled) return;
      settled = true;
      cleanupTempFiles(tempFiles);
      const error = err instanceof Error ? err : new Error(String(err));
      error._usage = capturedUsage || null;
      reject(error);
    }

    child.stdin.write(prompt);
    child.stdin.end();

    const timeout = setTimeout(() => {
      if (settled) return;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      const timeoutErr = new Error('Codex CLI parse timed out after ' + timeoutMs + 'ms');
      timeoutErr.code = 'TIMEOUT';
      finishErr(timeoutErr);
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      if (settled) return;
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          const usage = extractCodexUsage(event, { fallbackModel: effectiveParseModel });
          if (usage) capturedUsage = usage;
        } catch { /* non-JSON, ignore */ }
        const delta = extractDeltaFromEventLine(line, seenAgentTextByItem);
        if (delta) fullResponse += delta;
      }
    });

    child.stderr.on('data', (data) => {
      stderrOutput += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;

      try {
        const event = JSON.parse(stdoutBuffer);
        const usage = extractCodexUsage(event, { fallbackModel: effectiveParseModel });
        if (usage) capturedUsage = usage;
      } catch { /* ignore */ }

      const tailDelta = extractDeltaFromEventLine(stdoutBuffer, seenAgentTextByItem);
      if (tailDelta) fullResponse += tailDelta;

      if (code !== 0 && !fullResponse) {
        finishErr(new Error(formatCliFailure(code, stderrOutput)));
        return;
      }

      const parsed = extractJSONObject(fullResponse);
      if (parsed) {
        finishOk(parsed);
        return;
      }

      finishOk({
        category: 'unknown',
        attemptingTo: fullResponse.slice(0, 800),
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      finishErr(err);
    });
  });
}

function buildPrompt(messages, systemPrompt) {
  const parts = [];
  if (systemPrompt && systemPrompt.trim()) {
    parts.push('System instructions:\n' + systemPrompt.trim());
  }

  if (!messages || messages.length === 0) {
    return parts.join('\n\n');
  }

  if (messages.length === 1 && !systemPrompt) {
    return messages[0].content;
  }

  const history = [];
  for (const msg of messages) {
    const prefix = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
    history.push(prefix + ': ' + (msg.content || ''));
  }
  history.push('Assistant:');
  parts.push(history.join('\n\n'));

  return parts.join('\n\n');
}

function writeImageTempFiles(images) {
  if (!images || images.length === 0) return [];
  const files = [];

  for (let i = 0; i < images.length; i++) {
    const decoded = decodeImageInput(images[i]);
    const tmpPath = path.join(
      os.tmpdir(),
      `qbo-codex-img-${Date.now()}-${process.pid}-${i}.${decoded.extension}`
    );
    fs.writeFileSync(tmpPath, decoded.buffer);
    files.push(tmpPath);
  }

  return files;
}

function cleanupTempFiles(files) {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
}

function extractDeltaFromEventLine(line, seenAgentTextByItem) {
  if (!line || !line.trim()) return '';

  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return '';
  }

  if (event.item && event.item.type === 'agent_message' && typeof event.item.text === 'string') {
    const id = event.item.id || '__default__';
    const prevText = seenAgentTextByItem.get(id) || '';
    const nextText = event.item.text;

    seenAgentTextByItem.set(id, nextText);
    if (nextText.startsWith(prevText)) {
      return nextText.slice(prevText.length);
    }
    return nextText;
  }

  if (typeof event.delta === 'string') {
    return event.delta;
  }
  if (event.delta && typeof event.delta.text === 'string') {
    return event.delta.text;
  }
  if (typeof event.text === 'string' && event.type && event.type.includes('delta')) {
    return event.text;
  }

  return '';
}

function extractJSONObject(text) {
  if (!text || !text.trim()) return null;

  const direct = safeJsonParse(text);
  if (direct && typeof direct === 'object') return direct;

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;

  const candidate = text.slice(firstBrace, lastBrace + 1);
  const parsed = safeJsonParse(candidate);
  if (parsed && typeof parsed === 'object') return parsed;

  return null;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function shellEscapeArg(value) {
  if (!value || typeof value !== 'string') return value;
  if (!/[\s"]/.test(value)) return value;

  if (process.platform === 'win32') {
    return '"' + value.replace(/"/g, '\\"') + '"';
  }

  return "'" + value.replace(/'/g, `'\\''`) + "'";
}

module.exports = { chat, parseEscalation, warmUp };
module.exports._internal = { parsePositiveInt, didCliExitSuccessfully };
