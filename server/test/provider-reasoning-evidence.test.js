'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_REASONING_ENTRIES,
  buildReasoningEvidence,
  resolveProviderPromptHash,
} = require('../src/services/provider-reasoning-evidence');

test('reasoning evidence preserves repeated and prefix snapshots but removes an exact stable event replay', () => {
  const exact = {
    type: 'item.completed',
    item: { id: 'reasoning-a', type: 'reasoning', text: 'same thought' },
  };
  const capture = buildReasoningEvidence({
    _id: 'provider-package-1',
    providerId: 'codex',
    metadata: {
      runId: 'run-1',
      requestId: 'request-1',
      attemptId: 'attempt-1',
      attemptIndex: 2,
      toolLoopRound: 3,
      modelRound: 4,
      promptId: 'chat-core',
      promptHash: 'prompt-hash-1',
      promptVersion: '7',
    },
    cli: {
      modelRequested: 'gpt-requested',
      stdout: {
        jsonlEvents: [
          exact,
          exact,
          { type: 'item.completed', item: { id: 'reasoning-a', type: 'reasoning', text: 'same thought extended' } },
          { type: 'item.completed', item: { id: 'reasoning-b', type: 'reasoning', text: 'same thought' } },
          { type: 'reasoning.delta', delta: 'repeatable delta' },
          { type: 'reasoning.delta', delta: 'repeatable delta' },
          { type: 'result', model: 'gpt-actual' },
        ],
      },
    },
  });

  assert.deepEqual(capture.evidence.map((entry) => entry.text), [
    'same thought',
    'same thought extended',
    'same thought',
    'repeatable delta',
    'repeatable delta',
  ]);
  assert.equal(capture.summary.exactDuplicatesRemoved, 1);
  assert.equal(capture.summary.deduplication, 'stable-transport-event-id-and-hash-only');
  assert.deepEqual(capture.evidence.map((entry) => entry.sequence), [0, 1, 2, 3, 4]);
  assert.equal(new Set(capture.evidence.map((entry) => entry.evidenceId)).size, 5);

  const first = capture.evidence[0];
  assert.equal(first.packageId, 'provider-package-1');
  assert.equal(first.runId, 'run-1');
  assert.equal(first.requestId, 'request-1');
  assert.equal(first.attemptId, 'attempt-1');
  assert.equal(first.attemptIndex, 2);
  assert.equal(first.toolLoopRound, 3);
  assert.equal(first.modelRound, 4);
  assert.equal(first.provider, 'codex');
  assert.equal(first.actualModel, 'gpt-actual');
  assert.equal(first.requestedModel, 'gpt-requested');
  assert.equal(first.model, 'gpt-actual');
  assert.equal(first.promptId, 'chat-core');
  assert.equal(first.promptHash, 'prompt-hash-1');
  assert.equal(first.promptHashSource, 'caller');
  assert.equal(first.promptVersion, '7');
  assert.equal(first.authority, 'diagnostic-only');
  assert.equal(first.complete, true);
  assert.equal(first.truncated, false);
  assert.match(first.sourcePath, /jsonlEvents\[0\]\.item\.text$/);
  assert.match(first.transportEventHash, /^[a-f0-9]{64}$/);
  assert.equal(capture.evidence[3].complete, false, 'stream deltas are fragments, not complete blocks');
});

test('reasoning evidence enforces entry bounds and reports the missing tail honestly', () => {
  const events = Array.from({ length: MAX_REASONING_ENTRIES + 3 }, (_, index) => ({
    type: 'item.completed',
    item: { id: `reasoning-${index}`, type: 'reasoning', text: `thought-${index}` },
  }));
  const capture = buildReasoningEvidence({
    providerId: 'codex',
    cli: { modelRequested: 'gpt-5.4', stdout: { jsonlEvents: events } },
  });

  assert.equal(capture.evidence.length, MAX_REASONING_ENTRIES);
  assert.equal(capture.summary.observedEntryCount, MAX_REASONING_ENTRIES + 3);
  assert.equal(capture.summary.entryLimitReached, true);
  assert.equal(capture.summary.truncated, true);
  assert.equal(capture.summary.complete, false);
  assert.equal(capture.evidence.at(-1).sequence, MAX_REASONING_ENTRIES - 1);
});

test('prompt hash can fingerprint the exact provider request without retaining prompt text', () => {
  const first = resolveProviderPromptHash({
    request: { bodyJson: { model: 'gpt-5.4', messages: [{ role: 'user', content: 'private prompt' }] } },
  });
  const second = resolveProviderPromptHash({
    request: { bodyJson: { messages: [{ content: 'private prompt', role: 'user' }], model: 'gpt-5.4' } },
  });

  assert.match(first.promptHash, /^[a-f0-9]{64}$/);
  assert.equal(first.promptHash, second.promptHash, 'canonical object hashing is stable across key order');
  assert.equal(first.promptHashSource, 'provider-request');
  assert.equal(JSON.stringify(first).includes('private prompt'), false);
});
