'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { observableRequestPath } = require('../src/services/request-runtime');

test('runtime diagnostics retain only route paths and never query strings or fragments', () => {
  assert.equal(
    observableRequestPath({ originalUrl: '/api/search?q=customer-secret&token=private#details' }),
    '/api/search',
  );
  assert.equal(observableRequestPath({ url: '/api/runtime/health' }), '/api/runtime/health');
  assert.equal(observableRequestPath({ originalUrl: '' }), '');
});
