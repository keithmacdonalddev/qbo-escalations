'use strict';

const { registerProviderStub } = require('../../server/src/lib/harness-provider-gate');

const STUB_RESPONSE_TEXT = '[harness-stub] deterministic provider response — configure per-slice stubs to override.';
const DEFAULT_PARSE_FIELDS = Object.freeze({
  coid: 'COID-12345',
  mid: 'MID-67890',
  caseNumber: 'CASE-54321',
  clientContact: 'Taylor Example',
  agentName: 'Harness Agent',
  attemptingTo: 'Run payroll for this week.',
  expectedOutcome: 'Payroll completes successfully.',
  actualOutcome: 'Payroll submission does not complete and paychecks are not created.',
  tsSteps: 'Retried the payroll run and validated employee payroll setup.',
  triedTestAccount: 'no',
  category: 'payroll',
});
const DEFAULT_PARSE_TEXT = [
  'COID/MID: COID-12345 / MID-67890',
  'CASE: CASE-54321',
  'CLIENT/CONTACT: Taylor Example',
  'CX IS ATTEMPTING TO: Run payroll for this week.',
  'EXPECTED OUTCOME: Payroll completes successfully.',
  'ACTUAL OUTCOME: Payroll submission does not complete and paychecks are not created.',
  'KB/TOOLS USED: KB-100',
  'TRIED TEST ACCOUNT: no',
  'TS STEPS: Retried the payroll run and validated employee payroll setup.',
].join('\n');

function cloneDefaultParseFields() {
  return { ...DEFAULT_PARSE_FIELDS };
}

function stubUsage(provider, kind) {
  return {
    provider,
    kind,
    model: 'harness-stub-model',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    stub: true,
  };
}

function streamingChatStub(provider) {
  return function stubbedChat(args) {
    const { onChunk, onDone, onError, onThinkingChunk } = args || {};
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        if (typeof onThinkingChunk === 'function') onThinkingChunk('');
        if (typeof onChunk === 'function') onChunk(STUB_RESPONSE_TEXT);
        if (typeof onDone === 'function') onDone(STUB_RESPONSE_TEXT, stubUsage(provider, 'chat'));
      } catch (err) {
        if (typeof onError === 'function') onError(err);
      }
    });
    return () => { cancelled = true; return null; };
  };
}

function parseEscalationStub(provider) {
  return async function stubbedParseEscalation() {
    return {
      fields: cloneDefaultParseFields(),
      usage: stubUsage(provider, 'parseEscalation'),
      stub: true,
    };
  };
}

function parseImageStub(provider) {
  return async function stubbedParseImage() {
    return {
      text: DEFAULT_PARSE_TEXT,
      usage: stubUsage(provider, 'parseImage'),
      stub: true,
    };
  };
}

function validateRemoteProviderStub(provider) {
  return async function stubbedValidateRemoteProvider() {
    return {
      ok: true,
      configured: true,
      available: true,
      code: 'OK',
      reason: 'Harness stubbed',
      detail: '',
      model: 'harness-stub-model',
      provider,
      stub: true,
    };
  };
}

async function lmStudioAvailabilityStub() {
  return {
    available: true,
    model: 'harness-stub-model',
    reason: 'Harness stubbed',
    stub: true,
  };
}

function transcribeImageStub(provider) {
  return async function stubbedTranscribeImage() {
    return {
      ok: true,
      text: STUB_RESPONSE_TEXT,
      usage: stubUsage(provider, 'transcribeImage'),
      stub: true,
    };
  };
}

async function promptStub() {
  return {
    ok: true,
    text: STUB_RESPONSE_TEXT,
    usage: stubUsage('claude', 'prompt'),
    stub: true,
  };
}

async function warmUpStub() {
  return;
}

function installDefaultProviderStubs() {
  const chatProviders = ['claude', 'codex', 'lm-studio', 'anthropic', 'llm-gateway', 'openai', 'gemini', 'kimi'];
  for (const p of chatProviders) {
    registerProviderStub(p, 'chat', streamingChatStub(p));
  }

  const imageParserProviders = ['llm-gateway', 'lm-studio', 'anthropic', 'openai', 'gemini', 'kimi'];
  for (const p of imageParserProviders) {
    registerProviderStub(p, 'parseImage', parseImageStub(p));
  }

  const remoteAvailabilityProviders = ['llm-gateway', 'anthropic', 'openai', 'gemini', 'kimi'];
  for (const p of remoteAvailabilityProviders) {
    registerProviderStub(p, 'validateRemoteProvider', validateRemoteProviderStub(p));
  }
  registerProviderStub('lm-studio', 'providerAvailability', lmStudioAvailabilityStub);

  for (const p of ['claude', 'codex', 'lm-studio']) {
    registerProviderStub(p, 'parseEscalation', parseEscalationStub(p));
    registerProviderStub(p, 'transcribeImage', transcribeImageStub(p));
    registerProviderStub(p, 'warmUp', warmUpStub);
  }

  registerProviderStub('claude', 'prompt', promptStub);
}

module.exports = {
  DEFAULT_PARSE_FIELDS,
  DEFAULT_PARSE_TEXT,
  installDefaultProviderStubs,
  parseEscalationStub,
  parseImageStub,
  validateRemoteProviderStub,
  lmStudioAvailabilityStub,
  streamingChatStub,
  transcribeImageStub,
  promptStub,
  warmUpStub,
};
