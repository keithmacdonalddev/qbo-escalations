const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  PROVIDER_CATALOG,
  getProviderMeta,
  getProviderTransport,
  getProviderModelId,
  isValidProvider,
} = require('../services/providers/catalog');
const { getProvider } = require('../services/providers/registry');
const { extractClaudeUsage, extractCodexUsage } = require('../lib/usage-extractor');
const { reportServerError } = require('../lib/server-error-pipeline');
const LabResult = require('../models/LabResult');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

const router = express.Router();

const DEFAULT_TASK = 'escalation-template-transcription';
const SUPPORTED_TASKS = new Set([DEFAULT_TASK]);
const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_TIMEOUT_MS = 180_000;
const MAX_TOTAL_TIMEOUT_MS = 20 * 60_000;

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeTask(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return SUPPORTED_TASKS.has(normalized) ? normalized : DEFAULT_TASK;
}

function normalizeRequestedProviderIds(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return PROVIDER_CATALOG.map((entry) => entry.id);
  }

  const normalized = [];
  const seen = new Set();

  for (const raw of input) {
    const providerId = typeof raw === 'string' ? raw.trim() : '';
    if (!providerId || seen.has(providerId)) continue;
    if (!isValidProvider(providerId)) {
      const err = new Error(`Unsupported provider "${providerId}"`);
      err.code = 'INVALID_PROVIDER';
      throw err;
    }
    seen.add(providerId);
    normalized.push(providerId);
  }

  return normalized;
}

function benchmarkModelKey(entry) {
  return String(entry?.model || entry?.id || '');
}

function canonicalEntryScore(entry) {
  let score = 0;
  if (entry?.id && entry?.model && entry.id === entry.model) score += 100;
  if (entry?.selectable !== false) score += 20;
  if (entry?.default) score -= 50;
  if (!/\(default\)/i.test(String(entry?.label || ''))) score += 5;
  return score;
}

function dedupeEntriesByModel(providerIds) {
  const orderedEntries = providerIds
    .map((providerId) => getProviderMeta(providerId))
    .filter(Boolean);
  const grouped = new Map();

  for (const entry of orderedEntries) {
    const key = benchmarkModelKey(entry);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  }

  const deduped = [];
  for (const group of grouped.values()) {
    const canonical = group
      .slice()
      .sort((a, b) => canonicalEntryScore(b) - canonicalEntryScore(a))[0];
    deduped.push({
      ...canonical,
      aliases: group
        .map((entry) => entry.id)
        .filter((providerId) => providerId !== canonical.id),
    });
  }

  return deduped;
}

function normalizeLooseText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeMultilineText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tokenizeWords(value) {
  return normalizeLooseText(value).match(/[a-z0-9]+(?:[._:/-][a-z0-9]+)*/g) || [];
}

function tokenizeNumeric(value) {
  return normalizeLooseText(value).match(/[a-z0-9._:/-]*\d[a-z0-9._:/-]*/g) || [];
}

function nonEmptyLines(value) {
  return normalizeMultilineText(value)
    .split('\n')
    .map((line) => normalizeLooseText(line))
    .filter(Boolean);
}

function countTokens(tokens) {
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return counts;
}

function tokenOverlapCount(expected, actual) {
  const expectedCounts = countTokens(expected);
  const actualCounts = countTokens(actual);
  let overlap = 0;

  for (const [token, expectedCount] of expectedCounts.entries()) {
    overlap += Math.min(expectedCount, actualCounts.get(token) || 0);
  }

  return overlap;
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function f1(precision, recall) {
  if (!Number.isFinite(precision) || !Number.isFinite(recall) || (precision + recall) <= 0) {
    return null;
  }
  return (2 * precision * recall) / (precision + recall);
}

function buildTextMetrics(text, latencyMs, usage) {
  const normalized = normalizeMultilineText(text);
  const wordTokens = tokenizeWords(text);
  const numericTokens = tokenizeNumeric(text);
  const lines = normalized ? normalized.split('\n') : [];
  const totalTokens = (usage?.inputTokens || 0) + (usage?.outputTokens || 0);

  return {
    chars: text.length,
    nonWhitespaceChars: String(text || '').replace(/\s+/g, '').length,
    words: wordTokens.length,
    lines: lines.length,
    nonEmptyLines: lines.filter(Boolean).length,
    numericTokens: numericTokens.length,
    charsPerSecond: latencyMs > 0 ? round(text.length / (latencyMs / 1000), 1) : null,
    totalTokens: totalTokens > 0 ? totalTokens : null,
  };
}

function buildAccuracyMetrics(referenceText, outputText) {
  const reference = String(referenceText || '').trim();
  if (!reference) return null;

  const expectedWords = tokenizeWords(reference);
  const actualWords = tokenizeWords(outputText);
  const expectedNumbers = tokenizeNumeric(reference);
  const actualNumbers = tokenizeNumeric(outputText);
  const expectedLines = nonEmptyLines(reference);
  const outputNormalized = normalizeLooseText(outputText);

  const wordOverlap = tokenOverlapCount(expectedWords, actualWords);
  const numberOverlap = tokenOverlapCount(expectedNumbers, actualNumbers);
  const matchedLines = expectedLines.filter((line) => outputNormalized.includes(line)).length;

  const wordRecall = ratio(wordOverlap, expectedWords.length);
  const wordPrecision = ratio(wordOverlap, actualWords.length);
  const wordF1 = f1(wordPrecision, wordRecall);
  const numericRecall = ratio(numberOverlap, expectedNumbers.length);
  const numericPrecision = ratio(numberOverlap, actualNumbers.length);
  const numericF1 = f1(numericPrecision, numericRecall);
  const lineRecall = ratio(matchedLines, expectedLines.length);
  const exactNormalized = normalizeLooseText(reference) === outputNormalized;

  const coverageScore = Number.isFinite(numericF1)
    ? (0.55 * (wordF1 || 0)) + (0.25 * (numericF1 || 0)) + (0.20 * (lineRecall || 0))
    : (0.75 * (wordF1 || 0)) + (0.25 * (lineRecall || 0));

  return {
    exactNormalized,
    wordRecall: round(wordRecall),
    wordPrecision: round(wordPrecision),
    wordF1: round(wordF1),
    numericRecall: round(numericRecall),
    numericPrecision: round(numericPrecision),
    numericF1: round(numericF1),
    lineRecall: round(lineRecall),
    coverageScore: round(coverageScore),
    referenceWords: expectedWords.length,
    referenceNumericTokens: expectedNumbers.length,
    referenceLines: expectedLines.length,
  };
}

function buildSkippedResult(entry, reason, attempted = false) {
  return {
    provider: entry.id,
    label: entry.label,
    shortLabel: entry.shortLabel || entry.label,
    family: entry.family,
    model: entry.model || entry.id,
    selectable: entry.selectable !== false,
    aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
    status: 'skipped',
    attempted,
    reason: reason || 'Skipped',
    latencyMs: 0,
    outputText: '',
    usage: null,
    textMetrics: buildTextMetrics('', 0, null),
    accuracy: null,
  };
}

function buildSummary(results, startedAt, completedAt) {
  const okResults = results.filter((result) => result.status === 'ok');
  const errorCount = results.filter((result) => result.status === 'error').length;
  const skippedCount = results.filter((result) => result.status === 'skipped').length;
  const fastest = okResults
    .slice()
    .sort((a, b) => a.latencyMs - b.latencyMs)[0] || null;
  const bestAccuracy = okResults
    .filter((result) => Number.isFinite(result?.accuracy?.coverageScore))
    .slice()
    .sort((a, b) => (b.accuracy.coverageScore - a.accuracy.coverageScore) || (a.latencyMs - b.latencyMs))[0] || null;

  return {
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    elapsedMs: completedAt.getTime() - startedAt.getTime(),
    total: results.length,
    ok: okResults.length,
    errors: errorCount,
    skipped: skippedCount,
    fastestProvider: fastest ? fastest.provider : null,
    bestAccuracyProvider: bestAccuracy ? bestAccuracy.provider : null,
  };
}

router.post('/image-benchmark', async (req, res) => {
  const task = normalizeTask(req.body?.task);
  const image = typeof req.body?.image === 'string' ? req.body.image.trim() : '';
  const referenceText = typeof req.body?.referenceText === 'string' ? req.body.referenceText : '';
  const reasoningEffort = typeof req.body?.reasoningEffort === 'string' ? req.body.reasoningEffort : 'high';
  const forceCatalogBlocked = req.body?.forceCatalogBlocked === true;
  const perModelTimeoutMs = Math.min(
    MAX_TIMEOUT_MS,
    toPositiveInt(req.body?.timeoutMs, DEFAULT_TIMEOUT_MS)
  );

  if (!SUPPORTED_TASKS.has(task)) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_TASK',
      error: 'Unsupported benchmark task',
    });
  }

  if (!image) {
    return res.status(400).json({
      ok: false,
      code: 'MISSING_IMAGE',
      error: 'An image is required to run the benchmark',
    });
  }

  let requestedProviderIds;
  try {
    requestedProviderIds = normalizeRequestedProviderIds(req.body?.providers);
  } catch (err) {
    return res.status(400).json({
      ok: false,
      code: err.code || 'INVALID_PROVIDER',
      error: err.message || 'Invalid provider selection',
    });
  }

  const entries = dedupeEntriesByModel(requestedProviderIds);
  const responseTimeoutMs = Math.min(
    MAX_TOTAL_TIMEOUT_MS,
    Math.max(120_000, (entries.length * perModelTimeoutMs) + 60_000)
  );
  if (typeof req.setResponseTimeout === 'function') {
    req.setResponseTimeout(responseTimeoutMs);
  }

  const startedAt = new Date();
  const results = [];

  for (const entry of entries) {
    if (entry.selectable === false && !forceCatalogBlocked) {
      results.push(
        buildSkippedResult(
          entry,
          entry.availabilityNote || 'Catalog marks this model as unavailable in the current environment.'
        )
      );
      continue;
    }

    const provider = getProvider(entry.id);
    if (typeof provider.transcribeImage !== 'function') {
      results.push(buildSkippedResult(entry, `${entry.id} does not support image transcription.`, true));
      continue;
    }

    const attemptStartedAt = Date.now();
    try {
      const result = await provider.transcribeImage(image, {
        timeoutMs: perModelTimeoutMs,
        reasoningEffort,
      });
      const outputText = typeof result?.text === 'string' ? result.text : '';
      const usage = result?.usage || null;
      const latencyMs = Date.now() - attemptStartedAt;

      results.push({
        provider: entry.id,
        label: entry.label,
        shortLabel: entry.shortLabel || entry.label,
        family: entry.family,
        model: entry.model || entry.id,
        selectable: entry.selectable !== false,
        aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
        status: 'ok',
        attempted: true,
        reason: '',
        latencyMs,
        outputText,
        usage,
        textMetrics: buildTextMetrics(outputText, latencyMs, usage),
        accuracy: buildAccuracyMetrics(referenceText, outputText),
      });
    } catch (err) {
      const latencyMs = Date.now() - attemptStartedAt;
      const usage = err?._usage || null;
      results.push({
        provider: entry.id,
        label: entry.label,
        shortLabel: entry.shortLabel || entry.label,
        family: entry.family,
        model: entry.model || entry.id,
        selectable: entry.selectable !== false,
        aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
        status: 'error',
        attempted: true,
        reason: err?.message || `${entry.id} failed`,
        errorCode: err?.code || 'BENCHMARK_FAILED',
        latencyMs,
        outputText: '',
        usage,
        textMetrics: buildTextMetrics('', latencyMs, usage),
        accuracy: null,
      });
    }
  }

  const completedAt = new Date();

  return res.json({
    ok: true,
    benchmark: {
      task,
      perModelTimeoutMs,
      reasoningEffort,
      forceCatalogBlocked,
      referenceProvided: Boolean(referenceText.trim()),
      results,
      summary: buildSummary(results, startedAt, completedAt),
    },
  });
});

// ---------------------------------------------------------------------------
// Escalation template extraction prompt — shared by streaming endpoint
// ---------------------------------------------------------------------------
const TEMPLATE_EXTRACT_PROMPT = [
  'Extract the escalation template fields from this image.',
  'Return ONLY the filled template in this exact format:',
  '',
  'COID/MID:',
  'CASE:',
  'CLIENT/CONTACT:',
  'CX IS ATTEMPTING TO:',
  'EXPECTED OUTCOME:',
  'ACTUAL OUTCOME:',
  'KB/TOOLS USED:',
  'TRIED TEST ACCOUNT:',
  'TS STEPS:',
  '',
  'Fill each field with the corresponding value visible in the image.',
  'If a field is not visible or not applicable, leave it blank after the colon.',
  'Do not add any other text, explanation, or commentary.',
].join('\n');

// ---------------------------------------------------------------------------
// Image decode / temp file helpers (mirrored from service layer for SSE route)
// ---------------------------------------------------------------------------
function decodeImagePayload(imageInput) {
  const input = typeof imageInput === 'string' ? imageInput.trim() : '';
  if (!input) throw new Error('Image payload is empty');

  const dataUrlMatch = input.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,([\s\S]+)$/);
  const subtype = dataUrlMatch ? dataUrlMatch[1] : '';
  const base64Payload = (dataUrlMatch ? dataUrlMatch[2] : input).replace(/\s+/g, '');

  if (!base64Payload || !/^[A-Za-z0-9+/=]+$/.test(base64Payload)) {
    throw new Error('Image payload is not valid base64 data');
  }

  const buffer = Buffer.from(base64Payload, 'base64');
  if (!buffer || buffer.length === 0) throw new Error('Image payload decoded to empty');

  const normalized = String(subtype || '').toLowerCase();
  let ext = 'png';
  if (normalized === 'jpeg' || normalized === 'pjpeg') ext = 'jpg';
  else if (normalized === 'webp' || normalized === 'avif') ext = normalized;
  else if (normalized) ext = normalized.replace(/[^a-z0-9]/g, '') || 'png';

  return { buffer, extension: ext };
}

async function writeTempImage(imageInput, prefix) {
  const decoded = decodeImagePayload(imageInput);
  const fileName = `${prefix}-${Date.now()}-${process.pid}-0.${decoded.extension}`;
  const tmpPath = path.join(os.tmpdir(), fileName);
  await fs.promises.writeFile(tmpPath, decoded.buffer);
  return tmpPath;
}

function cleanupTemp(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
}

// Normalize reasoning effort per transport
const CLAUDE_ALLOWED_EFFORTS = new Set(['low', 'medium', 'high']);
const CODEX_ALLOWED_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);

function normalizeEffortForTransport(transport, value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (transport === 'codex') {
    return CODEX_ALLOWED_EFFORTS.has(normalized) ? normalized : 'high';
  }
  // Claude: xhigh maps to high
  if (normalized === 'xhigh') return 'high';
  return CLAUDE_ALLOWED_EFFORTS.has(normalized) ? normalized : 'high';
}

function shellEscapeArg(value) {
  if (!value || typeof value !== 'string') return value;
  if (!/[\s"]/.test(value)) return value;
  if (process.platform === 'win32') {
    return '"' + value.replace(/"/g, '\\"') + '"';
  }
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

// ---------------------------------------------------------------------------
// Claude stream-json parsing helpers
// ---------------------------------------------------------------------------
function extractStreamThinking(msg) {
  const inner = (msg.type === 'stream_event' && msg.event) ? msg.event : msg;
  if (inner.type === 'content_block_delta'
      && inner.delta
      && inner.delta.type === 'thinking_delta'
      && typeof inner.delta.thinking === 'string') {
    return inner.delta.thinking;
  }
  return null;
}

function extractStreamText(msg) {
  const inner = (msg.type === 'stream_event' && msg.event) ? msg.event : msg;
  if (inner.type === 'content_block_delta' && inner.delta && inner.delta.text) {
    return inner.delta.text;
  }
  return '';
}

function extractStreamFinalText(msg) {
  if (msg.type === 'assistant' && msg.message && msg.message.content) {
    return msg.message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }
  if (msg.type === 'result' && typeof msg.result === 'string') return msg.result;
  return '';
}

// Codex JSONL delta extraction
function extractCodexDelta(line, seenAgentText) {
  if (!line || !line.trim()) return '';
  let event;
  try { event = JSON.parse(line); } catch { return ''; }

  if (event.item && event.item.type === 'agent_message' && typeof event.item.text === 'string') {
    const id = event.item.id || '__default__';
    const prev = seenAgentText.get(id) || '';
    const next = event.item.text;
    seenAgentText.set(id, next);
    return next.startsWith(prev) ? next.slice(prev.length) : next;
  }
  if (typeof event.delta === 'string') return event.delta;
  if (event.delta && typeof event.delta.text === 'string') return event.delta.text;
  if (typeof event.text === 'string' && event.type && event.type.includes('delta')) return event.text;
  return '';
}

// ---------------------------------------------------------------------------
// POST /stream-transcribe — SSE streaming single-model transcription
// ---------------------------------------------------------------------------
router.post('/stream-transcribe', async (req, res) => {
  const providerId = typeof req.body?.provider === 'string' ? req.body.provider.trim() : '';
  const image = typeof req.body?.image === 'string' ? req.body.image.trim() : '';
  const rawEffort = typeof req.body?.reasoningEffort === 'string' ? req.body.reasoningEffort : 'high';
  const timeoutMs = Math.min(MAX_TIMEOUT_MS, toPositiveInt(req.body?.timeoutMs, DEFAULT_TIMEOUT_MS));

  // Validation
  if (!image) {
    return res.status(400).json({ ok: false, code: 'MISSING_IMAGE', error: 'Image is required.' });
  }
  if (!providerId || !isValidProvider(providerId)) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: `Invalid provider: "${providerId}"` });
  }

  const meta = getProviderMeta(providerId);
  if (!meta) {
    return res.status(400).json({ ok: false, code: 'INVALID_PROVIDER', error: `Provider not found: "${providerId}"` });
  }

  const transport = getProviderTransport(providerId);
  const modelId = getProviderModelId(providerId) || providerId;
  const effort = normalizeEffortForTransport(transport, rawEffort);

  // Set extended response timeout
  if (typeof req.setResponseTimeout === 'function') {
    req.setResponseTimeout(timeoutMs + 30_000);
  }

  // Write temp image file
  let tempPath = null;
  try {
    tempPath = await writeTempImage(image, 'qbo-lab-stream');
  } catch (err) {
    return res.status(400).json({ ok: false, code: 'IMAGE_DECODE_FAILED', error: err.message });
  }

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  function sseEvent(eventType, data) {
    try {
      res.write('event: ' + eventType + '\ndata: ' + JSON.stringify(data) + '\n\n');
    } catch { /* client disconnected */ }
  }

  const startedAt = Date.now();
  sseEvent('start', {
    provider: providerId,
    label: meta.label,
    shortLabel: meta.shortLabel || meta.label,
    family: meta.family,
    model: modelId,
    transport,
    reasoningEffort: effort,
  });

  let fullText = '';
  let fullThinking = '';
  let capturedUsage = null;
  let settled = false;
  let child = null;

  // Heartbeat
  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* ignore */ }
  }, 15_000);

  function finish(status, errorMsg) {
    if (settled) return;
    settled = true;
    clearInterval(heartbeat);
    clearTimeout(killTimeout);
    cleanupTemp(tempPath);

    const latencyMs = Date.now() - startedAt;

    if (status === 'ok') {
      sseEvent('done', {
        status: 'ok',
        outputText: fullText,
        thinkingText: fullThinking,
        latencyMs,
        usage: capturedUsage,
        textMetrics: buildTextMetrics(fullText, latencyMs, capturedUsage),
      });
    } else {
      sseEvent('error', {
        status: 'error',
        error: errorMsg || 'Unknown error',
        outputText: fullText,
        thinkingText: fullThinking,
        latencyMs,
        usage: capturedUsage,
      });
    }

    try { res.end(); } catch { /* ignore */ }
  }

  // Timeout
  const killTimeout = setTimeout(() => {
    if (settled) return;
    try { if (child) child.kill('SIGTERM'); } catch { /* ignore */ }
    finish('error', `Timed out after ${timeoutMs}ms`);
  }, timeoutMs);

  // Handle client disconnect
  req.on('close', () => {
    if (settled) return;
    settled = true;
    clearInterval(heartbeat);
    clearTimeout(killTimeout);
    cleanupTemp(tempPath);
    try { if (child) child.kill('SIGTERM'); } catch { /* ignore */ }
  });

  // ---- Spawn CLI based on transport ----
  if (transport === 'codex') {
    // Codex CLI: codex exec --json --model X -c reasoning_effort="Y" --image FILE -
    const args = [
      'exec', '--json',
      '--model', modelId,
      '-c', `reasoning_effort="${effort}"`,
      '--skip-git-repo-check',
      '--image', shellEscapeArg(tempPath),
      '-',
    ];

    try {
      child = spawn('codex', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        env: { ...process.env, CLAUDECODE: undefined },
      });
    } catch (err) {
      finish('error', 'Failed to spawn Codex CLI: ' + err.message);
      return;
    }

    try { child.stdin.write(TEMPLATE_EXTRACT_PROMPT); child.stdin.end(); } catch { /* ignore */ }

    let stdoutBuf = '';
    let stderrBuf = '';
    const seenAgentText = new Map();

    child.stdout.on('data', (data) => {
      if (settled) return;
      stdoutBuf += data.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() || '';

      for (const line of lines) {
        // Try to capture usage
        try {
          const evt = JSON.parse(line);
          const usage = extractCodexUsage(evt, { fallbackModel: modelId });
          if (usage) capturedUsage = usage;
        } catch { /* non-JSON */ }

        const delta = extractCodexDelta(line, seenAgentText);
        if (delta) {
          fullText += delta;
          sseEvent('text', { text: delta });
        }
      }
    });

    child.stderr.on('data', (data) => {
      if (settled) return;
      if (stderrBuf.length < 10240) stderrBuf += data.toString();
    });

    child.on('close', (code) => {
      if (settled) return;
      // Process remaining buffer
      if (stdoutBuf.trim()) {
        try {
          const evt = JSON.parse(stdoutBuf);
          const usage = extractCodexUsage(evt, { fallbackModel: modelId });
          if (usage) capturedUsage = usage;
        } catch { /* ignore */ }
        const delta = extractCodexDelta(stdoutBuf, seenAgentText);
        if (delta) {
          fullText += delta;
          sseEvent('text', { text: delta });
        }
      }

      if (code !== 0 && !fullText.trim()) {
        finish('error', 'Codex CLI exited with code ' + code + ': ' + (stderrBuf || '').slice(0, 500));
      } else {
        finish('ok');
      }
    });

    child.on('error', (err) => {
      finish('error', 'Codex CLI process error: ' + err.message);
    });

  } else {
    // Claude CLI: claude -p --output-format stream-json --max-turns 1
    // Images passed via prompt text + --add-dir (--image flag no longer exists)
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--max-turns', '1'];
    args.push('--model', modelId);
    if (effort) args.push('--effort', effort);
    // Grant read access to the temp image directory
    args.push('--permission-mode', 'bypassPermissions');
    const tempDir = require('path').dirname(tempPath);
    if (tempDir) args.push('--add-dir', tempDir);

    try {
      child = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          CLAUDECODE: undefined,
          CLAUDE_CODE_SIMPLE: '1',
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        },
      });
    } catch (err) {
      finish('error', 'Failed to spawn Claude CLI: ' + err.message);
      return;
    }

    // Append image path to prompt so Claude can read the file
    const imagePrompt = TEMPLATE_EXTRACT_PROMPT +
      '\n\nImage attachment is available at this local file path:\n1. ' + tempPath +
      '\nAnalyze this image as part of your response.';
    try { child.stdin.end(imagePrompt); } catch { /* ignore */ }

    let stdoutBuf = '';
    let stderrBuf = '';
    let receivedDeltaText = false;

    child.stdout.on('data', (data) => {
      if (settled) return;
      stdoutBuf += data.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }

        // Extract usage from result messages
        const usage = extractClaudeUsage(msg, { fallbackModel: modelId });
        if (usage) capturedUsage = usage;

        // Thinking deltas
        const thinking = extractStreamThinking(msg);
        if (thinking) {
          fullThinking += thinking;
          sseEvent('thinking', { thinking });
        }

        // Text deltas
        const text = extractStreamText(msg);
        if (text) {
          receivedDeltaText = true;
          fullText += text;
          sseEvent('text', { text });
        }

        // Final text fallback (only if we got no deltas)
        if (!receivedDeltaText) {
          const finalText = extractStreamFinalText(msg);
          if (finalText && !fullText) {
            fullText = finalText;
            sseEvent('text', { text: finalText });
            receivedDeltaText = true;
          }
        }
      }
    });

    child.stderr.on('data', (data) => {
      if (settled) return;
      if (stderrBuf.length < 10240) stderrBuf += data.toString();
    });

    child.on('close', (code) => {
      if (settled) return;
      // Process trailing buffer
      if (stdoutBuf.trim()) {
        try {
          const msg = JSON.parse(stdoutBuf);
          const usage = extractClaudeUsage(msg, { fallbackModel: modelId });
          if (usage) capturedUsage = usage;

          if (!receivedDeltaText) {
            const finalText = extractStreamFinalText(msg);
            if (finalText && !fullText) {
              fullText = finalText;
              sseEvent('text', { text: finalText });
            }
          }
        } catch { /* ignore */ }
      }

      if (code !== 0 && !fullText.trim()) {
        finish('error', 'Claude CLI exited with code ' + code + ': ' + (stderrBuf || '').slice(0, 500));
      } else {
        finish('ok');
      }
    });

    child.on('error', (err) => {
      finish('error', 'Claude CLI process error: ' + err.message);
    });
  }
});

// ---------------------------------------------------------------------------
// POST /save-result — Persist a completed lab extraction result
// ---------------------------------------------------------------------------
router.post('/save-result', async (req, res) => {
  const body = req.body || {};

  if (!body.provider || !body.status) {
    return res.status(400).json({
      ok: false,
      code: 'MISSING_FIELDS',
      error: 'provider and status are required',
    });
  }

  const doc = await LabResult.create({
    provider:        body.provider,
    label:           body.label || '',
    family:          body.family || '',
    model:           body.model || '',
    reasoningEffort: body.reasoningEffort || 'high',
    status:          body.status,
    outputText:      body.outputText || '',
    thinkingText:    body.thinkingText || '',
    error:           body.error || '',
    latencyMs:       Number(body.latencyMs) || 0,
    usage:           body.usage || {},
    textMetrics:     body.textMetrics || {},
    imageSource:     body.imageSource || '',
    imageName:       body.imageName || '',
    createdAt:       body.createdAt || new Date(),
  });

  return res.json({ ok: true, result: doc });
});

// ---------------------------------------------------------------------------
// GET /history — Paginated history of lab results
// ---------------------------------------------------------------------------
router.get('/history', async (req, res) => {
  const limit  = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);

  const filter = {};
  if (req.query.provider) filter.provider = req.query.provider;
  if (req.query.status)   filter.status   = req.query.status;

  const [results, total] = await Promise.all([
    LabResult.find(filter)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean(),
    LabResult.countDocuments(filter),
  ]);

  return res.json({ ok: true, results, total });
});

// ---------------------------------------------------------------------------
// DELETE /history/:id — Delete a single lab result
// ---------------------------------------------------------------------------
router.delete('/history/:id', async (req, res) => {
  const { id } = req.params;
  const deleted = await LabResult.findByIdAndDelete(id);
  if (!deleted) {
    return res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Result not found' });
  }
  return res.json({ ok: true });
});

router.use((err, req, res, next) => {
  reportServerError({
    route: '/api/model-lab',
    message: err?.message || 'Model benchmark route failed',
    code: err?.code || 'MODEL_BENCHMARK_FAILED',
    detail: err?.stack || '',
    severity: 'error',
  });
  next(err);
});

module.exports = router;
