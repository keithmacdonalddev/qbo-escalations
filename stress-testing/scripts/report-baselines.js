'use strict';

const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const BASELINES_DIR = path.join(ROOT_DIR, 'stress-testing', 'baselines');

function getBaselinePath(sliceId) {
  return path.join(BASELINES_DIR, `${sliceId}.json`);
}

function tokenizePath(pathExpression) {
  const tokens = [];
  String(pathExpression || '').replace(/([^[.\]]+)|\[(\d+)\]/g, (_, propertyName, index) => {
    tokens.push(index !== undefined ? Number(index) : propertyName);
    return '';
  });
  return tokens;
}

function getValueAtPath(source, pathExpression) {
  const tokens = tokenizePath(pathExpression);
  let current = source;
  for (const token of tokens) {
    if (current === null || current === undefined) return undefined;
    current = current[token];
  }
  return current;
}

function loadBaseline(sliceId) {
  const sourcePath = getBaselinePath(sliceId);
  if (!fs.existsSync(sourcePath)) {
    return { sourcePath, baseline: null };
  }

  const raw = fs.readFileSync(sourcePath, 'utf8');
  const baseline = JSON.parse(raw);
  return { sourcePath, baseline };
}

function evaluateCheck(report, check) {
  const actual = getValueAtPath(report, check.path);
  const expected = {};
  const failures = [];

  if (Object.prototype.hasOwnProperty.call(check, 'equalsPath')) {
    const expectedValue = getValueAtPath(report, check.equalsPath);
    expected.equalsPath = {
      path: check.equalsPath,
      value: expectedValue,
    };
    if (!isDeepStrictEqual(actual, expectedValue)) {
      failures.push(`expected value at ${check.equalsPath} (${JSON.stringify(expectedValue)}), got ${JSON.stringify(actual)}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(check, 'equals')) {
    expected.equals = check.equals;
    if (!isDeepStrictEqual(actual, check.equals)) {
      failures.push(`expected ${JSON.stringify(check.equals)}, got ${JSON.stringify(actual)}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(check, 'min')) {
    expected.min = check.min;
    if (!(typeof actual === 'number' && actual >= check.min)) {
      failures.push(`expected >= ${check.min}, got ${JSON.stringify(actual)}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(check, 'max')) {
    expected.max = check.max;
    if (!(typeof actual === 'number' && actual <= check.max)) {
      failures.push(`expected <= ${check.max}, got ${JSON.stringify(actual)}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(check, 'lengthMin')) {
    expected.lengthMin = check.lengthMin;
    const length = (typeof actual === 'string' || Array.isArray(actual)) ? actual.length : -1;
    if (length < check.lengthMin) {
      failures.push(`expected length >= ${check.lengthMin}, got ${length}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(check, 'includes')) {
    expected.includes = check.includes;
    if (Array.isArray(actual)) {
      if (!actual.includes(check.includes)) {
        failures.push(`expected array to include ${JSON.stringify(check.includes)}, got ${JSON.stringify(actual)}`);
      }
    } else if (typeof actual === 'string') {
      if (!actual.includes(String(check.includes))) {
        failures.push(`expected string to include ${JSON.stringify(check.includes)}, got ${JSON.stringify(actual)}`);
      }
    } else {
      failures.push(`includes check requires a string or array value, got ${JSON.stringify(actual)}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(check, 'oneOf')) {
    expected.oneOf = check.oneOf;
    if (!Array.isArray(check.oneOf) || !check.oneOf.some((candidate) => isDeepStrictEqual(candidate, actual))) {
      failures.push(`expected one of ${JSON.stringify(check.oneOf)}, got ${JSON.stringify(actual)}`);
    }
  }

  if (check.truthy) {
    expected.truthy = true;
    if (!actual) {
      failures.push(`expected a truthy value, got ${JSON.stringify(actual)}`);
    }
  }

  return {
    label: check.label || check.path,
    path: check.path,
    actual,
    expected,
    ok: failures.length === 0,
    failures,
  };
}

function evaluateReportBaseline(sliceId, report) {
  let loaded;
  try {
    loaded = loadBaseline(sliceId);
  } catch (err) {
    return {
      available: true,
      ok: false,
      sourcePath: getBaselinePath(sliceId),
      checks: [],
      error: err.message,
    };
  }

  if (!loaded.baseline) {
    return {
      available: false,
      ok: true,
      sourcePath: loaded.sourcePath,
      checks: [],
    };
  }

  const checks = Array.isArray(loaded.baseline.checks) ? loaded.baseline.checks : [];
  const results = checks.map((check) => evaluateCheck(report, check));

  return {
    available: true,
    ok: results.every((result) => result.ok),
    sourcePath: loaded.sourcePath,
    checks: results,
  };
}

module.exports = {
  BASELINES_DIR,
  evaluateReportBaseline,
  getBaselinePath,
  getValueAtPath,
  tokenizePath,
};
