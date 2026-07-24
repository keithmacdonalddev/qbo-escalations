'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  buildNpmInvocation,
  buildTreeKillInvocation,
  canConnect,
  createOutput,
  formatPortConflict,
  parseArgs,
  parseEnvValue,
  parsePort,
  renderPreview,
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
  assert.equal(parseArgs(['--preview']).check, false);
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
