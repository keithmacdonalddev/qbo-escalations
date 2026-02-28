const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { connect, disconnect } = require('./_mongo-helper');
const { createApp } = require('../src/app');
const Conversation = require('../src/models/Conversation');
const claude = require('../src/services/claude');
const codex = require('../src/services/codex');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse SSE events from a raw response buffer.
 * Returns an array of { event, data } objects.
 */
function parseSseEvents(raw) {
  const blocks = String(raw || '').split('\n\n');
  const events = [];
  for (const block of blocks) {
    if (!block || block.startsWith(':')) continue;
    const lines = block.split('\n');
    let event = '';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        data += (data ? '\n' : '') + line.slice('data:'.length).trim();
      }
    }
    if (event) events.push({ event, data });
  }
  return events;
}

/**
 * Make an SSE POST request to the chat endpoint using raw http.request().
 * Returns { req, dataPromise, waitForEvent, destroy, getRawChunks }.
 */
function sseRequest(port, body) {
  const payload = JSON.stringify(body);
  let chunks = '';
  let eventListeners = [];
  let resolveData;
  let responseRef = null;
  const dataPromise = new Promise((resolve) => { resolveData = resolve; });

  const agent = new http.Agent({ keepAlive: false });

  const req = http.request({
    hostname: '127.0.0.1',
    port,
    path: '/api/chat',
    method: 'POST',
    agent,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Connection': 'close',
    },
  });

  req.on('response', (res) => {
    responseRef = res;
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      chunks += chunk;
      const events = parseSseEvents(chunks);
      for (let i = eventListeners.length - 1; i >= 0; i--) {
        const { name, resolve: resolveFn } = eventListeners[i];
        const found = events.find((e) => e.event === name);
        if (found) {
          eventListeners.splice(i, 1);
          resolveFn(found);
        }
      }
    });
    res.on('end', () => resolveData(chunks));
    res.on('error', () => resolveData(chunks));
  });

  req.on('error', () => resolveData(chunks));
  req.end(payload);

  return {
    req,
    dataPromise,
    waitForEvent(name, timeoutMs = 10_000) {
      const existing = parseSseEvents(chunks).find((e) => e.event === name);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = eventListeners.findIndex((l) => l.name === name && l.resolve === wrappedResolve);
          if (idx >= 0) eventListeners.splice(idx, 1);
          reject(new Error('Timed out waiting for SSE event "' + name + '" after ' + timeoutMs + 'ms'));
        }, timeoutMs);
        function wrappedResolve(found) {
          clearTimeout(timer);
          resolve(found);
        }
        eventListeners.push({ name, resolve: wrappedResolve });
      });
    },
    destroy() {
      const socket = (responseRef && responseRef.socket) || req.socket;
      if (socket) socket.destroy();
      req.destroy();
    },
    getRawChunks() {
      return chunks;
    },
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createTestConversation(title) {
  return Conversation.create({
    title: title || 'Abort test',
    messages: [],
    provider: 'claude',
  });
}

// ---------------------------------------------------------------------------
// Suite: scoped hooks so they do not leak into other test files under
// --test-isolation=none.
// ---------------------------------------------------------------------------

test('abort suite', async (t) => {
  let app;
  let server;
  let port;
  let originalClaudeChat;
  let originalCodexChat;

  t.before(async () => {
    originalClaudeChat = claude.chat;
    originalCodexChat = codex.chat;
    await connect();
    app = createApp();
    server = app.listen(0);
    port = server.address().port;
  });

  t.afterEach(() => {
    claude.chat = originalClaudeChat;
    codex.chat = originalCodexChat;
  });

  t.after(async () => {
    claude.chat = originalClaudeChat;
    codex.chat = originalCodexChat;
    if (server) await new Promise((resolve) => server.close(resolve));
    await disconnect();
  });

  // -------------------------------------------------------------------------
  // Test 1
  // -------------------------------------------------------------------------

  await t.test('client disconnect during streaming calls orchestration cleanup', async () => {
    let cleanupCalled = false;

    claude.chat = ({ onChunk, onDone }) => {
      onChunk('partial');
      const handle = setTimeout(() => onDone('full response'), 30_000);
      return () => {
        cleanupCalled = true;
        clearTimeout(handle);
      };
    };

    const conversation = await createTestConversation('Abort test 1');

    const sse = sseRequest(port, {
      conversationId: conversation._id.toString(),
      message: 'test abort during streaming',
    });

    await sse.waitForEvent('chunk');
    sse.destroy();
    await delay(300);

    assert.equal(cleanupCalled, true, 'orchestration cleanup must be called on client disconnect');
  });

  // -------------------------------------------------------------------------
  // Test 2
  // -------------------------------------------------------------------------

  await t.test('client disconnect after stream settled does NOT call cleanup', async () => {
    let cleanupCalled = false;

    claude.chat = ({ onChunk, onDone }) => {
      onChunk('full');
      onDone('full');
      return () => {
        cleanupCalled = true;
      };
    };

    const conversation = await createTestConversation('Abort test 2');

    const sse = sseRequest(port, {
      conversationId: conversation._id.toString(),
      message: 'test abort after settlement',
    });

    await sse.waitForEvent('done');
    sse.destroy();
    await delay(300);

    assert.equal(cleanupCalled, false, 'cleanup must NOT be called after stream has settled');
  });

  // -------------------------------------------------------------------------
  // Test 3
  // -------------------------------------------------------------------------

  await t.test('abort during fallback cancels in-flight fallback provider', async () => {
    let codexCleanupCalled = false;

    claude.chat = ({ onError }) => {
      const err = new Error('primary failure');
      err.code = 'PROVIDER_EXEC_FAILED';
      onError(err);
      return () => {};
    };

    codex.chat = ({ onChunk, onDone }) => {
      onChunk('fallback partial');
      const handle = setTimeout(() => onDone('fallback complete'), 30_000);
      return () => {
        codexCleanupCalled = true;
        clearTimeout(handle);
      };
    };

    const conversation = await createTestConversation('Abort test 3');

    const sse = sseRequest(port, {
      conversationId: conversation._id.toString(),
      message: 'test abort during fallback',
      mode: 'fallback',
      primaryProvider: 'claude',
      fallbackProvider: 'chatgpt-5.3-codex-high',
    });

    await sse.waitForEvent('fallback');
    await sse.waitForEvent('chunk');
    sse.destroy();
    await delay(300);

    assert.equal(codexCleanupCalled, true, 'fallback provider cleanup must be called on client disconnect');
  });

  // -------------------------------------------------------------------------
  // Test 4
  // -------------------------------------------------------------------------

  await t.test('abort during parallel cancels all in-flight providers', async () => {
    let claudeCleanupCalled = false;
    let codexCleanupCalled = false;

    claude.chat = ({ onChunk, onDone }) => {
      onChunk('claude partial');
      const handle = setTimeout(() => onDone('claude done'), 30_000);
      return () => {
        claudeCleanupCalled = true;
        clearTimeout(handle);
      };
    };

    codex.chat = ({ onChunk, onDone }) => {
      onChunk('codex partial');
      const handle = setTimeout(() => onDone('codex done'), 30_000);
      return () => {
        codexCleanupCalled = true;
        clearTimeout(handle);
      };
    };

    const conversation = await createTestConversation('Abort test 4');

    const sse = sseRequest(port, {
      conversationId: conversation._id.toString(),
      message: 'test abort during parallel',
      mode: 'parallel',
      primaryProvider: 'claude',
      fallbackProvider: 'chatgpt-5.3-codex-high',
    });

    await sse.waitForEvent('chunk');
    sse.destroy();
    await delay(300);

    assert.equal(claudeCleanupCalled, true, 'claude provider cleanup must be called on parallel abort');
    assert.equal(codexCleanupCalled, true, 'codex provider cleanup must be called on parallel abort');
  });

  // -------------------------------------------------------------------------
  // Test 5
  // -------------------------------------------------------------------------

  await t.test('client disconnect after error settlement does NOT call cleanup', async () => {
    let cleanupCalled = false;

    claude.chat = ({ onError }) => {
      const err = new Error('immediate failure');
      err.code = 'PROVIDER_EXEC_FAILED';
      onError(err);
      return () => {
        cleanupCalled = true;
      };
    };

    const conversation = await createTestConversation('Abort test 5 - error settle');

    const sse = sseRequest(port, {
      conversationId: conversation._id.toString(),
      message: 'test abort after error settlement',
    });

    await sse.waitForEvent('error');
    sse.destroy();
    await delay(300);

    assert.equal(cleanupCalled, false, 'cleanup must NOT be called after stream has settled via error');
  });

  // -------------------------------------------------------------------------
  // Test 6
  // -------------------------------------------------------------------------

  await t.test('double destroy does not crash or double-invoke cleanup', async () => {
    let cleanupCount = 0;

    claude.chat = ({ onChunk, onDone }) => {
      onChunk('partial');
      const handle = setTimeout(() => onDone('full'), 30_000);
      return () => {
        cleanupCount++;
        clearTimeout(handle);
      };
    };

    const conversation = await createTestConversation('Abort test 6 - idempotent');

    const sse = sseRequest(port, {
      conversationId: conversation._id.toString(),
      message: 'test double destroy',
    });

    await sse.waitForEvent('chunk');
    sse.destroy();
    sse.destroy();
    await delay(300);

    assert.ok(cleanupCount <= 1, 'cleanup must be called at most once on double destroy (got ' + cleanupCount + ')');
  });

  // -------------------------------------------------------------------------
  // Test 7
  // -------------------------------------------------------------------------

  await t.test('abort before provider emits any data still triggers cleanup', async () => {
    let cleanupCalled = false;

    claude.chat = ({ onDone }) => {
      const handle = setTimeout(() => onDone('very late'), 30_000);
      return () => {
        cleanupCalled = true;
        clearTimeout(handle);
      };
    };

    const conversation = await createTestConversation('Abort test 7 - no chunks');

    const sse = sseRequest(port, {
      conversationId: conversation._id.toString(),
      message: 'test abort before any chunks',
    });

    await sse.waitForEvent('start');
    sse.destroy();
    await delay(300);

    assert.equal(cleanupCalled, true, 'cleanup must be called even when provider emitted no data');
  });

  // -------------------------------------------------------------------------
  // Test 8
  // -------------------------------------------------------------------------

  await t.test('user message persisted to conversation before abort', async () => {
    claude.chat = ({ onChunk, onDone }) => {
      onChunk('partial');
      const handle = setTimeout(() => onDone('full'), 30_000);
      return () => { clearTimeout(handle); };
    };

    const conversation = await createTestConversation('Abort test 8 - persistence');

    const sse = sseRequest(port, {
      conversationId: conversation._id.toString(),
      message: 'my important question',
    });

    await sse.waitForEvent('start');
    sse.destroy();
    await delay(300);

    const reloaded = await Conversation.findById(conversation._id).lean();
    assert.ok(reloaded, 'conversation must exist in DB');
    assert.ok(reloaded.messages.length >= 1, 'at least the user message must be saved');

    const userMsg = reloaded.messages.find((m) => m.role === 'user');
    assert.ok(userMsg, 'user message must be present');
    assert.equal(userMsg.content, 'my important question', 'user message content must match');
  });

  // -------------------------------------------------------------------------
  // Test 9
  // -------------------------------------------------------------------------

  await t.test('abort during 3-way parallel cancels all in-flight providers', async () => {
    let claudeCleanupCount = 0;
    let codexCleanupCount = 0;

    claude.chat = ({ onChunk, onDone }) => {
      onChunk('claude partial');
      const handle = setTimeout(() => onDone('claude done'), 30_000);
      return () => {
        claudeCleanupCount++;
        clearTimeout(handle);
      };
    };

    codex.chat = ({ onChunk, onDone }) => {
      onChunk('codex partial');
      const handle = setTimeout(() => onDone('codex done'), 30_000);
      return () => {
        codexCleanupCount++;
        clearTimeout(handle);
      };
    };

    const conversation = await createTestConversation('Abort test 9 - 3-way parallel');

    const sse = sseRequest(port, {
      conversationId: conversation._id.toString(),
      message: 'test abort during 3-way parallel',
      mode: 'parallel',
      primaryProvider: 'claude',
      parallelProviders: ['claude', 'chatgpt-5.3-codex-high', 'claude-sonnet-4-6'],
    });

    await sse.waitForEvent('chunk');
    sse.destroy();
    await delay(300);

    assert.equal(claudeCleanupCount, 2, 'both claude-family providers must be cleaned up');
    assert.equal(codexCleanupCount, 1, 'codex provider must be cleaned up');
  });

  // -------------------------------------------------------------------------
  // Test 10
  // -------------------------------------------------------------------------

  await t.test('abort when one parallel provider already settled only cleans up in-flight', async () => {
    let claudeCleanupCalled = false;
    let codexCleanupCalled = false;

    claude.chat = ({ onChunk, onDone }) => {
      onChunk('claude done');
      onDone('claude done');
      return () => {
        claudeCleanupCalled = true;
      };
    };

    codex.chat = ({ onChunk, onDone }) => {
      onChunk('codex partial');
      const handle = setTimeout(() => onDone('codex done'), 30_000);
      return () => {
        codexCleanupCalled = true;
        clearTimeout(handle);
      };
    };

    const conversation = await createTestConversation('Abort test 10 - partial settle');

    const sse = sseRequest(port, {
      conversationId: conversation._id.toString(),
      message: 'test abort with partial settlement',
      mode: 'parallel',
      primaryProvider: 'claude',
      fallbackProvider: 'chatgpt-5.3-codex-high',
    });

    await sse.waitForEvent('chunk');
    await delay(50);
    sse.destroy();
    await delay(300);

    assert.equal(claudeCleanupCalled, false, 'settled provider cleanup must NOT be called');
    assert.equal(codexCleanupCalled, true, 'in-flight provider cleanup must be called');
  });

  // -------------------------------------------------------------------------
  // Test 11
  // -------------------------------------------------------------------------

  await t.test('SSE stream contains chunk events before abort', async () => {
    claude.chat = ({ onChunk, onDone }) => {
      onChunk('hello ');
      onChunk('world');
      const handle = setTimeout(() => onDone('hello world'), 30_000);
      return () => { clearTimeout(handle); };
    };

    const conversation = await createTestConversation('Abort test 11 - SSE events');

    const sse = sseRequest(port, {
      conversationId: conversation._id.toString(),
      message: 'test sse events before abort',
    });

    await sse.waitForEvent('chunk');
    await delay(50);
    sse.destroy();
    await delay(100);

    const events = parseSseEvents(sse.getRawChunks());
    const startEvents = events.filter((e) => e.event === 'start');
    const chunkEvents = events.filter((e) => e.event === 'chunk');

    assert.equal(startEvents.length, 1, 'exactly one start event');
    assert.ok(chunkEvents.length >= 1, 'at least one chunk event before abort');
  });

  // -------------------------------------------------------------------------
  // Test 12
  // -------------------------------------------------------------------------

  await t.test('abort when provider cleanup throws does not crash server', async () => {
    claude.chat = ({ onChunk, onDone }) => {
      onChunk('partial');
      const handle = setTimeout(() => onDone('full'), 30_000);
      return () => {
        clearTimeout(handle);
        throw new Error('cleanup explosion');
      };
    };

    const conversation = await createTestConversation('Abort test 12 - cleanup throws');

    const sse = sseRequest(port, {
      conversationId: conversation._id.toString(),
      message: 'test cleanup explosion',
    });

    await sse.waitForEvent('chunk');
    sse.destroy();
    await delay(300);

    const healthCheck = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/api/health',
        method: 'GET',
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      });
      req.on('error', reject);
      req.end();
    });

    assert.ok(healthCheck, 'server must still respond after cleanup throw');
    assert.equal(healthCheck.ok, true, 'health check must return ok: true');
  });

  // -------------------------------------------------------------------------
  // Test 13
  // -------------------------------------------------------------------------

  await t.test('abort during streaming does not prevent future requests', async () => {
    let firstCleanupCalled = false;

    claude.chat = ({ onChunk, onDone }) => {
      onChunk('first partial');
      const handle = setTimeout(() => onDone('first full'), 30_000);
      return () => {
        firstCleanupCalled = true;
        clearTimeout(handle);
      };
    };

    const conversation = await createTestConversation('Abort test 13');

    const sse1 = sseRequest(port, {
      conversationId: conversation._id.toString(),
      message: 'first request',
    });

    await sse1.waitForEvent('chunk');
    sse1.destroy();
    await delay(300);

    assert.equal(firstCleanupCalled, true, 'first request cleanup must be called');

    claude.chat = ({ onChunk, onDone }) => {
      onChunk('second full');
      onDone('second full');
      return () => {};
    };

    const sse2 = sseRequest(port, {
      conversationId: conversation._id.toString(),
      message: 'second request after abort',
    });

    const doneEvent = await sse2.waitForEvent('done');
    assert.ok(doneEvent, 'second request must complete successfully after first was aborted');
    sse2.destroy();
  });

  // -------------------------------------------------------------------------
  // Test 14
  // -------------------------------------------------------------------------

  await t.test('provider late onDone after abort is a no-op', async () => {
    let cleanupCalled = false;
    let onDoneRef = null;

    claude.chat = ({ onChunk, onDone }) => {
      onDoneRef = onDone;
      onChunk('partial');
      return () => {
        cleanupCalled = true;
      };
    };

    const conversation = await createTestConversation('Abort test 14 - late onDone');

    const sse = sseRequest(port, {
      conversationId: conversation._id.toString(),
      message: 'test late onDone after abort',
    });

    await sse.waitForEvent('chunk');
    sse.destroy();
    await delay(300);

    assert.equal(cleanupCalled, true, 'cleanup must be called');

    assert.doesNotThrow(() => {
      if (onDoneRef) onDoneRef('late response');
    }, 'late onDone must not throw after abort');
  });

  // -------------------------------------------------------------------------
  // Test 15
  // -------------------------------------------------------------------------

  await t.test('rapid sequential abort requests are isolated', async () => {
    let cleanupCallCount = 0;

    claude.chat = ({ onChunk, onDone }) => {
      onChunk('partial');
      const handle = setTimeout(() => onDone('full'), 30_000);
      return () => {
        cleanupCallCount++;
        clearTimeout(handle);
      };
    };

    for (let i = 0; i < 3; i++) {
      const conversation = await createTestConversation('Abort test 15 iteration ' + i);

      const sse = sseRequest(port, {
        conversationId: conversation._id.toString(),
        message: 'rapid abort ' + i,
      });

      await sse.waitForEvent('chunk');
      sse.destroy();
      await delay(200);
    }

    assert.equal(cleanupCallCount, 3, 'each abort must trigger exactly one cleanup (got ' + cleanupCallCount + ')');
  });
});
