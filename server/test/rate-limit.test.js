const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter } = require('../src/middleware/rate-limit');

function makeReq(ip = '127.0.0.1') {
  return { ip, socket: { remoteAddress: ip } };
}

function makeRes() {
  return {
    headers: {},
    statusCode: 200,
    payload: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

test('rate limiter allows requests under limit and blocks when exceeded', () => {
  const prevEnv = process.env.NODE_ENV;
  try {
    delete process.env.RATE_LIMIT_DISABLED;
    process.env.NODE_ENV = 'development';

    const limiter = createRateLimiter({ name: 'unit', limit: 2, windowMs: 1000 });
    let nextCount = 0;
    const next = () => { nextCount++; };

    const req = makeReq('local');
    const res1 = makeRes();
    limiter(req, res1, next);
    assert.equal(nextCount, 1);
    assert.equal(res1.statusCode, 200);

    const res2 = makeRes();
    limiter(req, res2, next);
    assert.equal(nextCount, 2);
    assert.equal(res2.statusCode, 200);

    const res3 = makeRes();
    limiter(req, res3, next);
    assert.equal(nextCount, 2);
    assert.equal(res3.statusCode, 429);
    assert.equal(res3.payload.code, 'RATE_LIMITED');
  } finally {
    process.env.NODE_ENV = prevEnv;
  }
});
