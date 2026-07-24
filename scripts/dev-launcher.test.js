'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  buildNpmInvocation,
  buildTreeKillInvocation,
  canConnect,
  checkLiveCallProvider,
  checkWebSocket,
  checkWorkspaceEventStream,
  checkWritableDirectory,
  collectServiceHealth,
  connectionSummary,
  createOutput,
  emitServiceHealth,
  formatPortConflict,
  parseArgs,
  parseEnvValue,
  parsePort,
  renderPreview,
  runDeepServiceHealth,
  translateChildLine,
  waitForHttp,
} = require('./dev-launcher');

function captureOutput() {
  const stream = new PassThrough();
  let value = '';
  stream.on('data', (chunk) => { value += chunk.toString(); });
  return {
    output: createOutput({ stream, color: false }),
    read: () => value,
  };
}

test('preview is concise, useful, and free of raw startup stack noise', () => {
  const capture = captureOutput();
  renderPreview(capture.output, { api: 4000, client: 5174 });
  const text = capture.read();

  assert.match(text, /🚀 QBO Operations Platform/);
  assert.match(text, /http:\/\/localhost:5174/);
  assert.match(text, /Email and calendar monitoring active/);
  assert.match(text, /Press Ctrl\+C once/);
  assert.match(text, /one-stop shutdown/);
  assert.doesNotMatch(text, /AggregateError|node:internal|EADDRINUSE/);
});

test('environment parsing handles comments, export, and quoted values', () => {
  const contents = '# comment\nexport PORT="4555"\nOTHER=value\n';
  assert.equal(parseEnvValue(contents, 'PORT'), '4555');
  assert.equal(parseEnvValue(contents, 'MISSING'), '');
  assert.equal(parsePort('4555', 4000, 'API port'), 4555);
  assert.throws(() => parsePort('70000', 4000, 'API port'), /1 to 65535/);
  assert.throws(() => parsePort('4555oops', 4000, 'API port'), /1 to 65535/);
});

test('check mode is explicit and never implied by preview mode', () => {
  assert.equal(parseArgs(['--check', '--no-color']).check, true);
  assert.equal(parseArgs(['--check', '--deep']).deep, true);
  assert.equal(parseArgs(['--preview']).check, false);
});

test('WebSocket health requires the application hello and ping/pong contract', async () => {
  class FakeWebSocket extends EventEmitter {
    constructor() {
      super();
      process.nextTick(() => this.emit('message', JSON.stringify({ type: 'hello' })));
    }
    send(raw) {
      const message = JSON.parse(raw);
      if (message.type === 'ping') process.nextTick(() => this.emit('message', JSON.stringify({ type: 'pong' })));
    }
    close() {}
  }

  const result = await checkWebSocket('ws://example.test/api/realtime', {
    WebSocketImpl: FakeWebSocket,
    timeoutMs: 100,
  });

  assert.equal(result.ok, true);
  assert.equal(result.hello, true);
  assert.equal(result.pong, true);
});

test('deep Live Call health fails clearly when the provider closes before readiness', async () => {
  class ClosingWebSocket extends EventEmitter {
    constructor() {
      super();
      process.nextTick(() => this.emit('message', JSON.stringify({ type: 'hello' })));
    }
    send(raw) {
      const message = JSON.parse(raw);
      if (message.type === 'start') {
        process.nextTick(() => this.emit('message', JSON.stringify({
          type: 'source_closed',
          code: 1011,
          reason: 'upstream unavailable',
        })));
      }
    }
    close() {}
  }

  const result = await checkLiveCallProvider('ws://example.test/api/live-call-assist/stream', {
    WebSocketImpl: ClosingWebSocket,
    timeoutMs: 100,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'upstream unavailable');
});

test('Workspace event-stream health waits for a real snapshot', async (t) => {
  const server = require('node:http').createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('event: snapshot\n');
    res.write('data: {"ok":true}\n\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await checkWorkspaceEventStream(`http://127.0.0.1:${server.address().port}/events`, { timeoutMs: 500 });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot, true);
});

test('service-health summary keeps account identities private and reports useful ages', () => {
  const summary = connectionSummary({
    connections: {
      googleAccounts: [
        { email: 'private@example.test', lastGmailAccessAt: '2026-07-23T20:00:00.000Z', missingPermissions: [] },
        { email: 'other@example.test', lastCalendarAccessAt: '2026-07-23T21:00:00.000Z', missingPermissions: ['Calendar'] },
      ],
    },
  });
  assert.equal(summary.count, 2);
  assert.equal(summary.lastGmailAccessAt, '2026-07-23T20:00:00.000Z');
  assert.equal(summary.lastCalendarAccessAt, '2026-07-23T21:00:00.000Z');
  assert.equal(summary.missingPermissionAccounts, 1);
  assert.doesNotMatch(JSON.stringify(summary), /private@example/);
});

test('friendly service-health output distinguishes local sockets from external providers', () => {
  const capture = captureOutput();
  emitServiceHealth(capture.output, {
    realtime: { ok: true, latencyMs: 12 },
    eventStream: { ok: true, latencyMs: 8 },
    liveCall: { ok: true, latencyMs: 4 },
    runtime: { requests: { staleCount: 0 }, ai: { byKind: {} } },
    workspaceStatus: {
      workspace: { staleCount: 0 },
      background: { staleCount: 0, services: [] },
      liveCall: { configured: true },
    },
    packageStore: { packageStore: { ok: true, latencyMs: 5 } },
    profile: {
      connections: { googleAccounts: [] },
      background: {
        monitor: { running: true, lastTickStatus: 'healthy' },
        scheduler: { running: true, lastStatus: 'healthy' },
        knowledgeReview: { running: true, lastStatus: 'healthy' },
        aiManagement: { running: true },
        agentHealth: { running: true, lastCheckedAt: new Date().toISOString() },
      },
    },
  });
  const text = capture.read();
  assert.match(text, /Realtime socket healthy through web proxy/);
  assert.match(text, /ElevenLabs configured, external call not tested/);
  assert.match(text, /No stuck requests/);
  assert.match(text, /Provider evidence storage is writable and readable/);
  assert.match(text, /AI catalog scheduled/);
  assert.doesNotMatch(text, /undefined|null/);
});

test('one failed health dependency is reported without aborting the other checks', async () => {
  const requestFn = async (url, options) => {
    if (url.includes('/runtime/health')) throw new Error('runtime temporarily unavailable');
    if (url.includes('/package-store-health')) {
      assert.equal(options.method, 'POST');
      return { ok: false, status: 503, body: '{"ok":false}' };
    }
    if (url.includes('/workspace/profile')) return { ok: true, status: 200, body: '{"profile":{}}' };
    return { ok: true, status: 200, body: '{"ok":true}' };
  };

  const health = await collectServiceHealth({ api: 4000, client: 5174 }, {
    requestFn,
    websocketFn: async () => ({ ok: true }),
    eventStreamFn: async () => ({ ok: true }),
  });

  assert.equal(health.realtime.ok, true);
  assert.equal(health.runtime.ok, false);
  assert.match(health.runtime.error, /temporarily unavailable/);
});

test('deep folder check writes, reads, and removes only its own temporary file', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qbo-dev-health-'));
  t.after(() => {
    assert.ok(directory.startsWith(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const result = await checkWritableDirectory(directory);
  assert.equal(result.ok, true);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('deep health is explicit and covers connected, AI, optional, storage, and disk checks', async () => {
  const capture = captureOutput();
  const requested = [];
  const requestFn = async (url) => {
    requested.push(url);
    if (url.includes('/gmail/profile')) return { ok: true, status: 200, body: '{"ok":true}' };
    if (url.includes('/calendar/calendars')) return { ok: true, status: 200, body: '{"ok":true,"calendars":[]}' };
    if (url.includes('/provider-strategy/health')) return { ok: true, status: 200, body: '{"ok":true,"canary":{"ok":true,"providerUsed":"codex"}}' };
    if (url.includes('/image-parser/status')) return {
      ok: true,
      status: 200,
      body: '{"ok":true,"providers":{"llm-gateway":{"available":false},"lm-studio":{"available":true}}}',
    };
    throw new Error(`Unexpected deep-check URL: ${url}`);
  };
  const fsPromises = {
    writeFile: async () => {},
    readFile: async () => 'qbo-health-check',
    unlink: async () => {},
  };

  const result = await runDeepServiceHealth({ api: 4000, client: 5174 }, capture.output, {
    profile: { runtime: { provider: 'codex', model: 'gpt-test', fallbackProvider: 'kimi', fallbackModel: 'kimi-test' } },
    requestFn,
    liveCallProviderFn: async () => ({ ok: true, latencyMs: 9 }),
    fsPromises,
    statfs: async () => ({ bavail: 4 * 1024 * 1024, bsize: 1024 }),
  });

  assert.equal(requested.length, 4);
  assert.equal(result.elevenLabs.ok, true);
  assert.match(capture.read(), /Gmail live read passed/);
  assert.match(capture.read(), /Workspace AI canary passed on codex/);
  assert.match(capture.read(), /LM Studio reachable/);
  assert.match(capture.read(), /Data and upload folders passed write\/read\/delete checks/);
});

test('expected proxy errors collapse to one retry message during API restarts', () => {
  const state = { apiRestarting: true };
  const first = translateChildLine('web', '[vite] ws proxy error:', state, 'stderr');
  const stack = translateChildLine('web', '    at internalConnectMultiple (node:net:1:1)', state, 'stderr');
  const duplicate = translateChildLine('web', '[vite] http proxy error: /api/health', state, 'stderr');

  assert.equal(first.level, 'warning');
  assert.match(first.text, /restarting/);
  assert.equal(stack.skip, true);
  assert.equal(duplicate.skip, true);
});

test('nodemon restarts and recovery are explained in plain English', () => {
  const state = {};
  const restarting = translateChildLine('api', '[nodemon] restarting due to changes...', state);
  const listening = translateChildLine('api', 'QBO Escalation API listening on http://127.0.0.1:4000', state);

  assert.match(restarting.text, /Server code changed/);
  assert.equal(state.apiRestarting, false);
  assert.match(listening.text, /API restarted/);
});

test('readiness fails immediately when nodemon reports an API crash', async () => {
  await assert.rejects(
    waitForHttp('http://127.0.0.1:1/api/health', {
      isFailed: () => true,
      label: 'API',
      timeoutMs: 10_000,
    }),
    /API stopped before becoming ready/
  );
});

test('port-conflict messages distinguish this app from an unknown process', () => {
  assert.equal(formatPortConflict('api', 4000, true), 'API port 4000 is already serving this app.');
  assert.equal(formatPortConflict('client', 5174, false), 'web app port 5174 is occupied by another process.');
});

test('Windows shutdown targets only the launcher-owned process tree', () => {
  assert.deepEqual(buildTreeKillInvocation(1234, 'win32'), {
    command: 'taskkill.exe',
    args: ['/pid', '1234', '/T', '/F'],
  });
  assert.throws(() => buildTreeKillInvocation(0, 'win32'), /valid child process ID/);
});

test('managed npm scripts run through node instead of the Windows npm.cmd shim', () => {
  const invocation = buildNpmInvocation('dev:server', {
    env: { npm_execpath: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js' },
    execPath: 'C:\\Program Files\\nodejs\\node.exe',
    existsSync: () => true,
  });

  assert.deepEqual(invocation, {
    command: 'C:\\Program Files\\nodejs\\node.exe',
    args: [
      'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
      'run',
      'dev:server',
    ],
  });
  assert.throws(() => buildNpmInvocation('dev:server & whoami', {
    existsSync: () => true,
  }), /Invalid npm script name/);
});

test('TCP preflight detects a live listener without changing it', async (t) => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  assert.equal(await canConnect({ host: '127.0.0.1', port: address.port }), true);
});

test('nodemon watches runtime files but ignores tests and generated data', () => {
  const configPath = path.join(__dirname, '..', 'server', 'nodemon.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  assert.deepEqual(config.watch, ['src', '.env']);
  assert.ok(config.ignore.includes('test/**'));
  assert.ok(config.ignore.includes('data/**'));
  assert.equal(config.delay, '400');
});
