'use strict';

// GET /api/provider-packages/:id/reasoning
//
// Returns bounded, ordered, diagnostic-only provider reasoning evidence. The
// legacy `reasoning: [{text}]` response remains for compatibility; `evidence`
// and `provenance` are the authoritative identity-aware surfaces.

const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');

const ProviderCallPackage = require('../models/ProviderCallPackage');
const { loadProviderPayloadText } = require('../services/provider-payload-loader');
const {
  buildReasoningEvidence,
  resolveReasoningIdentity,
} = require('../services/provider-reasoning-evidence');

const router = express.Router();

// Stored evidence is already bounded more tightly. This independent display
// cap protects the API when reading historical or externally stored packages.
const MAX_TOTAL_REASONING_CHARS = 400_000;

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function idString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
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

function hashLegacyEvidence(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

async function loadExternalArray(ref) {
  if (!ref) return [];
  const loaded = await loadProviderPayloadText(ref, { maxBytes: 1024 * 1024 });
  const parsed = JSON.parse(loaded.text);
  return Array.isArray(parsed) ? parsed : [];
}

async function loadJsonlEvents(pkg) {
  const stdout = pkg?.cli?.stdout;
  if (!stdout) return [];
  if (Array.isArray(stdout.jsonlEvents) && stdout.jsonlEvents.length > 0) return stdout.jsonlEvents;
  const ref = typeof stdout?.jsonlEventsPayloadRef?.ref === 'string'
    ? stdout.jsonlEventsPayloadRef
    : null;
  return loadExternalArray(ref);
}

function normalizeEvidenceEntries(entries, fallback = {}) {
  const ordered = (Array.isArray(entries) ? entries : [])
    .map((rawEntry, originalIndex) => ({ rawEntry, originalIndex }))
    .sort((left, right) => {
      const leftSequence = optionalIndex(left.rawEntry?.sequence) ?? left.originalIndex;
      const rightSequence = optionalIndex(right.rawEntry?.sequence) ?? right.originalIndex;
      return leftSequence - rightSequence || left.originalIndex - right.originalIndex;
    });

  const evidence = [];
  let total = 0;
  let truncated = false;
  for (const { rawEntry, originalIndex } of ordered) {
    if (total >= MAX_TOTAL_REASONING_CHARS) {
      truncated = true;
      break;
    }
    const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry : { text: rawEntry };
    const text = typeof entry.text === 'string' ? entry.text.trim() : '';
    if (!text) continue;
    const remaining = MAX_TOTAL_REASONING_CHARS - total;
    const displayText = text.length > remaining ? text.slice(0, remaining) : text;
    const displayTruncated = displayText.length < text.length;
    if (displayTruncated) truncated = true;
    const sequence = optionalIndex(entry.sequence) ?? originalIndex;
    const packageId = idString(entry.packageId || fallback.packageId);
    const provider = safeString(entry.provider || entry.providerId || fallback.provider);
    const actualModel = safeString(entry.actualModel || fallback.actualModel);
    const requestedModel = safeString(entry.requestedModel || fallback.requestedModel);
    const sourcePath = safeString(entry.sourcePath || fallback.sourcePath) || 'unknown';
    const storedComplete = entry.complete === true;
    const storedTruncated = entry.truncated === true;
    const evidenceId = safeString(entry.evidenceId) || hashLegacyEvidence({
      packageId,
      sequence,
      sourcePath,
      text,
    });
    const transportEventHash = safeString(entry.transportEventHash);
    evidence.push({
      version: safeString(entry.version) || 'provider-reasoning-evidence-v1-legacy',
      evidenceId,
      packageId,
      runId: idString(entry.runId || fallback.runId),
      requestId: idString(entry.requestId || fallback.requestId),
      attemptId: idString(entry.attemptId || fallback.attemptId),
      attemptIndex: optionalIndex(entry.attemptIndex ?? fallback.attemptIndex),
      toolLoopRound: optionalIndex(entry.toolLoopRound ?? fallback.toolLoopRound),
      modelRound: optionalIndex(entry.modelRound ?? fallback.modelRound),
      provider,
      providerId: provider,
      actualModel,
      requestedModel,
      model: safeString(entry.model) || actualModel || requestedModel,
      promptId: safeString(entry.promptId || fallback.promptId),
      promptHash: safeString(entry.promptHash || fallback.promptHash),
      promptHashSource: safeString(entry.promptHashSource || fallback.promptHashSource) || 'legacy',
      promptVersion: safeString(entry.promptVersion || fallback.promptVersion),
      sequence,
      transportSequence: optionalIndex(entry.transportSequence),
      transportEventId: idString(entry.transportEventId),
      transportEventHash,
      sourcePath,
      kind: safeString(entry.kind) || 'provider-reasoning',
      authority: 'diagnostic-only',
      text: displayText,
      originalChars: Number.isFinite(Number(entry.originalChars))
        ? Number(entry.originalChars)
        : text.length,
      retainedChars: displayText.length,
      complete: storedComplete && !storedTruncated && !displayTruncated,
      truncated: storedTruncated || displayTruncated,
      storedComplete,
      storedTruncated,
      displayTruncated,
      provenanceComplete: Boolean(packageId && provider && sourcePath && evidenceId && transportEventHash),
    });
    total += displayText.length;
    if (displayTruncated) break;
  }
  return { evidence, truncated, totalChars: total };
}

function sendPayloadReadError(res, error) {
  const statusByCode = {
    PROVIDER_PAYLOAD_MISSING: 410,
    PROVIDER_PAYLOAD_TOO_LARGE: 413,
    PROVIDER_PAYLOAD_INTEGRITY_FAILED: 422,
    PROVIDER_PAYLOAD_REF_INVALID: 400,
  };
  return res.status(statusByCode[error?.code] || 500).json({
    ok: false,
    code: error?.code || 'PROVIDER_PAYLOAD_READ_FAILED',
    payloadStatus: error?.payloadStatus || 'read-failed',
    error: error?.message || 'Stored reasoning evidence could not be verified.',
  });
}

router.get('/:id/reasoning', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_PACKAGE_ID',
      error: 'Invalid provider package ID',
    });
  }

  const pkg = await ProviderCallPackage.findById(req.params.id)
    .select([
      'providerId',
      'metadata',
      'capturePolicy',
      'reasoningEvidence',
      'reasoningEvidencePayloadRef',
      'reasoningEvidenceSummary',
      'resultHandoff.model',
      'cli.modelRequested',
      'cli.stdout.jsonlEvents',
      'cli.stdout.jsonlEventsPayloadRef',
      'request.modelRequested',
      'response.parsedJson',
      'lmStudio.request.modelRequested',
      'lmStudio.response.parsedJson',
      'llmGateway.request.modelRequested',
      'llmGateway.response.parsedJson',
      'geminiApi.request.modelRequested',
      'geminiApi.response.parsedJson',
    ].join(' '))
    .lean();
  if (!pkg) {
    return res.status(404).json({
      ok: false,
      code: 'NOT_FOUND',
      error: 'Provider package not found',
    });
  }

  const packageId = String(pkg._id);
  let labelledEvidence = Array.isArray(pkg.reasoningEvidence) ? pkg.reasoningEvidence : [];
  if (labelledEvidence.length === 0 && pkg.reasoningEvidencePayloadRef?.ref) {
    try {
      labelledEvidence = await loadExternalArray(pkg.reasoningEvidencePayloadRef);
    } catch (error) {
      return sendPayloadReadError(res, error);
    }
  }

  let legacyCapture = null;
  if (labelledEvidence.length === 0) {
    let events;
    try {
      events = await loadJsonlEvents(pkg);
    } catch (error) {
      return sendPayloadReadError(res, error);
    }
    const legacyEnvelope = {
      ...pkg,
      _id: packageId,
      cli: pkg.cli ? {
        ...pkg.cli,
        stdout: { ...(pkg.cli.stdout || {}), jsonlEvents: events },
      } : null,
    };
    legacyCapture = buildReasoningEvidence(legacyEnvelope, { packageId });
    labelledEvidence = legacyCapture.evidence;
  }

  const identity = legacyCapture?.identity || resolveReasoningIdentity(pkg, { packageId });
  const responseEvidence = normalizeEvidenceEntries(labelledEvidence, {
    ...identity,
    packageId,
    sourcePath: pkg.reasoningEvidencePayloadRef?.ref
      ? 'reasoningEvidencePayloadRef'
      : 'reasoningEvidence',
  });
  const firstEvidence = responseEvidence.evidence[0] || null;
  const actualModel = safeString(firstEvidence?.actualModel || identity.actualModel);
  const requestedModel = safeString(firstEvidence?.requestedModel || identity.requestedModel);
  const evidenceSummary = pkg.reasoningEvidenceSummary || legacyCapture?.summary || null;
  const truncated = responseEvidence.truncated;

  res.json({
    ok: true,
    provider: pkg.providerId || '',
    model: actualModel || requestedModel,
    actualModel,
    requestedModel,
    // Compatibility surface retained for existing clients.
    reasoning: responseEvidence.evidence.map((entry) => ({ text: entry.text })),
    truncated,
    evidence: responseEvidence.evidence,
    evidenceSummary,
    provenance: {
      packageId,
      runId: firstEvidence?.runId || identity.runId || '',
      requestId: firstEvidence?.requestId || identity.requestId || '',
      attemptId: firstEvidence?.attemptId || identity.attemptId || '',
      attemptIndex: firstEvidence?.attemptIndex ?? identity.attemptIndex ?? null,
      toolLoopRound: firstEvidence?.toolLoopRound ?? identity.toolLoopRound ?? null,
      modelRound: firstEvidence?.modelRound ?? identity.modelRound ?? null,
      provider: pkg.providerId || identity.provider || '',
      actualModel,
      requestedModel,
      promptId: firstEvidence?.promptId || identity.promptId || '',
      promptHash: firstEvidence?.promptHash || identity.promptHash || '',
      promptHashSource: firstEvidence?.promptHashSource || identity.promptHashSource || 'unavailable',
      promptVersion: firstEvidence?.promptVersion || identity.promptVersion || '',
      authority: 'diagnostic-only',
    },
    capturePolicy: pkg.capturePolicy || null,
    displayTruncation: {
      applied: truncated,
      maxChars: MAX_TOTAL_REASONING_CHARS,
      storedEvidenceComplete: evidenceSummary?.complete !== false,
      storedEvidenceTruncated: evidenceSummary?.truncated === true,
    },
  });
});

module.exports = router;
