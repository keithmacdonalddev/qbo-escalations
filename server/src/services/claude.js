const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { extractClaudeUsage } = require('../lib/usage-extractor');
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function didCliExitSuccessfully(code) {
  return code === 0;
}

const CHAT_TIMEOUT_MS = parsePositiveInt(process.env.CLAUDE_CHAT_TIMEOUT_MS, 180000);
const PARSE_TIMEOUT_MS = parsePositiveInt(process.env.CLAUDE_PARSE_TIMEOUT_MS, 120000);
const CLAUDE_IMAGE_HELP_TIMEOUT_MS = parsePositiveInt(process.env.CLAUDE_IMAGE_HELP_TIMEOUT_MS, 5000);
let supportsClaudeImageFlagCache = null;

function cleanupTempFiles(paths) {
  for (const f of paths) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
}

function formatCliFailure(code, stderr) {
  const preview = (stderr || '').slice(0, 500);
  const lower = preview.toLowerCase();
  const missingBinary =
    lower.includes('not recognized as an internal or external command') ||
    lower.includes('command not found') ||
    lower.includes('enoent');
  const unsupportedImageFlag =
    (lower.includes('unknown option') || lower.includes('unknown argument') || lower.includes('unrecognized option'))
    && lower.includes('--image');

  if (missingBinary) {
    return 'Claude CLI command not found. Ensure `claude` is installed and available on PATH.';
  }
  if (unsupportedImageFlag) {
    return 'Installed Claude CLI does not support --image attachments. Upgrade Claude Code or use compatibility mode.';
  }
  return 'Claude CLI exited with code ' + code + ': ' + preview;
}

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return fallback;
}

function supportsClaudeImageFlag() {
  if (supportsClaudeImageFlagCache !== null) return supportsClaudeImageFlagCache;

  if (process.env.CLAUDE_SUPPORTS_IMAGE_INPUT !== undefined) {
    supportsClaudeImageFlagCache = parseBool(process.env.CLAUDE_SUPPORTS_IMAGE_INPUT, false);
    return supportsClaudeImageFlagCache;
  }

  try {
    const help = spawnSync('claude', ['--help'], {
      shell: true,
      cwd: PROJECT_ROOT,
      env: { ...process.env, CLAUDECODE: undefined },
      encoding: 'utf8',
      timeout: CLAUDE_IMAGE_HELP_TIMEOUT_MS,
    });
    const text = `${help.stdout || ''}\n${help.stderr || ''}`.toLowerCase();
    supportsClaudeImageFlagCache = text.includes('--image');
  } catch {
    supportsClaudeImageFlagCache = false;
  }
  return supportsClaudeImageFlagCache;
}

function appendImagePathsToPrompt(prompt, imagePaths) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) return prompt;
  const lines = [
    'Image attachments are available at these local file paths:',
    ...imagePaths.map((filePath, idx) => `${idx + 1}. ${filePath}`),
    'Analyze these images as part of your response.',
  ];
  return `${prompt}\n\n${lines.join('\n')}`;
}

function addCompatibilityImageAccessArgs(args, filePaths) {
  args.push('--permission-mode', 'bypassPermissions');
  const directories = new Set(
    (Array.isArray(filePaths) ? filePaths : [])
      .map((filePath) => path.dirname(filePath))
      .filter(Boolean)
  );
  for (const directory of directories) {
    args.push('--add-dir', directory);
  }
}

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

function writeTempImageFile(imageInput, prefix, index) {
  const decoded = decodeImageInput(imageInput);
  const fileName = `${prefix}-${Date.now()}-${process.pid}-${index}.${decoded.extension}`;
  const tmpPath = path.join(os.tmpdir(), fileName);
  fs.writeFileSync(tmpPath, decoded.buffer);
  return tmpPath;
}

/**
 * Chat with Claude via CLI subprocess.
 *
 * @param {Object} opts
 * @param {Array<{role: string, content: string}>} opts.messages - Conversation history
 * @param {string} [opts.systemPrompt] - System prompt (playbook content)
 * @param {string[]} [opts.images] - Base64-encoded images
 * @param {function} opts.onChunk - Called with each text delta
 * @param {function} opts.onDone - Called with full response text
 * @param {function} opts.onError - Called on failure
 * @returns {function} cleanup - Call to kill the subprocess
 */
function chat({ messages, systemPrompt, images, model, onChunk, onDone, onError }) {
  const prompt = buildPrompt(messages);
  const tempFiles = [];
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  if (model) args.push('--model', model);
  let stdinPrompt = systemPrompt
    ? `System instructions:\n${systemPrompt}\n\n${prompt}`
    : prompt;

  try {
    if (images && images.length > 0) {
      for (let i = 0; i < images.length; i++) {
        const tmpPath = writeTempImageFile(images[i], 'qbo-escalation-img', i);
        tempFiles.push(tmpPath);
      }
    }
  } catch (err) {
    cleanupTempFiles(tempFiles);
    onError(err instanceof Error ? err : new Error(String(err)));
    return function noopCleanup() {};
  }
  if (tempFiles.length > 0) {
    if (supportsClaudeImageFlag()) {
      for (const tempFilePath of tempFiles) {
        args.push('--image', tempFilePath);
      }
    } else {
      stdinPrompt = appendImagePathsToPrompt(stdinPrompt, tempFiles);
      addCompatibilityImageAccessArgs(args, tempFiles);
    }
  }

  let fullResponse = '';
  let killed = false;
  let settled = false;
  let capturedUsage = null;
  let child;
  try {
    // shell: true required on Windows where claude may be a .cmd shim.
    // User content is piped via stdin — never passed as a CLI argument.
    child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      cwd: PROJECT_ROOT,
      env: { ...process.env, CLAUDECODE: undefined },
    });
  } catch (err) {
    cleanupTempFiles(tempFiles);
    onError(err instanceof Error ? err : new Error(String(err)));
    return function noopCleanup() {};
  }
  try {
    child.stdin.end(stdinPrompt);
  } catch { /* ignore; process error handler will surface if needed */ }

  let stdoutBuffer = '';
  let stderrOutput = '';

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
    const timeoutErr = new Error('Claude CLI timed out after ' + CHAT_TIMEOUT_MS + 'ms');
    timeoutErr.code = 'TIMEOUT';
    finishWithError(timeoutErr);
  }, CHAT_TIMEOUT_MS);

  child.stdout.on('data', (data) => {
    if (settled || killed) return;
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        const usage = extractClaudeUsage(msg, { fallbackModel: process.env.CLAUDE_CHAT_MODEL || '' });
        if (usage) capturedUsage = usage;
        const text = extractText(msg);
        if (text) {
          fullResponse += text;
          try { onChunk(text); } catch { /* ignore client callback errors */ }
        }
      } catch {
        // Non-JSON line (verbose output), ignore
      }
    }
  });

  child.stderr.on('data', (data) => {
    stderrOutput += data.toString();
  });

  child.on('close', (code) => {
    clearTimeout(timeout);
    if (settled || killed) return;

    if (stdoutBuffer.trim()) {
      try {
        const msg = JSON.parse(stdoutBuffer);
        const usage = extractClaudeUsage(msg, { fallbackModel: process.env.CLAUDE_CHAT_MODEL || '' });
        if (usage) capturedUsage = usage;
        const text = extractText(msg);
        if (text) {
          fullResponse += text;
          try { onChunk(text); } catch { /* ignore client callback errors */ }
        }
      } catch { /* ignore */ }
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

/**
 * Parse an escalation from image or text using Claude CLI with structured output.
 *
 * @param {string} imageBase64OrText - Either a base64 image string or plain text
 * @returns {Promise<{fields: Object, usage: Object|null}>} Wrapper with parsed fields and usage metadata
 */
async function parseEscalation(imageBase64OrText, options = {}) {
  const source = typeof imageBase64OrText === 'string' ? imageBase64OrText : '';
  const isBase64Image = source.startsWith('data:image') ||
    /^[A-Za-z0-9+/=]{100,}/.test(source);

  const modelOverride = options.model || null;

  const schema = JSON.stringify({
    type: 'object',
    properties: {
      coid:             { type: 'string' },
      mid:              { type: 'string' },
      caseNumber:       { type: 'string' },
      clientContact:    { type: 'string' },
      agentName:        { type: 'string' },
      attemptingTo:     { type: 'string' },
      expectedOutcome:  { type: 'string' },
      actualOutcome:    { type: 'string' },
      tsSteps:          { type: 'string' },
      triedTestAccount: { type: 'string', enum: ['yes', 'no', 'unknown'] },
      category: {
        type: 'string',
        enum: [
          'payroll', 'bank-feeds', 'reconciliation', 'permissions',
          'billing', 'tax', 'invoicing', 'reporting', 'inventory',
          'payments', 'integrations', 'general', 'unknown',
          'technical',
        ],
      },
    },
    required: ['category'],
  });

  let prompt;
  let tmpPath = null;

  if (isBase64Image) {
    tmpPath = writeTempImageFile(source, 'qbo-parse', 0);

    prompt = 'Parse this escalation screenshot. Extract all fields: COID, MID, case number, ' +
      'client contact, agent name, what they are attempting, expected outcome, actual outcome, ' +
      'troubleshooting steps, whether they tried a test account, and issue category. ' +
      'Return ONLY the JSON.';
  } else {
    prompt = 'Parse this escalation text. Extract all fields: COID, MID, case number, ' +
      'client contact, agent name, what they are attempting, expected outcome, actual outcome, ' +
      'troubleshooting steps, whether they tried a test account, and issue category. ' +
      'Return ONLY the JSON.\n\nEscalation text:\n' + source;
  }

  const args = ['-p', '--output-format', 'json', '--json-schema', schema];
  if (modelOverride) args.push('--model', modelOverride);
  if (tmpPath) {
    if (supportsClaudeImageFlag()) {
      args.push('--image', tmpPath);
    } else {
      prompt = appendImagePathsToPrompt(prompt, [tmpPath]);
      addCompatibilityImageAccessArgs(args, [tmpPath]);
    }
  }

  const effectiveTimeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : PARSE_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let settled = false;
    let child;
    try {
      // shell: true required on Windows where claude may be a .cmd shim.
      // User content is piped via stdin — never passed as a CLI argument.
      child = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        cwd: PROJECT_ROOT,
        env: { ...process.env, CLAUDECODE: undefined },
      });
    } catch (err) {
      if (tmpPath) {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      }
      reject(err);
      return;
    }
    try {
      child.stdin.end(prompt);
    } catch { /* ignore; process error handler will surface if needed */ }

    let stdout = '';
    let stderr = '';
    let capturedUsage = null;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      if (tmpPath) {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      }
      const timeoutErr = new Error('Claude CLI parse timed out after ' + effectiveTimeoutMs + 'ms');
      timeoutErr.code = 'TIMEOUT';
      timeoutErr._usage = capturedUsage || null;
      reject(timeoutErr);
    }, effectiveTimeoutMs);

    child.stdout.on('data', (d) => {
      if (settled) return;
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      if (settled) return;
      stderr += d.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;

      if (tmpPath) {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      }

      if (code !== 0 && !stdout) {
        const cliErr = new Error(formatCliFailure(code, stderr));
        cliErr._usage = capturedUsage || null;
        return reject(cliErr);
      }

      try {
        const parsed = JSON.parse(stdout);
        const usage = extractClaudeUsage(parsed, { fallbackModel: process.env.CLAUDE_PARSE_MODEL || '' });
        if (usage) capturedUsage = usage;
        const data = parsed.structured_output || parsed.result || parsed;
        if (typeof data === 'string') {
          const jsonMatch = data.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            resolve({ fields: JSON.parse(jsonMatch[0]), usage: capturedUsage });
          } else {
            resolve({ fields: { category: 'unknown', attemptingTo: data }, usage: capturedUsage });
          }
        } else {
          resolve({ fields: data, usage: capturedUsage });
        }
      } catch {
        // stdout wasn't valid JSON as a whole — try line-by-line extraction for usage
        if (!capturedUsage) {
          for (const line of stdout.split('\n')) {
            if (!line.trim()) continue;
            try {
              const u = extractClaudeUsage(JSON.parse(line), { fallbackModel: process.env.CLAUDE_PARSE_MODEL || '' });
              if (u) { capturedUsage = u; break; }
            } catch { /* ignore non-JSON lines */ }
          }
        }
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            resolve({ fields: JSON.parse(jsonMatch[0]), usage: capturedUsage });
          } catch {
            resolve({ fields: { category: 'unknown', attemptingTo: stdout.slice(0, 500) }, usage: capturedUsage });
          }
        } else {
          resolve({ fields: { category: 'unknown', attemptingTo: stdout.slice(0, 500) }, usage: capturedUsage });
        }
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      if (tmpPath) {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      }
      err._usage = capturedUsage || null;
      reject(err);
    });
  });
}

/**
 * Warm up the Claude CLI to reduce first-request latency.
 */
async function warmUp() {
  return new Promise((resolve) => {
    const child = spawn('claude', ['-p', '--output-format', 'text', '--max-turns', '1'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,               // required on Windows where claude may be a .cmd shim
      cwd: PROJECT_ROOT,
      env: { ...process.env, CLAUDECODE: undefined },
    });
    // Pipe the prompt via stdin to avoid passing content as a CLI argument
    try { child.stdin.end('hello'); } catch { /* ignore */ }

    const timeout = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      console.log('Claude CLI warm-up timed out (30s) -- continuing anyway');
      resolve();
    }, 30000);

    child.on('close', () => {
      clearTimeout(timeout);
      console.log('Claude CLI warm-up complete');
      resolve();
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      console.warn('Claude CLI warm-up failed:', err.message);
      resolve();
    });
  });
}

// --- Helpers ---

/**
 * Build a prompt string from a messages array.
 */
function buildPrompt(messages) {
  if (!messages || messages.length === 0) return '';
  if (messages.length === 1) return messages[0].content;

  const lines = [];
  for (const msg of messages) {
    const prefix = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
    lines.push(prefix + ': ' + msg.content);
  }
  lines.push('Assistant:');
  return lines.join('\n\n');
}

/**
 * Extract text content from a stream-json message.
 */
function extractText(msg) {
  if (msg.type === 'assistant' && msg.message && msg.message.content) {
    return msg.message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
  if (msg.type === 'result' && msg.result) {
    return typeof msg.result === 'string' ? msg.result : '';
  }
  if (msg.type === 'content_block_delta' && msg.delta && msg.delta.text) {
    return msg.delta.text;
  }
  return '';
}

module.exports = { chat, parseEscalation, warmUp };
module.exports._internal = { parsePositiveInt, didCliExitSuccessfully };
