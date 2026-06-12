'use strict';

// Provider call package reasoning endpoint.
//
// GET /api/provider-packages/:id/reasoning
//
// Surfaces the model's internal reasoning ("thinking") captured for a
// provider call. ProviderCallPackage documents persist every CLI stdout
// JSONL event in cli.stdout.jsonlEvents (or externalized to disk when large
// — see provider-call-package-payload-store.js). This route replays those
// stored events and extracts only the reasoning text, so the client never
// receives raw forensic event dumps.
//
// Supported shapes:
// - Codex CLI: events with item.type 'reasoning' / 'agent_reasoning'
//   (cumulative snapshots per item id), plus flat event types containing
//   'reasoning' with text/delta payloads. Mirrors
//   extractThinkingFromEventLine() in services/codex.js.
// - Claude CLI: assistant message snapshots with content blocks of
//   type 'thinking', plus stream_event-wrapped content_block_delta events
//   with delta.type 'thinking_delta'. Mirrors extractThinking() in
//   services/claude.js.
// - Direct Anthropic API (HTTP harness): thinking blocks stored verbatim in
//   response.parsedJson.content (type 'thinking') when the request opted into
//   readable summaries via thinking: {type:'adaptive', display:'summarized'}.
// - Other providers (no cli.stdout, no Anthropic-shaped response): honest
//   empty result — { ok: true, reasoning: [] }.

const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');

const ProviderCallPackage = require('../models/ProviderCallPackage');
const { getDefaultPayloadRoot } = require('../services/provider-call-package-payload-store');

const router = express.Router();

// Reasoning can run long for high-effort runs. Keep the full text within a
// sane response budget instead of dumping unbounded payloads to the client.
const MAX_TOTAL_REASONING_CHARS = 400_000;

function summaryEntryText(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry.text === 'string') return entry.text;
  return '';
}

/**
 * Extract ordered reasoning text blocks from stored CLI stdout JSONL events.
 * Returns an array of strings (one per reasoning block).
 */
function extractReasoningBlocks(events) {
  // Codex: per-item cumulative snapshots (latest snapshot wins; non-prefix
  // snapshots are appended so nothing captured is silently dropped).
  const codexSnapshots = new Map();
  const codexOrder = [];
  // Codex: flat streaming reasoning deltas with no item id.
  let codexStreamText = '';
  // Claude: full thinking blocks from assistant message snapshots.
  const claudeFullBlocks = [];
  // Claude: thinking_delta accumulation per content-block index (fallback).
  const claudeDeltas = new Map();

  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== 'object') continue;

    // --- Codex CLI: reasoning items -------------------------------------
    const item = event.item && typeof event.item === 'object' ? event.item : null;
    if (item && (item.type === 'reasoning' || item.type === 'agent_reasoning')) {
      const nextText = typeof item.text === 'string'
        ? item.text
        : Array.isArray(item.summary)
          ? item.summary.map(summaryEntryText).filter(Boolean).join('\n')
          : '';
      if (nextText) {
        const key = item.id || '__default__';
        if (!codexSnapshots.has(key)) codexOrder.push(key);
        const prevText = codexSnapshots.get(key) || '';
        codexSnapshots.set(
          key,
          nextText.startsWith(prevText) || !prevText ? nextText : `${prevText}\n${nextText}`
        );
      }
      continue;
    }

    const eventType = typeof event.type === 'string' ? event.type : '';

    // --- Codex CLI: flat reasoning text/delta events ---------------------
    if (eventType.includes('reasoning')) {
      if (typeof event.text === 'string') {
        codexStreamText += event.text;
        continue;
      }
      if (typeof event.delta === 'string') {
        codexStreamText += event.delta;
        continue;
      }
      if (event.delta && typeof event.delta.text === 'string') {
        codexStreamText += event.delta.text;
        continue;
      }
    }

    // --- Claude CLI: full assistant snapshots ----------------------------
    const content = event.message && Array.isArray(event.message.content)
      ? event.message.content
      : null;
    if (content) {
      for (const block of content) {
        if (block && block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
          claudeFullBlocks.push(block.thinking.trim());
        }
      }
    }

    // --- Claude CLI: streaming thinking deltas ----------------------------
    const inner = (eventType === 'stream_event' && event.event && typeof event.event === 'object')
      ? event.event
      : event;
    if (inner
        && inner.type === 'content_block_delta'
        && inner.delta
        && inner.delta.type === 'thinking_delta'
        && typeof inner.delta.thinking === 'string') {
      const index = Number.isFinite(inner.index) ? inner.index : 0;
      claudeDeltas.set(index, (claudeDeltas.get(index) || '') + inner.delta.thinking);
    }
  }

  const blocks = [];
  for (const key of codexOrder) {
    const text = (codexSnapshots.get(key) || '').trim();
    if (text) blocks.push(text);
  }

  // Claude: prefer complete assistant-snapshot blocks. Partial+final snapshots
  // can repeat the same block — keep only the longest of any prefix family.
  if (claudeFullBlocks.length > 0) {
    const deduped = [];
    for (const text of claudeFullBlocks) {
      const familyIndex = deduped.findIndex(
        (existing) => existing.startsWith(text) || text.startsWith(existing)
      );
      if (familyIndex >= 0) {
        if (text.length > deduped[familyIndex].length) deduped[familyIndex] = text;
      } else {
        deduped.push(text);
      }
    }
    blocks.push(...deduped);
  } else if (claudeDeltas.size > 0) {
    const orderedIndexes = [...claudeDeltas.keys()].sort((a, b) => a - b);
    for (const index of orderedIndexes) {
      const text = (claudeDeltas.get(index) || '').trim();
      if (text) blocks.push(text);
    }
  }

  const streamText = codexStreamText.trim();
  if (streamText) blocks.push(streamText);

  return blocks;
}

/**
 * Load the stored CLI stdout JSONL events for a package. Large captures are
 * externalized to disk by the payload store with the inline field nulled and
 * a payload ref attached — follow the ref when the inline array is empty.
 */
async function loadJsonlEvents(pkg) {
  const stdout = pkg && pkg.cli && pkg.cli.stdout ? pkg.cli.stdout : null;
  if (!stdout) return [];

  if (Array.isArray(stdout.jsonlEvents) && stdout.jsonlEvents.length > 0) {
    return stdout.jsonlEvents;
  }

  const ref = stdout.jsonlEventsPayloadRef && typeof stdout.jsonlEventsPayloadRef.ref === 'string'
    ? stdout.jsonlEventsPayloadRef.ref
    : '';
  if (!ref) return [];

  // Refs are stored as server/data/provider-call-packages/<date>/<id>/<file>.
  const marker = 'provider-call-packages/';
  const markerIndex = ref.indexOf(marker);
  if (markerIndex < 0) return [];

  const payloadRoot = path.resolve(getDefaultPayloadRoot());
  const filePath = path.resolve(payloadRoot, ref.slice(markerIndex + marker.length));
  // Path traversal guard — the resolved file must stay inside the payload root.
  if (!filePath.startsWith(payloadRoot + path.sep)) return [];

  try {
    const text = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Externalized file may have been cleaned up independently of the Mongo
    // TTL — treat as "no reasoning captured" rather than a hard failure.
    return [];
  }
}

/**
 * Extract reasoning from an HTTP-harness package whose stored response is an
 * Anthropic /v1/messages body — thinking blocks precede the text block(s).
 */
function extractHttpReasoningBlocks(pkg) {
  const content = pkg && pkg.response && pkg.response.parsedJson && Array.isArray(pkg.response.parsedJson.content)
    ? pkg.response.parsedJson.content
    : null;
  if (!content) return [];
  return content
    .filter((block) => block && block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim())
    .map((block) => block.thinking.trim());
}

function capBlocks(blocks) {
  const capped = [];
  let total = 0;
  let truncated = false;
  for (const text of blocks) {
    if (total >= MAX_TOTAL_REASONING_CHARS) {
      truncated = true;
      break;
    }
    const remaining = MAX_TOTAL_REASONING_CHARS - total;
    if (text.length > remaining) {
      capped.push(text.slice(0, remaining));
      total += remaining;
      truncated = true;
      break;
    }
    capped.push(text);
    total += text.length;
  }
  return { capped, truncated };
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
    .select('providerId cli.modelRequested cli.stdout.jsonlEvents cli.stdout.jsonlEventsPayloadRef request.modelRequested response.parsedJson')
    .lean();
  if (!pkg) {
    return res.status(404).json({
      ok: false,
      code: 'NOT_FOUND',
      error: 'Provider package not found',
    });
  }

  const events = await loadJsonlEvents(pkg);
  let blocks = extractReasoningBlocks(events);
  if (blocks.length === 0) {
    blocks = extractHttpReasoningBlocks(pkg);
  }
  const { capped, truncated } = capBlocks(blocks);

  res.json({
    ok: true,
    provider: pkg.providerId || '',
    model: (pkg.cli && pkg.cli.modelRequested) || (pkg.request && pkg.request.modelRequested) || '',
    reasoning: capped.map((text) => ({ text })),
    truncated,
  });
});

module.exports = router;
