'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

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

test('chat image augmentation context runs INV Search Agent without inline Triage Agent output', async (t) => {
  const originalRunKnownIssueSearchAgent = knownIssueSearchModule.runKnownIssueSearchAgent;
  let capturedArgs = null;

  knownIssueSearchModule.runKnownIssueSearchAgent = async (args) => {
    capturedArgs = args;
    return {
      ok: true,
      status: 'match',
      searches: [{ query: 't4 xml summary missing', category: 'payroll', status: 'active', resultCount: 1 }],
      matches: [{
        invNumber: 'INV-149001',
        confidence: 'high',
        subject: 'Downloading T4 XML does not include the T4 summary',
      }],
      rejectedCandidates: [],
      noMatchReason: '',
      needsMoreInfo: [],
      meta: { providerUsed: 'claude', model: 'claude-stub', durationMs: 1 },
      summary: 'Likely INV match.',
    };
  };

  t.after(() => {
    knownIssueSearchModule.runKnownIssueSearchAgent = originalRunKnownIssueSearchAgent;
  });

  const context = await buildAgentBackedTriageContext({
    parserText: CANONICAL_TEMPLATE,
    parserProvider: 'gemini',
    parserModel: 'gemini-3-flash-preview',
    elapsedMs: 100,
    triageAgentRuntime: null,
    fallbackPolicy: FALLBACK_POLICY,
    reasoningEffort: 'medium',
    timeoutMs: 5000,
  });

  assert.ok(capturedArgs, 'INV Search Agent should still run from chat-side parser context');
  assert.match(capturedArgs.parserText, /COID\/MID/);
  assert.equal(capturedArgs.parseFields.clientContact, 'Doug Mckensie');
  assert.equal(context.knownIssueSearchResult.status, 'match');
  assert.equal(context.knownIssueSearchResult.matches[0].invNumber, 'INV-149001');
  assert.equal(context.triageCard, null);
  assert.equal(context.triageMeta, null);
});

test('chat image augmentation context can skip INV Search Agent without manufacturing triage', async (t) => {
  const originalRunKnownIssueSearchAgent = knownIssueSearchModule.runKnownIssueSearchAgent;
  let called = false;

  knownIssueSearchModule.runKnownIssueSearchAgent = async () => {
    called = true;
    return { ok: true, status: 'no-match', matches: [], meta: {} };
  };

  t.after(() => {
    knownIssueSearchModule.runKnownIssueSearchAgent = originalRunKnownIssueSearchAgent;
  });

  const context = await buildAgentBackedTriageContext({
    parserText: CANONICAL_TEMPLATE,
    parserProvider: 'gemini',
    parserModel: 'gemini-3-flash-preview',
    elapsedMs: 100,
    triageAgentRuntime: null,
    fallbackPolicy: FALLBACK_POLICY,
    reasoningEffort: 'medium',
    timeoutMs: 5000,
    runKnownIssueSearch: false,
  });

  assert.equal(called, false);
  assert.equal(context.knownIssueSearchResult, null);
  assert.equal(context.triageCard, null);
  assert.equal(context.triageMeta, null);
  assert.equal(context.parseFields.clientContact, 'Doug Mckensie');
});
