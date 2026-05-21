const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { extractCodexUsage } = require('../lib/usage-extractor');
const { providerHarnessTrace } = require('../lib/provider-harness-trace');
const {
  isStubbed: isProvidersStubbed,
  getProviderStub,
  MissingProviderStubError,
} = require('../lib/harness-provider-gate');
const {
  isProviderCallPackageCaptureEnabled,
  recordCliProviderCallPackageInBackground,
} = require('./provider-call-package-recorder');

const DEFAULT_MODEL = process.env.CODEX_CHAT_MODEL || 'gpt-5.5';
const DEFAULT_REASONING_EFFORT = process.env.CODEX_REASONING_EFFORT || 'high';
const CODEX_ALLOWED_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);
function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function didCliExitSuccessfully(code) {
  return code === 0;
}

function normalizeCodexReasoningEffort(value, fallback = DEFAULT_REASONING_EFFORT) {
  const normalized = String(value || '').trim().toLowerCase();
  return CODEX_ALLOWED_EFFORTS.has(normalized) ? normalized : fallback;
}

const CHAT_TIMEOUT_MS = parsePositiveInt(process.env.CODEX_CHAT_TIMEOUT_MS, 180000);
const PARSE_MODEL = process.env.CODEX_PARSE_MODEL || DEFAULT_MODEL;
const PARSE_REASONING_EFFORT = process.env.CODEX_PARSE_REASONING_EFFORT || DEFAULT_REASONING_EFFORT;
const PARSE_TIMEOUT_MS = parsePositiveInt(process.env.CODEX_PARSE_TIMEOUT_MS, 120000);
const CLI_CAPTURE_CLOSE_WAIT_MS = 250;

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

function isCodexSpawnFailure(err) {
  const code = String(err?.code || '').toUpperCase();
  const message = String(err?.message || '');
  return code === 'ENOENT'
    || code === 'EACCES'
    || code === 'SPAWN_ERROR'
    || /spawn .* (ENOENT|EACCES)/i.test(message);
}

/**
 * Chat with Codex CLI via subprocess.
 *
 * @param {Object} opts
 * @param {Array<{role: string, content: string}>} opts.messages
 * @param {string} [opts.systemPrompt]
 * @param {string[]} [opts.images] - Base64-encoded images
 * @param {function} opts.onChunk
 * @param {function} [opts.onThinkingChunk]
 * @param {function} opts.onDone
 * @param {function} opts.onError
 * @returns {function} cleanup
 */
function chat({ messages, systemPrompt, images, model, reasoningEffort, timeoutMs, onChunk, onThinkingChunk, onDone, onError }) {
  if (isProvidersStubbed()) {
    const stub = getProviderStub('codex', 'chat');
    if (!stub) throw new MissingProviderStubError('codex', 'chat');
    return stub({ messages, systemPrompt, images, model, reasoningEffort, timeoutMs, onChunk, onThinkingChunk, onDone, onError });
  }
  const prompt = buildPrompt(messages, systemPrompt);
  const tempFiles = writeImageTempFiles(images);
  const effectiveModel = model || DEFAULT_MODEL;
  const effectiveReasoningEffort = normalizeCodexReasoningEffort(reasoningEffort);
  const effectiveTimeoutMs = parsePositiveInt(timeoutMs, CHAT_TIMEOUT_MS);

  const args = [
    'exec',
    '--json',
    '--model', effectiveModel,
    '-c', `reasoning_effort="${effectiveReasoningEffort}"`,
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
  const seenReasoningTextByItem = new Map();

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
    const timeoutErr = new Error('Codex CLI timed out after ' + effectiveTimeoutMs + 'ms');
    timeoutErr.code = 'TIMEOUT';
    finishWithError(timeoutErr);
  }, effectiveTimeoutMs);

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
      const thinking = extractThinkingFromEventLine(line, seenReasoningTextByItem);
      if (thinking && onThinkingChunk) {
        try { onThinkingChunk(thinking); } catch { /* ignore callback errors */ }
      }
      const delta = extractDeltaFromEventLine(line, seenAgentTextByItem);
      if (delta) {
        fullResponse += delta;
        try { onChunk(delta); } catch { /* ignore callback errors */ }
      }
    }
  });

  let stderrOutput = '';
  child.stderr.on('data', (data) => {
    if (stderrOutput.length < 10240) stderrOutput += data.toString();
  });

  child.on('close', (code) => {
    clearTimeout(timeout);
    if (settled || killed) return;

    try {
      const event = JSON.parse(stdoutBuffer);
      const usage = extractCodexUsage(event, { fallbackModel: effectiveModel });
      if (usage) capturedUsage = usage;
    } catch { /* ignore */ }

    const tailThinking = extractThinkingFromEventLine(stdoutBuffer, seenReasoningTextByItem);
    if (tailThinking && onThinkingChunk) {
      try { onThinkingChunk(tailThinking); } catch { /* ignore callback errors */ }
    }

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
  if (isProvidersStubbed()) {
    const stub = getProviderStub('codex', 'warmUp');
    if (stub) return stub();
    return;
  }
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
  if (isProvidersStubbed()) {
    const stub = getProviderStub('codex', 'parseEscalation');
    if (!stub) throw new MissingProviderStubError('codex', 'parseEscalation');
    return stub(imageBase64OrText, options);
  }
  const input = typeof imageBase64OrText === 'string' ? imageBase64OrText : '';
  const isBase64Image = input.startsWith('data:image') || /^[A-Za-z0-9+/=]{100,}$/.test(input);
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : PARSE_TIMEOUT_MS;
  const effectiveParseModel = options.model || PARSE_MODEL;
  const effectiveParseReasoningEffort = normalizeCodexReasoningEffort(options.reasoningEffort, PARSE_REASONING_EFFORT);

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
    '- do not guess unreadable names, identifiers, numbers, or labels',
    '- if a value is unclear, unreadable, or uncertain, leave it as an empty string',
    '- prefer exact transcription from the source over summarizing',
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
    '-c', `reasoning_effort="${effectiveParseReasoningEffort}"`,
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

/**
 * Fast image transcription — extracts visible text from an image without
 * converting it into structured fields.
 *
 * Accepts a base64 image string (with or without data-URI prefix) or an
 * absolute file path to an image on disk.
 *
 * @param {string} imageBase64OrPath
 * @param {Object} [options]
 * @param {string} [options.model]
 * @param {string} [options.reasoningEffort]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{text: string, usage: Object|null}>}
 */
async function transcribeImage(imageBase64OrPath, options = {}) {
  if (isProvidersStubbed()) {
    const stub = getProviderStub('codex', 'transcribeImage');
    if (!stub) throw new MissingProviderStubError('codex', 'transcribeImage');
    return stub(imageBase64OrPath, options);
  }
  const input = typeof imageBase64OrPath === 'string' ? imageBase64OrPath.trim() : '';
  if (!input) throw new Error('transcribeImage: image input is empty');

  const effectiveModel = options.model || PARSE_MODEL;
  const effectiveReasoningEffort = normalizeCodexReasoningEffort(
    options.reasoningEffort,
    PARSE_REASONING_EFFORT
  );
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : PARSE_TIMEOUT_MS;

  const transcribePrompt = [
    'Transcribe ALL text visible in this image exactly as written.',
    'Preserve line breaks, section labels, spacing, and formatting as closely as possible.',
    'Do not summarize, interpret, or clean up the wording.',
    'Pay special attention to IDs, case numbers, and any numeric strings.',
    'Return only the transcribed text.',
  ].join('\n');

  const isFilePath = !input.startsWith('data:image')
    && !/^[A-Za-z0-9+/=]{100,}$/.test(input)
    && (path.isAbsolute(input) || /^[a-zA-Z]:[/\\]/.test(input));

  let tempFiles = [];
  const imagePaths = [];

  if (isFilePath) {
    if (!fs.existsSync(input)) {
      throw new Error('transcribeImage: file not found: ' + input);
    }
    imagePaths.push(input);
  } else {
    tempFiles = writeImageTempFiles([input]);
    imagePaths.push(...tempFiles);
  }

  const args = [
    'exec',
    '--json',
    '--model', effectiveModel,
    '-c', `reasoning_effort="${effectiveReasoningEffort}"`,
    '--skip-git-repo-check',
  ];
  for (const file of imagePaths) {
    args.push('--image', shellEscapeArg(file));
  }
  args.push('-');

  const captureEnabled = isProviderCallPackageCaptureEnabled();
  const requestStartedAt = new Date().toISOString();
  const captureContext = {
    providerId: 'codex',
    providerResearchId: 'openai-cli',
    providerPathType: 'cli',
    callSite: 'codex:transcribeImage',
    operation: 'image-transcribe',
    modelRequested: effectiveModel,
    reasoningEffort: effectiveReasoningEffort,
    source: {
      file: 'server/src/services/codex.js',
      functionName: 'transcribeImage',
      spawnSite: 'codex.transcribeImage',
    },
  };

  providerHarnessTrace('codex.cli.transcribeImage.enter', {
    providerId: captureContext.providerId,
    providerResearchId: captureContext.providerResearchId,
    providerPathType: captureContext.providerPathType,
    callSite: captureContext.callSite,
    operation: captureContext.operation,
    modelRequested: effectiveModel,
    reasoningEffort: effectiveReasoningEffort,
    timeoutMs,
    captureEnabled,
    imagePathCount: imagePaths.length,
    stdinBytes: Buffer.byteLength(transcribePrompt, 'utf8'),
  });

  return new Promise((resolve, reject) => {
    providerHarnessTrace('codex.cli.transcribeImage.spawn.start', {
      providerId: captureContext.providerId,
      callSite: captureContext.callSite,
      command: 'codex',
      argCount: args.length,
      modelRequested: effectiveModel,
    });
    const child = spawn('codex', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env, CLAUDECODE: undefined },
    });
    providerHarnessTrace('codex.cli.transcribeImage.spawn.done', {
      providerId: captureContext.providerId,
      callSite: captureContext.callSite,
      pid: child.pid || null,
      command: 'codex',
    });

    let settled = false;
    let stdoutBuffer = '';
    let stdoutText = '';
    let stderrOutput = '';
    let firstStdoutAt = null;
    let firstStderrAt = null;
    let stdinWrittenAt = null;
    let stdoutFinalBuffer = '';
    let cliCaptureQueued = false;
    let closeObserved = false;
    let pendingCaptureMeta = null;
    let captureCloseWaitTimer = null;
    let fullResponse = '';
    let capturedUsage = null;
    const stdoutLines = [];
    const stdoutJsonlEvents = [];
    const malformedStdoutLines = [];
    const stdoutChunks = [];
    const stderrChunks = [];
    const seenAgentTextByItem = new Map();

    function queueCliCapture(meta = {}) {
      if (!captureEnabled || cliCaptureQueued) return;
      cliCaptureQueued = true;
      if (captureCloseWaitTimer) {
        clearTimeout(captureCloseWaitTimer);
        captureCloseWaitTimer = null;
      }
      const responseCompletedAt = new Date().toISOString();
      const durationMs = Math.max(new Date(responseCompletedAt).getTime() - new Date(requestStartedAt).getTime(), 0);
      providerHarnessTrace('codex.cli.transcribeImage.package.assembled', {
        providerId: captureContext.providerId,
        callSite: captureContext.callSite,
        outcome: meta.outcome || '',
        exitCode: meta.exitCode,
        signal: meta.signal || '',
        stdoutBytes: Buffer.byteLength(stdoutText, 'utf8'),
        stdoutLineCount: stdoutLines.length,
        jsonlEventCount: stdoutJsonlEvents.length,
        malformedLineCount: malformedStdoutLines.length,
        stderrBytes: Buffer.byteLength(stderrOutput, 'utf8'),
        durationMs,
      });
      recordCliProviderCallPackageInBackground({
        captureContext,
        command: 'codex',
        args,
        spawnOptions: {
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          envOverrides: {
            CLAUDECODE: '[unset]',
          },
        },
        env: {
          capturedKeys: ['CLAUDECODE'],
          notes: ['CLAUDECODE is unset for Codex subprocess isolation'],
        },
        stdinText: transcribePrompt,
        stdoutText,
        stdoutLines,
        stdoutJsonlEvents,
        malformedStdoutLines,
        stdoutFinalBuffer,
        stdoutChunks,
        stderrText: stderrOutput,
        stderrChunks,
        pid: child.pid || null,
        exitCode: Number.isFinite(meta.exitCode) ? meta.exitCode : null,
        signal: meta.signal || null,
        spawned: meta.spawned === false ? false : true,
        closed: Boolean(meta.closed),
        killed: Boolean(meta.killed),
        killSignal: meta.killSignal || null,
        timeout: {
          timeoutMs,
          fired: Boolean(meta.timeoutFired),
        },
        requestStartedAt,
        stdinWrittenAt,
        firstStdoutAt,
        firstStderrAt,
        processClosedAt: meta.processClosedAt || (meta.closed ? responseCompletedAt : null),
        responseCompletedAt,
        durationMs,
        error: meta.error || null,
        outcome: meta.outcome || null,
        modelRequested: effectiveModel,
        reasoningEffort: effectiveReasoningEffort,
        expectsJsonl: true,
      }, { log: true });
      providerHarnessTrace('codex.cli.transcribeImage.recorder.queued', {
        providerId: captureContext.providerId,
        callSite: captureContext.callSite,
        outcome: meta.outcome || '',
      });
    }

    function deferCliCaptureUntilClose(meta = {}) {
      if (!captureEnabled || cliCaptureQueued) return;
      pendingCaptureMeta = {
        ...(pendingCaptureMeta || {}),
        ...meta,
      };
      providerHarnessTrace('codex.cli.transcribeImage.recorder.defer_until_close', {
        providerId: captureContext.providerId,
        callSite: captureContext.callSite,
        outcome: pendingCaptureMeta.outcome || '',
        closeObserved,
      });
      if (closeObserved) {
        queueCliCapture(pendingCaptureMeta);
        pendingCaptureMeta = null;
        return;
      }
      if (!captureCloseWaitTimer) {
        captureCloseWaitTimer = setTimeout(() => {
          if (!pendingCaptureMeta || cliCaptureQueued) return;
          providerHarnessTrace('codex.cli.transcribeImage.recorder.defer_close_timeout', {
            providerId: captureContext.providerId,
            callSite: captureContext.callSite,
            outcome: pendingCaptureMeta.outcome || '',
            waitMs: CLI_CAPTURE_CLOSE_WAIT_MS,
          });
          queueCliCapture(pendingCaptureMeta);
          pendingCaptureMeta = null;
        }, CLI_CAPTURE_CLOSE_WAIT_MS);
        if (typeof captureCloseWaitTimer.unref === 'function') {
          captureCloseWaitTimer.unref();
        }
      }
    }

    function finishOk(text, meta = {}) {
      if (settled) return;
      settled = true;
      cleanupTempFiles(tempFiles);
      const result = { text: String(text || '').trim(), usage: capturedUsage };
      resolve(result);
      providerHarnessTrace('codex.cli.transcribeImage.provider.returned', {
        providerId: captureContext.providerId,
        callSite: captureContext.callSite,
        outcome: 'success',
        textLength: result.text.length,
        hasUsage: Boolean(capturedUsage),
      });
      queueCliCapture({ ...meta, outcome: meta.outcome || 'success' });
    }

    function finishErr(err, meta = {}, options = {}) {
      if (settled) return;
      settled = true;
      cleanupTempFiles(tempFiles);
      const error = err instanceof Error ? err : new Error(String(err));
      error._usage = capturedUsage || null;
      reject(error);
      providerHarnessTrace('codex.cli.transcribeImage.provider.returned', {
        providerId: captureContext.providerId,
        callSite: captureContext.callSite,
        outcome: meta.outcome || '',
        errorName: error.name || 'Error',
        errorCode: error.code || '',
        errorMessage: error.message || '',
        hasUsage: Boolean(capturedUsage),
      });
      const captureMeta = { ...meta, error, outcome: meta.outcome || null };
      if (options.deferCaptureUntilClose) {
        deferCliCaptureUntilClose(captureMeta);
      } else {
        queueCliCapture(captureMeta);
      }
    }

    function handleStdoutLine(line) {
      stdoutLines.push(line);
      let event = null;
      try {
        event = JSON.parse(line);
        stdoutJsonlEvents.push(event);
        providerHarnessTrace('codex.cli.transcribeImage.stdout.jsonl_event', {
          providerId: captureContext.providerId,
          callSite: captureContext.callSite,
          eventType: event?.type || '',
          itemType: event?.item?.type || '',
          jsonlEventCount: stdoutJsonlEvents.length,
        });
        const usage = extractCodexUsage(event, { fallbackModel: effectiveModel });
        if (usage) capturedUsage = usage;
      } catch {
        malformedStdoutLines.push(line);
        providerHarnessTrace('codex.cli.transcribeImage.stdout.malformed_line', {
          providerId: captureContext.providerId,
          callSite: captureContext.callSite,
          malformedLineCount: malformedStdoutLines.length,
          byteLength: Buffer.byteLength(line, 'utf8'),
        });
      }
      const delta = extractDeltaFromEventLine(line, seenAgentTextByItem);
      if (delta) fullResponse += delta;
    }

    try {
      providerHarnessTrace('codex.cli.transcribeImage.stdin.write.start', {
        providerId: captureContext.providerId,
        callSite: captureContext.callSite,
        stdinBytes: Buffer.byteLength(transcribePrompt, 'utf8'),
      });
      child.stdin.write(transcribePrompt);
      child.stdin.end();
      stdinWrittenAt = new Date().toISOString();
      providerHarnessTrace('codex.cli.transcribeImage.stdin.write.done', {
        providerId: captureContext.providerId,
        callSite: captureContext.callSite,
        stdinBytes: Buffer.byteLength(transcribePrompt, 'utf8'),
      });
    } catch (err) {
      finishErr(err, { outcome: 'process_error' });
      return;
    }

    const timeout = setTimeout(() => {
      if (settled) return;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      const timeoutErr = new Error('Codex CLI transcription timed out after ' + timeoutMs + 'ms');
      timeoutErr.code = 'TIMEOUT';
      providerHarnessTrace('codex.cli.transcribeImage.timeout', {
        providerId: captureContext.providerId,
        callSite: captureContext.callSite,
        timeoutMs,
      });
      finishErr(timeoutErr, {
        outcome: 'timeout',
        timeoutFired: true,
        killed: true,
        killSignal: 'SIGTERM',
      }, {
        deferCaptureUntilClose: true,
      });
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      if (cliCaptureQueued) return;
      const chunkText = data.toString();
      const receivedAt = new Date().toISOString();
      if (!firstStdoutAt) firstStdoutAt = receivedAt;
      stdoutChunks.push({ seq: stdoutChunks.length, receivedAt, text: chunkText });
      stdoutText += chunkText;
      providerHarnessTrace('codex.cli.transcribeImage.stdout.data', {
        providerId: captureContext.providerId,
        callSite: captureContext.callSite,
        seq: stdoutChunks.length - 1,
        byteLength: Buffer.byteLength(chunkText, 'utf8'),
      });
      stdoutBuffer += chunkText;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        handleStdoutLine(line);
      }
    });

    child.stderr.on('data', (data) => {
      if (cliCaptureQueued) return;
      const chunkText = data.toString();
      const receivedAt = new Date().toISOString();
      if (!firstStderrAt) firstStderrAt = receivedAt;
      stderrChunks.push({ seq: stderrChunks.length, receivedAt, text: chunkText });
      if (stderrOutput.length < 10240) stderrOutput += chunkText;
      providerHarnessTrace('codex.cli.transcribeImage.stderr.data', {
        providerId: captureContext.providerId,
        callSite: captureContext.callSite,
        seq: stderrChunks.length - 1,
        byteLength: Buffer.byteLength(chunkText, 'utf8'),
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      closeObserved = true;
      const processClosedAt = new Date().toISOString();
      stdoutFinalBuffer = stdoutBuffer;
      providerHarnessTrace('codex.cli.transcribeImage.close', {
        providerId: captureContext.providerId,
        callSite: captureContext.callSite,
        exitCode: code,
        signal: signal || '',
        finalBufferBytes: Buffer.byteLength(stdoutFinalBuffer, 'utf8'),
      });

      if (stdoutFinalBuffer) {
        let event = null;
        try {
          event = JSON.parse(stdoutFinalBuffer);
          stdoutJsonlEvents.push(event);
          const usage = extractCodexUsage(event, { fallbackModel: effectiveModel });
          if (usage) capturedUsage = usage;
          providerHarnessTrace('codex.cli.transcribeImage.stdout.final_jsonl_event', {
            providerId: captureContext.providerId,
            callSite: captureContext.callSite,
            eventType: event?.type || '',
            itemType: event?.item?.type || '',
            jsonlEventCount: stdoutJsonlEvents.length,
          });
        } catch {
          malformedStdoutLines.push(stdoutFinalBuffer);
          providerHarnessTrace('codex.cli.transcribeImage.stdout.final_malformed_line', {
            providerId: captureContext.providerId,
            callSite: captureContext.callSite,
            malformedLineCount: malformedStdoutLines.length,
            byteLength: Buffer.byteLength(stdoutFinalBuffer, 'utf8'),
          });
        }

        const tailDelta = extractDeltaFromEventLine(stdoutFinalBuffer, seenAgentTextByItem);
        if (tailDelta) fullResponse += tailDelta;
      }

      if (pendingCaptureMeta) {
        queueCliCapture({
          ...pendingCaptureMeta,
          exitCode: code,
          signal: signal || null,
          closed: true,
          processClosedAt,
        });
        pendingCaptureMeta = null;
        return;
      }

      if (settled) return;

      if (code !== 0 && !fullResponse.trim()) {
        finishErr(new Error(formatCliFailure(code, stderrOutput)), {
          outcome: 'process_error',
          exitCode: code,
          signal: signal || null,
          closed: true,
          processClosedAt,
        });
        return;
      }

      finishOk(fullResponse, {
        outcome: code === 0 ? 'success' : 'process_error',
        exitCode: code,
        signal: signal || null,
        closed: true,
        processClosedAt,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      providerHarnessTrace('codex.cli.transcribeImage.process.error', {
        providerId: captureContext.providerId,
        callSite: captureContext.callSite,
        errorName: err.name || 'Error',
        errorCode: err.code || '',
        errorMessage: err.message || '',
      });
      const spawnFailure = isCodexSpawnFailure(err);
      finishErr(err, {
        outcome: spawnFailure ? 'spawn_error' : 'process_error',
        spawned: !spawnFailure,
      }, {
        deferCaptureUntilClose: true,
      });
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

function extractThinkingFromEventLine(line, seenReasoningTextByItem) {
  if (!line || !line.trim()) return '';

  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return '';
  }

  const item = event.item && typeof event.item === 'object' ? event.item : null;
  if (item && (item.type === 'reasoning' || item.type === 'agent_reasoning')) {
    const nextText = typeof item.text === 'string'
      ? item.text
      : Array.isArray(item.summary)
        ? item.summary.map((entry) => (
          typeof entry === 'string'
            ? entry
            : typeof entry?.text === 'string'
              ? entry.text
              : ''
        )).filter(Boolean).join('\n')
        : '';
    if (!nextText) return '';

    const id = item.id || '__default__';
    const prevText = seenReasoningTextByItem.get(id) || '';
    seenReasoningTextByItem.set(id, nextText);
    if (nextText.startsWith(prevText)) {
      return nextText.slice(prevText.length);
    }
    return nextText;
  }

  if (typeof event.text === 'string' && event.type && event.type.includes('reasoning')) {
    return event.text;
  }
  if (typeof event.delta === 'string' && event.type && event.type.includes('reasoning')) {
    return event.delta;
  }
  if (event.delta && typeof event.delta.text === 'string' && event.type && event.type.includes('reasoning')) {
    return event.delta.text;
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

module.exports = { chat, parseEscalation, transcribeImage, warmUp };
module.exports._internal = { parsePositiveInt, didCliExitSuccessfully };
