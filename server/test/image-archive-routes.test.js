const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const Conversation = require('../src/models/Conversation');

const SAMPLE_PNG_DATA_URL = 'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3Z8UkAAAAASUVORK5CYII=';

function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

test('image archive routes fallback to conversation images when disk archive is empty', async (t) => {
  let app;
  let agent;

  t.before(async () => {
    process.env.NODE_ENV = 'test';
    await connect();
    app = createApp();
    agent = request(app);
  });

  t.after(async () => {
    await disconnect();
  });

  t.beforeEach(async () => {
    await Conversation.deleteMany({});
  });

  await t.test('stats, all, metadata, and file endpoints expose conversation-backed images', async () => {
    const conversation = await Conversation.create({
      title: 'Image fallback test',
      provider: 'claude',
      messages: [
        {
          role: 'user',
          content: 'Test image prompt',
          images: [SAMPLE_PNG_DATA_URL],
          timestamp: new Date('2026-03-20T11:29:43.242Z'),
        },
      ],
    });

    const statsRes = await agent.get('/api/chat/image-archive/stats');
    assert.equal(statsRes.status, 200);
    assert.equal(statsRes.body.ok, true);
    assert.equal(statsRes.body.totalImages, 1);
    assert.equal(statsRes.body.totalConversations, 1);

    const allRes = await agent.get('/api/chat/image-archive/all?limit=60&offset=0');
    assert.equal(allRes.status, 200);
    assert.equal(allRes.body.ok, true);
    assert.equal(allRes.body.total, 1);
    assert.equal(allRes.body.images.length, 1);

    const imageEntry = allRes.body.images[0];
    assert.equal(imageEntry.conversationId, conversation._id.toString());
    assert.equal(imageEntry.userPrompt, 'Test image prompt');
    assert.equal(imageEntry.image.extension, 'png');
    assert.equal(imageEntry.image.mimeSubtype, 'png');
    assert.match(imageEntry._imageId, /^msg-0-img-0$/);

    const metadataRes = await agent.get(`/api/chat/image-archive/${conversation._id}/${imageEntry._imageId}/metadata`);
    assert.equal(metadataRes.status, 200);
    assert.equal(metadataRes.body.ok, true);
    assert.equal(metadataRes.body.metadata._imageId, imageEntry._imageId);

    const fileRes = await agent
      .get(`/api/chat/image-archive/${conversation._id}/${imageEntry._imageId}/file`)
      .buffer(true)
      .parse(binaryParser);
    assert.equal(fileRes.status, 200);
    assert.match(fileRes.headers['content-type'], /^image\/png/);
    assert.ok(Buffer.isBuffer(fileRes.body));
    assert.ok(fileRes.body.length > 0);
  });
});
