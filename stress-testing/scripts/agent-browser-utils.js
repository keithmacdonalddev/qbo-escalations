'use strict';

const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { promisify } = require('node:util');

const { pollUntil, sleep } = require('./harness-runner-utils');

const execFileAsync = promisify(execFile);
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const CLIENT_DIR = path.join(ROOT_DIR, 'client');
const IS_WINDOWS = process.platform === 'win32';
const NPM_BIN = IS_WINDOWS ? (process.env.ComSpec || 'cmd.exe') : 'npm';
const NPM_ARGS_PREFIX = IS_WINDOWS ? ['/d', '/s', '/c', 'npm.cmd'] : [];
const AGENT_BROWSER_BIN = resolveAgentBrowserBin();
const AGENT_BROWSER_USES_SHELL = IS_WINDOWS && /\.cmd$/i.test(AGENT_BROWSER_BIN);
const AGENT_BROWSER_IDLE_TIMEOUT_MS = process.env.AGENT_BROWSER_IDLE_TIMEOUT_MS || '60000';
const AGENT_BROWSER_COMMAND_TIMEOUT_MS = parsePositiveInt(
  process.env.AGENT_BROWSER_COMMAND_TIMEOUT_MS,
  180_000
);

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
}

async function allocatePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close((closeErr) => {
        if (closeErr) {
          reject(closeErr);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function parseJsonOutput(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) return null;

  const attempts = [trimmed, ...trimmed.split(/\r?\n/).reverse()];
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(`Failed to parse agent-browser JSON output:\n${trimmed}`);
}

function resolveAgentBrowserBin() {
  if (!IS_WINDOWS) return 'agent-browser';

  const candidates = [];
  if (process.env.APPDATA) {
    candidates.push(path.join(
      process.env.APPDATA,
      'npm',
      'node_modules',
      'agent-browser',
      'bin',
      'agent-browser-win32-x64.exe'
    ));
  }
  candidates.push(path.join(
    ROOT_DIR,
    'node_modules',
    'agent-browser',
    'bin',
    'agent-browser-win32-x64.exe'
  ));

  return candidates.find((candidate) => fs.existsSync(candidate)) || 'agent-browser.cmd';
}

async function runAgentBrowser(session, args, { json = false } = {}) {
  const fullArgs = [];
  if (json) fullArgs.push('--json');
  if (session) fullArgs.push('--session', session);
  fullArgs.push(...args);

  const { stdout, stderr } = await runCommand(AGENT_BROWSER_BIN, fullArgs, {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      AGENT_BROWSER_IDLE_TIMEOUT_MS,
    },
    shell: AGENT_BROWSER_USES_SHELL,
  });

  return {
    stdout,
    stderr,
    parsed: json ? parseJsonOutput(stdout) : null,
  };
}

function tryParseJsonOutput(stdout) {
  try {
    return parseJsonOutput(stdout);
  } catch {
    return null;
  }
}

async function runAgentBrowserBatch(session, commands, {
  bail = true,
  json = true,
} = {}) {
  const fullArgs = [];
  if (session) fullArgs.push('--session', session);
  fullArgs.push('batch');
  if (json) fullArgs.push('--json');
  if (bail) fullArgs.push('--bail');

  try {
    const { stdout, stderr } = await runCommand(AGENT_BROWSER_BIN, fullArgs, {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        AGENT_BROWSER_IDLE_TIMEOUT_MS,
      },
      input: `${JSON.stringify(commands)}\n`,
      shell: AGENT_BROWSER_USES_SHELL,
    });

    return {
      stdout,
      stderr,
      parsed: json ? parseJsonOutput(stdout) : null,
    };
  } catch (err) {
    err.parsed = json ? tryParseJsonOutput(err.stdout) : null;
    throw err;
  }
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const {
      input,
      timeoutMs = AGENT_BROWSER_COMMAND_TIMEOUT_MS,
      ...spawnOptions
    } = options;
    const child = spawn(command, args, {
      ...spawnOptions,
      shell: spawnOptions.shell ?? false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timer = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        killProcessTree(child).catch(() => {
          try { child.kill(); } catch { /* best effort */ }
        });
      }, timeoutMs)
      : null;
    if (timer && typeof timer.unref === 'function') timer.unref();

    function clearTimer() {
      if (timer) clearTimeout(timer);
    }

    function rejectWithOutput(err) {
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    }

    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimer();
      rejectWithOutput(err);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimer();

      if (timedOut) {
        const err = new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`);
        err.code = 'COMMAND_TIMEOUT';
        err.timedOut = true;
        err.exitCode = code;
        err.signal = signal;
        rejectWithOutput(err);
        return;
      }

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const err = new Error(`Command failed with exit code ${code}: ${command} ${args.join(' ')}`);
      err.code = code;
      err.exitCode = code;
      err.signal = signal;
      rejectWithOutput(err);
    });
  });
}

function listSnapshotRefs(snapshotResult) {
  const refs = snapshotResult?.parsed?.data?.refs || {};
  return Object.entries(refs).map(([refId, meta]) => ({
    refId,
    ref: `@${refId}`,
    ...meta,
  }));
}

function requireSnapshotRef(snapshotResult, predicate, description) {
  const entries = listSnapshotRefs(snapshotResult);
  const match = entries.find(predicate);
  assert.ok(
    match,
    `Expected browser snapshot to contain ${description}.\nSnapshot:\n${snapshotResult?.parsed?.data?.snapshot || '<empty snapshot>'}`
  );
  return match;
}

async function openPage(session, url) {
  await runAgentBrowser(session, ['open', url]);
}

async function snapshotInteractive(session) {
  return runAgentBrowser(session, ['snapshot', '-i'], { json: true });
}

async function clickRef(session, ref) {
  await runAgentBrowser(session, ['click', ref]);
}

async function fillRef(session, ref, value) {
  await runAgentBrowser(session, ['fill', ref, value]);
}

async function waitForText(session, text) {
  await runAgentBrowser(session, ['wait', '--text', text]);
}

async function waitForSelector(session, selector) {
  await runAgentBrowser(session, ['wait', selector]);
}

async function waitForFunction(session, expression) {
  await runAgentBrowser(session, ['wait', '--fn', expression]);
}

async function evaluate(session, script) {
  const encoded = Buffer.from(script, 'utf8').toString('base64');
  const result = await runAgentBrowser(session, ['eval', '-b', encoded], { json: true });
  return result.parsed?.data;
}

async function getUrl(session) {
  const result = await runAgentBrowser(session, ['get', 'url'], { json: true });
  return result.parsed?.data || '';
}

async function takeScreenshot(session, destinationPath) {
  await runAgentBrowser(session, ['screenshot', destinationPath]);
  return destinationPath;
}

async function closeSession(session) {
  try {
    await runAgentBrowser(session, ['close']);
  } catch {
    // Best-effort cleanup only.
  }
}

async function waitForClientReady(baseUrl, child, logs, getStartupError = () => null) {
  return pollUntil(async () => {
    const startupError = getStartupError();
    if (startupError) {
      throw new Error(`Client dev server failed to spawn: ${startupError.message}\n${logs.join('\n')}`);
    }

    if (child.exitCode !== null) {
      throw new Error(`Client dev server exited early with code ${child.exitCode}.\n${logs.join('\n')}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_500);
    if (typeof timer.unref === 'function') timer.unref();

    try {
      const response = await fetch(baseUrl, {
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-cache' },
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }, {
    timeoutMs: 45_000,
    intervalMs: 500,
    description: `client dev server at ${baseUrl}`,
  });
}

async function killProcessTree(child) {
  if (!child || child.exitCode !== null) return;

  if (IS_WINDOWS) {
    try {
      await execFileAsync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
      });
      return;
    } catch {
      // Fall back to regular kill if taskkill is unavailable.
    }
  }

  child.kill('SIGTERM');
  await sleep(250);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
}

async function startClientDevServer({ proxyTarget, port }) {
  const chosenPort = port || await allocatePort();
  const baseUrl = `http://127.0.0.1:${chosenPort}`;
  const logs = [];
  let startupError = null;
  const child = spawn(NPM_BIN, [
    ...NPM_ARGS_PREFIX,
    'run',
    'dev',
    '--',
    '--host',
    '127.0.0.1',
    '--port',
    String(chosenPort),
  ], {
    cwd: CLIENT_DIR,
    env: {
      ...process.env,
      VITE_PROXY_TARGET: proxyTarget,
    },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const capture = (chunk) => {
    const text = stripAnsi(chunk.toString('utf8'));
    if (!text) return;
    logs.push(...text.split(/\r?\n/).filter(Boolean));
    if (logs.length > 200) {
      logs.splice(0, logs.length - 200);
    }
  };

  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('error', (err) => {
    startupError = err;
    capture(Buffer.from(`spawn error: ${err.message}`));
  });

  try {
    await waitForClientReady(baseUrl, child, logs, () => startupError);
  } catch (err) {
    await killProcessTree(child);
    throw err;
  }

  return {
    port: chosenPort,
    baseUrl,
    logs,
    async stop() {
      await killProcessTree(child);
    },
  };
}

module.exports = {
  allocatePort,
  AGENT_BROWSER_COMMAND_TIMEOUT_MS,
  closeSession,
  evaluate,
  getUrl,
  listSnapshotRefs,
  openPage,
  requireSnapshotRef,
  runAgentBrowser,
  runAgentBrowserBatch,
  snapshotInteractive,
  startClientDevServer,
  takeScreenshot,
  waitForFunction,
  waitForSelector,
  waitForText,
  clickRef,
  fillRef,
};
