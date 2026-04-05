const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const request = require('supertest');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const ImageParseResult = require('../src/models/ImageParseResult');
const {
  archiveParserImage,
  PARSER_ARCHIVE_ROOT,
} = require('../src/lib/image-parser-archive');

const SAMPLE_PNG_DATA_URL = 'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3Z8UkAAAAASUVORK5CYII=';

function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

test('image parser gallery routes expose archived source screenshots', async (t) => {
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
    await ImageParseResult.deleteMany({});
    fs.rmSync(PARSER_ARCHIVE_ROOT, { recursive: true, force: true });
  });

  await t.test('history list, detail, and image endpoints surface archived parser screenshots', async () => {
    const result = await ImageParseResult.create({
      provider: 'lm-studio',
      model: 'test-vision-model',
      status: 'ok',
      role: 'escalation',
      parsedText: 'COID/MID: 123456',
      textLength: 16,
    });

    const archived = archiveParserImage(result._id, SAMPLE_PNG_DATA_URL);
    assert.equal(archived.ok, true);

    result.set('image.sourceFileName', archived.fileName);
    result.set('image.sourceContentType', archived.contentType);
    result.set('image.sourceSizeBytes', archived.sizeBytes);
    result.set('image.sourceStoredAt', new Date('2026-03-28T12:00:00.000Z'));
    await result.save();

    const historyRes = await agent.get('/api/image-parser/history?limit=10&page=1');
    assert.equal(historyRes.status, 200);
    assert.equal(historyRes.body.ok, true);
    assert.equal(historyRes.body.results.length, 1);
    assert.equal(historyRes.body.results[0].hasSourceImage, true);
    assert.equal(historyRes.body.results[0].sourceImageUrl, `/api/image-parser/history/${result._id}/image`);

    const detailRes = await agent.get(`/api/image-parser/history/${result._id}`);
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.body.ok, true);
    assert.equal(detailRes.body.result.hasSourceImage, true);
    assert.equal(detailRes.body.result.sourceImageUrl, `/api/image-parser/history/${result._id}/image`);

    const fileRes = await agent
      .get(`/api/image-parser/history/${result._id}/image`)
      .buffer(true)
      .parse(binaryParser);
    assert.equal(fileRes.status, 200);
    assert.match(fileRes.headers['content-type'], /^image\/png/);
    assert.ok(Buffer.isBuffer(fileRes.body));
    assert.ok(fileRes.body.length > 0);
  });

  await t.test('legacy parse results without an archived screenshot return SOURCE_IMAGE_NOT_FOUND', async () => {
    const result = await ImageParseResult.create({
      provider: 'lm-studio',
      status: 'ok',
      parsedText: 'Old parser entry',
      textLength: 16,
    });

    const fileRes = await agent.get(`/api/image-parser/history/${result._id}/image`);
    assert.equal(fileRes.status, 404);
    assert.equal(fileRes.body.ok, false);
    assert.equal(fileRes.body.code, 'SOURCE_IMAGE_NOT_FOUND');
  });
});
