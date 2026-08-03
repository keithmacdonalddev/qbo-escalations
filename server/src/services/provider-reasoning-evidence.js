'use strict';

const crypto = require('crypto');

const REASONING_EVIDENCE_VERSION = 'provider-reasoning-evidence-v2';
const REASONING_EVIDENCE_SUMMARY_VERSION = 'provider-reasoning-evidence-summary-v2';
const MAX_REASONING_ENTRY_CHARS = 64 * 1024;
const MAX_REASONING_TOTAL_CHARS = 256 * 1024;
const MAX_REASONING_ENTRIES = 64;

// Provider reasoning is diagnostic evidence about how a model arrived at an
// answer. It is useful for provider/model comparison and prompt-efficiency
// evaluation, but it is never authoritative case truth and is never fed back
// into product prompts.

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function idString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value?.toString === 'function') {
    const text = value.toString();
    return text === '[object Object]' ? '' : safeString(text);
  }
  return '';
}

function optionalIndex(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function stableSerialize(value) {
  if (value === null || value === undefined) return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableSerialize(value[key])}`
  )).join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function hashTransportEvent(event) {
  return sha256(stableSerialize(event));
}

function summaryEntryText(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry.text === 'string') return entry.text;
  return '';
}

function getParsedResponse(envelope) {
  if (envelope?.response?.parsedJson) {
    return { value: envelope.response.parsedJson, sourceRoot: 'response.parsedJson' };
  }
  if (envelope?.lmStudio?.response?.parsedJson) {
    return { value: envelope.lmStudio.response.parsedJson, sourceRoot: 'lmStudio.response.parsedJson' };
  }
  if (envelope?.llmGateway?.response?.parsedJson) {
    return { value: envelope.llmGateway.response.parsedJson, sourceRoot: 'llmGateway.response.parsedJson' };
  }
  if (envelope?.geminiApi?.response?.parsedJson) {
    return { value: envelope.geminiApi.response.parsedJson, sourceRoot: 'geminiApi.response.parsedJson' };
  }
  return { value: null, sourceRoot: 'response.parsedJson' };
}

function getRequestedModel(envelope) {
  return safeString(
    envelope?.cli?.modelRequested
      || envelope?.request?.modelRequested
      || envelope?.lmStudio?.request?.modelRequested
      || envelope?.llmGateway?.request?.modelRequested
      || envelope?.geminiApi?.request?.modelRequested
  );
}

function getCliActualModel(events) {
  for (const event of (Array.isArray(events) ? events : []).slice().reverse()) {
    const model = safeString(
      event?.model
        || event?.model_id
        || event?.modelId
        || event?.response?.model
        || event?.message?.model
    );
    if (model) return model;
  }
  return '';
}

function resolveEvidenceMetadata(envelope = {}, context = {}) {
  return {
    ...(envelope?.metadata && typeof envelope.metadata === 'object' ? envelope.metadata : {}),
    ...(context?.metadata && typeof context.metadata === 'object' ? context.metadata : {}),
  };
}

function firstId(...values) {
  for (const value of values) {
    const normalized = idString(value);
    if (normalized) return normalized;
  }
  return '';
}

function getPromptMaterial(envelope = {}) {
  const values = [
    envelope?.cli?.stdin?.text,
    envelope?.request?.bodyText,
    envelope?.lmStudio?.request?.bodyText,
    envelope?.llmGateway?.request?.bodyText,
    envelope?.geminiApi?.request?.bodyText,
  ];
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  const jsonValues = [
    envelope?.request?.bodyJson,
    envelope?.lmStudio?.request?.bodyJson,
    envelope?.llmGateway?.request?.bodyJson,
    envelope?.geminiApi?.request?.bodyJson,
  ];
  for (const value of jsonValues) {
    if (value && typeof value === 'object') return stableSerialize(value);
  }
  return '';
}

function resolveProviderPromptHash(envelope = {}, context = {}) {
  const metadata = resolveEvidenceMetadata(envelope, context);
  const explicit = safeString(
    context?.evidenceIdentity?.promptHash
      || context?.promptHash
      || context?.promptSha256
      || metadata.promptHash
      || metadata.promptSha256
      || metadata?.promptManifest?.promptHash
      || metadata?.promptManifest?.sha256
  );
  if (explicit) {
    return {
      promptHash: explicit,
      promptHashSource: safeString(context?.evidenceIdentity?.promptHashSource) || 'caller',
    };
  }
  const promptMaterial = getPromptMaterial(envelope);
  return promptMaterial
    ? { promptHash: sha256(promptMaterial), promptHashSource: 'provider-request' }
    : { promptHash: '', promptHashSource: 'unavailable' };
}

function resolveReasoningIdentity(envelope = {}, context = {}) {
  const metadata = resolveEvidenceMetadata(envelope, context);
  const parsedResponse = getParsedResponse(envelope).value;
  const requestedModel = getRequestedModel(envelope);
  const actualModel = safeString(
    parsedResponse?.model
      || parsedResponse?.modelVersion
      || envelope?.response?.model
      || envelope?.lmStudio?.response?.model
      || envelope?.llmGateway?.response?.model
      || envelope?.geminiApi?.response?.modelVersion
      || metadata.actualModel
      || metadata.modelUsed
      || metadata.responseModel
      || getCliActualModel(envelope?.cli?.stdout?.jsonlEvents)
  );
  const prompt = resolveProviderPromptHash(envelope, context);
  return {
    packageId: firstId(
      context?.evidenceIdentity?.packageId,
      context?.packageId,
      context?.providerPackageId,
      envelope?._id
    ),
    runId: firstId(
      context?.evidenceIdentity?.runId,
      context?.runId,
      metadata.agentRunId,
      metadata.runId,
      metadata.triageRunId,
      metadata.testRunId
    ),
    requestId: firstId(
      context?.evidenceIdentity?.requestId,
      context?.requestId,
      metadata.requestId,
      metadata.runtimeOperationId,
      metadata.operationId
    ),
    attemptId: firstId(
      context?.evidenceIdentity?.attemptId,
      context?.attemptId,
      metadata.providerAttemptId,
      metadata.attemptId
    ),
    attemptIndex: optionalIndex(
      context?.evidenceIdentity?.attemptIndex
        ?? context?.attemptIndex
        ?? metadata.attemptIndex
    ),
    toolLoopRound: optionalIndex(
      context?.evidenceIdentity?.toolLoopRound
        ?? context?.toolLoopRound
        ?? metadata.toolLoopRound
        ?? metadata.toolRound
    ),
    modelRound: optionalIndex(
      context?.evidenceIdentity?.modelRound
        ?? context?.modelRound
        ?? metadata.modelRound
    ),
    provider: safeString(envelope.providerId || context.providerId),
    actualModel,
    requestedModel,
    promptId: safeString(metadata.promptId || context.promptId),
    promptHash: prompt.promptHash,
    promptHashSource: prompt.promptHashSource,
    promptVersion: safeString(metadata.promptVersion || context.promptVersion),
  };
}

function stableTransportEventId(event) {
  return firstId(
    event?.event_id,
    event?.eventId,
    event?.id,
    event?.item?.id,
    event?.event?.id,
    event?.message?.id
  );
}

function pushCandidate(target, value, details = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return;
  target.push({
    kind: details.kind || 'provider-reasoning',
    sourcePath: details.sourcePath || 'unknown',
    eventFieldPath: details.eventFieldPath || details.sourcePath || 'unknown',
    transportSequence: optionalIndex(details.transportSequence),
    transportEventId: idString(details.transportEventId),
    transportEventHash: safeString(details.transportEventHash),
    complete: details.complete === true,
    text,
  });
}

function extractCliReasoningCandidates(events) {
  const candidates = [];
  for (const [eventIndex, event] of (Array.isArray(events) ? events : []).entries()) {
    if (!event || typeof event !== 'object') continue;
    const eventHash = hashTransportEvent(event);
    const eventId = stableTransportEventId(event);
    const eventType = safeString(event.type).toLowerCase();
    const item = event.item && typeof event.item === 'object' ? event.item : null;

    if (item && (item.type === 'reasoning' || item.type === 'agent_reasoning')) {
      const text = typeof item.text === 'string'
        ? item.text
        : Array.isArray(item.summary)
          ? item.summary.map(summaryEntryText).filter(Boolean).join('\n')
          : '';
      pushCandidate(candidates, text, {
        sourcePath: `cli.stdout.jsonlEvents[${eventIndex}].item.${typeof item.text === 'string' ? 'text' : 'summary'}`,
        eventFieldPath: `item.${typeof item.text === 'string' ? 'text' : 'summary'}`,
        transportSequence: eventIndex,
        transportEventId: eventId,
        transportEventHash: eventHash,
        complete: eventType.includes('completed') || item.status === 'completed',
      });
    }

    if (eventType.includes('reasoning')) {
      const flatText = typeof event.text === 'string'
        ? event.text
        : (typeof event.delta === 'string'
            ? event.delta
            : (typeof event?.delta?.text === 'string' ? event.delta.text : ''));
      const flatField = typeof event.text === 'string'
        ? 'text'
        : (typeof event.delta === 'string' ? 'delta' : 'delta.text');
      pushCandidate(candidates, flatText, {
        sourcePath: `cli.stdout.jsonlEvents[${eventIndex}].${flatField}`,
        eventFieldPath: flatField,
        transportSequence: eventIndex,
        transportEventId: eventId,
        transportEventHash: eventHash,
        complete: eventType.includes('completed') || eventType.includes('done'),
      });
    }

    const content = event.message && Array.isArray(event.message.content)
      ? event.message.content
      : [];
    for (const [blockIndex, block] of content.entries()) {
      if (block?.type !== 'thinking') continue;
      pushCandidate(candidates, block.thinking, {
        sourcePath: `cli.stdout.jsonlEvents[${eventIndex}].message.content[${blockIndex}].thinking`,
        eventFieldPath: `message.content[${blockIndex}].thinking`,
        transportSequence: eventIndex,
        transportEventId: eventId,
        transportEventHash: eventHash,
        complete: Boolean(event.message?.stop_reason || event.message?.stopReason),
      });
    }

    const inner = eventType === 'stream_event' && event.event && typeof event.event === 'object'
      ? event.event
      : event;
    if (inner?.type === 'content_block_delta'
        && inner?.delta?.type === 'thinking_delta'
        && typeof inner.delta.thinking === 'string') {
      pushCandidate(candidates, inner.delta.thinking, {
        sourcePath: `cli.stdout.jsonlEvents[${eventIndex}]${inner === event ? '' : '.event'}.delta.thinking`,
        eventFieldPath: `${inner === event ? '' : 'event.'}delta.thinking`,
        transportSequence: eventIndex,
        transportEventId: eventId,
        transportEventHash: eventHash,
        complete: false,
      });
    }
  }
  return candidates;
}

function extractResponseReasoningCandidates(parsed, sourceRoot = 'response.parsedJson') {
  const candidates = [];
  if (!parsed || typeof parsed !== 'object') return candidates;

  for (const [index, block] of (Array.isArray(parsed.content) ? parsed.content : []).entries()) {
    if (!block || typeof block !== 'object') continue;
    const eventId = `response-content:${index}`;
    const eventHash = hashTransportEvent(block);
    if (block.type === 'thinking') {
      pushCandidate(candidates, block.thinking, {
        sourcePath: `${sourceRoot}.content[${index}].thinking`,
        eventFieldPath: `content[${index}].thinking`,
        transportSequence: index,
        transportEventId: eventId,
        transportEventHash: eventHash,
        complete: true,
      });
    }
    if (block.type === 'reasoning') {
      pushCandidate(candidates, block.text || block.reasoning, {
        sourcePath: `${sourceRoot}.content[${index}]`,
        eventFieldPath: `content[${index}]`,
        transportSequence: index,
        transportEventId: eventId,
        transportEventHash: eventHash,
        complete: true,
      });
    }
  }

  for (const [choiceIndex, choice] of (Array.isArray(parsed.choices) ? parsed.choices : []).entries()) {
    const message = choice?.message || choice?.delta || {};
    const values = [
      ['message.reasoning_content', message.reasoning_content],
      ['message.reasoning', message.reasoning],
      ['reasoning_content', choice?.reasoning_content],
    ];
    for (const [field, value] of values) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const event = field.startsWith('message.') ? message : choice;
      pushCandidate(candidates, value, {
        sourcePath: `${sourceRoot}.choices[${choiceIndex}].${field}`,
        eventFieldPath: `choices[${choiceIndex}].${field}`,
        transportSequence: choiceIndex,
        transportEventId: firstId(event?.id, `response-choice:${choiceIndex}`),
        transportEventHash: hashTransportEvent(event),
        complete: choice?.finish_reason != null || choice?.finishReason != null || Boolean(choice?.message),
      });
    }
  }

  for (const [candidateIndex, candidate] of (Array.isArray(parsed.candidates) ? parsed.candidates : []).entries()) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const [partIndex, part] of parts.entries()) {
      if (part?.thought !== true) continue;
      pushCandidate(candidates, part.text, {
        sourcePath: `${sourceRoot}.candidates[${candidateIndex}].content.parts[${partIndex}].text`,
        eventFieldPath: `candidates[${candidateIndex}].content.parts[${partIndex}].text`,
        transportSequence: candidateIndex,
        transportEventId: `response-candidate:${candidateIndex}:part:${partIndex}`,
        transportEventHash: hashTransportEvent(part),
        complete: true,
      });
    }
  }

  for (const [field, value] of [
    ['reasoning_content', parsed.reasoning_content],
    ['reasoning', parsed.reasoning],
  ]) {
    pushCandidate(candidates, value, {
      sourcePath: `${sourceRoot}.${field}`,
      eventFieldPath: field,
      transportSequence: 0,
      transportEventId: firstId(parsed.id, 'response-root'),
      transportEventHash: hashTransportEvent(parsed),
      complete: true,
    });
  }
  return candidates;
}

function dedupeExactTransportEvents(candidates) {
  const evidence = [];
  const seen = new Set();
  let exactDuplicatesRemoved = 0;
  for (const candidate of candidates) {
    // Without a stable provider event id, identical text may be a legitimate
    // repeated delta. Preserve it. Hash-only or substring dedupe is forbidden.
    const key = candidate.transportEventId && candidate.transportEventHash
      ? `${candidate.transportEventId}\u0000${candidate.transportEventHash}\u0000${candidate.eventFieldPath}`
      : '';
    if (key && seen.has(key)) {
      exactDuplicatesRemoved += 1;
      continue;
    }
    if (key) seen.add(key);
    evidence.push(candidate);
  }
  return { candidates: evidence, exactDuplicatesRemoved };
}

function buildReasoningEvidence(envelope = {}, context = {}) {
  const identity = resolveReasoningIdentity(envelope, context);
  const parsedResponse = getParsedResponse(envelope);
  const rawCandidates = [
    ...extractCliReasoningCandidates(envelope?.cli?.stdout?.jsonlEvents),
    ...extractResponseReasoningCandidates(parsedResponse.value, parsedResponse.sourceRoot),
  ];
  const deduped = dedupeExactTransportEvents(rawCandidates);
  const evidence = [];
  let remaining = MAX_REASONING_TOTAL_CHARS;
  let entryLimitReached = false;
  let totalCharLimitReached = false;
  let entryCharLimitReached = false;

  for (const candidate of deduped.candidates) {
    if (evidence.length >= MAX_REASONING_ENTRIES) {
      entryLimitReached = true;
      break;
    }
    if (remaining <= 0) {
      totalCharLimitReached = true;
      break;
    }
    const originalText = candidate.text;
    const retainedChars = Math.min(originalText.length, MAX_REASONING_ENTRY_CHARS, remaining);
    const text = originalText.slice(0, retainedChars);
    const truncated = retainedChars < originalText.length;
    if (originalText.length > MAX_REASONING_ENTRY_CHARS) entryCharLimitReached = true;
    if (originalText.length > remaining) totalCharLimitReached = true;
    const sequence = evidence.length;
    const evidenceId = sha256(stableSerialize({
      version: REASONING_EVIDENCE_VERSION,
      packageId: identity.packageId,
      sequence,
      sourcePath: candidate.sourcePath,
      transportEventId: candidate.transportEventId,
      transportEventHash: candidate.transportEventHash,
    }));
    evidence.push({
      version: REASONING_EVIDENCE_VERSION,
      evidenceId,
      packageId: identity.packageId,
      runId: identity.runId,
      requestId: identity.requestId,
      attemptId: identity.attemptId,
      attemptIndex: identity.attemptIndex,
      toolLoopRound: identity.toolLoopRound,
      modelRound: identity.modelRound,
      provider: identity.provider,
      providerId: identity.provider,
      actualModel: identity.actualModel,
      requestedModel: identity.requestedModel,
      model: identity.actualModel || identity.requestedModel,
      promptId: identity.promptId,
      promptHash: identity.promptHash,
      promptHashSource: identity.promptHashSource,
      promptVersion: identity.promptVersion,
      sequence,
      transportSequence: candidate.transportSequence,
      transportEventId: candidate.transportEventId,
      transportEventHash: candidate.transportEventHash,
      sourcePath: candidate.sourcePath,
      kind: candidate.kind,
      authority: 'diagnostic-only',
      text,
      originalChars: originalText.length,
      retainedChars,
      complete: candidate.complete === true && !truncated,
      truncated,
    });
    remaining -= retainedChars;
  }

  if (evidence.length < deduped.candidates.length && !entryLimitReached) totalCharLimitReached = true;
  const truncated = entryLimitReached || totalCharLimitReached || entryCharLimitReached
    || evidence.some((entry) => entry.truncated);
  const orderedDigestInput = evidence.map((entry) => ({
    evidenceId: entry.evidenceId,
    sequence: entry.sequence,
    text: entry.text,
  }));
  return {
    evidence,
    summary: {
      version: REASONING_EVIDENCE_SUMMARY_VERSION,
      entryCount: evidence.length,
      observedEntryCount: deduped.candidates.length,
      rawEntryCount: rawCandidates.length,
      exactDuplicatesRemoved: deduped.exactDuplicatesRemoved,
      deduplication: 'stable-transport-event-id-and-hash-only',
      totalChars: evidence.reduce((total, entry) => total + entry.retainedChars, 0),
      totalOriginalChars: deduped.candidates.reduce((total, entry) => total + entry.text.length, 0),
      sha256: sha256(evidence.map((entry) => entry.text).join('\n')),
      orderedEvidenceSha256: sha256(stableSerialize(orderedDigestInput)),
      authority: 'diagnostic-only',
      complete: !truncated,
      allBlocksComplete: evidence.every((entry) => entry.complete === true),
      truncated,
      entryLimitReached,
      totalCharLimitReached,
      entryCharLimitReached,
      maxEntries: MAX_REASONING_ENTRIES,
      maxEntryChars: MAX_REASONING_ENTRY_CHARS,
      maxTotalChars: MAX_REASONING_TOTAL_CHARS,
    },
    identity,
  };
}

function extractCliReasoningBlocks(events) {
  return extractCliReasoningCandidates(events).map((entry) => entry.text);
}

function extractResponseReasoningBlocks(parsed) {
  return extractResponseReasoningCandidates(parsed).map((entry) => ({
    kind: entry.kind,
    sourcePath: entry.sourcePath,
    text: entry.text,
  }));
}

function extractProviderReasoningEvidence(envelope = {}, context = {}) {
  return buildReasoningEvidence(envelope, context).evidence;
}

module.exports = {
  REASONING_EVIDENCE_VERSION,
  REASONING_EVIDENCE_SUMMARY_VERSION,
  MAX_REASONING_ENTRIES,
  MAX_REASONING_ENTRY_CHARS,
  MAX_REASONING_TOTAL_CHARS,
  buildReasoningEvidence,
  extractCliReasoningBlocks,
  extractProviderReasoningEvidence,
  extractResponseReasoningBlocks,
  resolveProviderPromptHash,
  resolveReasoningIdentity,
};
