'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// Unit tests for knowledgebase-agent-scheduler.
//
// The scheduler destructures scanKnowledgebaseAgent from the service module at
// require time, so we prime require.cache with a stub BEFORE requiring the
// scheduler. This lets us assert the run path invokes the scan without any real
// DB/LLM call, and lets us verify the read-only options forwarded to the scan.
// ---------------------------------------------------------------------------

const servicePath = require.resolve('../src/services/knowledgebase-agent-service');
const schedulerPath = require.resolve('../src/services/knowledgebase-agent-scheduler');

let scanCalls = [];
let scanResult = null;
let scanShouldThrow = false;

function installStubAndLoadScheduler() {
  // Snapshot real cache entries so we can restore them after each test.
  const realService = require.cache[servicePath];

  const stubExports = {
    scanKnowledgebaseAgent: async (options = {}) => {
      scanCalls.push(options);
      if (scanShouldThrow) {
        throw new Error('boom');
      }
      return scanResult;
    },
  };

  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: stubExports,
  };

  // Force a fresh scheduler module that binds to the stubbed service export.
  delete require.cache[schedulerPath];
  const scheduler = require(schedulerPath);

  return {
    scheduler,
    restore() {
      delete require.cache[schedulerPath];
      if (realService) require.cache[servicePath] = realService;
      else delete require.cache[servicePath];
    },
  };
}

test('module loads and exports the expected scheduler API', () => {
  const { scheduler, restore } = installStubAndLoadScheduler();
  try {
    assert.equal(typeof scheduler.startScheduler, 'function');
    assert.equal(typeof scheduler.stopScheduler, 'function');
    assert.equal(typeof scheduler.runScan, 'function');
    assert.equal(typeof scheduler.shouldRunNow, 'function');
    assert.ok(scheduler.config && typeof scheduler.config === 'object');
  } finally {
    restore();
  }
});

test('runScan skips (no scan call) when MongoDB is not connected', async () => {
  const { scheduler, restore } = installStubAndLoadScheduler();
  const realReadyState = mongoose.connection.readyState;
  scanCalls = [];
  try {
    // Force "not connected" (anything other than 1).
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: 0,
      configurable: true,
    });
    const result = await scheduler.runScan();
    assert.equal(result, null);
    assert.equal(scanCalls.length, 0, 'scan must not run when Mongo is down');
  } finally {
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: realReadyState,
      configurable: true,
    });
    restore();
  }
});

test('runScan calls scanKnowledgebaseAgent read-only when Mongo is connected', async () => {
  const { scheduler, restore } = installStubAndLoadScheduler();
  const realReadyState = mongoose.connection.readyState;
  scanCalls = [];
  scanShouldThrow = false;
  scanResult = {
    status: 'review-needed',
    counts: { proposals: 3 },
    attention: { opened: 2 },
  };
  try {
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: 1,
      configurable: true,
    });
    const result = await scheduler.runScan();
    assert.equal(scanCalls.length, 1, 'scan should be invoked exactly once');
    // Read-only: it forwards the flag-only options, never any edit/auto-fill flag.
    assert.equal(scanCalls[0].persistAttention, true);
    assert.equal(scanCalls[0].persistActivity, true);
    assert.equal(result.status, 'review-needed');
  } finally {
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: realReadyState,
      configurable: true,
    });
    restore();
  }
});

test('runScan never throws even if the scan rejects', async () => {
  const { scheduler, restore } = installStubAndLoadScheduler();
  const realReadyState = mongoose.connection.readyState;
  scanCalls = [];
  scanShouldThrow = true;
  try {
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: 1,
      configurable: true,
    });
    const result = await scheduler.runScan();
    assert.equal(result, null, 'a failing scan is swallowed and returns null');
    assert.equal(scanCalls.length, 1);
  } finally {
    scanShouldThrow = false;
    Object.defineProperty(mongoose.connection, 'readyState', {
      value: realReadyState,
      configurable: true,
    });
    restore();
  }
});

test('shouldRunNow guards to at most once per calendar day', () => {
  const { scheduler, restore } = installStubAndLoadScheduler();
  try {
    function localDateStr(d = new Date()) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // Fresh state: never run today -> should run.
    scheduler._setLastRunDate(null);
    assert.equal(scheduler.shouldRunNow(), true);

    // Already ran today -> should NOT run again.
    scheduler._setLastRunDate(localDateStr());
    assert.equal(scheduler.shouldRunNow(), false);

    // Ran on a different (past) day -> should run again.
    scheduler._setLastRunDate('2000-01-01');
    assert.equal(scheduler.shouldRunNow(), true);

    // Disabled via config -> never runs.
    scheduler._setLastRunDate(null);
    scheduler.config.enabled = false;
    assert.equal(scheduler.shouldRunNow(), false);
    scheduler.config.enabled = true;
  } finally {
    restore();
  }
});
