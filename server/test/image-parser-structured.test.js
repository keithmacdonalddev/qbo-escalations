'use strict';

// Tests for the structured-output branch on the Anthropic image-parser path.
// Verifies Decision D2b (2026-05-19): with provider === 'anthropic' the
// SDK json_schema path is used by default; passing structured: false in
// options forces the legacy prose path. Output shape must be identical to
// the prose path's shape for downstream consumers (text, role, parseFields,
// parseMeta, usage, stats).

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// ---------------------------------------------------------------------------
// Module-cache substitution for sdk-image-parse
//
// The structured path in services/image-parser.js does
//   const { parseImageWithSDK } = require('./sdk-image-parse');
// inside a lazy loader, so mutating the module's exports here is picked up
// on the next call. We replace parseImageWithSDK with a controllable spy
// so we can verify the structured branch ran without invoking the real
// Agent SDK.
// ---------------------------------------------------------------------------
const sdkModulePath = require.resolve('../src/services/sdk-image-parse');
const sdkModule = require('../src/services/sdk-image-parse');
const ORIGINAL_SDK_PARSE = sdkModule.parseImageWithSDK;

let sdkSpyState = null;
function installSdkSpy(implementation) {
  sdkSpyState = {
    calls: [],
    implementation,
  };
  sdkModule.parseImageWithSDK = async function spy(imageInput, opts) {
    sdkSpyState.calls.push({ imageInput, opts });
    return implementation(imageInput, opts);
  };
  // Make sure require() returns the mutated exports too.
  require.cache[sdkModulePath].exports = sdkModule;
}
function uninstallSdkSpy() {
  sdkModule.parseImageWithSDK = ORIGINAL_SDK_PARSE;
  require.cache[sdkModulePath].exports = sdkModule;
  sdkSpyState = null;
}

// ---------------------------------------------------------------------------
// https / http intercept helpers — mirror image-parser.test.js so we can
// detect when the prose path is taken (it hits the Anthropic REST endpoint
// via https.request) vs when the structured path is taken (no https call).
// ---------------------------------------------------------------------------
function mockHttpsRequest(statusCode, responseBody) {
  const origHttps = https.request;
  let capturedBody = null;
  let calls = 0;
  https.request = function mockedRequest(options, callback) {
    calls += 1;
    const req = new EventEmitter();
    req.write = (data) => { capturedBody = data; };
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = statusCode;
      if (typeof callback === 'function') {
        process.nextTick(() => {
          callback(res);
          process.nextTick(() => {
            const payload = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
            res.emit('data', payload);
            res.emit('end');
          });
        });
      }
      return req;
    };
    req.destroy = () => {};
    return req;
  };
  return {
    restore() { https.request = origHttps; },
    getCapturedBody() { return capturedBody ? JSON.parse(capturedBody) : null; },
    getCallCount() { return calls; },
  };
}

function setupProviderKey(envVar, testKey, keysFile) {
  const origKey = process.env[envVar];
  const origRead = fs.readFileSync;
  process.env[envVar] = testKey;
  fs.readFileSync = function mockRead(filePath) {
    if (filePath === keysFile) throw new Error('ENOENT');
    return origRead.apply(this, arguments);
  };
  return function cleanup() {
    fs.readFileSync = origRead;
    if (origKey !== undefined) process.env[envVar] = origKey;
    else delete process.env[envVar];
  };
}

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
const { parseImage, KEYS_FILE } = require('../src/services/image-parser');

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const STRUCTURED_FIELDS_FIXTURE = {
  coid: '987654',
  mid: '321098',
  caseNumber: 'CS-2026-0042',
  clientContact: 'jane.doe@example.com',
  agentName: 'Maria S.',
  attemptingTo: 'submit Q2 payroll',
  expectedOutcome: 'payroll filed without warnings',
  actualOutcome: 'system shows a 5xx error after Step 3',
  tsSteps: '1) Cleared cache 2) Retried with backup admin',
  triedTestAccount: 'no',
  category: 'payroll',
};
const STRUCTURED_USAGE_FIXTURE = {
  model: 'claude-sonnet-4-20250514',
  inputTokens: 1234,
  outputTokens: 256,
};

// ---------------------------------------------------------------------------
// Cleanup hook — make sure each test starts clean
// ---------------------------------------------------------------------------
test.beforeEach(() => {
  if (sdkSpyState) uninstallSdkSpy();
});
test.afterEach(() => {
  if (sdkSpyState) uninstallSdkSpy();
});

// ═══════════════════════════════════════════════════════════════════════════
// Default behavior — Anthropic uses the structured path
// ═══════════════════════════════════════════════════════════════════════════
test('parseImage with provider=anthropic and default options uses the structured-output path', async () => {
  const cleanupKey = setupProviderKey('ANTHROPIC_API_KEY', 'sk-ant-test-structured', KEYS_FILE);
  installSdkSpy(async () => ({ fields: STRUCTURED_FIELDS_FIXTURE, usage: STRUCTURED_USAGE_FIXTURE }));

  // If the structured branch is wired correctly there should be ZERO calls
  // to https.request (the prose path's transport). Track that.
  const httpsMock = mockHttpsRequest(200, { content: [{ type: 'text', text: 'PROSE_PATH_RAN' }] });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });

    // Structured spy ran exactly once with the image payload.
    assert.equal(sdkSpyState.calls.length, 1, 'parseImageWithSDK must be invoked once for default Anthropic');
    assert.ok(typeof sdkSpyState.calls[0].imageInput === 'string', 'spy received the image as a string');

    // The prose REST endpoint must NOT have been hit.
    assert.equal(httpsMock.getCallCount(), 0, 'structured path must not call https.request');

    // Output shape — same fields downstream consumers expect.
    assert.equal(result.role, 'escalation');
    assert.equal(result.parseFields.coid, '987654');
    assert.equal(result.parseFields.mid, '321098');
    assert.equal(result.parseFields.caseNumber, 'CS-2026-0042');
    assert.equal(result.parseFields.attemptingTo, 'submit Q2 payroll');
    assert.ok(result.parseMeta, 'parseMeta should be populated for escalation role');
    assert.ok(result.usage, 'usage should be forwarded from SDK result');
    assert.equal(result.usage.inputTokens, 1234);
    assert.equal(result.usage.outputTokens, 256);
    assert.ok(result.text.includes('COID/MID: 987654 / 321098'), 'canonical text rendered from structured fields');
    assert.ok(result.text.includes('CASE: CS-2026-0042'), 'CASE label rendered');
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

test('parseImage with provider=anthropic and structured=true (explicit) also uses the structured path', async () => {
  const cleanupKey = setupProviderKey('ANTHROPIC_API_KEY', 'sk-ant-test-explicit', KEYS_FILE);
  installSdkSpy(async () => ({ fields: STRUCTURED_FIELDS_FIXTURE, usage: STRUCTURED_USAGE_FIXTURE }));
  const httpsMock = mockHttpsRequest(200, { content: [{ type: 'text', text: 'PROSE_PATH_RAN' }] });

  try {
    await parseImage(TINY_PNG_BASE64, { provider: 'anthropic', structured: true });
    assert.equal(sdkSpyState.calls.length, 1, 'structured: true must invoke the SDK path');
    assert.equal(httpsMock.getCallCount(), 0, 'structured: true must not call https.request');
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Opt-out — structured: false forces the prose path
// ═══════════════════════════════════════════════════════════════════════════
test('parseImage with provider=anthropic and structured=false forces the legacy prose path', async () => {
  const cleanupKey = setupProviderKey('ANTHROPIC_API_KEY', 'sk-ant-test-prose', KEYS_FILE);
  installSdkSpy(async () => {
    throw new Error('SDK path must not be invoked when structured=false');
  });
  const httpsMock = mockHttpsRequest(200, {
    content: [{ type: 'text', text: 'COID/MID: 111 / 222\nCASE: CS-2026-9999\nCX IS ATTEMPTING TO: post a journal entry' }],
    model: 'claude-sonnet-4-20250514',
    usage: { input_tokens: 50, output_tokens: 20 },
  });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'anthropic', structured: false });

    // SDK spy must NOT have been invoked.
    assert.equal(sdkSpyState.calls.length, 0, 'parseImageWithSDK must not run when structured=false');

    // Prose REST endpoint must have been hit.
    assert.equal(httpsMock.getCallCount(), 1, 'prose path must call https.request once');

    // Output shape — same downstream contract as the structured path.
    assert.equal(result.role, 'escalation');
    assert.equal(result.parseFields.coid, '111');
    assert.equal(result.parseFields.mid, '222');
    assert.equal(result.parseFields.caseNumber, 'CS-2026-9999');
    assert.ok(result.parseMeta);
    assert.equal(result.usage.inputTokens, 50);
    assert.equal(result.usage.outputTokens, 20);
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Shape parity — structured and prose paths produce the same field
// surface that downstream consumers depend on.
// ═══════════════════════════════════════════════════════════════════════════
test('structured and prose paths produce the same downstream shape (text + role + parseFields + parseMeta + usage)', async () => {
  // --- Run 1: structured path ----------------------------------------------
  const cleanupKey1 = setupProviderKey('ANTHROPIC_API_KEY', 'sk-ant-shape-1', KEYS_FILE);
  installSdkSpy(async () => ({
    fields: {
      coid: '500',
      mid: '600',
      caseNumber: 'CS-2026-7777',
      clientContact: 'op@example.com',
      attemptingTo: 'reconcile bank feed',
      expectedOutcome: 'clean reconciliation',
      actualOutcome: 'duplicates appearing',
      tsSteps: 'tried refresh',
      triedTestAccount: 'no',
      category: 'reconciliation',
    },
    usage: { model: 'claude-sonnet-4-20250514', inputTokens: 800, outputTokens: 100 },
  }));
  let structuredResult;
  try {
    structuredResult = await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });
  } finally {
    cleanupKey1();
  }
  uninstallSdkSpy();

  // --- Run 2: prose path ---------------------------------------------------
  const cleanupKey2 = setupProviderKey('ANTHROPIC_API_KEY', 'sk-ant-shape-2', KEYS_FILE);
  const httpsMock = mockHttpsRequest(200, {
    content: [{
      type: 'text',
      text: [
        'COID/MID: 500 / 600',
        'CASE: CS-2026-7777',
        'CLIENT/CONTACT: op@example.com',
        'CX IS ATTEMPTING TO: reconcile bank feed',
        'EXPECTED OUTCOME: clean reconciliation',
        'ACTUAL OUTCOME: duplicates appearing',
        'KB/TOOLS USED: ',
        'TRIED TEST ACCOUNT: no',
        'TS STEPS: tried refresh',
      ].join('\n'),
    }],
    model: 'claude-sonnet-4-20250514',
    usage: { input_tokens: 800, output_tokens: 100 },
  });
  let proseResult;
  try {
    proseResult = await parseImage(TINY_PNG_BASE64, { provider: 'anthropic', structured: false });
  } finally {
    httpsMock.restore();
    cleanupKey2();
  }

  // --- Compare downstream-visible shape ------------------------------------
  // The fields, role, and the existence of parseMeta are what every
  // downstream consumer (route response, persistence, UI, event bus)
  // touches. They must be identical regardless of which path produced
  // the result.
  for (const key of ['coid', 'mid', 'caseNumber', 'clientContact', 'attemptingTo', 'expectedOutcome', 'actualOutcome', 'tsSteps', 'triedTestAccount']) {
    assert.equal(
      structuredResult.parseFields[key],
      proseResult.parseFields[key],
      `parseFields.${key} must match across paths`
    );
  }
  assert.equal(structuredResult.role, proseResult.role, 'role must match across paths');
  assert.ok(structuredResult.parseMeta, 'structured path returns parseMeta');
  assert.ok(proseResult.parseMeta, 'prose path returns parseMeta');
  assert.equal(typeof structuredResult.text, 'string');
  assert.equal(typeof proseResult.text, 'string');
  assert.ok(structuredResult.usage);
  assert.ok(proseResult.usage);
});

// ═══════════════════════════════════════════════════════════════════════════
// Failure surface — when the SDK returns null (timeout, schema-reject),
// callAnthropicStructured must throw PROVIDER_ERROR rather than silently
// fall back to the prose path. That keeps the failure visible.
// ═══════════════════════════════════════════════════════════════════════════
test('parseImage with structured path throws PROVIDER_ERROR when SDK returns null', async () => {
  const cleanupKey = setupProviderKey('ANTHROPIC_API_KEY', 'sk-ant-fail', KEYS_FILE);
  installSdkSpy(async () => null);

  try {
    await assert.rejects(
      () => parseImage(TINY_PNG_BASE64, { provider: 'anthropic' }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.match(err.message, /structured-output/i);
        return true;
      }
    );
  } finally {
    cleanupKey();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Non-Anthropic providers must continue to use the prose path unchanged.
// This is the scope guard for Decision D2b: structured output is Anthropic-
// only in this iteration.
// ═══════════════════════════════════════════════════════════════════════════
test('parseImage with provider=openai ignores structured flag and continues to use the prose path', async () => {
  const cleanupKey = setupProviderKey('OPENAI_API_KEY', 'sk-openai-test', KEYS_FILE);
  installSdkSpy(async () => {
    throw new Error('SDK path must never run for non-Anthropic providers');
  });
  const httpsMock = mockHttpsRequest(200, {
    choices: [{ message: { content: 'COID/MID: 1 / 2\nCASE: CS-2026-0001' } }],
    model: 'gpt-5.4-mini',
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'openai', structured: true });
    assert.equal(sdkSpyState.calls.length, 0, 'OpenAI must not invoke the Anthropic SDK path');
    assert.equal(httpsMock.getCallCount(), 1, 'OpenAI prose path must hit https.request');
    assert.equal(result.parseFields.coid, '1');
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});
