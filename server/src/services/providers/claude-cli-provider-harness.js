'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');

const { extractClaudeUsage } = require('../../lib/usage-extractor');
const {
  isProviderCallPackageCaptureEnabled,
  recordCliProviderCallPackageInBackground,
} = require('../provider-call-package-recorder');
const {
  attachProviderTraceToError,
  observeProviderPackageCapture,
  requireProviderPackageCapture,
  setPackageCapturePromise,
  withProviderTraceUpdates,
} = require('./provider-handoff');

const CLAUDE_CLI_CALL_SITE = 'claude-cli-provider-harness:sendPrompt';
const CLAUDE_SOURCE_FILE = 'server/src/services/providers/claude-cli-provider-harness.js';
const CLAUDE_ISOLATED_ROOT = path.join(os.tmpdir(), 'qbo-escalations-claude-isolated');
const DEFAULT_TIMEOUT_MS = 120_000;
const CLAUDE_ALLOWED_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value || '').digest('hex');
}

function byteLength(value) {
  return Buffer.byteLength(value || '', 'utf8');
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeClaudeEffort(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return CLAUDE_ALLOWED_EFFORTS.has(normalized) ? normalized : '';
}

function ensureIsolatedClaudeRoot() {
  fs.mkdirSync(CLAUDE_ISOLATED_ROOT, { recursive: true });
  return CLAUDE_ISOLATED_ROOT;
}

function buildClaudeSpawnOptions() {
  return {
    cwd: ensureIsolatedClaudeRoot(),
    env: {
      ...process.env,
      CLAUDECODE: undefined,
      CLAUDE_PROJECT_DIR: '',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    },
  };
}

function emitProviderEvent(onProviderEvent, type, data = {}) {
  if (typeof onProviderEvent !== 'function') return;
  try {
    onProviderEvent(type, {
      providerId: data.providerId || 'claude',
      providerHarness: 'claude-cli',
      timestamp: nowIso(),
      ...data,
    });
  } catch (err) {
    console.warn('[claude-cli-provider-harness] provider event listener failed:', err.message);
  }
}

function emitUserVisibleProviderStatus(onProviderEvent, type, message, status, data = {}) {
  emitProviderEvent(onProviderEvent, type, {
    ...data,
    status,
    displayMessage: `${message} - ${status}`,
    surfaceToUser: true,
  });
}

function formatCliFailure(code, stderr, stdout) {
  const stderrPreview = String(stderr || '').trim().slice(0, 500);
  const stdoutPreview = String(stdout || '').trim().slice(0, 500);
  const preview = stderrPreview || stdoutPreview;
  const lower = preview.toLowerCase();
  const missingBinary = lower.includes('not recognized as an internal or external command')
    || lower.includes('command not found')
    || lower.includes('enoent');

  if (missingBinary) {
    return 'Claude CLI command not found. Ensure `claude` is installed and available on PATH.';
  }
  return preview ? `Claude CLI exited with code ${code}: ${preview}` : `Claude CLI exited with code ${code}`;
}

function buildMessagesPrompt(messages = [], userPrompt = '') {
  if (userPrompt && typeof userPrompt === 'string') return userPrompt;
  if (!Array.isArray(messages) || messages.length === 0) return '';
  if (messages.length === 1) return String(messages[0]?.content || '');
  const lines = [];
  for (const message of messages) {
    const role = message?.role === 'assistant' ? 'Assistant' : message?.role === 'system' ? 'System' : 'User';
    lines.push(`${role}: ${message?.content || ''}`);
  }
  lines.push('Assistant:');
  return lines.join('\n\n');
}

function buildStdinPrompt({ systemPrompt = '', userPrompt = '', messages = [] } = {}) {
  const prompt = buildMessagesPrompt(messages, userPrompt);
  return systemPrompt
    ? `System instructions:\n${systemPrompt}\n\n${prompt}`
    : prompt;
}

function mimeSubtypeToExtension(subtype) {
  const normalized = String(subtype || '').toLowerCase();
  if (!normalized) return 'png';
  if (normalized === 'jpeg' || normalized === 'pjpeg') return 'jpg';
  if (normalized === 'svg+xml') return 'svg';
  if (normalized === 'x-icon' || normalized === 'vnd.microsoft.icon') return 'ico';
  const clean = normalized.replace(/[^a-z0-9]/g, '');
  return clean || 'png';
}

function decodeImageInput(imageInput) {
  const input = typeof imageInput === 'string' ? imageInput.trim() : '';
  const dataUrlMatch = input.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,([\s\S]+)$/);
  const subtype = dataUrlMatch ? dataUrlMatch[1] : '';
  const base64Payload = (dataUrlMatch ? dataUrlMatch[2] : input).replace(/\s+/g, '');
  if (!base64Payload || !/^[A-Za-z0-9+/=]+$/.test(base64Payload)) {
    const err = new Error('Image payload is not valid base64 data');
    err.code = 'INVALID_IMAGE_PAYLOAD';
    throw err;
  }
  const buffer = Buffer.from(base64Payload, 'base64');
  if (!buffer.length) {
    const err = new Error('Image payload decoded to an empty file');
    err.code = 'INVALID_IMAGE_PAYLOAD';
    throw err;
  }
  return { buffer, extension: mimeSubtypeToExtension(subtype) };
}

async function writeTempImageFile(imageInput, index) {
  const decoded = decodeImageInput(imageInput);
  const fileName = `qbo-claude-cli-img-${Date.now()}-${process.pid}-${index}.${decoded.extension}`;
  const tmpPath = path.join(os.tmpdir(), fileName);
  await fs.promises.writeFile(tmpPath, decoded.buffer);
  return tmpPath;
}

function cleanupTempFiles(files) {
  for (const file of files || []) {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  }
}

function appendImagePathsToPrompt(prompt, imagePaths) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) return prompt;
  const lines = [
    'Image attachments are available at these local file paths:',
    ...imagePaths.map((filePath, index) => `${index + 1}. ${filePath}`),
    'Analyze these images as part of your response.',
  ];
  return `${prompt}\n\n${lines.join('\n')}`;
}

function addImageAccessArgs(args, imagePaths) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) return;
  args.push('--permission-mode', 'bypassPermissions');
  const dirs = new Set(imagePaths.map((filePath) => path.dirname(filePath)).filter(Boolean));
  for (const dir of dirs) args.push('--add-dir', dir);
}

function buildClaudeCliCaptureContext(overrides = {}) {
  return {
    providerId: 'claude',
    providerResearchId: 'anthropic-cli',
    providerPathType: 'cli',
    callSite: CLAUDE_CLI_CALL_SITE,
    operation: 'chat',
    functionName: 'sendClaudeCliPrompt',
    ...overrides,
    source: {
      file: CLAUDE_SOURCE_FILE,
      functionName: 'sendClaudeCliPrompt',
      spawnSite: 'claude-cli-provider-harness.sendClaudeCliPrompt',
      ...(overrides.source || {}),
    },
  };
}

function unwrapClaudeEvent(event) {
  return event && event.type === 'stream_event' && event.event ? event.event : event;
}

function extractClaudeTextDelta(event) {
  const inner = unwrapClaudeEvent(event);
  if (inner?.type === 'content_block_delta' && typeof inner?.delta?.text === 'string') {
    return inner.delta.text;
  }
  return '';
}

function extractClaudeFinalText(event) {
  if (event?.type === 'assistant' && Array.isArray(event?.message?.content)) {
    return event.message.content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
  }
  if (event?.type === 'result' && typeof event.result === 'string') {
    return event.result;
  }
  return '';
}

function buildClaudePayloadFromEvents(events, modelFallback = '') {
  let text = '';
  let finalText = '';
  let usage = null;

  for (const event of events || []) {
    const nextUsage = extractClaudeUsage(event, { fallbackModel: modelFallback });
    if (nextUsage) usage = nextUsage;
    const delta = extractClaudeTextDelta(event);
    if (delta) text += delta;
    if (!text) {
      const nextFinalText = extractClaudeFinalText(event);
      if (nextFinalText) finalText = nextFinalText;
    }
  }

  return {
    text: (text || finalText || '').trim(),
    usage,
  };
}

function isSpawnFailure(err) {
  const code = String(err?.code || '').toUpperCase();
  return code === 'ENOENT' || code === 'EACCES' || code === 'SPAWN_ERROR';
}

function createTraceBase({
  captureContext,
  model,
  reasoningEffort,
  captureEnabled,
  packageId,
  requestStartedAt,
  stdinText,
}) {
  return {
    providerId: captureContext.providerId || 'claude',
    providerResearchId: captureContext.providerResearchId || 'anthropic-cli',
    providerPathType: captureContext.providerPathType || 'cli',
    providerHarness: 'claude-cli',
    operation: captureContext.operation || 'chat',
    callSite: captureContext.callSite || CLAUDE_CLI_CALL_SITE,
    modelRequested: model || captureContext.modelRequested || '',
    model: model || captureContext.modelRequested || '',
    reasoningEffort: reasoningEffort || captureContext.reasoningEffort || '',
    requestStartedAt,
    providerPackageId: packageId ? String(packageId) : null,
    captureEnabled: Boolean(captureEnabled),
    packageCaptureQueued: false,
    packageCaptureStatus: captureEnabled ? 'reserved' : 'disabled',
    requestBodySha256: sha256(stdinText),
    requestBodyBytes: byteLength(stdinText),
    outcome: 'started',
  };
}

async function sendClaudeCliPrompt({
  messages,
  systemPrompt,
  userPrompt,
  images,
  model,
  reasoningEffort,
  timeoutMs,
  captureContext = {},
  onProviderEvent,
  signal,
} = {}) {
  const effectiveModel = model || captureContext.modelRequested || process.env.CLAUDE_CHAT_MODEL || 'claude-opus-4-8';
  const effectiveReasoningEffort = normalizeClaudeEffort(reasoningEffort || captureContext.reasoningEffort);
  const effectiveTimeoutMs = parsePositiveInt(timeoutMs, DEFAULT_TIMEOUT_MS);
  const effectiveCaptureContext = buildClaudeCliCaptureContext({
    modelRequested: effectiveModel,
    reasoningEffort: effectiveReasoningEffort,
    ...captureContext,
    metadata: {
      ...(captureContext.metadata || {}),
    },
  });
  const captureEnabled = effectiveCaptureContext.forceCapture === true || isProviderCallPackageCaptureEnabled();
  const packageId = captureEnabled ? new mongoose.Types.ObjectId() : null;
  const requestStartedAt = nowIso();
  const tempFiles = [];
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
  if (effectiveModel) args.push('--model', effectiveModel);
  if (effectiveReasoningEffort) args.push('--effort', effectiveReasoningEffort);

  let stdinText = buildStdinPrompt({ systemPrompt, userPrompt, messages });

  if (Array.isArray(images) && images.length > 0) {
    const imagePaths = await Promise.all(images.map((image, index) => writeTempImageFile(image, index)));
    tempFiles.push(...imagePaths);
    stdinText = appendImagePathsToPrompt(stdinText, imagePaths);
    addImageAccessArgs(args, imagePaths);
  }

  const providerTraceBase = createTraceBase({
    captureContext: effectiveCaptureContext,
    model: effectiveModel,
    reasoningEffort: effectiveReasoningEffort,
    captureEnabled,
    packageId,
    requestStartedAt,
    stdinText,
  });

  emitProviderEvent(onProviderEvent, 'provider.harness_request_started', {
    providerId: providerTraceBase.providerId,
    callSite: providerTraceBase.callSite,
    operation: providerTraceBase.operation,
    model: effectiveModel,
    captureEnabled,
    providerPackageId: providerTraceBase.providerPackageId,
    packageCaptureStatus: providerTraceBase.packageCaptureStatus,
  });
  emitUserVisibleProviderStatus(
    onProviderEvent,
    'provider.agent_payload_sent_to_provider',
    'claude agent sent payload to claude cli',
    'sent',
    {
      providerId: providerTraceBase.providerId,
      callSite: providerTraceBase.callSite,
      operation: providerTraceBase.operation,
      model: effectiveModel,
      providerPackageId: providerTraceBase.providerPackageId,
    }
  );

  return new Promise((resolve, reject) => {
    let child = null;
    let settled = false;
    let timeoutFired = false;
    let timeoutHandle = null;
    let removeAbortListener = null;
    let stdinWrittenAt = null;
    let firstStdoutAt = null;
    let firstStderrAt = null;
    let stdoutText = '';
    let stderrText = '';
    let stdoutBuffer = '';
    let stdoutFinalBuffer = '';
    let capturedUsage = null;
    const stdoutLines = [];
    const stdoutJsonlEvents = [];
    const malformedStdoutLines = [];
    const stdoutChunks = [];
    const stderrChunks = [];

    function cleanupAbortListener() {
      removeAbortListener?.();
      removeAbortListener = null;
    }

    function captureStdoutLine(line) {
      stdoutLines.push(line);
      try {
        const event = JSON.parse(line);
        stdoutJsonlEvents.push(event);
        const usage = extractClaudeUsage(event, { fallbackModel: effectiveModel });
        if (usage) capturedUsage = usage;
      } catch {
        malformedStdoutLines.push(line);
      }
    }

    function queueCapture(meta = {}) {
      const responseCompletedAt = nowIso();
      const processClosedAt = meta.processClosedAt || (meta.closed ? responseCompletedAt : null);
      const durationMs = Math.max(new Date(responseCompletedAt).getTime() - new Date(requestStartedAt).getTime(), 0);
      let providerTrace = withProviderTraceUpdates(providerTraceBase, {
        responseFinishedAt: responseCompletedAt,
        responseCompletedAt,
        processClosedAt,
        durationMs,
        responseBodySha256: sha256(stdoutText),
        responseBodyBytes: byteLength(stdoutText),
        exitCode: Number.isFinite(meta.exitCode) ? meta.exitCode : null,
        signal: meta.signal || null,
        outcome: meta.outcome || 'success',
        model: capturedUsage?.model || effectiveModel,
        usage: capturedUsage || null,
      });

      if (!captureEnabled || !packageId) return { queued: false, providerTrace, promise: null };

      const queued = recordCliProviderCallPackageInBackground({
        captureContext: effectiveCaptureContext,
        command: 'claude',
        args,
        spawnOptions: {
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          envOverrides: {
            CLAUDECODE: '[unset]',
            CLAUDE_PROJECT_DIR: '',
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
          },
        },
        env: {
          capturedKeys: ['CLAUDECODE', 'CLAUDE_PROJECT_DIR', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY'],
          notes: ['Claude CLI is spawned in an isolated temp root and app memory is disabled.'],
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
        pid: child?.pid || null,
        exitCode: Number.isFinite(meta.exitCode) ? meta.exitCode : null,
        signal: meta.signal || null,
        spawned: meta.spawned === false ? false : true,
        closed: Boolean(meta.closed),
        killed: Boolean(meta.killed),
        killSignal: meta.killSignal || null,
        timeout: {
          timeoutMs: effectiveTimeoutMs,
          fired: Boolean(meta.timeoutFired),
        },
        requestStartedAt,
        stdinWrittenAt,
        firstStdoutAt,
        firstStderrAt,
        processClosedAt,
        responseCompletedAt,
        durationMs,
        error: meta.error || null,
        outcome: meta.outcome || null,
        modelRequested: effectiveModel,
        reasoningEffort: effectiveReasoningEffort,
        expectsJsonl: true,
      }, {
        packageId,
        force: effectiveCaptureContext.forceCapture === true,
      });

      providerTrace = withProviderTraceUpdates(providerTrace, {
        packageCaptureQueued: Boolean(queued?.queued),
        packageCaptureStatus: queued?.queued ? 'queued' : providerTrace.packageCaptureStatus,
      });
      if (queued?.promise) setPackageCapturePromise(providerTrace, queued.promise);
      observeProviderPackageCapture({
        providerTrace,
        capture: {
          queued: Boolean(queued?.queued),
          promise: queued?.promise || null,
        },
        onProviderEvent,
        providerId: providerTrace.providerId,
        providerHarness: 'claude-cli',
      });
      return {
        queued: Boolean(queued?.queued),
        providerTrace,
        promise: queued?.promise || null,
      };
    }

    async function finishSuccess(meta = {}) {
      if (settled) return;
      settled = true;
      cleanupAbortListener();
      if (timeoutHandle) clearTimeout(timeoutHandle);
      cleanupTempFiles(tempFiles);
      let providerTrace = queueCapture({ ...meta, outcome: meta.outcome || 'success' }).providerTrace;
      providerTrace = await requireProviderPackageCapture({
        providerTrace,
        onProviderEvent,
        providerId: providerTrace.providerId,
        providerHarness: 'claude-cli',
      });
      emitProviderEvent(onProviderEvent, 'provider.package_ready_for_agent', {
        providerId: providerTrace.providerId,
        outcome: 'success',
        model: providerTrace.model,
        providerPackageId: providerTrace.providerPackageId,
        packageCaptureStatus: providerTrace.packageCaptureStatus,
      });
      resolve({ providerTrace });
    }

    async function finishError(err, meta = {}) {
      if (settled) return;
      settled = true;
      cleanupAbortListener();
      if (timeoutHandle) clearTimeout(timeoutHandle);
      cleanupTempFiles(tempFiles);
      const error = err instanceof Error ? err : new Error(String(err));
      const capture = queueCapture({
        ...meta,
        error,
        outcome: meta.outcome || 'process_error',
      });
      let providerTrace = capture.providerTrace;
      try {
        providerTrace = await requireProviderPackageCapture({
          providerTrace,
          onProviderEvent,
          providerId: providerTrace.providerId,
          providerHarness: 'claude-cli',
        });
      } catch (captureErr) {
        reject(captureErr);
        return;
      }
      emitProviderEvent(onProviderEvent, 'provider.harness_error', {
        providerId: providerTrace.providerId,
        outcome: providerTrace.outcome,
        errorCode: error.code,
        errorMessage: error.message,
        providerPackageId: providerTrace.providerPackageId,
        packageCaptureStatus: providerTrace.packageCaptureStatus,
      });
      reject(attachProviderTraceToError(error, providerTrace));
    }

    try {
      child = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        ...buildClaudeSpawnOptions(),
      });
    } catch (err) {
      finishError(err, {
        outcome: 'spawn_error',
        spawned: false,
      });
      return;
    }

    if (signal?.aborted) {
      const err = new Error('Claude CLI request aborted');
      err.name = 'AbortError';
      err.code = 'ABORT_ERR';
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      finishError(err, {
        outcome: 'aborted',
        killed: true,
        killSignal: 'SIGTERM',
      });
      return;
    }

    if (signal) {
      const onAbort = () => {
        const err = new Error('Claude CLI request aborted');
        err.name = 'AbortError';
        err.code = 'ABORT_ERR';
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        finishError(err, {
          outcome: 'aborted',
          killed: true,
          killSignal: 'SIGTERM',
        });
      };
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    }

    try {
      child.stdin.write(stdinText);
      child.stdin.end();
      stdinWrittenAt = nowIso();
    } catch (err) {
      finishError(err, { outcome: 'process_error' });
      return;
    }

    timeoutHandle = setTimeout(() => {
      if (settled) return;
      timeoutFired = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      const err = new Error(`Claude CLI request timed out after ${effectiveTimeoutMs}ms`);
      err.code = 'PROVIDER_TIMEOUT';
      finishError(err, {
        outcome: 'timeout',
        timeoutFired: true,
        killed: true,
        killSignal: 'SIGTERM',
      });
    }, effectiveTimeoutMs);

    child.stdout.on('data', (data) => {
      if (settled) return;
      const text = data.toString();
      const receivedAt = nowIso();
      if (!firstStdoutAt) firstStdoutAt = receivedAt;
      stdoutChunks.push({ seq: stdoutChunks.length, receivedAt, text });
      stdoutText += text;
      stdoutBuffer += text;
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) captureStdoutLine(line);
      }
    });

    child.stderr.on('data', (data) => {
      if (settled) return;
      const text = data.toString();
      const receivedAt = nowIso();
      if (!firstStderrAt) firstStderrAt = receivedAt;
      stderrChunks.push({ seq: stderrChunks.length, receivedAt, text });
      if (stderrText.length < 10240) stderrText += text;
    });

    child.on('close', (code, signalValue) => {
      const processClosedAt = nowIso();
      stdoutFinalBuffer = stdoutBuffer;
      if (stdoutFinalBuffer.trim()) captureStdoutLine(stdoutFinalBuffer);
      if (settled) return;
      if (code !== 0) {
        const err = new Error(formatCliFailure(code, stderrText, stdoutText));
        err.code = timeoutFired ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR';
        finishError(err, {
          outcome: timeoutFired ? 'timeout' : 'process_error',
          exitCode: code,
          signal: signalValue || null,
          closed: true,
          processClosedAt,
          timeoutFired,
        });
        return;
      }
      finishSuccess({
        exitCode: code,
        signal: signalValue || null,
        closed: true,
        processClosedAt,
      });
    });

    child.on('error', (err) => {
      finishError(err, {
        outcome: isSpawnFailure(err) ? 'spawn_error' : 'process_error',
        spawned: !isSpawnFailure(err),
      });
    });
  });
}

function checkClaudeCliAvailability(model = '') {
  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    let errorOutput = '';

    function finish(payload) {
      if (settled) return;
      settled = true;
      resolve(payload);
    }

    let child;
    try {
      child = spawn('claude', ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        ...buildClaudeSpawnOptions(),
      });
    } catch (err) {
      finish({
        available: false,
        code: 'CLI_UNAVAILABLE',
        reason: err.message || 'Claude CLI unavailable',
        model,
      });
      return;
    }

    const timeout = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      finish({
        available: false,
        code: 'TIMEOUT',
        reason: 'Claude CLI availability check timed out',
        model,
      });
    }, 3000);

    child.stdout.on('data', (chunk) => {
      if (output.length < 1000) output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      if (errorOutput.length < 1000) errorOutput += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      finish({
        available: false,
        code: 'CLI_UNAVAILABLE',
        reason: err.message || 'Claude CLI unavailable',
        model,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        finish({
          available: true,
          code: 'OK',
          reason: output.trim().split(/\r?\n/)[0] || 'Claude CLI ready',
          model,
        });
        return;
      }
      finish({
        available: false,
        code: 'CLI_UNAVAILABLE',
        reason: (errorOutput || output || `Claude CLI exited with code ${code}`).trim().slice(0, 240),
        model,
      });
    });
  });
}

module.exports = {
  CLAUDE_CLI_CALL_SITE,
  buildClaudePayloadFromEvents,
  checkClaudeCliAvailability,
  sendClaudeCliPrompt,
};
