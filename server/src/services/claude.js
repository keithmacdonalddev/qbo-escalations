const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { extractClaudeUsage } = require('../lib/usage-extractor');
const { reportServerError } = require('../lib/server-error-pipeline');
const { parseImageWithSDK } = require('./sdk-image-parse');
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

// Concurrency limiter for SDK image parsing — only 1 at a time to prevent
// memory pressure from parallel Claude Code subprocess spawns.
let _sdkParseActive = false;
const _sdkParseQueue = [];

function acquireSdkSlot() {
  return new Promise((resolve) => {
    if (!_sdkParseActive) {
      _sdkParseActive = true;
      resolve();
    } else {
      _sdkParseQueue.push(resolve);
    }
  });
}

function releaseSdkSlot() {
  if (_sdkParseQueue.length > 0) {
    const next = _sdkParseQueue.shift();
    next();
  } else {
    _sdkParseActive = false;
  }
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function didCliExitSuccessfully(code) {
  return code === 0;
}

const CHAT_TIMEOUT_MS = parsePositiveInt(process.env.CLAUDE_CHAT_TIMEOUT_MS, 180000);
const PARSE_TIMEOUT_MS = parsePositiveInt(process.env.CLAUDE_PARSE_TIMEOUT_MS, 300000);
const CLAUDE_ALLOWED_EFFORTS = new Set(['low', 'medium', 'high']);

function normalizeClaudeEffort(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'xhigh') return 'high';
  return CLAUDE_ALLOWED_EFFORTS.has(normalized) ? normalized : null;
}

function cleanupTempFiles(paths) {
  for (const f of paths) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
}

/**
 * Prepare CLI args and prompt text for passing images to Claude.
 *
 * Claude CLI no longer supports the --image flag. Images are passed by:
 *  1. Writing base64 data to temp files on disk
 *  2. Appending the file paths to the prompt text
 *  3. Granting the CLI read access via --add-dir + --permission-mode bypassPermissions
 */
function prepareImageArgs(args, stdinPrompt, imagePaths) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) return stdinPrompt;
  const result = appendImagePathsToPrompt(stdinPrompt, imagePaths);
  addCompatibilityImageAccessArgs(args, imagePaths);
  return result;
}

function combineUsage(usageA, usageB) {
  if (!usageA && !usageB) return null;
  if (!usageA) return usageB;
  if (!usageB) return usageA;
  return {
    model: usageB.model || usageA.model,
    inputTokens: (usageA.inputTokens || 0) + (usageB.inputTokens || 0),
    outputTokens: (usageA.outputTokens || 0) + (usageB.outputTokens || 0),
    cacheCreationInputTokens: (usageA.cacheCreationInputTokens || 0) + (usageB.cacheCreationInputTokens || 0),
    cacheReadInputTokens: (usageA.cacheReadInputTokens || 0) + (usageB.cacheReadInputTokens || 0),
    cost: ((usageA.cost || 0) + (usageB.cost || 0)) || undefined,
  };
}

function formatCliFailure(code, stderr, stdout) {
  const stderrPreview = (stderr || '').trim().slice(0, 500);
  const stdoutPreview = (stdout || '').trim().slice(0, 500);
  const preview = stderrPreview || stdoutPreview;
  const lower = preview.toLowerCase();
  const missingBinary =
    lower.includes('not recognized as an internal or external command') ||
    lower.includes('command not found') ||
    lower.includes('enoent');

  if (missingBinary) {
    return 'Claude CLI command not found. Ensure `claude` is installed and available on PATH.';
  }
  if (preview) {
    return 'Claude CLI exited with code ' + code + ': ' + preview;
  }
  return 'Claude CLI exited with code ' + code;
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

async function writeTempImageFile(imageInput, prefix, index) {
  const decoded = decodeImageInput(imageInput);
  const fileName = `${prefix}-${Date.now()}-${process.pid}-${index}.${decoded.extension}`;
  const tmpPath = path.join(os.tmpdir(), fileName);
  await fs.promises.writeFile(tmpPath, decoded.buffer);
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
function chat({ messages, systemPrompt, images, model, reasoningEffort, timeoutMs, onChunk, onThinkingChunk, onDone, onError }) {
  const prompt = buildPrompt(messages);
  const tempFiles = [];
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
  const effectiveTimeoutMs = parsePositiveInt(timeoutMs, CHAT_TIMEOUT_MS);
  if (model) args.push('--model', model);
  const normalizedEffort = normalizeClaudeEffort(reasoningEffort);
  if (normalizedEffort) args.push('--effort', normalizedEffort);
  let stdinPrompt = systemPrompt
    ? `System instructions:\n${systemPrompt}\n\n${prompt}`
    : prompt;

  let fullResponse = '';
  let killed = false;
  let settled = false;
  let capturedUsage = null;
  let receivedThinking = false;
  let child = null;
  let timeoutHandle = null;

  function finishWithError(err) {
    if (settled || killed) return;
    settled = true;
    cleanupTempFiles(tempFiles);
    const error = err instanceof Error ? err : new Error(String(err));
    error._usage = capturedUsage || null;
    reportServerError({
      message: `CLI chat failed: ${error.message}`,
      detail: `Claude CLI subprocess error during chat. Code: ${error.code || 'N/A'}`,
      stack: error.stack || '',
      source: 'claude.js',
      category: 'runtime-error',
    });
    onError(error);
  }

  function finishWithSuccess(text) {
    if (settled || killed) return;
    settled = true;
    cleanupTempFiles(tempFiles);
    onDone(text, capturedUsage || null);
  }

  // Async setup: write temp image files (non-blocking), then spawn subprocess.
  // The cleanup function returned below handles both the setup and spawn phases.
  (async () => {
    try {
      if (images && images.length > 0) {
        const written = await Promise.all(
          images.map((img, i) => writeTempImageFile(img, 'qbo-escalation-img', i))
        );
        tempFiles.push(...written);
      }
    } catch (err) {
      cleanupTempFiles(tempFiles);
      if (!killed) onError(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    // Abort if cleanup was called during file writes
    if (killed || settled) {
      cleanupTempFiles(tempFiles);
      return;
    }

    if (tempFiles.length > 0) {
      stdinPrompt = prepareImageArgs(args, stdinPrompt, tempFiles);
    }

    try {
      // shell: true required on Windows where claude may be a .cmd shim.
      // User content is piped via stdin — never passed as a CLI argument.
      child = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          CLAUDECODE: undefined,
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        },
      });
    } catch (err) {
      cleanupTempFiles(tempFiles);
      const spawnErr = err instanceof Error ? err : new Error(String(err));
      reportServerError({
        message: `CLI spawn error: ${spawnErr.message}`,
        detail: 'Failed to start Claude CLI subprocess for chat.',
        stack: spawnErr.stack || '',
        source: 'claude.js',
        category: 'runtime-error',
      });
      if (!killed) onError(spawnErr);
      return;
    }
    try {
      child.stdin.end(stdinPrompt);
    } catch { /* ignore; process error handler will surface if needed */ }

    let stdoutBuffer = '';
    let stderrOutput = '';

    // Activity-based timeout: resets on each stdout/stderr data event so
    // active-but-slow streams are not killed prematurely. The timeout only
    // fires after effectiveTimeoutMs of complete CLI inactivity.
    function resetActivityTimeout() {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      timeoutHandle = setTimeout(() => {
        if (killed || settled) return;
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        const timeoutErr = new Error('Claude CLI timed out after ' + effectiveTimeoutMs + 'ms of inactivity');
        timeoutErr.code = 'TIMEOUT';
        finishWithError(timeoutErr);
      }, effectiveTimeoutMs);
    }
    resetActivityTimeout();

    child.stdout.on('data', (data) => {
      if (settled || killed) return;
      resetActivityTimeout();
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          const usage = extractClaudeUsage(msg, { fallbackModel: process.env.CLAUDE_CHAT_MODEL || '' });
          if (usage) capturedUsage = usage;
          const thinking = extractThinking(msg);
          if (thinking && onThinkingChunk) {
            receivedThinking = true;
            try { onThinkingChunk(thinking); } catch { /* ignore */ }
          }
          const text = extractText(msg);
          if (text) {
            fullResponse += text;
            try { onChunk(text); } catch { /* ignore client callback errors */ }
          }
          // Fallback: if this is a result/assistant msg and no deltas arrived yet, use it
          if (!text && !fullResponse) {
            const finalText = extractFinalText(msg);
            if (finalText) {
              fullResponse = finalText;
              try { onChunk(finalText); } catch { /* ignore */ }
            }
          }
          // Log unhandled message types that produced no output
          if (!thinking && !text) {
            const inner = (msg.type === 'stream_event' && msg.event) ? msg.event : msg;
            const msgType = inner.type || msg.type || 'unknown';
            if (!['ping', 'message_start', 'content_block_start', 'content_block_stop', 'message_stop'].includes(msgType)) {
              console.debug('[claude] Unhandled stream event type=%s keys=%s', msgType, Object.keys(inner).join(','));
            }
          }
        } catch {
          // Log potential JSON parse failures (not verbose text output)
          if (line.trim().startsWith('{')) {
            console.warn('[claude] Failed to parse potential JSON line:', line.substring(0, 200));
          }
        }
      }
    });

    child.stderr.on('data', (data) => {
      resetActivityTimeout();
      if (stderrOutput.length < 10240) stderrOutput += data.toString();
    });

    child.on('close', (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (settled || killed) return;

      if (stdoutBuffer.trim()) {
        try {
          const msg = JSON.parse(stdoutBuffer);
          const usage = extractClaudeUsage(msg, { fallbackModel: process.env.CLAUDE_CHAT_MODEL || '' });
          if (usage) capturedUsage = usage;
          const thinking = extractThinking(msg);
          if (thinking && onThinkingChunk) {
            receivedThinking = true;
            try { onThinkingChunk(thinking); } catch { /* ignore */ }
          }
          // Try streaming delta first
          const text = extractText(msg);
          if (text) {
            fullResponse += text;
            try { onChunk(text); } catch { /* ignore client callback errors */ }
          }
          // If no deltas were received, fall back to the final result/assistant message
          if (!fullResponse) {
            const finalText = extractFinalText(msg);
            if (finalText) {
              fullResponse = finalText;
              try { onChunk(finalText); } catch { /* ignore */ }
            }
          }
          // Log unhandled message types in final buffer flush
          if (!thinking && !text) {
            const inner = (msg.type === 'stream_event' && msg.event) ? msg.event : msg;
            const msgType = inner.type || msg.type || 'unknown';
            if (!['ping', 'message_start', 'content_block_start', 'content_block_stop', 'message_stop'].includes(msgType)) {
              console.debug('[claude] Unhandled stream event (final buffer) type=%s keys=%s', msgType, Object.keys(inner).join(','));
            }
          }
        } catch {
          if (stdoutBuffer.trim().startsWith('{')) {
            console.warn('[claude] Failed to parse final buffer as JSON:', stdoutBuffer.substring(0, 200));
          }
        }
      }

      if (!didCliExitSuccessfully(code)) {
        finishWithError(new Error(formatCliFailure(code, stderrOutput, fullResponse)));
      } else {
        if (!fullResponse && receivedThinking) {
          console.warn('[claude] Process exited OK but fullResponse is empty despite receiving thinking chunks — possible extraction gap');
        }
        finishWithSuccess(fullResponse);
      }
    });

    child.on('error', (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (!killed) finishWithError(err);
    });
  })().catch((err) => {
    // Safety net: prevent unhandled rejection if an unexpected error escapes
    if (!settled && !killed) finishWithError(err);
  });

  return function cleanup() {
    killed = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    try { if (child) child.kill('SIGTERM'); } catch { /* ignore */ }
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
  const effortOverride = normalizeClaudeEffort(options.reasoningEffort);

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

  const effectiveTimeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : PARSE_TIMEOUT_MS;

  // ---------- IMAGE PATH ----------
  if (isBase64Image) {
    // Try SDK path first (native vision, single-pass, best quality).
    // Concurrency-limited to 1 to prevent memory pressure from parallel subprocess spawns.
    try {
      await acquireSdkSlot();
      try {
        const sdkResult = await parseImageWithSDK(imageBase64OrText, {
          timeoutMs: effectiveTimeoutMs,
          model: modelOverride || undefined,
          reasoningEffort: effortOverride || undefined,
        });
        if (sdkResult && sdkResult.fields) {
          console.log('[parseEscalation] SDK path succeeded');
          return sdkResult;
        }
        console.warn('[parseEscalation] SDK path returned null — falling back to CLI');
      } finally {
        releaseSdkSlot();
      }
    } catch (sdkErr) {
      // releaseSdkSlot() already called by the inner finally — no double-release
      console.warn('[parseEscalation] SDK path error, falling back to CLI:', sdkErr.message);
    }

    // --- CLI fallback: two-step transcribe then parse ---
    let tmpPath;
    try {
      tmpPath = await writeTempImageFile(source, 'qbo-parse', 0);
    } catch (err) {
      reportServerError({
        message: `Image decode error: ${err.message}`,
        detail: 'Failed to write temp image file for parseEscalation.',
        stack: err.stack || '',
        source: 'claude.js',
        category: 'runtime-error',
      });
      throw err;
    }

    // --- Step A: Transcribe the image as plain text (no JSON schema) ---
    const transcribeTimeoutMs = Math.round(effectiveTimeoutMs * 0.7);
    const transcribePrompt =
      'Transcribe all text visible in this escalation screenshot exactly as written. ' +
      'Do not summarize, interpret, or reword anything. Pay special attention to numeric IDs — ' +
      'transcribe each digit carefully. Include all field labels exactly as they appear ' +
      '(COID/MID, CASE, CLIENT/CONTACT, CX IS ATTEMPTING TO, EXPECTED OUTCOME, ACTUAL OUTCOME, ' +
      'TS STEPS, TRIED TEST ACCOUNT, etc). Return only the transcribed text.';

    let transcriptionText;
    let stepAUsage = null;

    try {
      const stepAResult = await new Promise((resolve, reject) => {
        let settled = false;
        const tArgs = ['-p', '--output-format', 'text'];
        if (modelOverride) tArgs.push('--model', modelOverride);
        if (effortOverride) tArgs.push('--effort', effortOverride);
        addCompatibilityImageAccessArgs(tArgs, [tmpPath]);

        let child;
        try {
          child = spawn('claude', tArgs, {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true,
            cwd: PROJECT_ROOT,
            env: {
              ...process.env,
              CLAUDECODE: undefined,
              CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
            },
          });
        } catch (err) {
          reportServerError({
            message: `CLI spawn error (transcribe): ${err.message}`,
            detail: 'Failed to start Claude CLI subprocess for image transcription.',
            stack: err.stack || '',
            source: 'claude.js',
            category: 'runtime-error',
          });
          return reject(err);
        }

        const stdinPromptA = appendImagePathsToPrompt(transcribePrompt, [tmpPath]);
        try { child.stdin.end(stdinPromptA); } catch { /* ignore */ }

        let stdout = '';
        let stderr = '';
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { child.kill('SIGTERM'); } catch { /* ignore */ }
          const timeoutErr = new Error('Claude CLI transcription timed out after ' + transcribeTimeoutMs + 'ms');
          timeoutErr.code = 'TIMEOUT';
          reject(timeoutErr);
        }, transcribeTimeoutMs);

        child.stdout.on('data', (d) => { if (!settled) stdout += d.toString(); });
        child.stderr.on('data', (d) => { if (!settled && stderr.length < 10240) stderr += d.toString(); });

        child.on('close', (code) => {
          clearTimeout(timeout);
          if (settled) return;
          settled = true;
          if (code !== 0 && !stdout) {
            const cliErr = new Error(formatCliFailure(code, stderr));
            reportServerError({
              message: `CLI transcribe failed: exit code ${code}`,
              detail: `stderr: ${(stderr || '').slice(0, 500)}`,
              source: 'claude.js',
              category: 'runtime-error',
            });
            return reject(cliErr);
          }
          // Try to extract usage from text output (may be wrapped in JSON)
          let usage = null;
          try {
            const parsed = JSON.parse(stdout);
            usage = extractClaudeUsage(parsed, { fallbackModel: process.env.CLAUDE_PARSE_MODEL || '' });
            // If output was JSON-wrapped, extract the text result
            const text = typeof parsed.result === 'string' ? parsed.result : stdout;
            resolve({ text, usage });
          } catch {
            resolve({ text: stdout, usage: null });
          }
        });

        child.on('error', (err) => {
          clearTimeout(timeout);
          if (settled) return;
          settled = true;
          reportServerError({
            message: `CLI spawn error (transcribe): ${err.message}`,
            detail: 'Claude CLI process emitted an error event during transcription.',
            stack: err.stack || '',
            source: 'claude.js',
            category: 'runtime-error',
          });
          reject(err);
        });
      });

      transcriptionText = stepAResult.text;
      stepAUsage = stepAResult.usage;
    } finally {
      // Clean up temp image file after Step A regardless of outcome
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }

    // --- Step B: Parse the transcription text using the existing text-parse path ---
    const parseTimeoutMs = effectiveTimeoutMs - Math.round(effectiveTimeoutMs * 0.7);
    const parsePrompt = 'Parse this escalation text. Extract all fields: COID, MID, case number, ' +
      'client contact, agent name, what they are attempting, expected outcome, actual outcome, ' +
      'troubleshooting steps, whether they tried a test account, and issue category. ' +
      'Do not guess unclear names, IDs, numbers, or labels. If a field is unreadable or uncertain, return an empty string for that field. ' +
      'Prefer exact transcription over summarizing. Return ONLY the JSON.\n\nEscalation text:\n' + transcriptionText;

    const parseArgs = ['-p', '--output-format', 'json', '--json-schema', schema];
    if (modelOverride) parseArgs.push('--model', modelOverride);
    if (effortOverride) parseArgs.push('--effort', effortOverride);

    return new Promise((resolve, reject) => {
      let settled = false;
      let child;
      try {
        child = spawn('claude', parseArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
          cwd: PROJECT_ROOT,
          env: {
            ...process.env,
            CLAUDECODE: undefined,
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
          },
        });
      } catch (err) {
        reportServerError({
          message: `CLI spawn error (parse step B): ${err.message}`,
          detail: 'Failed to start Claude CLI subprocess for parseEscalation step B.',
          stack: err.stack || '',
          source: 'claude.js',
          category: 'runtime-error',
        });
        err._usage = stepAUsage || null;
        return reject(err);
      }
      try { child.stdin.end(parsePrompt); } catch { /* ignore */ }

      let stdout = '';
      let stderr = '';
      let capturedUsage = null;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        const timeoutErr = new Error('Claude CLI parse (step B) timed out after ' + parseTimeoutMs + 'ms');
        timeoutErr.code = 'TIMEOUT';
        timeoutErr._usage = combineUsage(stepAUsage, capturedUsage);
        reject(timeoutErr);
      }, parseTimeoutMs);

      child.stdout.on('data', (d) => { if (!settled) stdout += d.toString(); });
      child.stderr.on('data', (d) => { if (!settled && stderr.length < 10240) stderr += d.toString(); });

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (settled) return;
        settled = true;

        if (code !== 0 && !stdout) {
          const cliErr = new Error(formatCliFailure(code, stderr, stdout));
          cliErr._usage = combineUsage(stepAUsage, capturedUsage);
          reportServerError({
            message: `CLI parse (step B) failed: exit code ${code}`,
            detail: `stderr: ${(stderr || '').slice(0, 500)}`,
            source: 'claude.js',
            category: 'runtime-error',
          });
          return reject(cliErr);
        }

        try {
          const parsed = JSON.parse(stdout);
          const usage = extractClaudeUsage(parsed, { fallbackModel: process.env.CLAUDE_PARSE_MODEL || '' });
          if (usage) capturedUsage = usage;
          const combined = combineUsage(stepAUsage, capturedUsage);
          const data = parsed.structured_output || parsed.result || parsed;
          if (typeof data === 'string') {
            const jsonMatch = data.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              resolve({ fields: JSON.parse(jsonMatch[0]), usage: combined });
            } else {
              resolve({ fields: { category: 'unknown', attemptingTo: data }, usage: combined });
            }
          } else {
            resolve({ fields: data, usage: combined });
          }
        } catch {
          if (!capturedUsage) {
            for (const line of stdout.split('\n')) {
              if (!line.trim()) continue;
              try {
                const u = extractClaudeUsage(JSON.parse(line), { fallbackModel: process.env.CLAUDE_PARSE_MODEL || '' });
                if (u) { capturedUsage = u; break; }
              } catch { /* ignore non-JSON lines */ }
            }
          }
          const combined = combineUsage(stepAUsage, capturedUsage);
          const jsonMatch = stdout.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              resolve({ fields: JSON.parse(jsonMatch[0]), usage: combined });
            } catch {
              resolve({ fields: { category: 'unknown', attemptingTo: stdout.slice(0, 500) }, usage: combined });
            }
          } else {
            resolve({ fields: { category: 'unknown', attemptingTo: stdout.slice(0, 500) }, usage: combined });
          }
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        if (settled) return;
        settled = true;
        reportServerError({
          message: `CLI spawn error (parse step B): ${err.message}`,
          detail: 'Claude CLI process emitted an error event during parseEscalation step B.',
          stack: err.stack || '',
          source: 'claude.js',
          category: 'runtime-error',
        });
        err._usage = combineUsage(stepAUsage, capturedUsage);
        reject(err);
      });
    });
  }

  // ---------- TEXT PATH: single-step parse (unchanged) ----------
  const prompt = 'Parse this escalation text. Extract all fields: COID, MID, case number, ' +
    'client contact, agent name, what they are attempting, expected outcome, actual outcome, ' +
    'troubleshooting steps, whether they tried a test account, and issue category. ' +
    'Do not guess unclear names, IDs, numbers, or labels. If a field is unreadable or uncertain, return an empty string for that field. ' +
    'Prefer exact transcription over summarizing. Return ONLY the JSON.\n\nEscalation text:\n' + source;

  const args = ['-p', '--output-format', 'json', '--json-schema', schema];
  if (modelOverride) args.push('--model', modelOverride);
  if (effortOverride) args.push('--effort', effortOverride);

  return new Promise((resolve, reject) => {
    let settled = false;
    let child;
    try {
      child = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          CLAUDECODE: undefined,
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        },
      });
    } catch (err) {
      reportServerError({
        message: `CLI spawn error: ${err.message}`,
        detail: 'Failed to start Claude CLI subprocess for parseEscalation.',
        stack: err.stack || '',
        source: 'claude.js',
        category: 'runtime-error',
      });
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
      if (stderr.length < 10240) stderr += d.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;

      if (code !== 0 && !stdout) {
        const cliErr = new Error(formatCliFailure(code, stderr, stdout));
        cliErr._usage = capturedUsage || null;
        reportServerError({
          message: `CLI parse failed: exit code ${code}`,
          detail: `stderr: ${(stderr || '').slice(0, 500)}`,
          source: 'claude.js',
          category: 'runtime-error',
        });
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
      reportServerError({
        message: `CLI spawn error (parse): ${err.message}`,
        detail: 'The Claude CLI process emitted an error event during parseEscalation.',
        stack: err.stack || '',
        source: 'claude.js',
        category: 'runtime-error',
      });
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
      env: {
        ...process.env,
        CLAUDECODE: undefined,
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      },
    });
    // Pipe the prompt via stdin to avoid passing content as a CLI argument
    try { child.stdin.end('hello'); } catch { /* ignore */ }

    const timeout = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      resolve();
    }, 30000);

    child.on('close', () => {
      clearTimeout(timeout);
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
 * Extract thinking content from a stream-json thinking_delta message.
 * With --include-partial-messages, events arrive wrapped as:
 * { type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "..." } } }
 */
function extractThinking(msg) {
  const inner = (msg.type === 'stream_event' && msg.event) ? msg.event : msg;
  if (inner.type === 'content_block_delta'
      && inner.delta
      && inner.delta.type === 'thinking_delta'
      && typeof inner.delta.thinking === 'string') {
    return inner.delta.thinking;
  }
  return null;
}

/**
 * Extract text content from a stream-json message.
 *
 * IMPORTANT: Only extract from content_block_delta (streaming chunks).
 * The 'assistant' and 'result' message types contain the FULL text again
 * and would duplicate what was already accumulated from deltas.
 */
function extractText(msg) {
  // Unwrap stream_event wrapper if present
  const inner = (msg.type === 'stream_event' && msg.event) ? msg.event : msg;
  if (inner.type === 'content_block_delta' && inner.delta && inner.delta.text) {
    return inner.delta.text;
  }
  return '';
}

/**
 * Extract final complete text from a result/assistant message.
 * Used ONLY as a fallback when no streaming deltas were received.
 */
function extractFinalText(msg) {
  if (msg.type === 'assistant' && msg.message && msg.message.content) {
    return msg.message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
  if (msg.type === 'result' && msg.result) {
    return typeof msg.result === 'string' ? msg.result : '';
  }
  return '';
}

/**
 * Run a single non-streaming Claude prompt and return the text result.
 *
 * @param {string} promptText - The prompt to send
 * @param {Object} [options]
 * @param {string} [options.systemPrompt] - Optional system prompt prepended
 * @param {string} [options.model] - Override model
 * @param {string} [options.reasoningEffort] - Effort level (low/medium/high)
 * @param {number} [options.timeoutMs] - Timeout in ms (default CHAT_TIMEOUT_MS)
 * @returns {Promise<{text: string, usage: Object|null}>}
 */
async function prompt(promptText, options = {}) {
  const args = ['-p', '--output-format', 'text', '--max-turns', '1'];
  if (options.model) args.push('--model', options.model);
  const effort = normalizeClaudeEffort(options.reasoningEffort);
  if (effort) args.push('--effort', effort);

  let stdinContent = promptText || '';
  if (options.systemPrompt) {
    stdinContent = `System instructions:\n${options.systemPrompt}\n\n${stdinContent}`;
  }

  const timeoutMs = parsePositiveInt(options.timeoutMs, CHAT_TIMEOUT_MS);

  return new Promise((resolve, reject) => {
    let settled = false;
    let child;
    try {
      child = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          CLAUDECODE: undefined,
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        },
      });
    } catch (err) {
      reportServerError({
        message: `CLI spawn error (prompt): ${err.message}`,
        detail: 'Failed to start Claude CLI subprocess for prompt().',
        stack: err.stack || '',
        source: 'claude.js',
        category: 'runtime-error',
      });
      return reject(err);
    }

    try { child.stdin.end(stdinContent); } catch { /* ignore */ }

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      const err = new Error('Claude CLI prompt timed out after ' + timeoutMs + 'ms');
      err.code = 'TIMEOUT';
      reject(err);
    }, timeoutMs);

    child.stdout.on('data', (d) => { if (!settled) stdout += d.toString(); });
    child.stderr.on('data', (d) => { if (!settled && stderr.length < 10240) stderr += d.toString(); });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;

      if (!didCliExitSuccessfully(code) && !stdout) {
        const err = new Error(formatCliFailure(code, stderr, stdout));
        reportServerError({
          message: `CLI prompt failed: exit code ${code}`,
          detail: `stderr: ${(stderr || '').slice(0, 500)}`,
          source: 'claude.js',
          category: 'runtime-error',
        });
        return reject(err);
      }

      // Try to extract usage if output is JSON-wrapped
      let usage = null;
      let text = stdout;
      try {
        const parsed = JSON.parse(stdout);
        usage = extractClaudeUsage(parsed, { fallbackModel: '' });
        text = typeof parsed.result === 'string' ? parsed.result : stdout;
      } catch { /* text output, not JSON — that's fine */ }

      resolve({ text, usage });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      reportServerError({
        message: `CLI spawn error (prompt): ${err.message}`,
        detail: 'Claude CLI process emitted an error event during prompt().',
        stack: err.stack || '',
        source: 'claude.js',
        category: 'runtime-error',
      });
      reject(err);
    });
  });
}

/**
 * Fast image transcription — extracts ALL visible text from an image without
 * any structured parsing, triage, or field extraction.
 *
 * Accepts a base64 image string (with or without data-URI prefix) or an
 * absolute file path to an image on disk.
 *
 * @param {string} imageBase64OrPath - Base64 image data or absolute file path
 * @param {Object} [options]
 * @param {string} [options.model] - Override model
 * @param {string} [options.reasoningEffort] - Effort level (low/medium/high)
 * @param {number} [options.timeoutMs] - Timeout in ms (default 60 000)
 * @returns {Promise<{text: string, usage: Object|null}>}
 */
const TRANSCRIBE_TIMEOUT_MS = parsePositiveInt(process.env.CLAUDE_TRANSCRIBE_TIMEOUT_MS, 60000);

async function transcribeImage(imageBase64OrPath, options = {}) {
  const input = typeof imageBase64OrPath === 'string' ? imageBase64OrPath.trim() : '';
  if (!input) throw new Error('transcribeImage: image input is empty');

  const modelOverride = options.model || null;
  const effortOverride = normalizeClaudeEffort(options.reasoningEffort);
  const timeoutMs = parsePositiveInt(options.timeoutMs, TRANSCRIBE_TIMEOUT_MS);

  const transcribePrompt =
    'Transcribe ALL text visible in this image exactly as written. ' +
    'Preserve layout, line breaks, labels, and formatting as closely as possible. ' +
    'Do not summarize, interpret, reword, or omit anything. ' +
    'Pay special attention to numeric IDs, codes, and reference numbers — ' +
    'transcribe each digit and character carefully. ' +
    'Return only the transcribed text, nothing else.';

  // Determine whether input is a file path or base64 data
  const isFilePath = !input.startsWith('data:image') &&
    !/^[A-Za-z0-9+/=]{100,}/.test(input) &&
    (path.isAbsolute(input) || /^[a-zA-Z]:[/\\]/.test(input));

  let imagePath = null;
  let tempPath = null;

  if (isFilePath) {
    // Verify the file exists
    if (!fs.existsSync(input)) {
      throw new Error('transcribeImage: file not found: ' + input);
    }
    imagePath = input;
  } else {
    // Write base64 data to a temp file
    try {
      tempPath = await writeTempImageFile(input, 'qbo-transcribe', 0);
      imagePath = tempPath;
    } catch (err) {
      reportServerError({
        message: `Image decode error (transcribeImage): ${err.message}`,
        detail: 'Failed to write temp image file for transcribeImage.',
        stack: err.stack || '',
        source: 'claude.js',
        category: 'runtime-error',
      });
      throw err;
    }
  }

  try {
    return await new Promise((resolve, reject) => {
      let settled = false;

      const args = ['-p', '--output-format', 'text', '--max-turns', '1'];
      if (modelOverride) args.push('--model', modelOverride);
      if (effortOverride) args.push('--effort', effortOverride);

      addCompatibilityImageAccessArgs(args, [imagePath]);

      let child;
      try {
        child = spawn('claude', args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
          cwd: PROJECT_ROOT,
          env: {
            ...process.env,
            CLAUDECODE: undefined,
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
          },
        });
      } catch (err) {
        reportServerError({
          message: `CLI spawn error (transcribeImage): ${err.message}`,
          detail: 'Failed to start Claude CLI subprocess for transcribeImage.',
          stack: err.stack || '',
          source: 'claude.js',
          category: 'runtime-error',
        });
        return reject(err);
      }

      const stdinContent = appendImagePathsToPrompt(transcribePrompt, [imagePath]);
      try { child.stdin.end(stdinContent); } catch { /* ignore */ }

      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        const err = new Error('Claude CLI transcribeImage timed out after ' + timeoutMs + 'ms');
        err.code = 'TIMEOUT';
        reject(err);
      }, timeoutMs);

      child.stdout.on('data', (d) => { if (!settled) stdout += d.toString(); });
      child.stderr.on('data', (d) => { if (!settled && stderr.length < 10240) stderr += d.toString(); });

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (settled) return;
        settled = true;

        if (!didCliExitSuccessfully(code) && !stdout) {
          const err = new Error(formatCliFailure(code, stderr, stdout));
          reportServerError({
            message: `CLI transcribeImage failed: exit code ${code}`,
            detail: `stderr: ${(stderr || '').slice(0, 500)}`,
            source: 'claude.js',
            category: 'runtime-error',
          });
          return reject(err);
        }

        // Try to extract usage if output is JSON-wrapped
        let usage = null;
        let text = stdout;
        try {
          const parsed = JSON.parse(stdout);
          usage = extractClaudeUsage(parsed, { fallbackModel: '' });
          text = typeof parsed.result === 'string' ? parsed.result : stdout;
        } catch { /* text output, not JSON — that's fine */ }

        resolve({ text: text.trim(), usage });
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        if (settled) return;
        settled = true;
        reportServerError({
          message: `CLI spawn error (transcribeImage): ${err.message}`,
          detail: 'Claude CLI process emitted an error event during transcribeImage.',
          stack: err.stack || '',
          source: 'claude.js',
          category: 'runtime-error',
        });
        reject(err);
      });
    });
  } finally {
    // Clean up temp file if we created one
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    }
  }
}

module.exports = { chat, parseEscalation, warmUp, prompt, transcribeImage };
module.exports._internal = { parsePositiveInt, didCliExitSuccessfully };
