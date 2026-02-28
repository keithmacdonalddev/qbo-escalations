const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadSseModule() {
  const modulePath = path.resolve(__dirname, '..', '..', 'client', 'src', 'api', 'sse.js');
  return import(pathToFileURL(modulePath).href);
}

test('SSE decoder handles split event/data frames across chunks', async () => {
  const { createSSEDecoder } = await loadSseModule();
  const events = [];
  const decoder = createSSEDecoder((event, data) => events.push({ event, data }));

  decoder.pushChunk('event: do');
  decoder.pushChunk('ne\n');
  decoder.pushChunk('data: {"ok":tr');
  decoder.pushChunk('ue}\n\n');
  decoder.finish();

  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'done');
  assert.deepEqual(events[0].data, { ok: true });
});

test('SSE decoder ignores comments and supports multiple events', async () => {
  const { createSSEDecoder } = await loadSseModule();
  const events = [];
  const decoder = createSSEDecoder((event, data) => events.push({ event, data }));

  decoder.pushChunk(':heartbeat\n');
  decoder.pushChunk('event: chunk\n');
  decoder.pushChunk('data: {"text":"a"}\n\n');
  decoder.pushChunk('event: error\n');
  decoder.pushChunk('data: {"error":"boom"}\n\n');
  decoder.finish();

  assert.equal(events.length, 2);
  assert.equal(events[0].event, 'chunk');
  assert.deepEqual(events[0].data, { text: 'a' });
  assert.equal(events[1].event, 'error');
  assert.deepEqual(events[1].data, { error: 'boom' });
});
