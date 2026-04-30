'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const UserPreferences = require('../src/models/UserPreferences');

test('preferences routes persist AI assistant defaults', async (t) => {
  await connect();
  const agent = request(createApp());
  await UserPreferences.deleteMany({});

  t.after(async () => {
    await UserPreferences.deleteMany({});
    await disconnect();
  });

  const aiAssistantDefaults = {
    settings: {
      providerStrategy: {
        defaultMode: 'single',
        defaultPrimaryProvider: 'gpt-5.5',
        defaultFallbackProvider: 'llm-gateway',
        reasoningEffort: 'high',
        timeoutMs: 0,
      },
    },
    agents: {
      chat: {
        provider: 'gpt-5.5',
        mode: 'single',
        fallbackProvider: 'llm-gateway',
        model: '',
        fallbackModel: '',
        reasoningEffort: 'high',
      },
      workspace: {
        provider: 'llm-gateway',
        mode: 'fallback',
        fallbackProvider: 'gpt-5.5',
        model: 'auto',
        fallbackModel: '',
        reasoningEffort: 'high',
      },
      'image-parser': {
        provider: 'llm-gateway',
        model: 'qwen/qwen3.6-27b',
      },
    },
  };

  const putRes = await agent
    .put('/api/preferences')
    .send({
      defaultGmailAccount: 'Support@Example.com',
      aiAssistantDefaults,
    })
    .expect(200);

  assert.equal(putRes.body.ok, true);
  assert.equal(putRes.body.defaultGmailAccount, 'support@example.com');
  assert.deepEqual(putRes.body.aiAssistantDefaults, aiAssistantDefaults);

  const getRes = await agent.get('/api/preferences').expect(200);
  assert.equal(getRes.body.ok, true);
  assert.equal(getRes.body.defaultGmailAccount, 'support@example.com');
  assert.deepEqual(getRes.body.aiAssistantDefaults, aiAssistantDefaults);
});
