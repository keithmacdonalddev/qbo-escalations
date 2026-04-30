'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BASELINES_DIR,
  evaluateReportBaseline,
  getBaselinePath,
  getValueAtPath,
  tokenizePath,
} = require('../report-baselines');

test('tokenizePath and getValueAtPath support array segments', () => {
  const report = {
    fixtures: [
      {
        assertions: {
          providerErrorEventSeen: true,
        },
      },
    ],
  };

  assert.deepEqual(
    tokenizePath('fixtures[0].assertions.providerErrorEventSeen'),
    ['fixtures', 0, 'assertions', 'providerErrorEventSeen']
  );
  assert.equal(
    getValueAtPath(report, 'fixtures[0].assertions.providerErrorEventSeen'),
    true
  );
});

test('evaluateReportBaseline applies mixed checks from a slice baseline file', () => {
  fs.mkdirSync(BASELINES_DIR, { recursive: true });
  const sliceId = 'report-baseline-test';
  const baselinePath = getBaselinePath(sliceId);

  fs.writeFileSync(baselinePath, JSON.stringify({
    slice: sliceId,
    checks: [
      { path: 'fixtures[0].assertions.count', min: 2 },
      { path: 'fixtures[0].assertions.ok', equals: true },
      { path: 'fixtures[0].assertions.items', includes: 'primary' },
      { path: 'fixtures[0].assertions.preview', lengthMin: 5 },
    ],
  }, null, 2));

  try {
    const report = {
      fixtures: [
        {
          assertions: {
            count: 3,
            ok: true,
            items: ['primary'],
            preview: 'hello world',
          },
        },
      ],
    };

    const comparison = evaluateReportBaseline(sliceId, report);
    assert.equal(comparison.available, true);
    assert.equal(comparison.ok, true);
    assert.equal(comparison.checks.length, 4);
  } finally {
    fs.rmSync(baselinePath, { force: true });
  }
});

test('evaluateReportBaseline reports failing checks without throwing', () => {
  fs.mkdirSync(BASELINES_DIR, { recursive: true });
  const sliceId = 'report-baseline-failure-test';
  const baselinePath = getBaselinePath(sliceId);

  fs.writeFileSync(baselinePath, JSON.stringify({
    slice: sliceId,
    checks: [
      { path: 'fixtures[0].assertions.ok', equals: true },
    ],
  }, null, 2));

  try {
    const report = {
      fixtures: [
        {
          assertions: {
            ok: false,
          },
        },
      ],
    };

    const comparison = evaluateReportBaseline(sliceId, report);
    assert.equal(comparison.available, true);
    assert.equal(comparison.ok, false);
    assert.match(comparison.checks[0].failures[0], /expected true, got false/);
  } finally {
    fs.rmSync(baselinePath, { force: true });
  }
});

test('evaluateReportBaseline supports equalsPath and oneOf checks', () => {
  fs.mkdirSync(BASELINES_DIR, { recursive: true });
  const sliceId = 'report-baseline-comparison-test';
  const baselinePath = getBaselinePath(sliceId);

  fs.writeFileSync(baselinePath, JSON.stringify({
    slice: sliceId,
    checks: [
      { path: 'fixtures[0].assertions.planned', equalsPath: 'fixtures[0].assertions.total' },
      { path: 'fixtures[0].assertions.exitCode', oneOf: [0, 1] },
    ],
  }, null, 2));

  try {
    const report = {
      fixtures: [
        {
          assertions: {
            planned: 14,
            total: 14,
            exitCode: 1,
          },
        },
      ],
    };

    const comparison = evaluateReportBaseline(sliceId, report);
    assert.equal(comparison.available, true);
    assert.equal(comparison.ok, true);
    assert.equal(comparison.checks.length, 2);
    assert.deepEqual(comparison.checks[0].expected.equalsPath, {
      path: 'fixtures[0].assertions.total',
      value: 14,
    });
  } finally {
    fs.rmSync(baselinePath, { force: true });
  }
});
