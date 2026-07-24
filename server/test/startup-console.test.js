'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  buildCliVersionInvocation,
  buildProbeTerminationInvocation,
  buildProbeEnv,
  probeCliVersion,
} = require('../src/lib/cli-version-probe');
const {
  formatProviderAvailabilitySummary,
  summarizeProviderAvailability,
} = require('../src/lib/startup-console');

test('Windows CLI version probes avoid shell:true and use a fixed command line', () => {
  assert.deepEqual(
    buildCliVersionInvocation('codex', { platform: 'win32', env: { ComSpec: 'C:\\Windows\\cmd.exe' } }),
    {
      command: 'C:\\Windows\\cmd.exe',
      args: ['/d', '/s', '/c', 'codex --version'],
    }
  );
});

test('CLI version probes reject commands that could inject shell syntax', () => {
  assert.throws(
    () => buildCliVersionInvocation('codex & whoami', { platform: 'win32' }),
    /Unsupported CLI version probe/
  );
});

test('timed-out Windows probes target only their exact child process tree', () => {
  assert.deepEqual(buildProbeTerminationInvocation(4321, 'win32'), {
    command: 'taskkill.exe',
    args: ['/pid', '4321', '/T', '/F'],
  });
  assert.equal(buildProbeTerminationInvocation(4321, 'linux'), null);
  assert.equal(buildProbeTerminationInvocation(0, 'win32'), null);
});

test('CLI probe removes nested Claude state and reports the version', async () => {
  let invocation = null;
  const spawnFn = (command, args, options) => {
    invocation = { command, args, options };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    process.nextTick(() => {
      child.stdout.end('codex-cli 9.9.9\n');
      child.emit('close', 0);
    });
    return child;
  };

  const result = await probeCliVersion('codex', {
    env: { PATH: 'test', CLAUDECODE: 'nested' },
    platform: 'linux',
    spawnFn,
    timeoutMs: 100,
  });

  assert.equal(result.available, true);
  assert.equal(result.reason, 'codex-cli 9.9.9');
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.env.CLAUDECODE, undefined);
  assert.deepEqual(invocation.args, ['--version']);
});

test('CLI probe timeout delegates full-tree termination', async () => {
  const child = new EventEmitter();
  child.pid = 9876;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  let terminatedPid = null;

  const result = await probeCliVersion('claude', {
    platform: 'win32',
    spawnFn: () => child,
    terminateFn: (target) => { terminatedPid = target.pid; },
    timeoutMs: 5,
  });

  assert.equal(result.code, 'TIMEOUT');
  assert.equal(terminatedPid, 9876);
});

test('provider summary reports families without repeating every model alias', () => {
  const providers = {
    openai: { available: true, model: 'gpt-5.6-terra' },
    'gpt-5.6-terra': { available: true, model: 'gpt-5.6-terra' },
    codex: { available: true, model: 'gpt-5.6-sol' },
    'gpt-5.6-sol': { available: true, model: 'gpt-5.6-sol' },
    'llm-gateway': { available: false, reason: 'Connection refused' },
  };

  const summary = summarizeProviderAvailability(providers);
  assert.deepEqual(summary.ready.map((item) => item.id), ['openai', 'codex']);
  assert.deepEqual(summary.unavailable.map((item) => item.id), ['llm-gateway']);

  const lines = formatProviderAvailabilitySummary(providers);
  assert.match(lines[0], /AI providers ready \(2\): OpenAI, Codex CLI/);
  assert.match(lines[1], /Other connections unavailable \(1\): LLM Gateway/);
  assert.doesNotMatch(lines.join('\n'), /gpt-5\.6-terra/);
});

test('probe environments remove only the nested Claude marker', () => {
  assert.deepEqual(buildProbeEnv({ PATH: 'x', CLAUDECODE: '1', KEEP: 'yes' }), {
    PATH: 'x',
    KEEP: 'yes',
  });
});
