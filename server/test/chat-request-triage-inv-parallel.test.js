'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const claude = require('../src/services/claude');
const codex = require('../src/services/codex');
const knownIssueSearchModule = require('../src/services/known-issue-search-agent');
const { buildAgentBackedTriageContext } = require('../src/services/chat-request-service');

const CANONICAL_TEMPLATE = [
  'COID/MID: 9341452197744835',
  'CASE: 15154531492',
  'CLIENT/CONTACT: Doug Mckensie',
  'CX IS ATTEMPTING TO: Customer is calling to download the XML for his T4 but the summary did not download.',
  'EXPECTED OUTCOME: send T4 to CRA',
  'ACTUAL OUTCOME: missing the T4 summary',
  'KB/TOOLS USED: HELP PANEL, KB ARTICLES, GOOGLE, SCREEN SHARE.',
  'TRIED TEST ACCOUNT: n/a',
  'TS STEPS: Customer is calling about to download his T4 to CRA.',
].join('\n');

const FALLBACK_POLICY = {
  mode: 'single',
  primaryProvider: 'claude',
  primaryModel: '',
  fallbackProvider: '',
  fallbackModel: '',
  reasoningEffort: 'medium',
};

const TRIAGE_AGENT_OUTPUT = [
  'severity: P3',
  'category: payroll',
  'fast read: customer needs T4 summary export support',
  'next action: walk customer through re-exporting the T4 summary',
  'missing info: none',
  'confidence: high',
].join('\n');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('triage prompt no longer contains the INV Search Agent result block', async (t) => {
  const originalClaudeChat = claude.chat;
  const originalCodexChat = codex.chat;
  const originalRunKnownIssueSearchAgent = knownIssueSearchModule.runKnownIssueSearchAgent;

  let capturedSystemPrompt = '';
  let capturedUserMessage = '';

  claude.chat = ({ messages, systemPrompt, onChunk, onDone }) => {
    capturedSystemPrompt = systemPrompt || '';
    const lastUser = Array.isArray(messages)
      ? messages.filter((m) => m && m.role === 'user').slice(-1)[0]
      : null;
    capturedUserMessage = (lastUser && lastUser.content) || '';
    onChunk?.(TRIAGE_AGENT_OUTPUT);
    onDone?.({
      providerUsed: 'claude',
      modelUsed: 'claude-stub',
      fullResponse: TRIAGE_AGENT_OUTPUT,
      attempts: [],
      fallbackUsed: false,
      usage: null,
      mode: 'single',
    });
    return () => {};
  };

  knownIssueSearchModule.runKnownIssueSearchAgent = async () => ({
    ok: true,
    status: 'no-match',
    searches: [],
    matches: [],
    rejectedCandidates: [],
    noMatchReason: 'no candidates',
    needsMoreInfo: [],
    meta: { providerUsed: 'claude', model: 'claude-stub', durationMs: 1 },
    summary: 'No INV match.',
  });

  t.after(() => {
    claude.chat = originalClaudeChat;
    codex.chat = originalCodexChat;
    knownIssueSearchModule.runKnownIssueSearchAgent = originalRunKnownIssueSearchAgent;
  });

  await buildAgentBackedTriageContext({
    parserText: CANONICAL_TEMPLATE,
    parserProvider: 'gemini',
    parserModel: 'gemini-3-flash-preview',
    elapsedMs: 100,
    triageAgentRuntime: null,
    fallbackPolicy: FALLBACK_POLICY,
    reasoningEffort: 'medium',
    timeoutMs: 5000,
  });

  assert.equal(
    capturedUserMessage.includes('INV Search Agent result JSON'),
    false,
    'triage user prompt must not include the legacy INV result block',
  );
  assert.equal(
    capturedUserMessage.includes('Use the INV Search Agent result as retrieval evidence'),
    false,
    'triage user prompt must not include the legacy INV-evidence directive',
  );
  assert.ok(
    capturedUserMessage.includes('Parsed fields JSON:'),
    'triage user prompt should still contain parsed fields JSON',
  );
  assert.ok(
    capturedSystemPrompt.length > 0,
    'triage system prompt must still be supplied',
  );
});

test('INV Search and Triage agents are kicked off in parallel (both started before either resolves)', async (t) => {
  const originalClaudeChat = claude.chat;
  const originalCodexChat = codex.chat;
  const originalRunKnownIssueSearchAgent = knownIssueSearchModule.runKnownIssueSearchAgent;

  const order = [];

  // Triage: record start, hold for 50ms, then resolve.
  claude.chat = ({ onChunk, onDone }) => {
    order.push({ event: 'triage-start', at: Date.now() });
    setTimeout(() => {
      order.push({ event: 'triage-resolve', at: Date.now() });
      onChunk?.(TRIAGE_AGENT_OUTPUT);
      onDone?.({
        providerUsed: 'claude',
        modelUsed: 'claude-stub',
        fullResponse: TRIAGE_AGENT_OUTPUT,
        attempts: [],
        fallbackUsed: false,
        usage: null,
        mode: 'single',
      });
    }, 50);
    return () => {};
  };

  // INV: record start, hold for 50ms, then resolve.
  knownIssueSearchModule.runKnownIssueSearchAgent = async () => {
    order.push({ event: 'inv-start', at: Date.now() });
    await delay(50);
    order.push({ event: 'inv-resolve', at: Date.now() });
    return {
      ok: true,
      status: 'no-match',
      searches: [],
      matches: [],
      rejectedCandidates: [],
      noMatchReason: 'no candidates',
      needsMoreInfo: [],
      meta: { providerUsed: 'claude', model: 'claude-stub', durationMs: 50 },
      summary: 'No INV match.',
    };
  };

  t.after(() => {
    claude.chat = originalClaudeChat;
    codex.chat = originalCodexChat;
    knownIssueSearchModule.runKnownIssueSearchAgent = originalRunKnownIssueSearchAgent;
  });

  const startedAt = Date.now();
  await buildAgentBackedTriageContext({
    parserText: CANONICAL_TEMPLATE,
    parserProvider: 'gemini',
    parserModel: 'gemini-3-flash-preview',
    elapsedMs: 100,
    triageAgentRuntime: null,
    fallbackPolicy: FALLBACK_POLICY,
    reasoningEffort: 'medium',
    timeoutMs: 5000,
  });
  const totalMs = Date.now() - startedAt;

  const invStart = order.find((e) => e.event === 'inv-start');
  const triageStart = order.find((e) => e.event === 'triage-start');
  const invResolve = order.find((e) => e.event === 'inv-resolve');
  const triageResolve = order.find((e) => e.event === 'triage-resolve');

  assert.ok(invStart, 'INV agent must have been invoked');
  assert.ok(triageStart, 'Triage agent must have been invoked');
  assert.ok(invResolve, 'INV agent must have resolved');
  assert.ok(triageResolve, 'Triage agent must have resolved');

  // Both must start before either resolves — the parallelization contract.
  assert.ok(
    invStart.at <= invResolve.at && invStart.at <= triageResolve.at,
    'INV must start before any resolution',
  );
  assert.ok(
    triageStart.at <= invResolve.at && triageStart.at <= triageResolve.at,
    'Triage must start before any resolution',
  );

  // Wall-clock check: with each stub holding 50ms, sequential would be ~100ms;
  // parallel should be ~50ms. Allow generous slack for CI jitter.
  assert.ok(
    totalMs < 95,
    `combined wall-clock should be roughly max(inv, triage), got ${totalMs}ms`,
  );
});
