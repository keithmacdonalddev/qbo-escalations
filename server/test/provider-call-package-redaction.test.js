'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  redactHeaders,
  redactRawHeaders,
  redactProviderCallPackage,
} = require('../src/services/provider-call-package-redaction');

test('redactHeaders redacts secret headers case-insensitively', () => {
  const result = redactHeaders({
    Authorization: 'Bearer sk-test',
    'x-goog-api-key': 'AIza-test',
    'content-type': 'application/json',
  });

  assert.equal(result.headers.Authorization, 'Bearer [REDACTED]');
  assert.equal(result.headers['x-goog-api-key'], '[REDACTED]');
  assert.equal(result.headers['content-type'], 'application/json');
  assert.deepEqual(result.redactedHeaderNames.sort(), ['authorization', 'x-goog-api-key']);
});

test('redactRawHeaders preserves names and redacts secret values', () => {
  const result = redactRawHeaders([
    'content-type', 'application/json',
    'set-cookie', 'sid=secret',
    'x-token-id', 'token-value',
  ]);

  assert.deepEqual(result.rawHeaders, [
    'content-type', 'application/json',
    'set-cookie', '[REDACTED]',
    'x-token-id', '[REDACTED]',
  ]);
  assert.deepEqual(result.redactedHeaderNames.sort(), ['set-cookie', 'x-token-id']);
});

test('redactProviderCallPackage redacts headers and secret-like body fields without mutating input', () => {
  const envelope = {
    request: {
      headers: { Authorization: 'Bearer sk-test' },
      bodyText: JSON.stringify({
        model: 'kimi-k2.6',
        messages: [{ role: 'user', content: 'keep prompt text' }],
        accessToken: 'secret-token',
      }),
      bodyJson: {
        model: 'kimi-k2.6',
        messages: [{ role: 'user', content: 'keep prompt text' }],
        accessToken: 'secret-token',
        nested: { credential: 'secret-credential' },
      },
    },
    response: {
      headers: { 'x-request-id': 'req-1' },
      rawHeaders: ['set-cookie', 'sid=secret'],
      parsedJson: { apiKey: 'response-secret', answer: 'keep answer text' },
    },
  };

  const redacted = redactProviderCallPackage(envelope);

  assert.equal(redacted.request.headers.Authorization, 'Bearer [REDACTED]');
  assert.equal(redacted.request.bodyJson.messages[0].content, 'keep prompt text');
  assert.equal(redacted.request.bodyJson.accessToken, '[REDACTED]');
  assert.equal(redacted.request.bodyJson.nested.credential, '[REDACTED]');
  assert.equal(redacted.request.bodyText.includes('secret-token'), false);
  assert.equal(redacted.request.bodyText.includes('[REDACTED]'), true);
  assert.equal(redacted.response.parsedJson.apiKey, '[REDACTED]');
  assert.equal(envelope.request.headers.Authorization, 'Bearer sk-test');
  assert.equal(envelope.request.bodyJson.accessToken, 'secret-token');
  assert.equal(redacted.redaction.applied, true);
  assert.ok(redacted.redaction.redactedHeaderNames.includes('authorization'));
  assert.ok(redacted.redaction.redactedBodyPaths.includes('request.bodyJson.accessToken'));
  assert.ok(redacted.redaction.notes.includes('request.bodyText regenerated after body secret redaction'));
});

test('redactProviderCallPackage redacts JSON string request bodies', () => {
  const envelope = {
    request: {
      headers: {},
      bodyKind: 'text',
      bodyJson: null,
      bodyText: JSON.stringify({ apiKey: 'sk-secret', prompt: 'keep prompt' }),
      bodyByteLength: 45,
      bodySha256: 'before',
    },
  };

  const redacted = redactProviderCallPackage(envelope);

  assert.equal(redacted.request.bodyText.includes('sk-secret'), false);
  assert.equal(redacted.request.bodyText.includes('[REDACTED]'), true);
  assert.equal(JSON.parse(redacted.request.bodyText).prompt, 'keep prompt');
  assert.notEqual(redacted.request.bodySha256, 'before');
  assert.ok(redacted.redaction.redactedBodyPaths.includes('request.bodyText.apiKey'));
  assert.ok(redacted.redaction.notes.includes('request.bodyText JSON string redacted'));
});

test('redactProviderCallPackage redacts JSON string error raw bodies', () => {
  const envelope = {
    error: {
      rawBody: JSON.stringify({ credential: 'provider-secret', message: 'bad request' }),
    },
  };

  const redacted = redactProviderCallPackage(envelope);

  assert.equal(redacted.error.rawBody.includes('provider-secret'), false);
  assert.equal(JSON.parse(redacted.error.rawBody).credential, '[REDACTED]');
  assert.equal(JSON.parse(redacted.error.rawBody).message, 'bad request');
  assert.ok(redacted.redaction.redactedBodyPaths.includes('error.rawBody.credential'));
  assert.ok(redacted.redaction.notes.includes('error.rawBody JSON string redacted'));
});
