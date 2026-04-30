'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectRole,
  normalizeImageParsePromptId,
} = require('../src/services/image-parser');

test('normalizeImageParsePromptId only allows known parser prompts', () => {
  assert.equal(normalizeImageParsePromptId('escalation-template-parser'), 'escalation-template-parser');
  assert.equal(normalizeImageParsePromptId('follow-up-chat-parser'), 'follow-up-chat-parser');
  assert.equal(normalizeImageParsePromptId('sdk-image-parse'), 'image-parser');
  assert.equal(normalizeImageParsePromptId(''), 'image-parser');
});

test('detectRole respects strict parser prompt hints', () => {
  assert.equal(
    detectRole('Context type: phone-agent-follow-up\n\nVerbatim transcript:\nAgent: Customer called back.', {
      promptId: 'follow-up-chat-parser',
    }),
    'follow-up-chat'
  );
  assert.equal(
    detectRole('COID/MID: 123\nCASE: 456', {
      promptId: 'escalation-template-parser',
    }),
    'escalation'
  );
});
