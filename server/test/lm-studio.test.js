'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { EventEmitter } = require('events');

const SERVICE_PATH = require.resolve('../src/services/lm-studio');
const origRequest = http.request;
const origGet = http.get;

let queuedResponses = [];
let seenRequests = [];

function queueHttpResponses(responses) {
  queuedResponses = Array.isArray(responses) ? responses.slice() : [];
  seenRequests = [];
}

function restoreHttp() {
  http.request = origRequest;
  http.get = origGet;
}

function installHttpMock() {
  http.request = function mockedRequest(options, callback) {
    const normalizedOptions = typeof options === 'string' ? new URL(options) : options;
    const path = normalizedOptions.pathname || normalizedOptions.path;
    const headers = normalizedOptions.headers || {};
    const nextResponse = queuedResponses.find((entry) => entry.path === path) || queuedResponses[0];

    if (!nextResponse) {
      return origRequest.apply(http, arguments);
    }

    seenRequests.push({ path, headers });

    const req = new EventEmitter();
    req.write = () => {};
    req.destroy = () => {};
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = nextResponse.statusCode;

      process.nextTick(() => {
        if (typeof callback === 'function') {
          callback(res);
        }

        process.nextTick(() => {
          const body = typeof nextResponse.body === 'string'
            ? nextResponse.body
            : JSON.stringify(nextResponse.body);
          if (body) {
            res.emit('data', body);
          }
          res.emit('end');
        });
      });
    };

    return req;
  };

  http.get = function mockedGet(url, options, callback) {
    const requestOptions = typeof options === 'function' || options == null ? url : options;
    const cb = typeof options === 'function' ? options : callback;
    const req = http.request(requestOptions, cb);
    req.end();
    return req;
  };
}

function loadService() {
  delete require.cache[SERVICE_PATH];
  return require(SERVICE_PATH);
}

test.beforeEach(() => {
  restoreHttp();
  installHttpMock();
  delete process.env.LM_STUDIO_API_TOKEN;
  delete process.env.LM_STUDIO_API_KEY;
});

test.after(() => {
  restoreHttp();
  delete process.env.LM_STUDIO_API_TOKEN;
  delete process.env.LM_STUDIO_API_KEY;
});

test('getModelSnapshot prefers native /api/v1/models and exposes available unloaded models', async () => {
  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [
          {
            type: 'llm',
            key: 'google/gemma-4-26b-a4b',
            display_name: 'Gemma 4 26B A4B',
            loaded_instances: []
          }
        ]
      }
    }
  ]);

  const { getModelSnapshot, getLoadedModel, clearModelCache } = loadService();
  clearModelCache();

  const snapshot = await getModelSnapshot('http://127.0.0.1:1234');
  const detectedModel = await getLoadedModel('http://127.0.0.1:1234');

  assert.equal(snapshot.source, 'native');
  assert.equal(snapshot.status, 'no_model_loaded');
  assert.equal(snapshot.loadedModel, null);
  assert.equal(snapshot.availableModel, 'google/gemma-4-26b-a4b');
  assert.equal(detectedModel, 'google/gemma-4-26b-a4b');
  assert.deepEqual(seenRequests.map((entry) => entry.path), ['/api/v1/models', '/api/v1/models']);
});

test('getModelSnapshot falls back to legacy /v1/models when the native endpoint is unavailable', async () => {
  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 404,
      body: 'Not Found'
    },
    {
      path: '/v1/models',
      statusCode: 200,
      body: {
        object: 'list',
        data: [
          { id: 'qwen/qwen3.5-9b', object: 'model', owned_by: 'lm-studio' }
        ]
      }
    }
  ]);

  const { getModelSnapshot, clearModelCache } = loadService();
  clearModelCache();

  const snapshot = await getModelSnapshot('http://127.0.0.1:1234');

  assert.equal(snapshot.source, 'compat');
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.loadedModel, 'qwen/qwen3.5-9b');
  assert.equal(snapshot.availableModel, 'qwen/qwen3.5-9b');
  assert.deepEqual(seenRequests.map((entry) => entry.path), ['/api/v1/models', '/v1/models']);
});

test('LM Studio requests include Authorization when LM_STUDIO_API_TOKEN is configured', async () => {
  process.env.LM_STUDIO_API_TOKEN = 'lm-token-test';

  queueHttpResponses([
    {
      path: '/api/v1/models',
      statusCode: 200,
      body: {
        models: [
          {
            type: 'llm',
            key: 'google/gemma-4-26b-a4b',
            loaded_instances: []
          }
        ]
      }
    }
  ]);

  const { getModelSnapshot } = loadService();
  await getModelSnapshot('http://127.0.0.1:1234');

  assert.equal(seenRequests[0]?.headers?.Authorization, 'Bearer lm-token-test');
});
