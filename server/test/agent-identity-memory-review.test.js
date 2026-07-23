'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const AgentIdentity = require('../src/models/AgentIdentity');

test('agent memory can be confirmed, corrected, and forgotten with history evidence', async (t) => {
  await connect();
  const app = request(createApp());
  await AgentIdentity.deleteMany({});

  t.after(async () => {
    await AgentIdentity.deleteMany({});
    await disconnect();
  });

  await AgentIdentity.create({
    agentId: 'chat',
    memory: {
      notes: [{
        key: 'preference:explanations',
        kind: 'preference',
        content: 'Prefers very short explanations.',
        sourceRole: 'user',
        sourceSurface: 'chat',
        reviewStatus: 'inferred',
        updatedAt: new Date(),
      }],
    },
  });

  const confirmed = await app
    .patch('/api/agent-identities/chat/memory/preference%3Aexplanations')
    .send({ action: 'confirm' })
    .expect(200);
  assert.equal(confirmed.body.agent.memory.notes[0].reviewStatus, 'confirmed');
  assert.equal(confirmed.body.agent.memory.notes[0].reviewedBy, 'user');

  const corrected = await app
    .patch('/api/agent-identities/chat/memory/preference%3Aexplanations')
    .send({ action: 'correct', content: 'Prefers concise explanations with important context.' })
    .expect(200);
  assert.equal(corrected.body.agent.memory.notes[0].reviewStatus, 'corrected');
  assert.equal(corrected.body.agent.memory.notes[0].content, 'Prefers concise explanations with important context.');

  const forgotten = await app
    .delete('/api/agent-identities/chat/memory/preference%3Aexplanations')
    .expect(200);
  assert.equal(forgotten.body.agent.memory.notes.length, 0);
  assert.equal(forgotten.body.agent.history.entries[0].type, 'memory-forget');
  assert.equal(forgotten.body.agent.activity.entries[0].type, 'memory-review');
});
