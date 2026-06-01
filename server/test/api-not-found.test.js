const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');

// Batch 3 / Fix #7: unmatched /api routes must return the universal
// { ok:false, code, error } JSON contract with HTTP 404 — never Express's
// default HTML "Cannot GET /api/foo" page (which breaks clients calling
// res.json()). The catch-all is pure routing and needs no DB connection.
test('unmatched /api route suite', async (t) => {
  let app;

  t.before(() => {
    process.env.NODE_ENV = 'test';
    app = createApp();
  });

  await t.test('GET /api/<nonexistent> returns 404 JSON with NOT_FOUND', async () => {
    const res = await request(app).get('/api/this-route-does-not-exist');
    assert.equal(res.status, 404);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'NOT_FOUND');
    assert.equal(typeof res.body.error, 'string');
    assert.ok(res.body.error.length > 0);
  });

  await t.test('POST /api/<nonexistent> also returns 404 JSON (any method)', async () => {
    const res = await request(app).post('/api/nope/not/here').send({ x: 1 });
    assert.equal(res.status, 404);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'NOT_FOUND');
  });

  await t.test('real /api route is not shadowed by the catch-all', async () => {
    // /api/health is a registered route; it must still respond 200, proving the
    // catch-all sits AFTER real routes and does not intercept them.
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  await t.test('non-/api path is unaffected by the /api catch-all', async () => {
    // A path outside /api must NOT receive the NOT_FOUND JSON payload — the
    // catch-all is scoped to /api only.
    const res = await request(app).get('/definitely-not-an-api-path');
    assert.notEqual(res.body && res.body.code, 'NOT_FOUND');
  });
});
