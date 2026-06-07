'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const ProviderCallPackage = require('../models/ProviderCallPackage');
const TriageResult = require('../models/TriageResult');
const { getRenderedAgentPrompt } = require('../lib/agent-prompt-store');
const { parseEscalationText } = require('../lib/escalation-parser');
const {
  buildFallbackTriageCard,
  buildServerTriageCard,
  buildSoftValidatedTriageCardFromOutput,
  buildTriageAgentPromptInput,
} = require('../lib/chat-triage');
const { getProviderModelId } = require('./providers/catalog');
const codex = require('./codex');
const { resolveApiKey, validateRemoteProvider } = require('./image-parser');
const {
  buildClaudePayloadFromEvents,
  checkClaudeCliAvailability,
  sendClaudeCliPrompt,
} = require('./providers/claude-cli-provider-harness');
const { sendLlmGatewayChatCompletion } = require('./providers/llm-gateway-provider-harness');
const { sendLmStudioChatCompletion } = require('./providers/lm-studio-provider-harness');
const { sendAnthropicMessages } = require('./providers/anthropic-provider-harness');
const { sendOpenAiChatCompletion } = require('./providers/openai-api-provider-harness');
const { sendGeminiGenerateContent } = require('./providers/gemini-api-provider-harness');
const { sendKimiChatCompletion } = require('./providers/kimi-api-provider-harness');
const {
  requireProviderPackageCapture,
  TRIAGE_PROVIDER_CALL_SITE,
  TRIAGE_PROVIDER_OPERATION,
} = require('./providers/provider-handoff');
const { buildOperationalIntelligenceContext } = require('./operational-intelligence-service');

const TRIAGE_AGENT_ID = 'triage-agent';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_READBACK_WAIT_MS = 30_000;
const DEFAULT_PREFLIGHT_TIMEOUT_MS = 2_000;
const DIRECT_TRIAGE_PROVIDERS = Object.freeze([
  'claude',
  'llm-gateway',
  'codex',
  'lm-studio',
  'anthropic',
  'openai',
  'kimi',
  'gemini',
]);
const REMOTE_KEYED_PROVIDERS = new Set(['anthropic', 'openai', 'kimi', 'gemini']);
const CLI_TRIAGE_PROVIDERS = new Set(['claude', 'codex']);

function safeString(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function normalizeElapsedMs(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkCodexCliAvailability(model = '') {
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
      child = spawn('codex', ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        env: { ...process.env, CLAUDECODE: undefined },
      });
    } catch (err) {
      finish({
        ok: false,
        available: false,
        code: 'CLI_UNAVAILABLE',
        reason: err.message || 'Codex CLI unavailable',
        model,
      });
      return;
    }

    const timeout = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      finish({
        ok: false,
        available: false,
        code: 'TIMEOUT',
        reason: 'Codex CLI availability check timed out',
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
        ok: false,
        available: false,
        code: 'CLI_UNAVAILABLE',
        reason: err.message || 'Codex CLI unavailable',
        model,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        finish({
          ok: true,
          available: true,
          code: 'OK',
          reason: output.trim().split(/\r?\n/)[0] || 'Codex CLI ready',
          model,
        });
        return;
      }
      finish({
        ok: false,
        available: false,
        code: 'CLI_UNAVAILABLE',
        reason: (errorOutput || output || `Codex CLI exited with code ${code}`).trim().slice(0, 240),
        model,
      });
    });
  });
}

function abortError(message = 'Triage request cancelled') {
  const err = new Error(message);
  err.name = 'AbortError';
  err.code = 'ABORT_ERR';
  return err;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function readbackWaitMs() {
  const raw = Number.parseInt(process.env.TRIAGE_PROVIDER_PACKAGE_WAIT_MS, 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 60_000) : DEFAULT_READBACK_WAIT_MS;
}

function parsePromptVersion(promptText) {
  const match = safeString(promptText, '').match(/^\s*PROMPT_VERSION:\s*([^\r\n]+)/im);
  return match ? match[1].trim() : '';
}

function buildPromptTrace(promptId, promptText) {
  return {
    promptId,
    promptVersion: parsePromptVersion(promptText),
    promptLength: safeString(promptText, '').length,
  };
}

function formatKnowledgeContextRecord(record) {
  const lines = [];
  const trust = safeString(record.trustState, 'unknown').toUpperCase();
  lines.push(`[KB ${trust}: ${record.id}] ${safeString(record.title, 'Untitled knowledge record')}`);
  if (record.category) lines.push(`Category: ${record.category}`);
  if (record.reusableOutcome) lines.push(`Reusable outcome: ${record.reusableOutcome}`);
  if (record.summary) lines.push(`Summary: ${record.summary}`);
  if (record.symptom) lines.push(`Symptom: ${record.symptom}`);
  if (record.rootCause) lines.push(`Root cause: ${record.rootCause}`);
  if (record.exactFix) lines.push(`Fix: ${record.exactFix}`);
  if (Array.isArray(record.keySignals) && record.keySignals.length > 0) {
    lines.push(`Signals: ${record.keySignals.join('; ')}`);
  }
  if (Array.isArray(record.evidence) && record.evidence.length > 0) {
    const evidence = record.evidence
      .slice(0, 3)
      .map((item) => {
        const label = safeString(item.label || item.id || item.type, '');
        const status = safeString(item.evidenceStatus, '');
        return status ? `${label} (${status})` : label;
      })
      .filter(Boolean);
    if (evidence.length > 0) lines.push(`Evidence: ${evidence.join('; ')}`);
  }
  if (Array.isArray(record.operationalClaims) && record.operationalClaims.length > 0) {
    const claims = record.operationalClaims
      .slice(0, 5)
      .map((claim) => `${claim.claimType}: ${claim.text}`)
      .filter(Boolean);
    if (claims.length > 0) lines.push(`Validated claims: ${claims.join(' | ')}`);
  }
  if (Array.isArray(record.warnings) && record.warnings.length > 0) {
    lines.push(`Warnings: ${record.warnings.join(', ')}`);
  }
  return lines.join('\n');
}

function formatTriageKnowledgeContext(context) {
  const records = Array.isArray(context?.records) ? context.records : [];
  if (records.length === 0) return '';
  return [
    'Trusted QBO Knowledgebase Context:',
    'These records were selected for allowedUse=triage. Use TRUSTED records as reviewed guidance only when directly relevant. Use LEGACY-TRUSTED playbook records as existing guidance with incomplete database evidence. Do not treat candidate, rejected, restricted, or unsafe knowledge as final guidance.',
    '',
    records.map(formatKnowledgeContextRecord).join('\n\n'),
  ].join('\n');
}

async function buildTriageKnowledgebaseContext(parserText, { eventBus = null, signal = null } = {}) {
  try {
    throwIfAborted(signal);
    const context = await buildOperationalIntelligenceContext({
      query: parserText,
      allowedUse: 'triage',
      limit: 5,
      includeLegacy: true,
      includeCandidates: false,
    });
    throwIfAborted(signal);
    const records = Array.isArray(context.records) ? context.records : [];
    const trace = {
      source: 'knowledgebase-service',
      allowedUse: 'triage',
      recordCount: records.length,
      records: records.map((record) => ({
        id: record.id,
        sourceType: record.sourceType,
        title: record.title,
        trustState: record.trustState,
        reviewStatus: record.reviewStatus,
        reusableOutcome: record.reusableOutcome,
        warnings: record.warnings || [],
        operationalClaimCount: Array.isArray(record.operationalClaims) ? record.operationalClaims.length : 0,
      })),
      fallbackUsed: false,
      error: '',
    };
    eventBus?.emit('triage.knowledge_context_built', trace);
    return {
      promptSection: formatTriageKnowledgeContext(context),
      trace,
    };
  } catch (err) {
    const trace = {
      source: 'knowledgebase-service',
      allowedUse: 'triage',
      recordCount: 0,
      records: [],
      fallbackUsed: true,
      error: err?.message || 'Knowledgebase lookup failed',
    };
    eventBus?.emit('triage.knowledge_context_failed', trace);
    return {
      promptSection: '',
      trace,
    };
  }
}

function createTriageError(message, code, extra = {}) {
  const err = new Error(message);
  err.code = code || 'TRIAGE_FAILED';
  Object.assign(err, extra);
  return err;
}

function emitUserVisibleStatus(eventBus, kind, message, status, data = {}) {
  eventBus?.emit(kind, {
    ...data,
    status,
    surfaceToUser: true,
    displayMessage: `${message} - ${status}`,
  });
}

function getEffectiveModel(provider, model) {
  const requested = safeString(model, '').trim();
  if (requested) return requested;
  return getProviderModelId(provider) || (provider === 'lm-studio' ? 'local' : 'auto');
}

function deriveParseFieldsFromParserText(text) {
  return parseEscalationText(text);
}

function buildOpenAiLikeBody({ model, systemPrompt, userPrompt, reasoningEffort, maxTokens = 1200 }) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };
  const isReasoningModel = /^gpt-5(?:[.\-\w]*)?$/i.test(model) || /^o\d/i.test(model);
  if (isReasoningModel) {
    body.max_completion_tokens = maxTokens;
    const effort = safeString(reasoningEffort, '').trim().toLowerCase();
    if (['none', 'low', 'medium', 'high', 'xhigh'].includes(effort)) body.reasoning_effort = effort;
  } else {
    body.max_tokens = maxTokens;
    body.temperature = 0.1;
  }
  return body;
}

function buildCaptureContext({ provider, model, promptTrace }) {
  return {
    providerId: provider,
    callSite: TRIAGE_PROVIDER_CALL_SITE,
    operation: TRIAGE_PROVIDER_OPERATION,
    functionName: 'runDirectTriageProviderCall',
    forceCapture: true,
    agent: TRIAGE_AGENT_ID,
    modelRequested: model,
    metadata: {
      sourceAgent: TRIAGE_AGENT_ID,
      promptId: promptTrace.promptId,
      promptVersion: promptTrace.promptVersion,
    },
  };
}

function runCodexTriageProviderCall({
  provider,
  model,
  systemPrompt,
  userPrompt,
  reasoningEffort,
  serviceTier,
  timeoutMs,
  captureContext,
  eventBus,
  signal,
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let cleanup = null;

    function finishOk(_text, _usage, providerTrace) {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', handleAbort);
      resolve({ providerTrace });
    }

    function finishErr(err) {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', handleAbort);
      reject(err);
    }

    function handleAbort() {
      if (settled) return;
      const cleanupResult = typeof cleanup === 'function' ? cleanup() : null;
      const err = abortError('Triage Codex CLI request cancelled');
      if (cleanupResult?.providerTrace) err.providerTrace = cleanupResult.providerTrace;
      finishErr(err);
    }

    signal?.addEventListener('abort', handleAbort, { once: true });

    try {
      cleanup = codex.chat({
        messages: [{ role: 'user', content: userPrompt }],
        systemPrompt,
        model,
        reasoningEffort,
        serviceTier,
        timeoutMs,
        captureContext: {
          providerId: provider,
          providerResearchId: 'openai-cli',
          providerPathType: 'cli',
          callSite: TRIAGE_PROVIDER_CALL_SITE,
          operation: TRIAGE_PROVIDER_OPERATION,
          forceCapture: true,
          modelRequested: model,
          reasoningEffort,
          source: {
            file: 'server/src/services/triage.js',
            functionName: 'runDirectTriageProviderCall',
            helperName: 'codex.chat',
            spawnSite: 'codex.chat',
          },
          ...(captureContext || {}),
        },
        onProviderEvent: (eventType, payload) => eventBus?.emit(eventType, payload),
        onChunk: () => {},
        onThinkingChunk: () => {},
        onDone: finishOk,
        onError: finishErr,
      });
    } catch (err) {
      finishErr(err);
    }
  });
}

async function runDirectTriageProviderCall({
  provider,
  model,
  systemPrompt,
  userPrompt,
  reasoningEffort,
  serviceTier,
  timeoutMs,
  promptTrace,
  eventBus,
  signal,
} = {}) {
  const captureContext = buildCaptureContext({ provider, model, promptTrace });
  const onProviderEvent = (eventType, payload) => eventBus?.emit(eventType, payload);

  switch (provider) {
    case 'claude':
      return sendClaudeCliPrompt({
        systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        model,
        reasoningEffort,
        timeoutMs,
        captureContext: {
          ...captureContext,
          providerResearchId: 'anthropic-cli',
          providerPathType: 'cli',
          forceCapture: true,
          source: {
            file: 'server/src/services/triage.js',
            functionName: 'runDirectTriageProviderCall',
            helperName: 'sendClaudeCliPrompt',
            spawnSite: 'claude-cli-provider-harness.sendClaudeCliPrompt',
          },
        },
        onProviderEvent,
        signal,
      });
    case 'codex':
      {
        const result = await runCodexTriageProviderCall({
          provider,
          model,
          systemPrompt,
          userPrompt,
          reasoningEffort,
          serviceTier,
          timeoutMs,
          captureContext: {
            ...captureContext,
            providerResearchId: 'openai-cli',
            providerPathType: 'cli',
            forceCapture: true,
          },
          eventBus,
          signal,
        });
        const providerTrace = await requireProviderPackageCapture({
          providerTrace: result.providerTrace,
          onProviderEvent,
          providerId: result.providerTrace?.providerId || 'codex',
          providerHarness: result.providerTrace?.providerHarness || 'openai-cli',
        });
        return { providerTrace };
      }
    case 'llm-gateway':
      return sendLlmGatewayChatCompletion({
        body: {
          ...buildOpenAiLikeBody({ model, systemPrompt, userPrompt, reasoningEffort }),
          chat_template_kwargs: { enable_thinking: false },
        },
        model,
        timeoutMs,
        getApiKey: () => resolveApiKey('llm-gateway'),
        captureContext: {
          ...captureContext,
          providerPathType: 'gateway-http',
          metadata: {
            ...captureContext.metadata,
            serviceTier: serviceTier || '',
          },
        },
        onProviderEvent,
        signal,
      });
    case 'lm-studio':
      return sendLmStudioChatCompletion({
        body: buildOpenAiLikeBody({ model, systemPrompt, userPrompt, reasoningEffort }),
        model,
        timeoutMs,
        captureContext: {
          ...captureContext,
          providerResearchId: 'lm-studio-openai-compatible',
          providerPathType: 'lm-studio-http-nonstream',
        },
        onProviderEvent,
        signal,
      });
    case 'anthropic':
      return sendAnthropicMessages({
        body: {
          model,
          max_tokens: 1200,
          temperature: 0.1,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        },
        model,
        timeoutMs,
        getApiKey: () => resolveApiKey('anthropic'),
        captureContext: {
          ...captureContext,
          providerResearchId: 'anthropic-api',
          providerPathType: 'direct-http',
        },
        onProviderEvent,
        signal,
      });
    case 'openai':
      return sendOpenAiChatCompletion({
        body: buildOpenAiLikeBody({ model, systemPrompt, userPrompt, reasoningEffort }),
        model,
        timeoutMs,
        getApiKey: () => resolveApiKey('openai'),
        captureContext: {
          ...captureContext,
          providerResearchId: 'openai-api',
          providerPathType: 'direct-http',
        },
        onProviderEvent,
        signal,
      });
    case 'gemini':
      return sendGeminiGenerateContent({
        body: {
          contents: [{
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1200,
          },
        },
        model,
        timeoutMs,
        getApiKey: () => resolveApiKey('gemini'),
        captureContext: {
          ...captureContext,
          providerResearchId: 'gemini-api',
          providerPathType: 'direct-http',
        },
        onProviderEvent,
        signal,
      });
    case 'kimi':
      return sendKimiChatCompletion({
        body: buildOpenAiLikeBody({ model, systemPrompt, userPrompt, reasoningEffort }),
        model,
        timeoutMs,
        getApiKey: () => resolveApiKey('kimi'),
        captureContext: {
          ...captureContext,
          providerResearchId: 'kimi-api',
          providerPathType: 'direct-http',
        },
        onProviderEvent,
        signal,
      });
    default:
      throw createTriageError(`Unsupported direct triage provider: ${provider}`, 'INVALID_PROVIDER');
  }
}

function requestJson({ url, headers = {}, timeoutMs = DEFAULT_PREFLIGHT_TIMEOUT_MS, signal } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...headers,
      },
      timeout: timeoutMs,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        let parsedBody = null;
        try { parsedBody = body ? JSON.parse(body) : null; } catch { parsedBody = null; }
        resolve({ statusCode: res.statusCode || 0, body, parsedJson: parsedBody });
      });
    });
    req.on('timeout', () => {
      const err = createTriageError(`Pre-flight request timed out after ${timeoutMs}ms`, 'TRIAGE_PREFLIGHT_TIMEOUT');
      req.destroy(err);
      reject(err);
    });
    req.on('error', reject);
    if (signal) {
      signal.addEventListener('abort', () => {
        const err = abortError('Triage pre-flight request cancelled');
        req.destroy(err);
        reject(err);
      }, { once: true });
    }
    req.end();
  });
}

async function preflightProvider({ provider, model, timeoutMs = DEFAULT_PREFLIGHT_TIMEOUT_MS, signal } = {}) {
  throwIfAborted(signal);
  if (!DIRECT_TRIAGE_PROVIDERS.includes(provider)) {
    return {
      ok: false,
      code: 'INVALID_PROVIDER',
      reason: `Triage provider must be one of: ${DIRECT_TRIAGE_PROVIDERS.join(', ')}`,
      provider,
      model,
    };
  }

  if (provider === 'lm-studio') {
    try {
      const baseUrl = process.env.LM_STUDIO_API_URL || 'http://127.0.0.1:1234';
      const response = await requestJson({ url: new URL('/v1/models', baseUrl).toString(), timeoutMs, signal });
      const ok = response.statusCode >= 200 && response.statusCode < 300;
      return {
        ok,
        code: ok ? 'OK' : 'PROVIDER_UNAVAILABLE',
        reason: ok ? 'LM Studio reachable.' : `LM Studio returned HTTP ${response.statusCode}.`,
        provider,
        model,
      };
    } catch (err) {
      return {
        ok: false,
        code: err.code || 'PROVIDER_UNAVAILABLE',
        reason: err.message || 'LM Studio is not reachable.',
        provider,
        model,
      };
    }
  }

  if (provider === 'llm-gateway') {
    try {
      const baseUrl = process.env.LLM_GATEWAY_API_URL || 'http://127.0.0.1:4100';
      const key = await resolveApiKey('llm-gateway');
      const response = await requestJson({
        url: new URL('/v1/provider-status', baseUrl).toString(),
        timeoutMs,
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal,
      });
      const ok = response.statusCode >= 200 && response.statusCode < 500;
      return {
        ok,
        code: ok ? 'OK' : 'PROVIDER_UNAVAILABLE',
        reason: ok ? 'LLM Gateway reachable.' : `LLM Gateway returned HTTP ${response.statusCode}.`,
        provider,
        model,
      };
    } catch (err) {
      return {
        ok: false,
        code: err.code || 'PROVIDER_UNAVAILABLE',
        reason: err.message || 'LLM Gateway is not reachable.',
        provider,
        model,
      };
    }
  }

  if (CLI_TRIAGE_PROVIDERS.has(provider)) {
    const result = provider === 'claude'
      ? await checkClaudeCliAvailability(model)
      : await checkCodexCliAvailability(model);
    return {
      ok: Boolean(result.ok || result.available),
      code: result.code || (result.available ? 'OK' : 'CLI_UNAVAILABLE'),
      reason: result.reason || (result.available ? `${provider} CLI ready.` : `${provider} CLI unavailable.`),
      provider,
      model,
    };
  }

  if (REMOTE_KEYED_PROVIDERS.has(provider)) {
    const key = await resolveApiKey(provider);
    if (!key) {
      return {
        ok: false,
        code: 'NO_KEY',
        reason: `${provider} API key is not configured.`,
        provider,
        model,
      };
    }
    const validated = await validateRemoteProvider(provider, key).catch((err) => ({
      ok: false,
      code: err.code || 'PROVIDER_UNAVAILABLE',
      reason: err.message || `${provider} validation failed.`,
    }));
    return {
      ok: Boolean(validated.ok),
      code: validated.code || (validated.ok ? 'OK' : 'PROVIDER_UNAVAILABLE'),
      reason: validated.reason || (validated.ok ? `${provider} reachable.` : `${provider} is not reachable.`),
      provider,
      model,
      validationModel: validated.model || '',
    };
  }

  return { ok: true, code: 'OK', reason: 'Provider accepted.', provider, model };
}

async function waitForProviderPackage(providerTrace, eventBus = null, signal = null) {
  throwIfAborted(signal);
  const providerPackageId = providerTrace?.providerPackageId;
  if (!providerPackageId) {
    throw createTriageError('Provider package id is required before triage can inspect provider output', 'PROVIDER_PACKAGE_MISSING_ID');
  }
  if (!ProviderCallPackage.db || ProviderCallPackage.db.readyState !== 1) {
    throw createTriageError('MongoDB must be connected before triage can inspect provider output', 'PROVIDER_PACKAGE_MONGO_UNAVAILABLE', {
      providerPackageId,
    });
  }

  const timeoutMs = readbackWaitMs();
  const startedAt = Date.now();
  let attempt = 0;
  while (Date.now() - startedAt <= timeoutMs) {
    throwIfAborted(signal);
    attempt += 1;
    const providerPackage = await ProviderCallPackage.findById(providerPackageId).lean();
    if (providerPackage) {
      eventBus?.emit('triage.provider_package_loaded', {
        providerPackageId,
        providerId: providerPackage.providerId || '',
        providerPathType: providerPackage.providerPathType || '',
        outcome: providerPackage.outcome || '',
        attempts: attempt,
      });
      return providerPackage;
    }
    eventBus?.emit('triage.provider_package_load_retry', {
      providerPackageId,
      attempt,
      elapsedMs: Date.now() - startedAt,
      timeoutMs,
      status: 'retrying',
    });
    await delay(Math.min(25 + attempt * 10, 250));
  }

  eventBus?.emit('triage.provider_package_load_failed', {
    providerPackageId,
    attempts: attempt,
    timeoutMs,
    status: 'error',
  });
  throw createTriageError(
    `Provider package ${providerPackageId} was not readable from MongoDB after ${timeoutMs}ms`,
    'PROVIDER_PACKAGE_LOAD_TIMEOUT',
    { providerPackageId }
  );
}

async function loadProviderCallPackagePayloadRef(ref) {
  if (!ref || typeof ref.ref !== 'string' || !ref.ref.trim()) return null;
  const fullPath = path.resolve(__dirname, '..', '..', '..', ref.ref);
  return fs.promises.readFile(fullPath, 'utf8');
}

async function loadCliStdoutJsonlEventsFromPackage(providerPackage) {
  const stdout = providerPackage?.cli?.stdout || {};
  if (Array.isArray(stdout.jsonlEvents) && stdout.jsonlEvents.length) {
    return stdout.jsonlEvents;
  }

  if (stdout.jsonlEventsPayloadRef) {
    const payload = await loadProviderCallPackagePayloadRef(stdout.jsonlEventsPayloadRef);
    if (payload) {
      const parsed = JSON.parse(payload);
      if (Array.isArray(parsed)) return parsed;
    }
  }

  let lines = Array.isArray(stdout.lines) ? stdout.lines : [];
  if ((!lines || lines.length === 0) && stdout.linesPayloadRef) {
    const payload = await loadProviderCallPackagePayloadRef(stdout.linesPayloadRef);
    if (payload) {
      try {
        const parsed = JSON.parse(payload);
        lines = Array.isArray(parsed) ? parsed : String(payload).split(/\r?\n/);
      } catch {
        lines = String(payload).split(/\r?\n/);
      }
    }
  }
  if ((!lines || lines.length === 0) && typeof stdout.text === 'string' && stdout.text.trim()) {
    lines = stdout.text.split(/\r?\n/);
  }
  if ((!lines || lines.length === 0) && stdout.textPayloadRef) {
    const payload = await loadProviderCallPackagePayloadRef(stdout.textPayloadRef);
    if (payload) lines = payload.split(/\r?\n/);
  }

  return (lines || [])
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function loadParsedJsonFromResponse(response = {}, providerLabel = 'Provider') {
  if (response.parsedJson && typeof response.parsedJson === 'object') return response.parsedJson;
  if (response.parsedJsonPayloadRef) {
    const payload = await loadProviderCallPackagePayloadRef(response.parsedJsonPayloadRef);
    if (payload) return JSON.parse(payload);
  }
  let bodyText = typeof response.bodyText === 'string' ? response.bodyText : '';
  if (!bodyText && response.bodyPayloadRef) bodyText = await loadProviderCallPackagePayloadRef(response.bodyPayloadRef);
  if (!bodyText && response.bodyTextPayloadRef) bodyText = await loadProviderCallPackagePayloadRef(response.bodyTextPayloadRef);
  if (!bodyText) {
    throw createTriageError(`${providerLabel} provider package did not include response body text`, 'PROVIDER_PACKAGE_EMPTY_RESPONSE');
  }
  return JSON.parse(bodyText);
}

function extractOpenAiLikeText(parsed) {
  const message = parsed?.choices?.[0]?.message || {};
  const content = typeof message.content === 'string' ? message.content : '';
  const reasoningContent = typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
  return (content || reasoningContent || '').trim();
}

function extractGeminiText(parsed) {
  return (parsed?.candidates?.[0]?.content?.parts || [])
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractCodexVisibleTextFromEvent(event, seenAgentTextByItem) {
  if (!event || typeof event !== 'object') return '';
  if (event.item && event.item.type === 'agent_message' && typeof event.item.text === 'string') {
    const id = event.item.id || '__default__';
    const prevText = seenAgentTextByItem.get(id) || '';
    const nextText = event.item.text;
    seenAgentTextByItem.set(id, nextText);
    if (nextText.startsWith(prevText)) return nextText.slice(prevText.length);
    return nextText;
  }
  if (typeof event.delta === 'string') return event.delta;
  if (event.delta && typeof event.delta.text === 'string') return event.delta.text;
  if (typeof event.text === 'string' && event.type && event.type.includes('delta')) return event.text;
  return '';
}

function buildCodexTextFromEvents(events) {
  const seenAgentTextByItem = new Map();
  let text = '';
  for (const event of events || []) {
    text += extractCodexVisibleTextFromEvent(event, seenAgentTextByItem);
  }
  return text.trim();
}

async function extractTriageTextFromProviderPackage(providerPackage, providerTrace = {}) {
  const providerId = providerPackage?.providerId || providerTrace.providerId || '';
  let parsed = null;
  let sourcePath = '';
  if (providerId === 'claude' || providerPackage?.providerResearchId === 'anthropic-cli') {
    const events = await loadCliStdoutJsonlEventsFromPackage(providerPackage);
    const payload = buildClaudePayloadFromEvents(events, providerTrace?.model || '');
    sourcePath = 'cli.stdout.jsonlEvents[stream_event.content_block_delta.delta.text]';
    return { text: payload.text, parsed: events, sourcePath };
  }
  if (providerId === 'codex' || providerPackage?.providerResearchId === 'openai-cli') {
    const events = await loadCliStdoutJsonlEventsFromPackage(providerPackage);
    sourcePath = 'cli.stdout.jsonlEvents[item.type=agent_message]';
    return { text: buildCodexTextFromEvents(events), parsed: events, sourcePath };
  }
  if (providerId === 'llm-gateway') {
    parsed = await loadParsedJsonFromResponse(providerPackage?.llmGateway?.response || {}, 'LLM Gateway');
    sourcePath = 'llmGateway.response.parsedJson.choices[0].message.content';
    return { text: extractOpenAiLikeText(parsed), parsed, sourcePath };
  }
  if (providerId === 'lm-studio') {
    parsed = await loadParsedJsonFromResponse(providerPackage?.lmStudio?.response || {}, 'LM Studio');
    sourcePath = 'lmStudio.response.parsedJson.choices[0].message.content';
    return { text: extractOpenAiLikeText(parsed), parsed, sourcePath };
  }
  if (providerId === 'openai' || providerPackage?.providerResearchId === 'openai-api') {
    parsed = await loadParsedJsonFromResponse(providerPackage?.response || {}, 'OpenAI');
    sourcePath = 'response.parsedJson.choices[0].message.content';
    return { text: extractOpenAiLikeText(parsed), parsed, sourcePath };
  }
  if (providerId === 'kimi' || providerPackage?.providerResearchId === 'kimi-api') {
    parsed = await loadParsedJsonFromResponse(providerPackage?.response || {}, 'Kimi');
    sourcePath = 'response.parsedJson.choices[0].message.content';
    return { text: extractOpenAiLikeText(parsed), parsed, sourcePath };
  }
  if (providerId === 'anthropic' || providerPackage?.providerResearchId === 'anthropic-api') {
    parsed = await loadParsedJsonFromResponse(providerPackage?.response || {}, 'Anthropic');
    sourcePath = 'response.parsedJson.content[0].text';
    return { text: safeString(parsed?.content?.[0]?.text, '').trim(), parsed, sourcePath };
  }
  if (providerId === 'gemini' || providerPackage?.providerResearchId === 'gemini-api') {
    parsed = await loadParsedJsonFromResponse(providerPackage?.geminiApi?.response || {}, 'Gemini');
    sourcePath = 'geminiApi.response.parsedJson.candidates[0].content.parts[text]';
    return { text: extractGeminiText(parsed), parsed, sourcePath };
  }
  throw createTriageError(`Unsupported provider package for triage extraction: ${providerId || 'unknown'}`, 'PROVIDER_PACKAGE_UNSUPPORTED');
}

function buildTriageMeta({
  source,
  provider,
  model,
  providerTrace,
  providerPayloadTrace,
  promptTrace,
  validation,
  severity,
  fallbackReason,
  failureStage,
  errorCode,
  latencyMs,
  knowledgeContext,
  attempted,
} = {}) {
  return {
    source,
    providerUsed: provider,
    model,
    providerPackageId: safeString(providerTrace?.providerPackageId, ''),
    providerTrace: providerTrace || null,
    providerPayload: providerPayloadTrace || null,
    promptId: promptTrace?.promptId || TRIAGE_AGENT_ID,
    promptVersion: promptTrace?.promptVersion || '',
    validation: validation || null,
    severity: severity || null,
    fallback: fallbackReason ? { used: source === 'fallback', reason: fallbackReason } : { used: false },
    fallbackReason: fallbackReason || null,
    fallbackUsed: source === 'fallback',
    failureStage: failureStage || '',
    errorCode: errorCode || '',
    latencyMs: normalizeElapsedMs(latencyMs),
    parsedBy: source === 'agent' ? TRIAGE_AGENT_ID : 'rule-fallback',
    knowledgeContext: knowledgeContext || promptTrace?.knowledgebase || null,
    // Ordered provenance of the provider attempts that led here. On a rule-card
    // fallback this records the primary (and the backup, if a failover was tried)
    // that failed, so the card does not mis-attribute the failure to whichever
    // provider happened to be the active attempt when it threw.
    attempted: Array.isArray(attempted) && attempted.length > 0 ? attempted : null,
  };
}

function buildFallbackCard(parseFields, reason) {
  const card = parseFields && Object.keys(parseFields).length > 0
    ? buildServerTriageCard(parseFields)
    : buildFallbackTriageCard();
  return {
    ...card,
    source: 'rule-fallback',
    fallback: {
      used: true,
      reason: reason || 'Triage provider did not return a usable answer.',
      warning: 'This triage card was generated by deterministic fallback rules, not the configured Triage Agent model.',
    },
  };
}

async function persistTriageResult(record) {
  if (!TriageResult.db || TriageResult.db.readyState !== 1) return null;
  try {
    return await TriageResult.create(record);
  } catch {
    return null;
  }
}

function serializeTriageResultDoc(doc) {
  if (!doc) return null;
  const raw = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    ...raw,
    id: String(raw._id || raw.id || ''),
  };
}

async function buildFallbackRun({
  runId,
  text,
  parseFields,
  provider,
  model,
  providerTrace,
  promptTrace,
  reason,
  failureStage,
  errorCode,
  startedAt,
  eventBus,
  knowledgeContext,
  attempted,
} = {}) {
  const elapsedMs = Date.now() - startedAt;
  const card = buildFallbackCard(parseFields, reason);
  const severity = { raw: '', validated: card.severity || '', displayed: card.severity || '' };
  const validation = {
    passed: false,
    issues: [makeFallbackIssue(errorCode, failureStage, reason)],
    fieldsFound: 0,
    outputFormat: 'deterministic-fallback',
    confidence: card.confidence || 'low',
  };
  const triageMeta = buildTriageMeta({
    source: 'fallback',
    provider,
    model,
    providerTrace,
    promptTrace,
    validation,
    severity,
    fallbackReason: reason,
    failureStage,
    errorCode,
    latencyMs: elapsedMs,
    knowledgeContext,
    attempted,
  });
  eventBus?.emit('error', {
    code: errorCode || 'TRIAGE_FALLBACK',
    message: reason,
    failureStage,
    provider,
    model,
    providerPackageId: providerTrace?.providerPackageId || null,
  });
  eventBus?.emit('triage.fields_extracted', {
    fieldCount: Object.keys(parseFields || {}).length,
    fields: Object.keys(parseFields || {}),
    source: 'fallback',
  });
  eventBus?.emit('triage.output_validated', {
    passed: false,
    issueCount: validation.issues.length,
    source: 'fallback',
  });

  const saved = await persistTriageResult({
    runId,
    status: 'degraded',
    severity,
    category: card.category || '',
    rawOutput: '',
    card,
    validationIssues: validation.issues,
    fallbackUsed: true,
    fallbackReason: reason || '',
    failureStage: failureStage || '',
    errorCode: errorCode || '',
    providerPackageId: safeString(providerTrace?.providerPackageId, ''),
    provider,
    model,
    latencyMs: elapsedMs,
    promptVersion: promptTrace?.promptVersion || '',
    triageMeta,
    parserText: safeString(text, ''),
    parseFields,
  });

  return {
    ok: true,
    status: 'degraded',
    card,
    triageMeta: {
      ...triageMeta,
      resultId: saved?._id ? String(saved._id) : '',
    },
    elapsedMs,
    providerUsed: provider,
    modelUsed: model,
    savedResult: serializeTriageResultDoc(saved),
  };
}

function makeFallbackIssue(errorCode, failureStage, reason) {
  return {
    code: errorCode || 'TRIAGE_FALLBACK',
    field: 'infrastructure',
    message: reason || 'Triage fell back to deterministic rules.',
    failureStage: failureStage || '',
  };
}

async function runTriage(text, options = {}) {
  const startedAt = Date.now();
  const eventBus = options.eventBus || null;
  const signal = options.signal || null;
  throwIfAborted(signal);

  const parserText = safeString(text, '').trim();
  if (!parserText) {
    throw createTriageError('Escalation template text is required', 'MISSING_TEXT');
  }
  const runId = safeString(options.runId, '');
  const parseFields = deriveParseFieldsFromParserText(parserText);
  const primaryProvider = safeString(options.provider, '').trim() || 'lm-studio';
  const primaryModel = getEffectiveModel(primaryProvider, options.model);
  // `provider`/`model` track the ACTIVE attempt. After an automatic failover
  // they are reassigned to the backup so the card, persistence, and triageMeta
  // describe the provider that actually produced the result.
  let provider = primaryProvider;
  let model = primaryModel;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
    ? Math.min(Number(options.timeoutMs), 180_000)
    : DEFAULT_TIMEOUT_MS;

  let promptTrace = { promptId: TRIAGE_AGENT_ID, promptVersion: '', promptLength: 0 };
  let providerTrace = null;
  let knowledgeContextTrace = null;

  try {
    const baseSystemPrompt = getRenderedAgentPrompt(TRIAGE_AGENT_ID);
    const knowledgeContext = await buildTriageKnowledgebaseContext(parserText, { eventBus, signal });
    knowledgeContextTrace = knowledgeContext.trace;
    const systemPrompt = [
      baseSystemPrompt,
      knowledgeContext.promptSection,
    ].filter(Boolean).join('\n\n');
    promptTrace = {
      ...buildPromptTrace(TRIAGE_AGENT_ID, systemPrompt),
      knowledgebase: knowledgeContextTrace,
    };
    eventBus?.emit('triage.prompt_resolved', promptTrace);

    const userPrompt = buildTriageAgentPromptInput({ parserText });
    eventBus?.emit('triage.context_built', {
      parseFieldCount: Object.keys(parseFields || {}).length,
      parserTextChars: parserText.length,
      promptInputChars: userPrompt.length,
    });
    eventBus?.emit('triage.provider_selected', {
      provider,
      model,
      reasoningEffort: options.reasoningEffort || '',
      serviceTier: options.serviceTier || '',
      timeoutMs,
    });

    const preflight = typeof options.preflightProvider === 'function'
      ? await options.preflightProvider({ provider, model, timeoutMs: Math.min(timeoutMs, DEFAULT_PREFLIGHT_TIMEOUT_MS), signal })
      : await preflightProvider({ provider, model, timeoutMs: Math.min(timeoutMs, DEFAULT_PREFLIGHT_TIMEOUT_MS), signal });
    eventBus?.emit('triage.preflight_checked', {
      ...preflight,
      provider,
      model,
    });
    if (!preflight.ok) {
      return buildFallbackRun({
        runId,
        text: parserText,
        parseFields,
        provider,
        model,
        promptTrace,
        reason: preflight.reason || 'Triage provider was not reachable.',
        failureStage: 'preflight',
        errorCode: preflight.code || 'PROVIDER_UNAVAILABLE',
        startedAt,
        eventBus,
        knowledgeContext: knowledgeContextTrace,
        // Only the primary was attempted (no failover before its own pre-flight).
        attempted: [{ provider: primaryProvider, model: primaryModel, role: 'primary' }],
      });
    }

    const directCall = typeof options.runDirectTriageProviderCall === 'function'
      ? options.runDirectTriageProviderCall
      : runDirectTriageProviderCall;
    const waitForPackage = typeof options.waitForProviderPackage === 'function'
      ? options.waitForProviderPackage
      : waitForProviderPackage;

    // One full provider attempt: hand off to the provider, wait for its
    // ProviderCallPackage to be readable, then extract the triage text. This is
    // run once for the primary and — on failure — once for the configured
    // backup. The capture pipeline keys off the providerTrace returned by THIS
    // call, so each attempt produces and reads back its OWN package; the backup
    // does not reuse the primary's trace. Returns { providerTrace, providerPackage, payload }.
    async function attemptProviderTriage(attemptProvider, attemptModel) {
      eventBus?.emit('triage.generation_started', {
        provider: attemptProvider,
        model: attemptModel,
        reasoningEffort: options.reasoningEffort || '',
        serviceTier: options.serviceTier || '',
      });
      eventBus?.emit('triage.agent_handoff_to_provider', {
        provider: attemptProvider,
        model: attemptModel,
        forceCapture: true,
        operation: TRIAGE_PROVIDER_OPERATION,
      });

      const providerResult = await directCall({
        provider: attemptProvider,
        model: attemptModel,
        systemPrompt,
        userPrompt,
        reasoningEffort: options.reasoningEffort || '',
        serviceTier: options.serviceTier || '',
        timeoutMs,
        promptTrace,
        eventBus,
        signal,
      });
      const attemptTrace = providerResult?.providerTrace || null;
      const attemptPackage = await waitForPackage(attemptTrace, eventBus, signal);
      const attemptPayload = await extractTriageTextFromProviderPackage(attemptPackage, attemptTrace);
      if (!attemptPayload.text) {
        const emptyErr = createTriageError('Provider package did not contain usable triage text', 'PROVIDER_PACKAGE_EMPTY_RESPONSE', {
          providerPackageId: attemptTrace?.providerPackageId || null,
        });
        emptyErr.providerTrace = attemptTrace;
        throw emptyErr;
      }
      return { providerTrace: attemptTrace, providerPackage: attemptPackage, payload: attemptPayload };
    }

    // Automatic provider-to-provider failover (Wave 2): Triage now fails over to
    // a configured backup when its primary provider attempt fails, exactly like
    // the chat and parse substrates. The backup is resolved by the shared,
    // use-case-agnostic resolveAgentBackup helper — NO capability filtering; the
    // operator's profile choice is honored as-is, defaulting to a neutral global
    // alternate when unset. Precedence: an explicit request-body fallbackProvider
    // wins, else the profile-configured backup, else the neutral alternate. If
    // the backup ALSO fails, the error propagates to the catch below and the
    // deterministic rule-card fallback (buildFallbackRun) stays the final resort.
    let attempt;
    try {
      attempt = await attemptProviderTriage(primaryProvider, primaryModel);
    } catch (primaryErr) {
      // Failover is gated on the CALLER signalling failover intent (an explicit
      // fallbackProvider OR an agentRuntime object). The agent routes ALWAYS pass
      // the triage agent profile runtime (which defaults the fallback to the
      // neutral alternate), so for every real triage flow failover is always on.
      // Bare engine callers that pass a single provider and no runtime keep the
      // original behavior: the primary failure flows straight to the rule card
      // without a second provider attempt.
      const requestFallbackProvider = safeString(options.fallbackProvider, '').trim();
      const hasFailoverIntent = Boolean(requestFallbackProvider)
        || (options.agentRuntime && typeof options.agentRuntime === 'object');
      if (!hasFailoverIntent) {
        throw primaryErr;
      }
      // eslint-disable-next-line global-require
      const { resolveAgentBackup } = require('./agent-failover');
      const profileBackup = resolveAgentBackup(primaryProvider, options.agentRuntime);
      const requestFallbackModel = safeString(options.fallbackModel, '').trim();
      const backupProviderRaw = requestFallbackProvider || profileBackup.provider;
      const backupProvider = DIRECT_TRIAGE_PROVIDERS.includes(backupProviderRaw) ? backupProviderRaw : '';
      const backupModelRaw = requestFallbackProvider ? requestFallbackModel : profileBackup.model;
      const backupModel = getEffectiveModel(backupProvider, backupModelRaw);

      // Only fail over to a DISTINCT, supported triage provider. Otherwise there
      // is nothing usable to fail over to — let the original failure flow to the
      // deterministic rule-card fallback below.
      if (!backupProvider || backupProvider === primaryProvider) {
        throw primaryErr;
      }

      // The backup must clear its own pre-flight before we hand off, mirroring
      // the primary path so an unreachable backup degrades to the rule card
      // rather than hanging on a dead provider.
      const backupPreflight = typeof options.preflightProvider === 'function'
        ? await options.preflightProvider({ provider: backupProvider, model: backupModel, timeoutMs: Math.min(timeoutMs, DEFAULT_PREFLIGHT_TIMEOUT_MS), signal })
        : await preflightProvider({ provider: backupProvider, model: backupModel, timeoutMs: Math.min(timeoutMs, DEFAULT_PREFLIGHT_TIMEOUT_MS), signal });
      if (!backupPreflight.ok) {
        throw primaryErr;
      }

      eventBus?.emit('triage.provider_failover', {
        from: primaryProvider,
        fromModel: primaryModel || '',
        to: backupProvider,
        toModel: backupModel || '',
        reason: primaryErr?.message || 'Primary triage provider failed',
        code: primaryErr?.code || 'TRIAGE_PROVIDER_FAILED',
        surfaceToUser: true,
        displayMessage: `Triage primary ${primaryProvider} failed; failing over to ${backupProvider}`,
      });

      // Reassign the active attempt identity to the backup so the card,
      // persistence, and triageMeta below all describe the backup that produced
      // the result. If the backup throws, it propagates to the catch -> rule card.
      provider = backupProvider;
      model = backupModel;
      attempt = await attemptProviderTriage(backupProvider, backupModel);
    }

    providerTrace = attempt.providerTrace;
    const providerPackage = attempt.providerPackage;
    const payload = attempt.payload;
    eventBus?.emit('triage.fields_extracted', {
      providerPackageId: providerTrace?.providerPackageId || null,
      sourcePath: payload.sourcePath,
      textLength: payload.text.length,
    });
    const built = buildSoftValidatedTriageCardFromOutput(payload.text, parseFields);
    eventBus?.emit('triage.output_validated', {
      passed: Boolean(built.validation.passed),
      issueCount: built.validation.issues.length,
      confidence: built.validation.confidence || '',
      severity: built.severity.displayed || '',
      category: built.category.displayed || '',
    });
    const elapsedMs = Date.now() - startedAt;
    const triageMeta = buildTriageMeta({
      source: 'agent',
      provider,
      model: providerTrace?.model || model,
      providerTrace,
      providerPayloadTrace: {
        providerPackageId: safeString(providerPackage?._id || providerTrace?.providerPackageId, ''),
        sourcePath: payload.sourcePath,
      },
      promptTrace,
      validation: built.validation,
      severity: built.severity,
      latencyMs: elapsedMs,
      knowledgeContext: knowledgeContextTrace,
    });
    const status = built.validation.passed ? 'success' : 'degraded';
    const saved = await persistTriageResult({
      runId,
      status,
      severity: built.severity,
      category: built.card.category || '',
      rawOutput: payload.text,
      card: built.card,
      validationIssues: built.validation.issues,
      fallbackUsed: false,
      fallbackReason: '',
      failureStage: '',
      errorCode: '',
      providerPackageId: safeString(providerTrace?.providerPackageId, ''),
      provider,
      model: providerTrace?.model || model,
      latencyMs: elapsedMs,
      promptVersion: promptTrace.promptVersion || '',
      triageMeta,
      parserText,
      parseFields,
    });

    return {
      ok: true,
      status,
      card: built.card,
      rawOutput: payload.text,
      triageMeta: {
        ...triageMeta,
        resultId: saved?._id ? String(saved._id) : '',
      },
      elapsedMs,
      providerUsed: provider,
      modelUsed: providerTrace?.model || model,
      // Surface whether an automatic failover produced this result (provider now
      // differs from the requested primary). fallbackFrom is the primary we left.
      fallbackUsed: provider !== primaryProvider,
      fallbackFrom: provider !== primaryProvider ? primaryProvider : '',
      savedResult: serializeTriageResultDoc(saved),
    };
  } catch (err) {
    providerTrace = err?.providerTrace || providerTrace || null;
    const code = err?.code || 'TRIAGE_PROVIDER_FAILED';
    const failureStage = code && code.startsWith('PROVIDER_PACKAGE') ? 'provider-package-readback' : 'provider-call';
    // Accurate provenance for the rule card: the primary always failed to reach
    // here, and if `provider` was reassigned to a backup (a failover was tried)
    // that backup failed too. Record both in order so the card does not blame the
    // backup alone when the active attempt happened to be the backup.
    const failedOverToBackup = provider !== primaryProvider;
    const attempted = [{ provider: primaryProvider, model: primaryModel, role: 'primary' }];
    if (failedOverToBackup) {
      attempted.push({ provider, model, role: 'backup' });
    }
    return buildFallbackRun({
      runId,
      text: parserText,
      parseFields,
      provider,
      model,
      providerTrace,
      promptTrace,
      reason: err?.message || 'Triage provider failed.',
      failureStage,
      errorCode: code,
      startedAt,
      eventBus,
      knowledgeContext: knowledgeContextTrace,
      attempted,
    });
  }
}

module.exports = {
  DIRECT_TRIAGE_PROVIDERS,
  TRIAGE_AGENT_ID,
  buildFallbackCard,
  extractTriageTextFromProviderPackage,
  preflightProvider,
  runDirectTriageProviderCall,
  runTriage,
  waitForProviderPackage,
  __internals: {
    buildOpenAiLikeBody,
    buildPromptTrace,
    loadParsedJsonFromResponse,
    loadProviderCallPackagePayloadRef,
    makeFallbackIssue,
  },
};
