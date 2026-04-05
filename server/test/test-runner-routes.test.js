'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');

function parseSseEvents(payload) {
  const blocks = String(payload || '').split('\n\n');
  const events = [];

  for (const block of blocks) {
    if (!block || block.startsWith(':')) continue;
    const lines = block.split('\n');
    let event = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
      if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice('data:'.length).trim();
    }
    if (!event) continue;
    events.push({
      event,
      data: data ? JSON.parse(data) : null,
    });
  }

  return events;
}

test('test-runner routes', async (t) => {
  const app = createApp();
  const agent = request(app);

  await t.test('groups endpoint returns catalog with counts', async () => {
    const response = await agent.get('/api/test-runner/groups').expect(200);

    assert.equal(response.body.ok, true);
    assert.ok(Array.isArray(response.body.groups));
    assert.ok(response.body.totalTestCount > 0);

    const imageParserGroup = response.body.groups.find((group) => group.id === 'image-parser');
    assert.ok(imageParserGroup);
    assert.ok(imageParserGroup.testCount > 0);
  });

  await t.test('group tests endpoint returns parsed test names', async () => {
    const response = await agent.get('/api/test-runner/groups/image-parser/tests').expect(200);

    assert.equal(response.body.ok, true);
    assert.ok(Array.isArray(response.body.files));

    const parserFile = response.body.files.find((file) => file.name === 'image-parser.test.js');
    assert.ok(parserFile);
    assert.ok(Array.isArray(parserFile.tests));
    assert.ok(parserFile.tests.includes('returns null for empty string'));
  });

  await t.test('image parser catalog count matches the live run total', async () => {
    const groupsResponse = await agent.get('/api/test-runner/groups').expect(200);
    const imageParserGroup = groupsResponse.body.groups.find((group) => group.id === 'image-parser');

    const response = await agent
      .post('/api/test-runner/run')
      .send({ group: 'image-parser' })
      .buffer(true)
      .parse((res, callback) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => callback(null, body));
      })
      .expect(200);

    const events = parseSseEvents(response.body);
    const completion = events.find((entry) => entry.event === 'suite-complete');

    assert.ok(imageParserGroup);
    assert.ok(completion);
    assert.equal(completion.data.total, imageParserGroup.testCount);
  });

  await t.test('run endpoint streams SSE results for a focused group', async () => {
    const response = await agent
      .post('/api/test-runner/run')
      .send({ group: 'provider' })
      .buffer(true)
      .parse((res, callback) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => callback(null, body));
      })
      .expect(200);

    const events = parseSseEvents(response.body);
    const eventNames = events.map((entry) => entry.event);

    assert.ok(eventNames.includes('run-start'));
    assert.ok(eventNames.includes('test-plan'));
    assert.ok(eventNames.includes('test-result'));
    assert.ok(eventNames.includes('suite-complete'));

    const completion = events.find((entry) => entry.event === 'suite-complete');
    assert.ok(completion);
    assert.equal(completion.data.failed, 0);
    assert.ok(completion.data.total > 0);
  });
});
