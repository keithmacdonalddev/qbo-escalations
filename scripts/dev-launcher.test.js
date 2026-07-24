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
  buildOpenInvocation,
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
  formatReadySummary,
  formatPortConflict,
  getRuntimeIdentity,
  mergeHealthSummaries,
  openBrowser,
  parseArgs,
  parseEnvValue,
  parsePort,
  renderPreview,
  runDevLauncher,
  runDeepServiceHealth,
  retryTransientHealthCheck,
  sanitizeDiagnostic,
  stopDevelopmentServices,
  translateChildLine,
  waitForHttp,
} = require('./dev-launcher');

function captureOutput(options = {}) {
  const stream = new PassThrough();
  let value = '';
  stream.on('data', (chunk) => { value += chunk.toString(); });
  return {
    output: createOutput({ stream, color: false, ...options }),
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
  assert.match(text, /master · commit 417b85c · Node/);
  assert.match(text, /Ready in 4\.3s — core 2\/2 ready · operational 7\/7 healthy/);
  assert.ok(text.indexOf('Core app ready') < text.indexOf('Finishing background checks'));
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
  assert.equal(parseArgs(['--open']).open, true);
  assert.equal(parseArgs(['--quiet', '--verbose']).quiet, true);
  assert.equal(parseArgs(['--quiet', '--verbose']).verbose, false);
  assert.equal(parseArgs([], { stdoutIsTTY: false, env: { FORCE_COLOR: '1' } }).color, false);
  assert.equal(parseArgs([], { stdoutIsTTY: true, env: {} }).color, true);
});

test('transient checks retry once while definitive failures do not repeat', async () => {
  let transientAttempts = 0;
  const transient = await retryTransientHealthCheck(async () => {
    transientAttempts += 1;
    return transientAttempts === 1
      ? { ok: false, transient: true, error: 'connection reset' }
      : { ok: true };
  }, { sleep: async () => {} });
  assert.equal(transient.ok, true);
  assert.equal(transient.attempts, 2);
  assert.equal(transientAttempts, 2);

  let definitiveAttempts = 0;
  const definitive = await retryTransientHealthCheck(async () => {
    definitiveAttempts += 1;
    return { ok: false, status: 503, error: 'application rejected the check' };
  }, { sleep: async () => {} });
  assert.equal(definitive.ok, false);
  assert.equal(definitive.attempts, 1);
  assert.equal(definitiveAttempts, 1);

  let thrownAttempts = 0;
  const programmingFailure = await retryTransientHealthCheck(async () => {
    thrownAttempts += 1;
    throw new Error('invalid health-check response shape');
  }, { sleep: async () => {} });
  assert.equal(programmingFailure.ok, false);
  assert.equal(programmingFailure.attempts, 1);
  assert.equal(thrownAttempts, 1);
});

test('runtime identity is bounded, safe, and does not require a shell', () => {
  const calls = [];
  const identity = getRuntimeIdentity({
    nodeVersion: '24.4.1',
    execFile: (command, args, options) => {
      calls.push({ command, args, options });
      if (args.includes('status')) return '';
      return args.includes('--abbrev-ref') ? 'feature/startup\n' : 'abc1234\n';
    },
  });
  assert.deepEqual(identity, { branch: 'feature/startup', commit: 'abc1234', dirty: false, nodeVersion: '24.4.1' });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.command === 'git'));
  assert.ok(calls.every((call) => call.options.windowsHide === true));

  const unsafe = getRuntimeIdentity({
    execFile: (_command, args) => args.includes('status') ? ' M local-file.js\n' : 'branch name with spaces\nsecret',
    nodeVersion: '24.4.1',
  });
  assert.equal(unsafe.branch, 'unknown-branch');
  assert.equal(unsafe.commit, 'unknown');
  assert.equal(unsafe.dirty, true);
});

test('diagnostics retain useful codes while redacting identities and credentials', () => {
  const diagnostic = sanitizeDiagnostic(
    'AUTH_401 for private@example.test\nAuthorization: Bearer super-secret-token api_key=sk-test_12345678901234567890'
  );
  assert.match(diagnostic, /AUTH_401/);
  assert.match(diagnostic, /\[redacted email\]/);
  assert.doesNotMatch(diagnostic, /private@example|super-secret|12345678901234567890|\n/);
  assert.ok(diagnostic.length <= 240);
});

test('browser opening is readiness-triggered, shell-free, and mockable', async () => {
  assert.deepEqual(buildOpenInvocation('http://localhost:5174/', 'win32'), {
    command: 'explorer.exe',
    args: ['http://localhost:5174/'],
  });
  assert.throws(() => buildOpenInvocation('file:///C:/secret.txt', 'win32'), /Only HTTP and HTTPS/);

  const child = new EventEmitter();
  let unrefCalled = false;
  child.unref = () => { unrefCalled = true; };
  let invocation = null;
  const opened = openBrowser('http://localhost:5174/', {
    platform: 'win32',
    spawnFn: (command, args, options) => {
      invocation = { command, args, options };
      process.nextTick(() => child.emit('spawn'));
      return child;
    },
  });
  await opened;
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(unrefCalled, true);
});

test('--open waits until the existing web app has passed readiness inspection', async () => {
  const events = [];
  const capture = captureOutput();
  const result = await runDevLauncher({
    check: true,
    color: false,
    deep: false,
    open: true,
    output: capture.output,
    ports: { api: 4000, client: 5174 },
    identity: { branch: 'master', commit: 'abc1234', nodeVersion: '24.4.1' },
    inspectExistingStackFn: async () => {
      events.push('readiness');
      return {
        apiConnected: true,
        apiIsQbo: true,
        clientConnected: true,
        clientPage: { ok: true },
      };
    },
    openBrowserFn: async () => { events.push('open'); },
    healthRunner: async () => {
      events.push('health');
      return {
        summary: {
          operational: { healthy: 1, attention: 0, notConfigured: 0, total: 1 },
          optional: { healthy: 0, attention: 0, notConfigured: 0, total: 0 },
        },
      };
    },
  });
  assert.equal(result.mode, 'check');
  assert.deepEqual(events, ['readiness', 'open', 'health']);
});

test('quiet output keeps warnings, fixes, and the final result only', () => {
  const capture = captureOutput({ quiet: true });
  capture.output.banner();
  capture.output.success('hidden success');
  capture.output.info('hidden info');
  capture.output.warning('⚠️ Visible warning');
  capture.output.action('Do the safe thing.');
  capture.output.always('✨ Ready in 1.0s');
  const text = capture.read();
  assert.doesNotMatch(text, /QBO Operations|hidden success|hidden info/);
  assert.match(text, /Visible warning/);
  assert.match(text, /Fix: Do the safe thing/);
  assert.match(text, /Ready in 1\.0s/);
});

test('ready summary separates core, operational, and optional status', () => {
  const summary = formatReadySummary({
    durationMs: 8250,
    healthSummary: {
      operational: { healthy: 5, attention: 1, notConfigured: 0, total: 6 },
      optional: { healthy: 0, attention: 0, notConfigured: 1, total: 1 },
    },
  });
  assert.match(summary, /Ready in 8\.3s/);
  assert.match(summary, /core 2\/2 ready/);
  assert.match(summary, /operational 5\/6 healthy/);
  assert.match(summary, /1 operational needs attention/);
  assert.match(summary, /optional 1 not configured/);
});

test('deep-check results merge into the final operational and optional totals', () => {
  const merged = mergeHealthSummaries(
    {
      operational: { healthy: 7, attention: 0, notConfigured: 0, total: 7 },
      optional: { healthy: 0, attention: 0, notConfigured: 1, total: 1 },
    },
    {
      operational: { healthy: 4, attention: 1, notConfigured: 0, total: 5 },
      optional: { healthy: 1, attention: 1, notConfigured: 1, total: 3 },
    }
  );
  assert.deepEqual(merged.operational, { healthy: 11, attention: 1, notConfigured: 0, total: 12 });
  assert.deepEqual(merged.optional, { healthy: 1, attention: 1, notConfigured: 2, total: 4 });
  const line = formatReadySummary({ durationMs: 1000, healthSummary: merged });
  assert.match(line, /operational 11\/12 healthy/);
  assert.match(line, /optional 1 healthy, 2 not configured, 1 needs attention/);
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

test('WebSocket protocol failures are definitive and are not marked for retry', async () => {
  class NoPongWebSocket extends EventEmitter {
    constructor() {
      super();
      process.nextTick(() => this.emit('message', JSON.stringify({ type: 'hello' })));
    }
    send() {}
    close() {}
  }
  const result = await checkWebSocket('ws://example.test/api/realtime', {
    WebSocketImpl: NoPongWebSocket,
    timeoutMs: 20,
  });
  assert.equal(result.ok, false);
  assert.equal(result.hello, true);
  assert.equal(result.transient, false);
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
  const summary = emitServiceHealth(capture.output, {
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
  assert.match(text, /ElevenLabs configured; external call not tested/);
  assert.match(text, /No stuck requests/);
  assert.match(text, /Provider evidence storage is writable and readable/);
  assert.match(text, /AI catalog scheduled/);
  assert.doesNotMatch(text, /undefined|null/);
  assert.equal(summary.operational.attention, 0);
  assert.equal(summary.operational.notConfigured, 1);
});

test('health warnings distinguish unavailable from failed and include one fix each', () => {
  const capture = captureOutput();
  const now = new Date().toISOString();
  emitServiceHealth(capture.output, {
    realtime: { ok: false, transient: true, error: 'connection reset' },
    eventStream: { ok: false, transient: false, error: 'HTTP 403' },
    liveCall: { ok: true },
    runtime: { requests: { staleCount: 0 }, ai: { byKind: {} } },
    workspaceStatus: {
      workspace: { staleCount: 0 },
      background: { staleCount: 0, services: [] },
      liveCall: { configured: false },
    },
    packageStore: { ok: false, reason: 'write rejected' },
    transport: {
      runtime: { ok: true },
      workspace: { ok: true },
      packageStore: { ok: false, status: 503 },
      profile: { ok: true },
    },
    profile: {
      connections: {
        googleAccounts: [{ lastGmailAccessAt: now, lastCalendarAccessAt: now, missingPermissions: [] }],
      },
      background: {
        monitor: { running: true, lastTickStatus: 'healthy' },
        scheduler: { running: true, lastStatus: 'healthy' },
        knowledgeReview: { running: true, lastStatus: 'healthy' },
        aiManagement: { running: true },
        agentHealth: { running: true, lastCheckedAt: now },
      },
    },
  });
  const text = capture.read();
  assert.match(text, /Unavailable — Realtime socket/);
  assert.match(text, /Failed — Workspace event stream/);
  assert.match(text, /Optional: ElevenLabs not configured/);
  assert.match(text, /Failed — Provider evidence storage/);
  assert.equal((text.match(/⚠️/g) || []).length, (text.match(/Fix:/g) || []).length);
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
  assert.deepEqual(result.summary.operational, { healthy: 5, attention: 0, notConfigured: 0, total: 5 });
  assert.deepEqual(result.summary.optional, { healthy: 2, attention: 1, notConfigured: 0, total: 3 });
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

test('shutdown confirms each owned service and only claims clean closure when all stop', async () => {
  const api = { pid: 100, exitCode: null };
  const web = { pid: 101, exitCode: null };
  const details = new Map([
    [api, { label: 'API', source: 'api' }],
    [web, { label: 'Web app', source: 'web' }],
  ]);
  const cleanCapture = captureOutput();
  const clean = await stopDevelopmentServices([api, web], details, cleanCapture.output, {
    reason: 'SIGINT',
    stopProcessTreeFn: async () => ({ ok: true }),
  });
  assert.equal(clean.ok, true);
  assert.ok(cleanCapture.read().indexOf('Web app stopped') < cleanCapture.read().indexOf('API stopped'));
  assert.match(cleanCapture.read(), /Development environment closed cleanly/);

  let attempt = 0;
  const failedCapture = captureOutput();
  const failed = await stopDevelopmentServices([api, web], details, failedCapture.output, {
    reason: 'SIGTERM',
    stopProcessTreeFn: async () => {
      attempt += 1;
      return attempt === 1 ? { ok: false, error: 'access denied' } : { ok: true };
    },
  });
  assert.equal(failed.ok, false);
  assert.match(failedCapture.read(), /Shutdown incomplete/);
  assert.doesNotMatch(failedCapture.read(), /closed cleanly/);
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
