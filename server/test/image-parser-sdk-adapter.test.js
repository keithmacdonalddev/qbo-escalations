'use strict';

// Tests for the Anthropic SDK provider adapter on the image-parser path.
// The adapter's job is deliberately narrow: unwrap the provider/SDK response
// and hand the model's answer text to the normal parser pipeline.

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const fs = require('fs');
const { EventEmitter } = require('events');

const sdkModulePath = require.resolve('../src/services/sdk-image-parse');
const sdkModule = require('../src/services/sdk-image-parse');
const ORIGINAL_SDK_PARSE = sdkModule.parseImageWithSDK;

let sdkSpyState = null;
function installSdkSpy(implementation) {
  sdkSpyState = { calls: [], implementation };
  sdkModule.parseImageWithSDK = async function spy(imageInput, opts) {
    sdkSpyState.calls.push({ imageInput, opts });
    return implementation(imageInput, opts);
  };
  require.cache[sdkModulePath].exports = sdkModule;
}

function uninstallSdkSpy() {
  sdkModule.parseImageWithSDK = ORIGINAL_SDK_PARSE;
  require.cache[sdkModulePath].exports = sdkModule;
  sdkSpyState = null;
}

function mockHttpsRequest(statusCode, responseBody) {
  const origHttps = https.request;
  let calls = 0;
  https.request = function mockedRequest(_options, callback) {
    calls += 1;
    const req = new EventEmitter();
    req.write = () => {};
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

const { parseImage, KEYS_FILE } = require('../src/services/image-parser');

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const ANSWER_TEXT = [
  'COID/MID: 987654 / 321098',
  'CASE: CS-2026-0042',
  'CLIENT/CONTACT: jane.doe@example.com',
  'CX IS ATTEMPTING TO: submit Q2 payroll',
  'EXPECTED OUTCOME: payroll filed without warnings',
  'ACTUAL OUTCOME: system shows a 5xx error after Step 3',
  'KB/TOOLS USED: payroll article',
  'TRIED TEST ACCOUNT: no',
  'TS STEPS: 1) Cleared cache 2) Retried with backup admin',
].join('\n');

test.beforeEach(() => {
  if (sdkSpyState) uninstallSdkSpy();
});

test.afterEach(() => {
  if (sdkSpyState) uninstallSdkSpy();
});

test('parseImage with provider=anthropic uses SDK adapter and forwards answer text', async () => {
  const cleanupKey = setupProviderKey('ANTHROPIC_API_KEY', 'sk-ant-test-sdk', KEYS_FILE);
  installSdkSpy(async () => ({
    text: ANSWER_TEXT,
    usage: { model: 'claude-sonnet-4-20250514', inputTokens: 1234, outputTokens: 256 },
  }));
  const httpsMock = mockHttpsRequest(200, { content: [{ type: 'text', text: 'DIRECT_HTTP_PATH_RAN' }] });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });

    assert.equal(sdkSpyState.calls.length, 1, 'parseImageWithSDK must be invoked once for default Anthropic');
    assert.equal(httpsMock.getCallCount(), 0, 'default Anthropic path must not call direct https.request');
    assert.equal(result.text, ANSWER_TEXT);
    assert.equal(result.role, 'escalation');
    assert.equal(result.parseFields.coid, '987654');
    assert.equal(result.parseFields.mid, '321098');
    assert.equal(result.usage.inputTokens, 1234);
    assert.equal(result.usage.outputTokens, 256);
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

test('parseImage with provider=anthropic forwards arbitrary SDK answer text without judging it', async () => {
  const cleanupKey = setupProviderKey('ANTHROPIC_API_KEY', 'sk-ant-test-arbitrary', KEYS_FILE);
  const arbitraryText = '1 2 3 4 5\nthis is not a parser template';
  installSdkSpy(async () => ({ text: arbitraryText, usage: null }));

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'anthropic' });

    assert.equal(result.text, arbitraryText);
    assert.equal(result.role, 'escalation');
    assert.deepEqual(result.parseFields, {});
    assert.ok(result.parseMeta);
    assert.equal(result.parseMeta.passed, false);
  } finally {
    cleanupKey();
  }
});

test('parseImage with provider=anthropic and structured=false still uses direct Anthropic HTTP path', async () => {
  const cleanupKey = setupProviderKey('ANTHROPIC_API_KEY', 'sk-ant-test-prose', KEYS_FILE);
  installSdkSpy(async () => {
    throw new Error('SDK path must not be invoked when structured=false');
  });
  const httpsMock = mockHttpsRequest(200, {
    content: [{ type: 'text', text: ANSWER_TEXT }],
    model: 'claude-sonnet-4-20250514',
    usage: { input_tokens: 50, output_tokens: 20 },
  });

  try {
    const result = await parseImage(TINY_PNG_BASE64, { provider: 'anthropic', structured: false });

    assert.equal(sdkSpyState.calls.length, 0, 'parseImageWithSDK must not run when structured=false');
    assert.equal(httpsMock.getCallCount(), 1, 'direct Anthropic path must call https.request once');
    assert.equal(result.text, ANSWER_TEXT);
    assert.equal(result.usage.inputTokens, 50);
    assert.equal(result.usage.outputTokens, 20);
  } finally {
    httpsMock.restore();
    cleanupKey();
  }
});

test('parseImage with SDK path throws PROVIDER_ERROR when SDK returns no text envelope', async () => {
  const cleanupKey = setupProviderKey('ANTHROPIC_API_KEY', 'sk-ant-fail', KEYS_FILE);
  installSdkSpy(async () => null);

  try {
    await assert.rejects(
      () => parseImage(TINY_PNG_BASE64, { provider: 'anthropic' }),
      (err) => {
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.match(err.message, /answer text/i);
        return true;
      }
    );
  } finally {
    cleanupKey();
  }
});
