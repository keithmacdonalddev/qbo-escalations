'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAgentBackedTriageContext,
  buildParserDerivedTriageContext,
  buildTriageCardFromAgentOutput,
} = require('../src/services/chat-request-service');
const claude = require('../src/services/claude');
const knownIssueSearch = require('../src/services/known-issue-search-agent');

const CANONICAL_TEMPLATE = [
  'COID/MID: 9341452197744835',
  'CASE: 15154531492',
  'CLIENT/CONTACT: Doug Mckensie',
  'CX IS ATTEMPTING TO: Customer is calling to download the XML for his T4 but for some reason it didn\'t download the T4 summary when he downloaded the XML',
  'EXPECTED OUTCOME: wanted to send in his T4 to CRA',
  'ACTUAL OUTCOME: missing the T4 summary',
  'KB/TOOLS USED: HELP PANEL, KB ARTICLES, GOOGLE, SCREEN SHARE.',
  'TRIED TEST ACCOUNT: n/a',
  'TS STEPS: Customer is calling about to download his T4 to CRA when he downloaded the T4 XML the T4 summary didn\'t download',
].join('\n');

test('buildParserDerivedTriageContext accepts canonical escalation template text', () => {
  const context = buildParserDerivedTriageContext({
    parserText: CANONICAL_TEMPLATE,
    parserProvider: 'gemini',
    parserModel: 'gemini-3-flash-preview',
    elapsedMs: 123,
  });

  assert.equal(context.error, null);
  assert.equal(context.parseFields.clientContact, 'Doug Mckensie');
  assert.equal(context.triageCard.category, 'payroll');
  assert.equal(context.triageCard.confidence, 'high');
  assert.equal(context.triageCard.generation.source, 'server');
  assert.equal(context.triageCard.generation.label, 'Server generated');
  assert.equal(context.triageCard.generation.latencyMs, 123);
  assert.equal(context.parseMeta.validation.passed, true);
  assert.equal(context.parseMeta.validation.canonicalTemplate.passed, true);
});

test('buildParserDerivedTriageContext rejects non-canonical parser fields while retaining rule triage', () => {
  const withAgent = CANONICAL_TEMPLATE.replace(
    'CLIENT/CONTACT: Doug Mckensie\n',
    'CLIENT/CONTACT: Doug Mckensie\nAGENT: Phone Agent\n'
  );
  const context = buildParserDerivedTriageContext({
    parserText: withAgent,
    parserProvider: 'gemini',
    parserModel: 'gemini-3-flash-preview',
    elapsedMs: 123,
  });

  assert.equal(context.error.code, 'CANONICAL_TEMPLATE_VALIDATION_FAILED');
  assert.deepEqual(context.parseFields, {});
  assert.equal(context.triageCard.agent, 'Phone Agent');
  assert.equal(context.triageCard.confidence, 'high');
  assert.equal(context.triageCard.generation.source, 'server');
  assert.equal(context.parseMeta.validation.passed, false);
  assert.ok(context.parseMeta.validation.issues.includes('canonical_NON_CANONICAL_FIELD'));
  assert.equal(context.parseMeta.validation.canonicalTemplate.passed, false);
});

test('buildTriageCardFromAgentOutput converts triage-agent fields into a UI card', () => {
  const out = buildTriageCardFromAgentOutput([
    'Category: Payroll',
    'Severity: P3; raise to P2 if CRA filing is due today',
    'Fast read: T4 XML export is incomplete because the T4 summary is missing.',
    'Immediate next step: Confirm the tax year and rerun one fresh export.',
    'Missing info: None',
    'Confidence: High',
    'Category check: Payroll because T4 forms are generated from payroll workflows.',
  ].join('\n'), {
    agentName: 'Jamie Agent',
    clientContact: 'Example Client',
  });

  assert.deepEqual(out.issues, []);
  assert.equal(out.card.agent, 'Jamie Agent');
  assert.equal(out.card.client, 'Example Client');
  assert.equal(out.card.category, 'payroll');
  assert.equal(out.card.severity, 'P3');
  assert.equal(out.card.confidence, 'high');
  assert.deepEqual(out.card.missingInfo, ['None']);
  assert.equal(out.card.source, 'triage-agent');
  assert.equal(out.card.fallback.used, false);
});

test('buildAgentBackedTriageContext uses formatted triage-agent model output', async (t) => {
  const originalClaudeChat = claude.chat;
  t.after(() => {
    claude.chat = originalClaudeChat;
  });

  let capturedSystemPrompt = '';
  let capturedMessage = '';
  claude.chat = ({ systemPrompt, messages, onDone }) => {
    capturedSystemPrompt = systemPrompt;
    capturedMessage = messages?.[0]?.content || '';
    onDone([
      'Category: Payroll',
      'Severity: P3',
      'Fast read: T4 summary is missing from the export package.',
      'Immediate next step: Confirm the tax year and run one fresh export.',
      'Missing info: None',
      'Confidence: High',
      'Category check: Payroll because T4 forms are generated from payroll workflows.',
    ].join('\n'), { inputTokens: 12, outputTokens: 34, model: 'claude-opus-4-7' });
    return () => {};
  };

  const context = await buildAgentBackedTriageContext({
    parserText: CANONICAL_TEMPLATE,
    parserProvider: 'llm-gateway',
    parserUsage: null,
    parserModel: 'qwen/qwen3.6-27b',
    elapsedMs: 50,
    triageAgentRuntime: {
      'triage-agent': {
        provider: 'claude',
        mode: 'single',
        reasoningEffort: 'high',
      },
    },
    fallbackPolicy: {
      primaryProvider: 'claude',
      fallbackProvider: 'gpt-5.5',
    },
    reasoningEffort: 'high',
    timeoutMs: 1000,
  });

  assert.match(capturedSystemPrompt, /Output exactly these fields/i);
  assert.match(capturedMessage, /Raw parsed template/i);
  assert.equal(context.triageCard.source, 'triage-agent');
  assert.equal(context.triageCard.fallback.used, false);
  assert.equal(context.triageCard.generation.source, 'agent');
  assert.equal(context.triageCard.generation.label, 'Agent generated');
  assert.equal(context.triageCard.generation.provider, 'claude');
  assert.equal(context.triageCard.generation.model, 'claude-opus-4-7');
  assert.equal(context.triageMeta.providerUsed, 'claude');
  assert.equal(context.triageMeta.model, 'claude-opus-4-7');
  assert.equal(context.triageMeta.usedRuleFallback, false);
});

test('buildAgentBackedTriageContext runs Known Issue Search Agent alongside triage', async (t) => {
  const originalClaudeChat = claude.chat;
  const originalKnownIssueSearch = knownIssueSearch.runKnownIssueSearchAgent;
  t.after(() => {
    claude.chat = originalClaudeChat;
    knownIssueSearch.runKnownIssueSearchAgent = originalKnownIssueSearch;
  });

  knownIssueSearch.runKnownIssueSearchAgent = async () => ({
    ok: true,
    source: 'known-issue-search-agent',
    agentId: 'known-issue-search-agent',
    agentName: 'Known Issue Search Agent',
    status: 'match',
    summary: 'Likely INV match after active payroll search.',
    searches: [{ query: 't4 xml summary missing', category: 'payroll', status: 'active', resultCount: 1 }],
    matches: [{
      invNumber: 'INV-149001',
      confidence: 'high',
      subject: 'Downloading T4 XML does not include the T4 summary',
      evidenceFor: ['T4 XML export is missing summary', 'CRA filing workflow matches'],
      evidenceAgainst: [],
      missingConfirmations: ['Confirm tax year'],
      recommendedAction: 'Confirm tax year before adding the customer to affected users.',
    }],
    rejectedCandidates: [],
    noMatchReason: '',
    needsMoreInfo: [],
    validation: { passed: true, issues: [], toolSearchCount: 1, fetchedInvestigationCount: 1 },
    meta: { providerUsed: 'claude', model: 'claude-opus-4-7' },
  });

  let capturedMessage = '';
  claude.chat = ({ messages, onDone }) => {
    capturedMessage = messages?.[0]?.content || '';
    onDone([
      'Category: Payroll',
      'Severity: P3',
      'Fast read: T4 summary is missing from the export package and a known issue candidate exists.',
      'Immediate next step: Confirm the tax year before linking the customer to the INV.',
      'Missing info: Tax year',
      'Confidence: High',
      'Category check: Payroll because T4 forms are generated from payroll workflows.',
    ].join('\n'), { inputTokens: 12, outputTokens: 34, model: 'claude-opus-4-7' });
    return () => {};
  };

  const context = await buildAgentBackedTriageContext({
    parserText: CANONICAL_TEMPLATE,
    parserProvider: 'llm-gateway',
    parserUsage: null,
    parserModel: 'qwen/qwen3.6-27b',
    elapsedMs: 50,
    triageAgentRuntime: {
      'triage-agent': {
        provider: 'claude',
        mode: 'single',
        reasoningEffort: 'high',
      },
      'known-issue-search-agent': {
        provider: 'claude',
        mode: 'single',
        reasoningEffort: 'high',
      },
    },
    fallbackPolicy: {
      primaryProvider: 'claude',
      fallbackProvider: 'gpt-5.5',
    },
    reasoningEffort: 'high',
    timeoutMs: 1000,
  });

  assert.match(capturedMessage, /Raw parsed template/i);
  assert.doesNotMatch(capturedMessage, /INV-149001/);
  assert.equal(context.knownIssueSearchResult.status, 'match');
  assert.equal(context.knownIssueSearchResult.matches[0].invNumber, 'INV-149001');
  assert.equal(context.triageCard.source, 'triage-agent');
  assert.equal(context.triageCard.generation.source, 'agent');
});

test('buildAgentBackedTriageContext marks rule fallback triage as server generated', async (t) => {
  const originalClaudeChat = claude.chat;
  t.after(() => {
    claude.chat = originalClaudeChat;
  });

  claude.chat = ({ onDone }) => {
    onDone('Not the required labeled fields.', { inputTokens: 12, outputTokens: 7, model: 'claude-opus-4-7' });
    return () => {};
  };

  const context = await buildAgentBackedTriageContext({
    parserText: CANONICAL_TEMPLATE,
    parserProvider: 'llm-gateway',
    parserUsage: null,
    parserModel: 'qwen/qwen3.6-27b',
    elapsedMs: 50,
    triageAgentRuntime: {
      'triage-agent': {
        provider: 'claude',
        mode: 'single',
        reasoningEffort: 'high',
      },
    },
    fallbackPolicy: {
      primaryProvider: 'claude',
      fallbackProvider: 'gpt-5.5',
    },
    reasoningEffort: 'high',
    timeoutMs: 1000,
    runKnownIssueSearch: false,
  });

  assert.equal(context.triageCard.fallback.used, true);
  assert.equal(context.triageCard.generation.source, 'server');
  assert.equal(context.triageCard.generation.label, 'Server generated');
  assert.equal(context.triageCard.generation.provider, 'claude');
  assert.equal(context.triageMeta.usedRuleFallback, true);
});

test('buildAgentBackedTriageContext warns when Triage Agent runtime is not saved', async (t) => {
  const originalClaudeChat = claude.chat;
  t.after(() => {
    claude.chat = originalClaudeChat;
  });

  claude.chat = ({ onDone }) => {
    onDone([
      'Category: Payroll',
      'Severity: P3',
      'Fast read: T4 summary is missing from the export package.',
      'Immediate next step: Confirm the tax year and run one fresh export.',
      'Missing info: None',
      'Confidence: High',
      'Category check: Payroll because T4 forms are generated from payroll workflows.',
    ].join('\n'), { inputTokens: 12, outputTokens: 34, model: 'claude-opus-4-7' });
    return () => {};
  };

  const statuses = [];
  const context = await buildAgentBackedTriageContext({
    parserText: CANONICAL_TEMPLATE,
    parserProvider: 'llm-gateway',
    parserUsage: null,
    parserModel: 'qwen/qwen3.6-27b',
    elapsedMs: 50,
    triageAgentRuntime: {
      'triage-agent': {
        configured: false,
        provider: 'claude',
        mode: 'single',
        reasoningEffort: 'high',
      },
    },
    fallbackPolicy: {
      primaryProvider: 'claude',
      fallbackProvider: 'gpt-5.5',
    },
    reasoningEffort: 'high',
    timeoutMs: 1000,
    emitStatus: async (status) => { statuses.push(status); },
  });

  assert.equal(context.triageCard.source, 'triage-agent');
  assert.equal(context.triageCard.runtime.usedDefault, true);
  assert.equal(context.triageCard.generation.source, 'agent');
  assert.equal(context.triageMeta.usedDefaultRuntime, true);
  assert.equal(context.triageMeta.runtimeConfigured, false);
  assert.ok(statuses.some((status) => status.code === 'TRIAGE_AGENT_DEFAULT_RUNTIME'));
  assert.ok(statuses.some((status) => status.code === 'TRIAGE_AGENT_STARTED'));
});
