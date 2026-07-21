const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const mongoose = require('mongoose');
const { extractCodexUsage } = require('../lib/usage-extractor');
const {
  isStubbed: isProvidersStubbed,
  getProviderStub,
  MissingProviderStubError,
} = require('../lib/harness-provider-gate');
const {
  isProviderCallPackageCaptureEnabled,
  recordCliProviderCallPackageInBackground,
} = require('./provider-call-package-recorder');
const {
  observeProviderPackageCapture,
  setPackageCapturePromise,
} = require('./providers/provider-handoff');

const DEFAULT_MODEL = process.env.CODEX_CHAT_MODEL || 'gpt-5.6-sol';
const DEFAULT_REASONING_EFFORT = process.env.CODEX_REASONING_EFFORT || 'high';
const CODEX_ALLOWED_EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
const DEFAULT_SERVICE_TIER = process.env.CODEX_SERVICE_TIER || 'fast';
const CODEX_ALLOWED_SERVICE_TIERS = new Set(['fast', 'priority', 'flex']);
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

// Last-line OS command-injection guard. Codex is spawned with shell:true, so the
// model string is re-parsed by the OS shell and must never contain shell
// metacharacters. Lazily require the shared validator to avoid a load-time
// circular dependency (codex.js <- providers/registry <- chat-orchestrator).
function assertSafeModel(model, label = 'model') {
  if (model === undefined || model === null || model === '') return;
  // eslint-disable-next-line global-require
  const { assertModelAllowed } = require('./chat-orchestrator');
  assertModelAllowed(model, label);
}

function normalizeCodexServiceTier(value, fallback = 'fast') {
  const normalized = String(value || '').trim().toLowerCase();
  return CODEX_ALLOWED_SERVICE_TIERS.has(normalized) ? normalized : fallback;
}

function codexConfigArgs({ reasoningEffort, serviceTier = DEFAULT_SERVICE_TIER }) {
  return [
    // NOTE: the codex CLI config key is `model_reasoning_effort` — the bare
    // `reasoning_effort` key is silently ignored (verified via --strict-config,
    // which we deliberately do NOT pass at runtime because it would also
    // strict-validate the user's global ~/.codex/config.toml).
    '-c', `model_reasoning_effort="${reasoningEffort}"`,
    // Always request detailed reasoning summaries so reasoning items reliably
    // land in the captured stdout JSONL for the reasoning viewer.
    '-c', 'model_reasoning_summary="detailed"',
    '-c', `service_tier="${normalizeCodexServiceTier(serviceTier)}"`,
  ];
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

function nowIso() {
  return new Date().toISOString();
}

function buildCodexCliCaptureContext(overrides = {}) {
  return {
    providerId: 'codex',
    providerResearchId: 'openai-cli',
    providerPathType: 'cli',
    ...overrides,
    source: {
      file: 'server/src/services/codex.js',
      ...(overrides.source || {}),
    },
  };
}

function createCodexCliCapture({
  captureContext = {},
  command = 'codex',
  args,
  child,
  stdinText,
  timeoutMs,
  requestStartedAt = nowIso(),
  modelRequested,
  reasoningEffort,
  expectsJsonl = true,
  captureEnabled,
  onProviderEvent,
}) {
  const effectiveCaptureEnabled = captureEnabled ?? (
    captureContext.forceCapture === true || isProviderCallPackageCaptureEnabled()
  );
  const packageId = effectiveCaptureEnabled ? new mongoose.Types.ObjectId() : null;
  let stdoutBuffer = '';
  let stdoutText = '';
  let stderrText = '';
  let firstStdoutAt = null;
  let firstStderrAt = null;
  let stdinWrittenAt = null;
  let stdoutFinalBuffer = '';
  let cliCaptureQueued = false;
  let packageCaptureQueued = false;
  let closeObserved = false;
  let pendingCaptureMeta = null;
  let captureCloseWaitTimer = null;
  const stdoutLines = [];
  const stdoutJsonlEvents = [];
  const malformedStdoutLines = [];
  const stdoutChunks = [];
  const stderrChunks = [];

  function writeStdin() {
    child.stdin.write(stdinText);
    child.stdin.end();
    stdinWrittenAt = nowIso();
  }

  function handleStdoutData(data, onLine) {
    if (cliCaptureQueued) return;
    const chunkText = data.toString();
    const receivedAt = nowIso();
    if (!firstStdoutAt) firstStdoutAt = receivedAt;
    stdoutChunks.push({ seq: stdoutChunks.length, receivedAt, text: chunkText });
    stdoutText += chunkText;
    stdoutBuffer += chunkText;
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      const parsed = captureStdoutLine(line);
      if (typeof onLine === 'function') {
        onLine(line, parsed.event);
      }
    }
  }

  function handleStderrData(data) {
    if (cliCaptureQueued) return;
    const chunkText = data.toString();
    const receivedAt = nowIso();
    if (!firstStderrAt) firstStderrAt = receivedAt;
    stderrChunks.push({ seq: stderrChunks.length, receivedAt, text: chunkText });
    if (stderrText.length < 10240) stderrText += chunkText;
  }

  function captureStdoutLine(line) {
    stdoutLines.push(line);
    try {
      const event = JSON.parse(line);
      stdoutJsonlEvents.push(event);
      return { event, malformed: false };
    } catch {
      malformedStdoutLines.push(line);
      return { event: null, malformed: true };
    }
  }

  function finalizeStdoutBufferForClose() {
    stdoutFinalBuffer = stdoutBuffer;
    if (!stdoutFinalBuffer) return { line: '', event: null };
    const parsed = captureStdoutLine(stdoutFinalBuffer);
    return { line: stdoutFinalBuffer, event: parsed.event };
  }

  function getProviderTrace(meta = {}) {
    return {
      providerId: captureContext.providerId || 'codex',
      providerResearchId: captureContext.providerResearchId || 'openai-cli',
      providerPathType: captureContext.providerPathType || 'cli',
      providerHarness: 'openai-cli',
      operation: captureContext.operation || '',
      callSite: captureContext.callSite || '',
      modelRequested: modelRequested || captureContext.modelRequested || '',
      model: modelRequested || captureContext.modelRequested || '',
      reasoningEffort: reasoningEffort || captureContext.reasoningEffort || '',
      requestStartedAt,
      providerPackageId: packageId ? String(packageId) : null,
      captureEnabled: Boolean(effectiveCaptureEnabled),
      packageCaptureQueued: Boolean(packageCaptureQueued),
      outcome: meta.outcome || null,
      exitCode: Number.isFinite(meta.exitCode) ? meta.exitCode : null,
      signal: meta.signal || null,
      processClosedAt: meta.processClosedAt || null,
    };
  }

  function queueCliCapture(meta = {}) {
    if (!effectiveCaptureEnabled || cliCaptureQueued) {
      return {
        queued: false,
        packageId: packageId ? String(packageId) : null,
        providerTrace: getProviderTrace(meta),
      };
    }
    cliCaptureQueued = true;
    if (captureCloseWaitTimer) {
      clearTimeout(captureCloseWaitTimer);
      captureCloseWaitTimer = null;
    }
    const responseCompletedAt = nowIso();
    const durationMs = Math.max(new Date(responseCompletedAt).getTime() - new Date(requestStartedAt).getTime(), 0);
    const queued = recordCliProviderCallPackageInBackground({
      captureContext,
      command,
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
      stdinText,
      stdoutText,
      stdoutLines,
      stdoutJsonlEvents,
      malformedStdoutLines,
      stdoutFinalBuffer,
      stdoutChunks,
      stderrText,
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
      modelRequested,
      reasoningEffort,
      expectsJsonl,
    }, {
      log: true,
      packageId,
      force: captureContext.forceCapture === true,
    });
    packageCaptureQueued = Boolean(queued && queued.queued);
    const providerTrace = getProviderTrace(meta);
    if (queued?.promise) {
      setPackageCapturePromise(providerTrace, queued.promise);
    }
    observeProviderPackageCapture({
      providerTrace,
      capture: {
        queued: packageCaptureQueued,
        promise: queued?.promise || null,
      },
      onProviderEvent,
      providerId: providerTrace.providerId || captureContext.providerId || 'codex',
      providerHarness: providerTrace.providerHarness || 'openai-cli',
    });
    return {
      queued: packageCaptureQueued,
      packageId: packageId ? String(packageId) : null,
      promise: queued && queued.promise ? queued.promise : null,
      providerTrace,
    };
  }

  function deferCliCaptureUntilClose(meta = {}) {
    if (!effectiveCaptureEnabled || cliCaptureQueued) return;
    pendingCaptureMeta = {
      ...(pendingCaptureMeta || {}),
      ...meta,
    };
    if (closeObserved) {
      queueCliCapture(pendingCaptureMeta);
      pendingCaptureMeta = null;
      return;
    }
    if (!captureCloseWaitTimer) {
      captureCloseWaitTimer = setTimeout(() => {
        if (!pendingCaptureMeta || cliCaptureQueued) return;
        queueCliCapture(pendingCaptureMeta);
        pendingCaptureMeta = null;
      }, CLI_CAPTURE_CLOSE_WAIT_MS);
      if (typeof captureCloseWaitTimer.unref === 'function') {
        captureCloseWaitTimer.unref();
      }
    }
  }

  function markClosed() {
    closeObserved = true;
  }

  function takePendingCaptureMeta() {
    const meta = pendingCaptureMeta;
    pendingCaptureMeta = null;
    return meta;
  }

  function getStderrText() {
    return stderrText;
  }

  return {
    writeStdin,
    handleStdoutData,
    handleStderrData,
    finalizeStdoutBufferForClose,
    queueCliCapture,
    deferCliCaptureUntilClose,
    markClosed,
    takePendingCaptureMeta,
    getStderrText,
    getProviderTrace,
    requestStartedAt,
  };
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
function chat({
  messages,
  systemPrompt,
  images,
  model,
  reasoningEffort,
  serviceTier,
  timeoutMs,
  captureContext,
  onProviderEvent,
  onChunk,
  onThinkingChunk,
  onDone,
  onError,
}) {
  require('./ai-management').assertProviderModelAllowed('codex', model || '');
  if (isProvidersStubbed()) {
    const stub = getProviderStub('codex', 'chat');
    if (!stub) throw new MissingProviderStubError('codex', 'chat');
    return stub({ messages, systemPrompt, images, model, reasoningEffort, serviceTier, timeoutMs, captureContext, onProviderEvent, onChunk, onThinkingChunk, onDone, onError });
  }
  assertSafeModel(model);
  const prompt = buildPrompt(messages, systemPrompt);
  const tempFiles = writeImageTempFiles(images);
  const effectiveModel = model || DEFAULT_MODEL;
  const effectiveReasoningEffort = normalizeCodexReasoningEffort(reasoningEffort);
  const effectiveServiceTier = normalizeCodexServiceTier(serviceTier);
  const effectiveTimeoutMs = parsePositiveInt(timeoutMs, CHAT_TIMEOUT_MS);

  const args = [
    'exec',
    '--json',
    '--model', effectiveModel,
    ...codexConfigArgs({ reasoningEffort: effectiveReasoningEffort, serviceTier: effectiveServiceTier }),
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
  const cliCapture = createCodexCliCapture({
    captureContext: buildCodexCliCaptureContext({
      callSite: 'codex:chat',
      operation: 'chat',
      modelRequested: effectiveModel,
      reasoningEffort: effectiveReasoningEffort,
      ...(captureContext || {}),
      source: {
        functionName: 'chat',
        spawnSite: 'codex.chat',
        ...(captureContext?.source || {}),
      },
    }),
    args,
    child,
    stdinText: prompt,
    timeoutMs: effectiveTimeoutMs,
    modelRequested: effectiveModel,
    reasoningEffort: effectiveReasoningEffort,
    onProviderEvent,
  });
  try {
    cliCapture.writeStdin();
  } catch (err) {
    finishWithError(err, { outcome: 'process_error' });
    return function cleanupAfterStdinFailure() {
      return {
        usage: capturedUsage || null,
        partialResponse: fullResponse,
        providerTrace: cliCapture.getProviderTrace({ outcome: 'process_error' }),
      };
    };
  }

  function finishWithError(err, meta = {}, options = {}) {
    if (settled || killed) return;
    settled = true;
    cleanupTempFiles(tempFiles);
    const error = err instanceof Error ? err : new Error(String(err));
    error._usage = capturedUsage || null;
    const captureMeta = { ...meta, error, outcome: meta.outcome || null };
    if (options.deferCaptureUntilClose) {
      cliCapture.deferCliCaptureUntilClose(captureMeta);
      error.providerTrace = cliCapture.getProviderTrace(captureMeta);
    } else {
      const capture = cliCapture.queueCliCapture(captureMeta);
      error.providerTrace = capture.providerTrace;
    }
    onError(error);
  }

  function finishWithSuccess(text, meta = {}) {
    if (settled || killed) return;
    settled = true;
    cleanupTempFiles(tempFiles);
    const capture = cliCapture.queueCliCapture({ ...meta, outcome: meta.outcome || 'success' });
    onDone(text, capturedUsage || null, capture.providerTrace);
  }

  function processStdoutLine(line, event) {
    if (settled || killed) return;
    if (event) {
      const usage = extractCodexUsage(event, { fallbackModel: effectiveModel });
      if (usage) capturedUsage = usage;
    }
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

  const timeout = setTimeout(() => {
    if (killed || settled) return;
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    const timeoutErr = new Error('Codex CLI timed out after ' + effectiveTimeoutMs + 'ms');
    timeoutErr.code = 'TIMEOUT';
    finishWithError(timeoutErr, {
      outcome: 'timeout',
      timeoutFired: true,
      killed: true,
      killSignal: 'SIGTERM',
    }, {
      deferCaptureUntilClose: true,
    });
  }, effectiveTimeoutMs);

  child.stdout.on('data', (data) => {
    cliCapture.handleStdoutData(data, processStdoutLine);
  });

  child.stderr.on('data', (data) => {
    cliCapture.handleStderrData(data);
  });

  child.on('close', (code, signal) => {
    clearTimeout(timeout);
    cliCapture.markClosed();
    const processClosedAt = new Date().toISOString();
    const tail = cliCapture.finalizeStdoutBufferForClose();
    if (tail.line) processStdoutLine(tail.line, tail.event);

    const pendingCaptureMeta = cliCapture.takePendingCaptureMeta();
    if (pendingCaptureMeta) {
      cliCapture.queueCliCapture({
        ...pendingCaptureMeta,
        exitCode: code,
        signal: signal || null,
        closed: true,
        processClosedAt,
      });
      return;
    }

    if (settled || killed) return;

    if (!didCliExitSuccessfully(code)) {
      finishWithError(new Error(formatCliFailure(code, cliCapture.getStderrText())), {
        outcome: 'process_error',
        exitCode: code,
        signal: signal || null,
        closed: true,
        processClosedAt,
      });
    } else {
      finishWithSuccess(fullResponse, {
        outcome: 'success',
        exitCode: code,
        signal: signal || null,
        closed: true,
        processClosedAt,
      });
    }
  });

  child.on('error', (err) => {
    clearTimeout(timeout);
    const spawnFailure = isCodexSpawnFailure(err);
    if (!killed) {
      finishWithError(err, {
        outcome: spawnFailure ? 'spawn_error' : 'process_error',
        spawned: !spawnFailure,
      }, {
        deferCaptureUntilClose: true,
      });
    }
  });

  return function cleanup() {
    killed = true;
    clearTimeout(timeout);
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    cliCapture.deferCliCaptureUntilClose({
      outcome: 'aborted',
      aborted: true,
      killed: true,
      killSignal: 'SIGTERM',
      error: Object.assign(new Error('Codex CLI chat aborted'), { code: 'ABORT_ERR' }),
    });
    cleanupTempFiles(tempFiles);
    return {
      usage: capturedUsage || null,
      partialResponse: fullResponse,
      providerTrace: cliCapture.getProviderTrace({ outcome: 'aborted' }),
    };
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
      ...codexConfigArgs({ reasoningEffort: DEFAULT_REASONING_EFFORT }),
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
  require('./ai-management').assertProviderModelAllowed('codex', options.model || '');
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
  assertSafeModel(options.model);
  const effectiveParseModel = options.model || PARSE_MODEL;
  const effectiveParseReasoningEffort = normalizeCodexReasoningEffort(options.reasoningEffort, PARSE_REASONING_EFFORT);
  const effectiveParseServiceTier = normalizeCodexServiceTier(options.serviceTier);

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
    ...codexConfigArgs({ reasoningEffort: effectiveParseReasoningEffort, serviceTier: effectiveParseServiceTier }),
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
    const cliCapture = createCodexCliCapture({
      captureContext: buildCodexCliCaptureContext({
        callSite: 'codex:parseEscalation',
        operation: 'parse-escalation',
        modelRequested: effectiveParseModel,
        reasoningEffort: effectiveParseReasoningEffort,
        ...(options.captureContext || {}),
        source: {
          functionName: 'parseEscalation',
          spawnSite: 'codex.parseEscalation',
          ...(options.captureContext?.source || {}),
        },
      }),
      args,
      child,
      stdinText: prompt,
      timeoutMs,
      modelRequested: effectiveParseModel,
      reasoningEffort: effectiveParseReasoningEffort,
    });

    let settled = false;
    let fullResponse = '';
    let capturedUsage = null;
    const seenAgentTextByItem = new Map();

    function finishOk(result, meta = {}) {
      if (settled) return;
      settled = true;
      cleanupTempFiles(tempFiles);
      const capture = cliCapture.queueCliCapture({ ...meta, outcome: meta.outcome || 'success' });
      resolve({ fields: result, usage: capturedUsage, providerTrace: capture.providerTrace });
    }

    function finishErr(err, meta = {}, options = {}) {
      if (settled) return;
      settled = true;
      cleanupTempFiles(tempFiles);
      const error = err instanceof Error ? err : new Error(String(err));
      error._usage = capturedUsage || null;
      const captureMeta = { ...meta, error, outcome: meta.outcome || null };
      if (options.deferCaptureUntilClose) {
        cliCapture.deferCliCaptureUntilClose(captureMeta);
        error.providerTrace = cliCapture.getProviderTrace(captureMeta);
      } else {
        const capture = cliCapture.queueCliCapture(captureMeta);
        error.providerTrace = capture.providerTrace;
      }
      reject(error);
    }

    function processStdoutLine(line, event) {
      if (settled) return;
      if (event) {
        const usage = extractCodexUsage(event, { fallbackModel: effectiveParseModel });
        if (usage) capturedUsage = usage;
      }
      const delta = extractDeltaFromEventLine(line, seenAgentTextByItem);
      if (delta) fullResponse += delta;
    }

    try {
      cliCapture.writeStdin();
    } catch (err) {
      finishErr(err, { outcome: 'process_error' });
      return;
    }

    const timeout = setTimeout(() => {
      if (settled) return;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      const timeoutErr = new Error('Codex CLI parse timed out after ' + timeoutMs + 'ms');
      timeoutErr.code = 'TIMEOUT';
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
      cliCapture.handleStdoutData(data, processStdoutLine);
    });

    child.stderr.on('data', (data) => {
      cliCapture.handleStderrData(data);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      cliCapture.markClosed();
      const processClosedAt = nowIso();
      const tail = cliCapture.finalizeStdoutBufferForClose();
      if (tail.line) processStdoutLine(tail.line, tail.event);

      const pendingCaptureMeta = cliCapture.takePendingCaptureMeta();
      if (pendingCaptureMeta) {
        cliCapture.queueCliCapture({
          ...pendingCaptureMeta,
          exitCode: code,
          signal: signal || null,
          closed: true,
          processClosedAt,
        });
        return;
      }

      if (settled) return;

      if (code !== 0 && !fullResponse) {
        finishErr(new Error(formatCliFailure(code, cliCapture.getStderrText())), {
          outcome: 'process_error',
          exitCode: code,
          signal: signal || null,
          closed: true,
          processClosedAt,
        });
        return;
      }

      const finishMeta = {
        outcome: code === 0 ? 'success' : 'process_error',
        exitCode: code,
        signal: signal || null,
        closed: true,
        processClosedAt,
      };
      const parsed = extractJSONObject(fullResponse);
      if (parsed) {
        finishOk(parsed, finishMeta);
        return;
      }

      finishOk({
        category: 'unknown',
        attemptingTo: fullResponse.slice(0, 800),
      }, finishMeta);
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
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
  require('./ai-management').assertProviderModelAllowed('codex', options.model || '');
  if (isProvidersStubbed()) {
    const stub = getProviderStub('codex', 'transcribeImage');
    if (!stub) throw new MissingProviderStubError('codex', 'transcribeImage');
    return stub(imageBase64OrPath, options);
  }
  const input = typeof imageBase64OrPath === 'string' ? imageBase64OrPath.trim() : '';
  if (!input) throw new Error('transcribeImage: image input is empty');

  assertSafeModel(options.model);
  const effectiveModel = options.model || PARSE_MODEL;
  const effectiveReasoningEffort = normalizeCodexReasoningEffort(
    options.reasoningEffort,
    PARSE_REASONING_EFFORT
  );
  const effectiveServiceTier = normalizeCodexServiceTier(options.serviceTier);
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
    ...codexConfigArgs({ reasoningEffort: effectiveReasoningEffort, serviceTier: effectiveServiceTier }),
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


  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env, CLAUDECODE: undefined },
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
    }

    function deferCliCaptureUntilClose(meta = {}) {
      if (!captureEnabled || cliCaptureQueued) return;
      pendingCaptureMeta = {
        ...(pendingCaptureMeta || {}),
        ...meta,
      };
      if (closeObserved) {
        queueCliCapture(pendingCaptureMeta);
        pendingCaptureMeta = null;
        return;
      }
      if (!captureCloseWaitTimer) {
        captureCloseWaitTimer = setTimeout(() => {
          if (!pendingCaptureMeta || cliCaptureQueued) return;
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
      queueCliCapture({ ...meta, outcome: meta.outcome || 'success' });
    }

    function finishErr(err, meta = {}, options = {}) {
      if (settled) return;
      settled = true;
      cleanupTempFiles(tempFiles);
      const error = err instanceof Error ? err : new Error(String(err));
      error._usage = capturedUsage || null;
      reject(error);
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
        const usage = extractCodexUsage(event, { fallbackModel: effectiveModel });
        if (usage) capturedUsage = usage;
      } catch {
        malformedStdoutLines.push(line);
      }
      const delta = extractDeltaFromEventLine(line, seenAgentTextByItem);
      if (delta) fullResponse += delta;
    }

    try {
      child.stdin.write(transcribePrompt);
      child.stdin.end();
      stdinWrittenAt = new Date().toISOString();
    } catch (err) {
      finishErr(err, { outcome: 'process_error' });
      return;
    }

    const timeout = setTimeout(() => {
      if (settled) return;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      const timeoutErr = new Error('Codex CLI transcription timed out after ' + timeoutMs + 'ms');
      timeoutErr.code = 'TIMEOUT';
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
    });

    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      closeObserved = true;
      const processClosedAt = new Date().toISOString();
      stdoutFinalBuffer = stdoutBuffer;

      if (stdoutFinalBuffer) {
        let event = null;
        try {
          event = JSON.parse(stdoutFinalBuffer);
          stdoutJsonlEvents.push(event);
          const usage = extractCodexUsage(event, { fallbackModel: effectiveModel });
          if (usage) capturedUsage = usage;
        } catch {
          malformedStdoutLines.push(stdoutFinalBuffer);
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
