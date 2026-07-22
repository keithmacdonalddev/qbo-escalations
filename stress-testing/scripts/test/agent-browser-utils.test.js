'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');

const {
  closeSession,
  isBrowserCompletionLoss,
  runAgentBrowserSequence,
  runCommand,
} = require('../agent-browser-utils');

test('sequential browser commands preserve individual results and continue after a bounded failure', async () => {
  const calls = [];
  const runImpl = async (session, command, options) => {
    calls.push({ session, command, options });
    if (command[0] === 'wait') {
      const error = new Error('bounded wait failed');
      error.stdout = 'wait output';
      throw error;
    }
    return {
      stdout: `${command[0]} output`,
      stderr: '',
      parsed: { data: `${command[0]} result` },
    };
  };

  const result = await runAgentBrowserSequence('isolated-session', [
    ['open', 'http://127.0.0.1:1234'],
    ['wait', '--text', 'Ready'],
    ['get', 'url'],
  ], {
    bail: false,
    timeoutMs: 1_234,
    runImpl,
  });

  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.options.timeoutMs === 1_234));
  assert.deepEqual(result.parsed.map((entry) => entry.success), [true, false, true]);
  assert.equal(result.parsed[0].result, 'open result');
  assert.match(result.parsed[1].error, /bounded wait failed/);
  assert.equal(result.parsed[2].result, 'get result');
});

test('a command hard-settles after timeout even when its child and kill operation never close', async () => {
  const child = new EventEmitter();
  child.pid = 987654;
  child.exitCode = null;
  child.stdin = { end() {} };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  const startedAt = Date.now();

  await assert.rejects(
    runCommand('never-close', [], {
      timeoutMs: 25,
      killGraceMs: 30,
      spawnImpl: () => child,
      killImpl: () => new Promise(() => {}),
    }),
    (error) => error.code === 'COMMAND_TIMEOUT' && error.timedOut === true,
  );
  assert.ok(Date.now() - startedAt < 180, 'command should settle independently of child close and taskkill completion');
});

test('session close hard-settles when the close command promise never resolves', async () => {
  const startedAt = Date.now();
  await assert.rejects(
    closeSession('never-close-session', {
      timeoutMs: 25,
      runImpl: () => new Promise(() => {}),
    }),
    /close exceeded 25ms/,
  );
  assert.ok(Date.now() - startedAt < 350, 'session close should settle within its timeout plus grace');
});

test('session close returns an explicit verified outcome on success', async () => {
  const result = await closeSession('closed-session', {
    timeoutMs: 25,
    runImpl: async () => ({ parsed: { data: { closed: true } } }),
  });
  assert.equal(result.closed, true);
});

test('sequential browser commands stop after the first failure when bail is enabled', async () => {
  let calls = 0;
  const result = await runAgentBrowserSequence('isolated-session', [['open'], ['click'], ['get']], {
    bail: true,
    runImpl: async () => {
      calls += 1;
      throw new Error('connection failed');
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.parsed.length, 1);
  assert.equal(result.parsed[0].success, false);
  assert.equal(result.parsed[0].incomplete, true);
  assert.equal(result.parsed[0].completionLost, true);
});

test('native and Node connection-loss errors become structurally incomplete without timeout or signal', async () => {
  const cases = [
    Object.assign(new Error('connection failed with os error 10060'), { code: 1 }),
    Object.assign(new Error('socket read failed'), { code: 'ECONNRESET' }),
    Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9222'), { code: 'ECONNREFUSED' }),
  ];
  for (const error of cases) {
    const result = await runAgentBrowserSequence('transport-loss-session', [['open', 'http://127.0.0.1']], {
      runImpl: async () => { throw error; },
    });
    assert.equal(result.parsed[0].timedOut, false);
    assert.equal(result.parsed[0].signal, null);
    assert.equal(result.parsed[0].completionLost, true);
    assert.equal(result.parsed[0].incomplete, true);
    assert.equal(isBrowserCompletionLoss(error), true);
  }
});

test('ordinary selector and application assertion failures remain completed failures', async () => {
  const errors = [
    Object.assign(new Error('Expected selector .ready-state to be visible'), { code: 1 }),
    Object.assign(new Error('Expected HTTP 500 response to equal 200'), { code: 1 }),
    Object.assign(new Error('Baseline expected 4 fixtures, got 3'), { code: 1 }),
  ];
  for (const error of errors) {
    const result = await runAgentBrowserSequence('assertion-session', [['wait', '.ready-state']], {
      runImpl: async () => { throw error; },
    });
    assert.equal(result.parsed[0].completionLost, false);
    assert.equal(result.parsed[0].incomplete, false);
    assert.equal(isBrowserCompletionLoss(error), false);
  }
});
