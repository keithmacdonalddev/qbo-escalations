'use strict';

const crypto = require('crypto');
const { buildReasoningEvidence } = require('./provider-reasoning-evidence');

const CAPTURE_POLICY_VERSION = 'provider-capture-policy-v1';
const CAPTURE_MODES = Object.freeze({
  MANIFEST: 'manifest',
  DIAGNOSTIC: 'diagnostic',
  EVALUATION: 'evaluation',
});
const RICH_CAPTURE_MODES = new Set([CAPTURE_MODES.DIAGNOSTIC, CAPTURE_MODES.EVALUATION]);
const ALLOWED_RICH_CAPTURE_PURPOSES = new Set([
  'agent-evaluation',
  'provider-comparison',
  'operator-incident-review',
  'provider-package-contract-test',
]);
const MAX_RESULT_HANDOFF_BYTES = 64 * 1024;

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function resolveCapturePolicy(context = {}, envelope = {}) {
  const metadata = context?.metadata && typeof context.metadata === 'object' ? context.metadata : {};
  const requestedMode = safeString(context.captureMode || metadata.captureMode).toLowerCase();
  const requestedPurpose = safeString(context.capturePurpose || metadata.capturePurpose).toLowerCase();
  const operation = safeString(context.operation || envelope.operation).toLowerCase();
  const richPurposeAllowed = ALLOWED_RICH_CAPTURE_PURPOSES.has(requestedPurpose);
  const isEvaluation = richPurposeAllowed && (
    requestedMode === CAPTURE_MODES.EVALUATION
    || metadata.testRun === true
    || metadata.harnessRun === true
    || /(^|[-_:])(harness|evaluation|provider-comparison)([-_:]|$)/.test(operation)
  );

  if (requestedMode === CAPTURE_MODES.MANIFEST) {
    return {
      version: CAPTURE_POLICY_VERSION,
      mode: CAPTURE_MODES.MANIFEST,
      purpose: requestedPurpose || 'product-observability',
      declared: true,
      decisionReason: 'caller-declared',
      payloadBodiesRetained: false,
      reasoningRetained: true,
    };
  }

  if (RICH_CAPTURE_MODES.has(requestedMode) && richPurposeAllowed) {
    return {
      version: CAPTURE_POLICY_VERSION,
      mode: requestedMode,
      purpose: requestedPurpose,
      declared: true,
      decisionReason: 'allowlisted-rich-capture',
      payloadBodiesRetained: true,
      reasoningRetained: true,
    };
  }

  if (operation === 'provider-status') {
    return {
      version: CAPTURE_POLICY_VERSION,
      mode: CAPTURE_MODES.MANIFEST,
      purpose: requestedPurpose || 'provider-health',
      declared: Boolean(requestedPurpose),
      decisionReason: 'provider-health-manifest',
      payloadBodiesRetained: false,
      reasoningRetained: true,
    };
  }

  if (isEvaluation) {
    return {
      version: CAPTURE_POLICY_VERSION,
      mode: CAPTURE_MODES.EVALUATION,
      purpose: requestedPurpose || 'agent-evaluation',
      declared: Boolean(requestedPurpose),
      decisionReason: 'evaluation-context',
      payloadBodiesRetained: true,
      reasoningRetained: true,
    };
  }

  return {
    version: CAPTURE_POLICY_VERSION,
    mode: CAPTURE_MODES.MANIFEST,
    purpose: requestedPurpose || 'product-observability',
    declared: Boolean(requestedPurpose),
    decisionReason: RICH_CAPTURE_MODES.has(requestedMode)
      ? 'rich-capture-purpose-not-allowlisted'
      : (context.forceCapture === true ? 'force-capture-does-not-authorize-raw-traffic' : 'safe-default'),
    payloadBodiesRetained: false,
    reasoningRetained: true,
  };
}

function clearPath(target, path) {
  const parts = path.split('.');
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (!cursor || typeof cursor !== 'object') return;
    cursor = cursor[parts[index]];
  }
  if (cursor && typeof cursor === 'object' && Object.prototype.hasOwnProperty.call(cursor, parts.at(-1))) {
    cursor[parts.at(-1)] = null;
  }
}

function stripReasoningFromValue(value) {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => !(entry && typeof entry === 'object' && (
        entry.type === 'thinking'
        || entry.type === 'reasoning'
        || entry.type === 'agent_reasoning'
        || entry.thought === true
      )))
      .map(stripReasoningFromValue);
  }
  if (!value || typeof value !== 'object') return value;
  const eventType = safeString(value.type).toLowerCase();
  if (eventType.includes('reasoning') || eventType === 'thinking_delta') return null;
  if (value.item && ['reasoning', 'agent_reasoning'].includes(value.item.type)) return null;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/reasoning|thinking/i.test(key)) continue;
    const scrubbed = stripReasoningFromValue(entry);
    if (scrubbed !== null) result[key] = scrubbed;
  }
  return result;
}

function stripInlineReasoning(prepared) {
  const semanticPaths = [
    'response.parsedJson',
    'lmStudio.response.parsedJson',
    'llmGateway.response.parsedJson',
    'geminiApi.response.parsedJson',
    'cli.stdout.jsonlEvents',
  ];
  for (const fieldPath of semanticPaths) {
    const parts = fieldPath.split('.');
    const key = parts.pop();
    const parent = parts.reduce((cursor, part) => cursor?.[part], prepared);
    if (parent && Object.prototype.hasOwnProperty.call(parent, key)) {
      parent[key] = stripReasoningFromValue(parent[key]);
      if (Array.isArray(parent[key])) parent[key] = parent[key].filter(Boolean);
    }
  }
}

function buildResultHandoff(prepared) {
  const responsePayload = prepared?.response?.parsedJson
    || prepared?.lmStudio?.response?.parsedJson
    || prepared?.llmGateway?.response?.parsedJson
    || prepared?.geminiApi?.response?.parsedJson
    || null;
  const cliEvents = Array.isArray(prepared?.cli?.stdout?.jsonlEvents)
    ? prepared.cli.stdout.jsonlEvents
    : null;
  let text = '';
  let sourcePath = '';
  let usage = null;
  let responseModel = '';
  if (responsePayload) {
    responseModel = safeString(responsePayload.model || responsePayload.modelVersion);
    const choiceContent = responsePayload?.choices?.[0]?.message?.content;
    const anthropicText = (Array.isArray(responsePayload?.content) ? responsePayload.content : [])
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
    const geminiText = (Array.isArray(responsePayload?.candidates?.[0]?.content?.parts)
      ? responsePayload.candidates[0].content.parts : [])
      .filter((part) => part?.thought !== true && typeof part?.text === 'string')
      .map((part) => part.text)
      .join('\n');
    text = safeString(choiceContent || anthropicText || geminiText);
    sourcePath = choiceContent
      ? 'response.choices[0].message.content'
      : (anthropicText ? 'response.content[type=text]' : 'response.candidates[0].content.parts[text]');
    const rawUsage = responsePayload.usage || responsePayload.usageMetadata || null;
    if (rawUsage) {
      const inputTokens = Number(rawUsage.prompt_tokens ?? rawUsage.input_tokens ?? rawUsage.promptTokenCount ?? 0);
      const outputTokens = Number(rawUsage.completion_tokens ?? rawUsage.output_tokens ?? rawUsage.candidatesTokenCount ?? 0);
      const totalTokens = Number(rawUsage.total_tokens ?? rawUsage.totalTokenCount ?? (inputTokens + outputTokens));
      usage = {
        inputTokens: Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0,
        outputTokens: Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0,
        totalTokens: Number.isFinite(totalTokens) ? Math.max(0, totalTokens) : 0,
      };
    }
  } else if (cliEvents) {
    const snapshots = new Map();
    const order = [];
    let streamed = '';
    for (const event of cliEvents) {
      if (event?.item?.type === 'agent_message' && typeof event.item.text === 'string') {
        const id = event.item.id || '__default__';
        if (!snapshots.has(id)) order.push(id);
        snapshots.set(id, event.item.text);
      }
      const content = Array.isArray(event?.message?.content) ? event.message.content : [];
      const assistantText = content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n');
      if (assistantText) streamed = assistantText;
      const inner = event?.type === 'stream_event' ? event.event : event;
      if (inner?.type === 'content_block_delta' && inner?.delta?.type === 'text_delta' && typeof inner.delta.text === 'string') {
        streamed += inner.delta.text;
      }
      const rawUsage = event?.usage || (event?.type === 'usage' ? event : null);
      if (rawUsage) {
        const inputTokens = Number(rawUsage.prompt_tokens ?? rawUsage.input_tokens ?? 0);
        const outputTokens = Number(rawUsage.completion_tokens ?? rawUsage.output_tokens ?? 0);
        usage = {
          inputTokens: Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0,
          outputTokens: Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0,
          totalTokens: Math.max(0, (Number.isFinite(inputTokens) ? inputTokens : 0) + (Number.isFinite(outputTokens) ? outputTokens : 0)),
        };
      }
    }
    text = safeString(order.map((id) => snapshots.get(id) || '').filter(Boolean).join('\n') || streamed);
    sourcePath = order.length > 0 ? 'cli.agent_message.text' : 'cli.assistant_text';
  }
  if (!text) return null;
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength > MAX_RESULT_HANDOFF_BYTES) {
    return {
      version: 'provider-result-handoff-v1',
      status: 'rejected-too-large',
      format: 'assistant-text',
      text: '',
      byteLength,
      sha256: crypto.createHash('sha256').update(text).digest('hex'),
      maxBytes: MAX_RESULT_HANDOFF_BYTES,
      authority: 'provider-output-unvalidated',
      reasoningRemoved: true,
      sourcePath,
      providerId: safeString(prepared.providerId),
      model: responseModel || safeString(prepared?.cli?.modelRequested || prepared?.request?.modelRequested || prepared?.lmStudio?.request?.modelRequested || prepared?.llmGateway?.request?.modelRequested || prepared?.geminiApi?.request?.modelRequested),
      ...(usage ? { usage } : {}),
    };
  }
  return {
    version: 'provider-result-handoff-v1',
    status: 'ready',
    format: 'assistant-text',
    text,
    byteLength,
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
    maxBytes: MAX_RESULT_HANDOFF_BYTES,
    authority: 'provider-output-unvalidated',
    reasoningRemoved: true,
    sourcePath,
    providerId: safeString(prepared.providerId),
    model: responseModel || safeString(prepared?.cli?.modelRequested || prepared?.request?.modelRequested || prepared?.lmStudio?.request?.modelRequested || prepared?.llmGateway?.request?.modelRequested || prepared?.geminiApi?.request?.modelRequested),
    ...(usage ? { usage } : {}),
  };
}

function readProviderResultHandoff(providerPackage) {
  const handoff = providerPackage?.resultHandoff;
  if (!handoff || handoff.version !== 'provider-result-handoff-v1' || handoff.status !== 'ready') return null;
  if (handoff.format !== 'assistant-text' || typeof handoff.text !== 'string' || !handoff.text.trim()) return null;
  const byteLength = Buffer.byteLength(handoff.text, 'utf8');
  const digest = crypto.createHash('sha256').update(handoff.text).digest('hex');
  if (byteLength !== handoff.byteLength || digest !== handoff.sha256) {
    const error = new Error('Provider result handoff failed byte-length or SHA-256 verification.');
    error.code = 'PROVIDER_RESULT_HANDOFF_INTEGRITY_FAILED';
    throw error;
  }
  return handoff;
}

const MANIFEST_OMITTED_PATHS = Object.freeze([
  'request.bodyText',
  'request.bodyJson',
  'response.bodyText',
  'response.chunks',
  'error.rawBody',
  'error.object',
  'cli.stdin.text',
  'cli.stdout.text',
  'cli.stdout.lines',
  'cli.stdout.malformedLines',
  'cli.stdout.finalBuffer',
  'cli.stdout.chunks',
  'cli.stderr.text',
  'cli.stderr.chunks',
  'lmStudio.request.bodyText',
  'lmStudio.request.bodyJson',
  'lmStudio.response.bodyText',
  'lmStudio.stream.parsedChunks',
  'lmStudio.stream.frames',
  'lmStudio.stream.finalBuffer',
  'lmStudio.stream.fullResponse',
  'lmStudio.error.rawBody',
  'llmGateway.request.bodyText',
  'llmGateway.request.bodyJson',
  'llmGateway.response.bodyText',
  'llmGateway.stream.parsedChunks',
  'llmGateway.error.rawBody',
  'geminiApi.request.bodyText',
  'geminiApi.request.bodyJson',
  'geminiApi.response.bodyText',
  'geminiApi.stream.parsedChunks',
  'geminiApi.error.rawBody',
]);

function applyProviderCapturePolicy(envelope, context = {}) {
  const prepared = clone(envelope || {});
  const policy = resolveCapturePolicy(context, prepared);
  prepared.capturePolicy = policy;

  // Extract first, then omit raw traffic for manifest mode. This preserves the
  // full provider reasoning signal in a purpose-labelled field even when an
  // ordinary product call does not retain unrestricted prompt/response bodies.
  const reasoningCapture = buildReasoningEvidence(prepared, context);
  prepared.reasoningEvidence = reasoningCapture.evidence;
  prepared.reasoningEvidenceSummary = {
    ...reasoningCapture.summary,
    redactionAppliedBeforeExtraction: prepared.redaction?.applied === true,
    inlineLimitBytes: 512 * 1024,
  };
  prepared.resultHandoff = buildResultHandoff(prepared);

  if (policy.mode === CAPTURE_MODES.MANIFEST) {
    stripInlineReasoning(prepared);
    for (const path of MANIFEST_OMITTED_PATHS) clearPath(prepared, path);
    clearPath(prepared, 'response.parsedJson');
    clearPath(prepared, 'lmStudio.response.parsedJson');
    clearPath(prepared, 'llmGateway.response.parsedJson');
    clearPath(prepared, 'geminiApi.response.parsedJson');
    clearPath(prepared, 'cli.stdout.jsonlEvents');
    prepared.storage = prepared.storage || {};
    prepared.storage.inline = true;
    prepared.storage.externalPayloads = [];
    prepared.storage.notes = [
      ...(Array.isArray(prepared.storage.notes) ? prepared.storage.notes : []),
      'Raw provider request/response bodies omitted by manifest capture policy; hashes, usage, timing, errors, provenance, and labelled reasoning evidence retained.',
    ];
  }

  return prepared;
}

module.exports = {
  CAPTURE_MODES,
  CAPTURE_POLICY_VERSION,
  ALLOWED_RICH_CAPTURE_PURPOSES,
  MANIFEST_OMITTED_PATHS,
  MAX_RESULT_HANDOFF_BYTES,
  applyProviderCapturePolicy,
  resolveCapturePolicy,
  readProviderResultHandoff,
};
