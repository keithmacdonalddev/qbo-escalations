'use strict';

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const readline = require('readline');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_API_PORT = 4000;
const DEFAULT_CLIENT_PORT = 5174;
const API_START_TIMEOUT_MS = 60_000;
const CLIENT_START_TIMEOUT_MS = 30_000;
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

function stripAnsi(value) {
  return String(value || '').replace(ANSI_PATTERN, '');
}

function parseArgs(argv = process.argv.slice(2), options = {}) {
  const env = options.env || process.env;
  const outputIsInteractive = options.stdoutIsTTY === undefined
    ? process.stdout.isTTY === true
    : options.stdoutIsTTY === true;
  const colorRequested = !argv.includes('--no-color') && !env.NO_COLOR;
  const quiet = argv.includes('--quiet');
  return {
    check: argv.includes('--check'),
    color: colorRequested && outputIsInteractive,
    deep: argv.includes('--deep'),
    open: argv.includes('--open'),
    preview: argv.includes('--preview'),
    quiet,
    verbose: !quiet && (argv.includes('--verbose') || env.QBO_DEV_VERBOSE === '1'),
  };
}

function colorize(code, value, enabled) {
  return enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
}

function createOutput({ stream = process.stdout, color = true, quiet = false } = {}) {
  const writeRaw = (value = '') => stream.write(`${value}\n`);
  const write = (value = '') => {
    if (!quiet) writeRaw(value);
  };
  const prefix = (source) => {
    if (source === 'api') return colorize('36;1', ' API ', color);
    if (source === 'web') return colorize('35;1', ' WEB ', color);
    if (source === 'live') return colorize('36;1', 'LIVE ', color);
    if (source === 'call') return colorize('35;1', 'CALL ', color);
    if (source === 'jobs') return colorize('33;1', 'JOBS ', color);
    if (source === 'data') return colorize('32;1', 'DATA ', color);
    if (source === 'work') return colorize('34;1', 'WORK ', color);
    if (source === 'deep') return colorize('33;1', 'DEEP ', color);
    return colorize('34;1', ' DEV ', color);
  };
  const levelColor = {
    error: '31;1',
    success: '32;1',
    warning: '33;1',
    info: '37',
    muted: '90',
  };

  return {
    color,
    quiet,
    write,
    always: writeRaw,
    blank: () => write(),
    banner() {
      write(`🚀 ${colorize('1;36', 'QBO Operations Platform', color)} ${colorize('90', '— development', color)}`);
      write(colorize('90', '   Safe startup · clear status · one-stop shutdown', color));
      write(colorize('36', '───────────────────────────────────────────────', color));
    },
    heading(value) {
      write(colorize('1', value, color));
    },
    line(level, value, source = 'dev') {
      if (quiet && level !== 'warning' && level !== 'error') return;
      const code = levelColor[level] || levelColor.info;
      writeRaw(`${prefix(source)} ${colorize(code, value, color)}`);
    },
    action(value, source = 'dev') {
      writeRaw(`${prefix(source)} ${colorize('90', `   Fix: ${value}`, color)}`);
    },
    success(value, source) { this.line('success', value, source); },
    warning(value, source) { this.line('warning', value, source); },
    error(value, source) { this.line('error', value, source); },
    info(value, source) { this.line('info', value, source); },
    muted(value, source) { this.line('muted', value, source); },
  };
}

function formatDuration(durationMs) {
  const milliseconds = Math.max(0, Number(durationMs) || 0);
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function sanitizeIdentityPart(value, fallback) {
  const singleLine = String(value || '').split(/\r?\n/, 1)[0].trim();
  return singleLine && /^[a-z0-9._\/-]+$/i.test(singleLine)
    ? singleLine.slice(0, 80)
    : fallback;
}

function sanitizeDiagnostic(value, fallback = 'check did not pass') {
  const text = String(value || fallback)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(api[-_ ]?key|authorization|access[-_ ]?token|refresh[-_ ]?token|secret)\s*[:=]\s*["']?[^\s,"';]+/gi, '$1=[redacted]')
    .replace(/\b(?:sk|key)-[a-z0-9_-]{12,}\b/gi, '[redacted key]')
    .replace(/:\/\/[^\s:/]+:[^\s@/]+@/g, '://[redacted]@')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!text) return fallback;
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function getRuntimeIdentity(options = {}) {
  const execFile = options.execFile || execFileSync;
  const nodeVersion = sanitizeIdentityPart(options.nodeVersion || process.versions.node, 'unknown');
  const runGit = (args) => {
    try {
      return String(execFile('git', args, {
        cwd: options.cwd || REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      }) || '');
    } catch {
      return '';
    }
  };
  const readGit = (args, fallback) => sanitizeIdentityPart(runGit(args), fallback);
  const branch = readGit(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown-branch');
  const commit = readGit(['rev-parse', '--short=7', 'HEAD'], 'unknown');
  const dirty = runGit(['status', '--porcelain']).trim().length > 0;
  return {
    branch: branch === 'HEAD' ? 'detached' : branch,
    commit,
    dirty,
    nodeVersion,
  };
}

function buildOpenInvocation(url, platform = process.platform) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS app URLs can be opened.');
  }
  if (platform === 'win32') return { command: 'explorer.exe', args: [parsed.href] };
  if (platform === 'darwin') return { command: 'open', args: [parsed.href] };
  return { command: 'xdg-open', args: [parsed.href] };
}

function openBrowser(url, options = {}) {
  const platform = options.platform || process.platform;
  const invocation = buildOpenInvocation(url, platform);
  const spawnFn = options.spawnFn || spawn;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(invocation.command, invocation.args, {
        stdio: 'ignore',
        shell: false,
        windowsHide: true,
        detached: platform !== 'win32',
      });
    } catch (error) {
      reject(error);
      return;
    }
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref?.();
      resolve(invocation);
    });
  });
}

function parseEnvValue(contents, key) {
  const matcher = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)\\s*$`);
  for (const rawLine of String(contents || '').split(/\r?\n/)) {
    if (!rawLine || rawLine.trimStart().startsWith('#')) continue;
    const match = rawLine.match(matcher);
    if (!match) continue;
    return match[1].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return '';
}

function parsePort(value, fallback, label) {
  const text = String(value || fallback).trim();
  const parsed = /^\d+$/.test(text) ? Number.parseInt(text, 10) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${label} must be a number from 1 to 65535; received ${value || '(empty)'}.`);
  }
  return parsed;
}

function resolvePorts(options = {}) {
  const env = options.env || process.env;
  const readFile = options.readFile || ((filePath) => fs.readFileSync(filePath, 'utf8'));
  let envFile = '';
  try {
    envFile = readFile(path.join(REPO_ROOT, 'server', '.env'));
  } catch {
    // The server gives the authoritative missing-.env message during startup.
  }
  return {
    api: parsePort(env.PORT || parseEnvValue(envFile, 'PORT'), DEFAULT_API_PORT, 'API port'),
    client: parsePort(env.VITE_DEV_PORT, DEFAULT_CLIENT_PORT, 'Client port'),
  };
}

function canConnect({ host, port, timeoutMs = 400, socketFactory = () => new net.Socket() }) {
  return new Promise((resolve) => {
    const socket = socketFactory();
    let settled = false;
    const finish = (connected) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

function requestHttp(url, timeoutOrOptions = 1200) {
  const options = typeof timeoutOrOptions === 'number'
    ? { timeoutMs: timeoutOrOptions }
    : { ...(timeoutOrOptions || {}) };
  const timeoutMs = options.timeoutMs || 1200;
  const bodyText = options.body === undefined
    ? ''
    : typeof options.body === 'string'
      ? options.body
      : JSON.stringify(options.body);
  return new Promise((resolve) => {
    const request = http.request(url, {
      method: options.method || (bodyText ? 'POST' : 'GET'),
      timeout: timeoutMs,
      headers: {
        ...(bodyText ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyText),
        } : {}),
        ...(options.headers || {}),
      },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (body.length < 16_384) body += chunk;
      });
      response.on('end', () => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 400,
        status: response.statusCode,
        body,
      }));
    });
    request.once('timeout', () => request.destroy(new Error('Request timed out')));
    request.once('error', (error) => resolve({ ok: false, status: 0, body: '', error }));
    if (bodyText) request.write(bodyText);
    request.end();
  });
}

function parseJsonResponse(response) {
  if (!response?.body) return null;
  try { return JSON.parse(response.body); } catch { return null; }
}

function isLikelyTransientError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (['ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'ENETDOWN', 'ENETUNREACH', 'EPIPE', 'ETIMEDOUT'].includes(code)) {
    return true;
  }
  return /\b(?:connection (?:aborted|refused|reset)|network unavailable|socket hang up|timed out)\b/i.test(String(error?.message || ''));
}

async function safeHealthCheck(run, fallbackMessage) {
  try {
    return await run();
  } catch (error) {
    return {
      ok: false,
      error: error?.message || fallbackMessage,
      transient: isLikelyTransientError(error),
    };
  }
}

function isTransientHealthFailure(result) {
  if (!result || result.ok) return false;
  if (result.transient === true) return true;
  return result.status === 0 && Boolean(result.error);
}

async function retryTransientHealthCheck(run, options = {}) {
  const sleep = options.sleep || ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const fallbackMessage = options.fallbackMessage || 'Health check failed.';
  let result = await safeHealthCheck(run, fallbackMessage);
  if (!isTransientHealthFailure(result)) return { ...result, attempts: 1 };
  await sleep(options.delayMs ?? 200);
  result = await safeHealthCheck(run, fallbackMessage);
  return { ...result, attempts: 2 };
}

function loadWebSocketImplementation() {
  try {
    return require(path.join(REPO_ROOT, 'server', 'node_modules', 'ws')).WebSocket;
  } catch (error) {
    const wrapped = new Error('The WebSocket health checker requires the server dependencies. Run npm install in server/.');
    wrapped.cause = error;
    throw wrapped;
  }
}

function checkWebSocket(url, options = {}) {
  const WebSocketImpl = options.WebSocketImpl || loadWebSocketImplementation();
  const timeoutMs = options.timeoutMs || 5000;
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let hello = false;
    let pong = false;
    let socket = null;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.close(1000, 'health-check-complete'); } catch { /* already closed */ }
      resolve({
        ok: !error && hello && pong,
        hello,
        pong,
        latencyMs: Date.now() - startedAt,
        error: error ? String(error.message || error) : null,
        transient: Boolean(error?.transient ?? error),
      });
    };
    const timer = setTimeout(() => {
      const error = new Error(`WebSocket check timed out after ${timeoutMs}ms.`);
      error.transient = !hello;
      finish(error);
    }, timeoutMs);

    try {
      socket = new WebSocketImpl(url, { origin: options.origin || 'http://localhost:5174', handshakeTimeout: timeoutMs });
    } catch (error) {
      finish(error);
      return;
    }
    socket.on('message', (raw) => {
      let message = null;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.type === 'hello') {
        hello = true;
        try { socket.send(JSON.stringify({ type: 'ping' })); } catch (error) { finish(error); }
      }
      if (message.type === 'pong') {
        pong = true;
        finish();
      }
    });
    socket.once('unexpected-response', (_request, response) => {
      const error = new Error(`WebSocket upgrade returned HTTP ${response.statusCode}.`);
      error.transient = false;
      finish(error);
    });
    socket.once('error', finish);
    socket.once('close', (code) => {
      if (!settled && !(hello && pong)) {
        const error = new Error(`WebSocket closed with code ${code}.`);
        error.transient = !hello;
        finish(error);
      }
    });
  });
}

function checkWorkspaceEventStream(url, options = {}) {
  const timeoutMs = options.timeoutMs || 5000;
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let streamConnected = false;
    let request = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request?.destroy();
      resolve({ latencyMs: Date.now() - startedAt, ...result });
    };
    const timer = setTimeout(() => finish({
      ok: false,
      error: `Workspace event stream timed out after ${timeoutMs}ms.`,
      transient: !streamConnected,
    }), timeoutMs);
    request = http.get(url, { timeout: timeoutMs }, (response) => {
      const contentType = String(response.headers['content-type'] || '');
      if (response.statusCode !== 200 || !contentType.includes('text/event-stream')) {
        finish({ ok: false, error: `Workspace event stream returned HTTP ${response.statusCode || 0}.`, transient: false });
        return;
      }
      streamConnected = true;
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
        if (/event:\s*snapshot\b/.test(body) && /data:\s*\{/.test(body)) {
          finish({ ok: true, snapshot: true });
        } else if (body.length > 16_384) {
          finish({ ok: false, error: 'Workspace event stream did not provide a snapshot.', transient: false });
        }
      });
    });
    request.once('timeout', () => finish({ ok: false, error: 'Workspace event stream request timed out.', transient: !streamConnected }));
    request.once('error', (error) => finish({ ok: false, error: error.message, transient: true }));
  });
}

function latestTimestamp(values = []) {
  const timestamps = values
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function formatAge(value, now = Date.now()) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'never';
  const ageMs = Math.max(0, now - timestamp);
  if (ageMs < 60_000) return 'just now';
  if (ageMs < 60 * 60_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 24 * 60 * 60_000) return `${Math.floor(ageMs / (60 * 60_000))}h ago`;
  return `${Math.floor(ageMs / (24 * 60 * 60_000))}d ago`;
}

async function inspectExistingStack(ports) {
  const [apiConnected, clientIpv4, clientIpv6] = await Promise.all([
    canConnect({ host: '127.0.0.1', port: ports.api }),
    canConnect({ host: '127.0.0.1', port: ports.client }),
    canConnect({ host: '::1', port: ports.client }),
  ]);
  const clientConnected = clientIpv4 || clientIpv6;
  const [apiHealth, clientPage] = await Promise.all([
    apiConnected ? requestHttp(`http://127.0.0.1:${ports.api}/api/health`) : null,
    clientConnected ? requestHttp(`http://localhost:${ports.client}/`) : null,
  ]);
  let apiIsQbo = false;
  if (apiHealth?.ok) {
    try { apiIsQbo = JSON.parse(apiHealth.body)?.ok === true; } catch { /* not QBO JSON */ }
  }
  return {
    apiConnected,
    apiHealth,
    apiIsQbo,
    clientConnected,
    clientPage,
  };
}

function formatPortConflict(kind, port, isKnownService) {
  const label = kind === 'api' ? 'API' : 'web app';
  if (isKnownService) {
    return `${label} port ${port} is already serving this app.`;
  }
  return `${label} port ${port} is occupied by another process.`;
}

function isNpmBoilerplate(line) {
  return !line
    || /^>\s/.test(line)
    || /^qbo-escalations(?:-client|-server)?@/.test(line)
    || /^\[nodemon\] (?:\d|to restart|watching path|watching extensions|starting)/.test(line);
}

function translateChildLine(source, rawLine, state = {}, channel = 'stdout') {
  let line = stripAnsi(rawLine).replace(/\r$/, '');
  line = line.replace(/^\d{1,2}:\d{2}:\d{2}\s+(?:a\.m\.|p\.m\.)\s+/, '');

  if (state.suppressTrace) {
    if (/^\s*(?:AggregateError|Error:|at\s|\^|\(Use `node|code:|errors:|\[errors\])/.test(line) || !line.trim()) {
      return { skip: true };
    }
    state.suppressTrace = false;
  }

  if (isNpmBoilerplate(line.trim())) return { skip: true };

  if (source === 'web') {
    if (/VITE v\S+\s+ready in/.test(line) || /^\s*➜\s+(?:Local|Network):/.test(line)) {
      return { skip: true };
    }
    if (/\[vite\].*proxy (?:socket )?error:/.test(line)) {
      state.suppressTrace = true;
      if (state.proxyWarningShown) return { skip: true };
      state.proxyWarningShown = true;
      return {
        level: 'warning',
        text: state.apiRestarting
          ? '⏳ API is restarting; browser requests will retry automatically.'
          : '⚠️ API connection was interrupted; retrying automatically.',
        action: 'If it continues after the API is ready, run npm run dev:check.',
      };
    }
  }

  if (source === 'api') {
    if (line.includes('[nodemon] restarting due to changes')) {
      state.apiRestarting = true;
      state.apiCrashed = false;
      state.proxyWarningShown = false;
      return { level: 'info', text: '🔄 Server code changed — restarting the API once changes settle…' };
    }
    if (line.includes('[nodemon] app crashed')) {
      state.apiCrashed = true;
      return { level: 'error', text: '❌ API stopped. Nodemon is waiting for the next code change.' };
    }
    if (line.startsWith('DNS override:')) {
      return { level: 'muted', text: `🌐 MongoDB ${line}` };
    }
    if (line.includes('[room-agents/registry] Loaded')) {
      const count = line.match(/Loaded\s+(\d+)/)?.[1] || '?';
      return { level: 'success', text: `🧩 Agent registry loaded (${count} agents)` };
    }
    if (line === 'MongoDB connected') {
      return { level: 'success', text: '🗄️ MongoDB connected' };
    }
    if (line.startsWith('QBO Escalation API listening on')) {
      state.apiCrashed = false;
      state.apiListeningSeen = true;
      if (state.apiRestarting) {
        state.apiRestarting = false;
        state.proxyWarningShown = false;
        return { level: 'success', text: '✅ API restarted and is accepting requests' };
      }
      return { skip: true };
    }
    if (/\[workspace-scheduler\] Started/.test(line)) {
      const time = line.match(/briefing at\s+([^\s]+)\s+daily/)?.[1] || 'the configured time';
      return { level: 'success', text: `🗓️ Daily Workspace briefing scheduled for ${time}` };
    }
    if (/\[workspace-scheduler\] Briefing already exists/.test(line)) {
      return { level: 'info', text: '🗓️ Today’s Workspace briefing is already prepared' };
    }
    if (/\[workspace-monitor\] started/.test(line)) {
      const seconds = Number(line.match(/check:\s*(\d+)s/)?.[1]);
      const interval = Number.isFinite(seconds) ? `${Math.round(seconds / 60)} min` : 'configured interval';
      return { level: 'success', text: `📬 Email and calendar monitoring active (${interval})` };
    }
    if (/\[kb-agent-scheduler\] Started/.test(line)) {
      return { level: 'success', text: '📚 Knowledge review scheduled daily' };
    }
    if (/\[kb-agent-scheduler\] Running/.test(line)) {
      return { level: 'info', text: '📚 Checking Knowledge Base items…' };
    }
    if (/\[kb-agent-scheduler\] Scan /.test(line)) {
      const flagged = line.match(/(\d+) item\(s\) flagged/)?.[1] || '0';
      const duration = line.match(/\((\d+)ms\)/)?.[1];
      const suffix = duration ? ` in ${(Number(duration) / 1000).toFixed(1)}s` : '';
      return {
        level: Number(flagged) > 0 ? 'warning' : 'success',
        text: `📚 Knowledge review: ${flagged} item(s) need attention${suffix}`,
        action: Number(flagged) > 0 ? 'Review the flagged Knowledge items in the app.' : undefined,
      };
    }
    if (line.startsWith('[image-parser] Provider availability:')) return { skip: true };
    if (line.startsWith('[providers] ')) {
      return {
        level: line.includes('❌') ? 'error' : line.includes('⚠️') ? 'warning' : line.includes('✅') ? 'success' : 'info',
        text: line.slice(12),
        action: line.includes('⚠️') ? 'Run npm run dev:check -- --deep if you need that connection.' : undefined,
      };
    }
    if (line.startsWith('Codex CLI ready')) {
      return { level: 'success', text: `🤖 ${line}` };
    }
    if (line.includes('[DEP0190] DeprecationWarning')) {
      state.suppressTrace = true;
      return {
        level: 'warning',
        text: '⚠️ Node reported a CLI compatibility warning; use --verbose for its raw detail.',
        action: 'Run npm run dev -- --verbose to inspect the compatibility warning.',
      };
    }
  }

  const trimmed = line.trim();
  const looksLikeError = channel === 'stderr' || /(?:\berror\b|\bfailed\b|\bcrashed\b|uncaught|unhandled)/i.test(trimmed);
  const looksLikeWarning = /(?:\bwarn(?:ing)?\b|\bunavailable\b|\bskipp?ed\b)/i.test(trimmed);
  return {
    level: looksLikeError ? 'error' : looksLikeWarning ? 'warning' : 'info',
    text: trimmed,
  };
}

function attachChildOutput(child, source, output, state, options = {}) {
  const recentLines = options.recentLines || [];
  const verbose = options.verbose === true;
  const attach = (input, channel) => {
    if (!input) return;
    const reader = readline.createInterface({ input });
    reader.on('line', (rawLine) => {
      const plain = stripAnsi(rawLine).trim();
      if (plain) {
        recentLines.push(plain);
        if (recentLines.length > 30) recentLines.shift();
      }
      if (verbose) {
        if (state.coreReady && !state.backgroundActivityHeadingShown) {
          state.backgroundActivityHeadingShown = true;
          output.blank();
          output.heading('🔄 Background activity');
        }
        output.info(plain, source);
        return;
      }
      const translated = translateChildLine(source, rawLine, state, channel);
      if (!translated.skip && translated.text) {
        if (state.coreReady && !state.backgroundActivityHeadingShown) {
          state.backgroundActivityHeadingShown = true;
          output.blank();
          output.heading('🔄 Background activity');
        }
        output.line(translated.level, translated.text, source);
        if (translated.level === 'warning' && typeof output.action === 'function') {
          output.action(translated.action || 'Run npm run dev:check if this warning continues.', source);
        }
      }
    });
  };
  attach(child.stdout, 'stdout');
  attach(child.stderr, 'stderr');
  return recentLines;
}

async function waitForHttp(url, options = {}) {
  const timeoutMs = options.timeoutMs || 30_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (options.isFailed?.()) {
      throw new Error(`${options.label || 'Service'} stopped before becoming ready.`);
    }
    if (options.child?.exitCode !== null && options.child?.exitCode !== undefined) {
      throw new Error(`${options.label || 'Process'} exited before becoming ready.`);
    }
    const response = await requestHttp(url, 1000);
    if (response.ok) return { response, elapsedMs: Date.now() - startedAt };
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`${options.label || 'Service'} did not become ready within ${Math.round(timeoutMs / 1000)} seconds.`);
}

function buildTreeKillInvocation(pid, platform = process.platform) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) throw new Error('A valid child process ID is required.');
  if (platform === 'win32') {
    return { command: 'taskkill.exe', args: ['/pid', String(pid), '/T', '/F'] };
  }
  return { command: 'process-group', args: ['SIGTERM', String(-Number(pid))] };
}

function stopProcessTree(child, options = {}) {
  if (!child?.pid || child.exitCode !== null) return Promise.resolve({ ok: true, alreadyStopped: true });
  const platform = options.platform || process.platform;
  if (platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGTERM');
      return Promise.resolve({ ok: true });
    } catch (error) {
      return Promise.resolve({ ok: false, error: error.message });
    }
  }
  const invocation = buildTreeKillInvocation(child.pid, platform);
  const spawnFn = options.spawnFn || spawn;
  return new Promise((resolve) => {
    const killer = spawnFn(invocation.command, invocation.args, {
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
    });
    killer.once('error', (error) => resolve({ ok: false, error: error.message }));
    killer.once('close', (code) => resolve({ ok: code === 0, code }));
  });
}

async function stopDevelopmentServices(children, childDetails, output, options = {}) {
  const stopTree = options.stopProcessTreeFn || stopProcessTree;
  let allStopped = true;
  for (const child of children.slice().reverse()) {
    const detail = childDetails.get(child) || { label: 'Service', source: 'dev' };
    const result = await stopTree(child);
    if (result.ok) {
      output.success(`✅ ${detail.label} ${result.alreadyStopped ? 'already stopped' : 'stopped'}`, detail.source);
    } else {
      allStopped = false;
      emitHealthWarning(
        output,
        `Failed — ${detail.label} did not confirm shutdown${result.error ? `: ${sanitizeDiagnostic(result.error)}` : ''}`,
        'Close the remaining process from its terminal.',
        detail.source
      );
    }
  }
  const closedCleanly = options.reason === 'SIGINT' || options.reason === 'SIGTERM' || options.reason === 'shutdown';
  output.always(closedCleanly && allStopped
    ? '✨ Development environment closed cleanly'
    : allStopped
      ? '🧹 Development processes cleaned up safely after a failure'
      : '⚠️ Shutdown incomplete — one or more development services may still be running');
  return { ok: allStopped };
}

function sumAiStale(ai = {}) {
  if (ai.byKind && typeof ai.byKind === 'object') {
    return Object.values(ai.byKind).reduce((sum, entry) => sum + (Number(entry?.staleCount) || 0), 0);
  }
  return Number(ai.staleCount) || 0;
}

function connectionSummary(profile = {}) {
  const accounts = Array.isArray(profile?.connections?.googleAccounts)
    ? profile.connections.googleAccounts
    : [];
  return {
    count: accounts.length,
    lastGmailAccessAt: latestTimestamp(accounts.map((account) => account.lastGmailAccessAt)),
    lastCalendarAccessAt: latestTimestamp(accounts.map((account) => account.lastCalendarAccessAt)),
    missingPermissionAccounts: accounts.filter((account) => Array.isArray(account.missingPermissions) && account.missingPermissions.length > 0).length,
  };
}

function healthFailureLabel(result) {
  return isTransientHealthFailure(result) ? 'Unavailable' : 'Failed';
}

function emitHealthWarning(output, message, fix, source) {
  output.warning(`⚠️ ${message}`, source);
  if (typeof output.action === 'function') output.action(fix, source);
  else output.write?.(`   Fix: ${fix}`);
}

function emitServiceHealth(output, health) {
  const emptyGroup = () => ({ healthy: 0, attention: 0, notConfigured: 0, total: 0 });
  const summary = { operational: emptyGroup(), optional: emptyGroup() };
  const mark = (state, category = 'operational') => {
    summary[category].total += 1;
    summary[category][state] += 1;
  };

  if (health.realtime.ok) {
    output.success(`✅ Realtime socket healthy through web proxy (${health.realtime.latencyMs} ms)`, 'live');
    mark('healthy');
  } else {
    emitHealthWarning(
      output,
      `${healthFailureLabel(health.realtime)} — Realtime socket did not pass through the web proxy: ${sanitizeDiagnostic(health.realtime.error, 'ping/pong failed')}`,
      'Wait a moment, then run npm run dev:check.',
      'live'
    );
    mark('attention');
  }

  if (health.eventStream.ok) {
    output.success(`✅ Workspace event stream connected (${health.eventStream.latencyMs} ms)`, 'live');
    mark('healthy');
  } else {
    emitHealthWarning(
      output,
      `${healthFailureLabel(health.eventStream)} — Workspace event stream did not provide a snapshot: ${sanitizeDiagnostic(health.eventStream.error, 'snapshot not received')}`,
      'Wait a moment, then run npm run dev:check.',
      'live'
    );
    mark('attention');
  }

  const liveCallConfigured = health.workspaceStatus?.liveCall?.configured === true;
  if (health.liveCall.ok) {
    output.success(
      `✅ Local Live Call socket ready — ${liveCallConfigured ? 'ElevenLabs configured; external call not tested' : 'Optional: ElevenLabs not configured'}`,
      'call'
    );
    mark('healthy');
    if (!liveCallConfigured) mark('notConfigured', 'optional');
  } else {
    emitHealthWarning(
      output,
      `${healthFailureLabel(health.liveCall)} — Local Live Call socket did not respond: ${sanitizeDiagnostic(health.liveCall.error, 'ping/pong failed')}`,
      'Wait a moment, then run npm run dev:check.',
      'call'
    );
    mark('attention');
  }

  const runtimeTransport = health.transport?.runtime;
  const workspaceTransport = health.transport?.workspace;
  const operationalStatusAvailable = (!runtimeTransport || runtimeTransport.ok === true)
    && (!workspaceTransport || workspaceTransport.ok === true);
  const staleRequests = Number(health.runtime?.requests?.staleCount) || 0;
  const staleAi = sumAiStale(health.runtime?.ai);
  const staleWorkspace = Number(health.workspaceStatus?.workspace?.staleCount) || 0;
  const staleBackground = Number(health.workspaceStatus?.background?.staleCount) || 0;
  const failedServices = (health.workspaceStatus?.background?.services || []).filter((service) => service?.state === 'failed' || service?.lastError);
  const totalStale = staleRequests + staleAi + staleWorkspace + staleBackground;
  if (!operationalStatusAvailable) {
    const failedTransport = runtimeTransport?.ok === false ? runtimeTransport : workspaceTransport;
    emitHealthWarning(
      output,
      `${healthFailureLabel(failedTransport)} — Background work status could not be verified`,
      'Run npm run dev:check after the API finishes settling.',
      'jobs'
    );
    mark('attention');
  } else if (totalStale === 0 && failedServices.length === 0) {
    output.success('✅ No stuck requests, AI operations, Workspace sessions, or background tasks', 'jobs');
    mark('healthy');
  } else {
    const details = [
      totalStale > 0 ? `${totalStale} stuck operation${totalStale === 1 ? '' : 's'}` : '',
      failedServices.length > 0 ? `${failedServices.length} background service failure${failedServices.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' · ');
    emitHealthWarning(
      output,
      `Failed — ${details}`,
      'Review the background-service warning above, then run npm run dev:check.',
      'jobs'
    );
    mark('attention');
  }

  const packageStore = health.packageStore?.packageStore || health.packageStore;
  if (packageStore?.ok === true || packageStore?.available === true) {
    output.success(`✅ Provider evidence storage is writable and readable${packageStore.latencyMs ? ` (${packageStore.latencyMs} ms)` : ''}`, 'data');
    mark('healthy');
  } else {
    const packageTransport = health.transport?.packageStore || packageStore;
    emitHealthWarning(
      output,
      `${healthFailureLabel(packageTransport)} — Provider evidence storage was not verified: ${sanitizeDiagnostic(packageStore?.reason, 'health endpoint unavailable')}`,
      'Confirm MongoDB is healthy, then run npm run dev:check.',
      'data'
    );
    mark('attention');
  }

  const profileAvailable = !health.transport?.profile || health.transport.profile.ok === true;
  const connections = connectionSummary(health.profile);
  if (!profileAvailable) {
    emitHealthWarning(
      output,
      `${healthFailureLabel(health.transport.profile)} — Workspace connected-service status could not be verified`,
      'Run npm run dev:check after the API finishes settling.',
      'work'
    );
    mark('attention');
  } else if (connections.count === 0) {
    emitHealthWarning(
      output,
      'Not configured — Google account is required for proactive Gmail and Calendar work',
      'Connect Google in the app\'s Connected Accounts settings.',
      'work'
    );
    mark('notConfigured');
  } else {
    const access = `Gmail ${formatAge(connections.lastGmailAccessAt)} · Calendar ${formatAge(connections.lastCalendarAccessAt)}`;
    const permissions = connections.missingPermissionAccounts > 0
      ? ` · ${connections.missingPermissionAccounts} account${connections.missingPermissionAccounts === 1 ? '' : 's'} need permission review`
      : '';
    const accessHealthy = connections.lastGmailAccessAt && connections.lastCalendarAccessAt && connections.missingPermissionAccounts === 0;
    if (accessHealthy) {
      output.success(`✅ Connected services: ${access}${permissions}`, 'work');
      mark('healthy');
    } else {
      emitHealthWarning(
        output,
        `Failed — Connected services need attention: ${access}${permissions}`,
        connections.missingPermissionAccounts > 0
          ? 'Review Google permissions in Connected Accounts.'
          : 'Run npm run dev:check -- --deep to test Gmail and Calendar.',
        'work'
      );
      mark('attention');
    }
  }

  if (profileAvailable) {
    const background = health.profile?.background || {};
    const monitor = background.monitor || {};
    const briefing = background.scheduler || {};
    const knowledge = background.knowledgeReview || {};
    const aiManagement = background.aiManagement || {};
    const agentHealth = background.agentHealth || {};
    const servicesRunning = monitor.running
      && briefing.running
      && knowledge.running
      && aiManagement.running
      && agentHealth.running;
    const detail = [
      `monitor ${monitor.lastTickStatus || (monitor.running ? 'scheduled' : 'stopped')}`,
      `briefing ${briefing.lastStatus || (briefing.running ? 'scheduled' : 'stopped')}`,
      `knowledge ${knowledge.lastStatus || (knowledge.running ? 'scheduled' : 'stopped')}`,
      `AI catalog ${aiManagement.running ? 'scheduled' : 'stopped'}`,
      agentHealth.lastCheckedAt ? `agents checked ${formatAge(agentHealth.lastCheckedAt)}` : 'agents not checked yet',
    ].join(' · ');
    if (servicesRunning) {
      output.success(`✅ Background systems: ${detail}`, 'jobs');
      mark('healthy');
    } else {
      emitHealthWarning(
        output,
        `Failed — One or more background systems are stopped: ${detail}`,
        'Review the API startup warnings, then run npm run dev:check.',
        'jobs'
      );
      mark('attention');
    }
  }

  return summary;
}

async function collectServiceHealth(ports, options = {}) {
  const webBase = `http://localhost:${ports.client}`;
  const wsBase = `ws://localhost:${ports.client}`;
  const requestFn = options.requestFn || requestHttp;
  const websocketFn = options.websocketFn || checkWebSocket;
  const eventStreamFn = options.eventStreamFn || checkWorkspaceEventStream;
  const retryOptions = { sleep: options.retrySleep, delayMs: options.retryDelayMs ?? 200 };
  const [realtime, liveCall, eventStream, runtimeResponse, workspaceResponse, profileResponse, packageStoreResponse] = await Promise.all([
    retryTransientHealthCheck(
      () => websocketFn(`${wsBase}/api/realtime`, { origin: webBase }),
      { ...retryOptions, fallbackMessage: 'Realtime socket check failed.' }
    ),
    retryTransientHealthCheck(
      () => websocketFn(`${wsBase}/api/live-call-assist/stream`, { origin: webBase }),
      { ...retryOptions, fallbackMessage: 'Live Call socket check failed.' }
    ),
    retryTransientHealthCheck(
      () => eventStreamFn(`${webBase}/api/workspace/monitor`),
      { ...retryOptions, fallbackMessage: 'Workspace event-stream check failed.' }
    ),
    retryTransientHealthCheck(
      () => requestFn(`${webBase}/api/runtime/health`, 5000),
      { ...retryOptions, fallbackMessage: 'Runtime health check failed.' }
    ),
    retryTransientHealthCheck(
      () => requestFn(`${webBase}/api/workspace/status`, 5000),
      { ...retryOptions, fallbackMessage: 'Workspace status check failed.' }
    ),
    retryTransientHealthCheck(
      () => requestFn(`${webBase}/api/workspace/profile`, 5000),
      { ...retryOptions, fallbackMessage: 'Workspace profile check failed.' }
    ),
    safeHealthCheck(
      () => requestFn(`${webBase}/api/image-parser/package-store-health`, { method: 'POST', timeoutMs: 8000 }),
      'Provider evidence storage check failed.'
    ),
  ]);
  return {
    realtime,
    liveCall,
    eventStream,
    runtime: parseJsonResponse(runtimeResponse) || runtimeResponse,
    workspaceStatus: parseJsonResponse(workspaceResponse) || workspaceResponse,
    profile: parseJsonResponse(profileResponse)?.profile || null,
    packageStore: parseJsonResponse(packageStoreResponse) || packageStoreResponse,
    transport: {
      runtime: runtimeResponse,
      workspace: workspaceResponse,
      profile: profileResponse,
      packageStore: packageStoreResponse,
    },
  };
}

async function checkWritableDirectory(directoryPath, options = {}) {
  const fsPromises = options.fsPromises || fs.promises;
  const testPath = path.join(directoryPath, `.qbo-health-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  const startedAt = Date.now();
  try {
    await fsPromises.writeFile(testPath, 'qbo-health-check', { flag: 'wx' });
    const contents = await fsPromises.readFile(testPath, 'utf8');
    if (contents !== 'qbo-health-check') throw new Error('Health-check file readback did not match.');
    return { ok: true, directoryPath, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, directoryPath, error: error.message, latencyMs: Date.now() - startedAt };
  } finally {
    await fsPromises.unlink(testPath).catch(() => {});
  }
}

async function checkDiskSpace(directoryPath, options = {}) {
  const statfs = options.statfs || fs.promises.statfs?.bind(fs.promises);
  if (typeof statfs !== 'function') return { ok: true, availableBytes: null, note: 'Disk-space API unavailable in this Node version.' };
  try {
    const stats = await statfs(directoryPath);
    const availableBytes = Number(stats.bavail) * Number(stats.bsize);
    return { ok: Number.isFinite(availableBytes), availableBytes };
  } catch (error) {
    return { ok: false, availableBytes: null, error: error.message };
  }
}

function checkLiveCallProvider(url, options = {}) {
  const WebSocketImpl = options.WebSocketImpl || loadWebSocketImplementation();
  const timeoutMs = options.timeoutMs || 15_000;
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let socket = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.send(JSON.stringify({ type: 'stop' })); } catch { /* already closed */ }
      try { socket?.close(1000, 'deep-health-check-complete'); } catch { /* already closed */ }
      resolve({ latencyMs: Date.now() - startedAt, ...result });
    };
    const timer = setTimeout(() => finish({ ok: false, error: `ElevenLabs connection timed out after ${timeoutMs}ms.` }), timeoutMs);
    try {
      socket = new WebSocketImpl(url, { origin: options.origin || 'http://localhost:5174', handshakeTimeout: timeoutMs });
    } catch (error) {
      finish({ ok: false, error: error.message });
      return;
    }
    socket.on('message', (raw) => {
      let message = null;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.type === 'hello') {
        socket.send(JSON.stringify({
          type: 'start',
          sources: [{ sourceId: 'health-check', label: 'Health check', languageCode: 'en' }],
          options: { modelId: 'scribe_v2_realtime', includeTimestamps: false, commitStrategy: 'manual' },
        }));
      }
      if (message.type === 'source_connected') finish({ ok: true, provider: 'elevenlabs' });
      if (message.type === 'error') finish({ ok: false, error: message.error || message.code || 'ElevenLabs connection failed.' });
      if (message.type === 'source_closed') {
        finish({
          ok: false,
          error: message.reason || `ElevenLabs connection closed before it became ready (code ${message.code || 'unknown'}).`,
        });
      }
    });
    socket.once('error', (error) => finish({ ok: false, error: error.message }));
    socket.once('close', (code) => { if (!settled) finish({ ok: false, error: `Live Call socket closed with code ${code}.` }); });
  });
}

async function runDeepServiceHealth(ports, output, options = {}) {
  const webBase = `http://localhost:${ports.client}`;
  const wsBase = `ws://localhost:${ports.client}`;
  const requestFn = options.requestFn || requestHttp;
  const profileResponse = options.profile
    ? null
    : await safeHealthCheck(() => requestFn(`${webBase}/api/workspace/profile`, 8000), 'Workspace profile check failed.');
  const profile = options.profile || parseJsonResponse(profileResponse)?.profile || {};
  const runtime = profile.runtime || profile.identity?.runtime || {};
  const providerStrategy = {
    defaultMode: runtime.mode || 'fallback',
    defaultPrimaryProvider: runtime.provider,
    defaultPrimaryModel: runtime.model,
    defaultFallbackProvider: runtime.fallbackProvider,
    defaultFallbackModel: runtime.fallbackModel,
    reasoningEffort: runtime.reasoningEffort,
  };
  const [gmail, calendar, canary, elevenLabs, providerRefresh, dataWrite, uploadWrite, disk] = await Promise.all([
    safeHealthCheck(() => requestFn(`${webBase}/api/gmail/profile`, { timeoutMs: 20_000 }), 'Gmail live read failed.'),
    safeHealthCheck(() => requestFn(`${webBase}/api/calendar/calendars`, { timeoutMs: 20_000 }), 'Calendar live read failed.'),
    safeHealthCheck(() => requestFn(`${webBase}/api/agent-identities/provider-strategy/health`, {
      method: 'POST',
      timeoutMs: 35_000,
      body: { providerStrategy, healthLevel: 'canary', forceRefresh: true, trigger: 'dev-deep-check' },
    }), 'Workspace AI canary failed.'),
    safeHealthCheck(
      () => (options.liveCallProviderFn || checkLiveCallProvider)(`${wsBase}/api/live-call-assist/stream`, { origin: webBase }),
      'ElevenLabs live connection failed.'
    ),
    safeHealthCheck(() => requestFn(`${webBase}/api/image-parser/status?refresh=1`, 15_000), 'Optional-provider refresh failed.'),
    safeHealthCheck(() => checkWritableDirectory(path.join(REPO_ROOT, 'server', 'data'), options), 'Data folder check failed.'),
    safeHealthCheck(() => checkWritableDirectory(path.join(REPO_ROOT, 'server', 'uploads'), options), 'Upload folder check failed.'),
    safeHealthCheck(() => checkDiskSpace(REPO_ROOT, options), 'Disk-space check failed.'),
  ]);

  const gmailBody = parseJsonResponse(gmail);
  const calendarBody = parseJsonResponse(calendar);
  const canaryBody = parseJsonResponse(canary);
  const providerBody = parseJsonResponse(providerRefresh);
  const gateway = providerBody?.providers?.['llm-gateway'] || null;
  const lmStudio = providerBody?.providers?.['lm-studio'] || null;
  const emptyGroup = () => ({ healthy: 0, attention: 0, notConfigured: 0, total: 0 });
  const deepSummary = { operational: emptyGroup(), optional: emptyGroup() };
  const mark = (state, category = 'operational') => {
    deepSummary[category].total += 1;
    deepSummary[category][state] += 1;
  };
  const deepCheck = (result, body, label, fix) => {
    const ok = result.ok && body?.ok !== false;
    if (ok) {
      output.success(`✅ ${label} passed`, 'deep');
      mark('healthy');
      return;
    }
    const message = sanitizeDiagnostic(body?.error || body?.message || result.error);
    const notConfigured = /not (?:connected|configured)|missing .*key|no .*account/i.test(message);
    emitHealthWarning(
      output,
      `${notConfigured ? 'Not configured' : healthFailureLabel(result)} — ${label}: ${message}`,
      fix,
      'deep'
    );
    mark(notConfigured ? 'notConfigured' : 'attention');
  };
  deepCheck(gmail, gmailBody, 'Gmail live read', 'Review Google access in Connected Accounts.');
  deepCheck(calendar, calendarBody, 'Calendar live read', 'Review Google access in Connected Accounts.');
  const canaryOk = canary.ok && canaryBody?.canary?.ok === true;
  if (canaryOk) {
    output.success(`✅ Workspace AI canary passed on ${canaryBody.canary.providerUsed || runtime.provider || 'assigned provider'}`, 'deep');
    mark('healthy');
  } else {
    emitHealthWarning(
      output,
      `${healthFailureLabel(canary)} — Workspace AI canary did not pass`,
      'Review the assigned Workspace provider, then rerun the deep check.',
      'deep'
    );
    mark('attention');
  }
  if (elevenLabs.ok) {
    output.success(`✅ ElevenLabs live connection passed (${elevenLabs.latencyMs} ms)`, 'deep');
    mark('healthy', 'optional');
  } else {
    const elevenLabsMessage = sanitizeDiagnostic(elevenLabs.error);
    const elevenLabsNotConfigured = /not configured|missing .*key/i.test(elevenLabsMessage);
    emitHealthWarning(
      output,
      `${elevenLabsNotConfigured ? 'Not configured' : healthFailureLabel(elevenLabs)} — ElevenLabs live connection: ${elevenLabsMessage}`,
      'Review the ElevenLabs key and connection settings.',
      'deep'
    );
    mark(elevenLabsNotConfigured ? 'notConfigured' : 'attention', 'optional');
  }
  output.line(gateway?.available ? 'success' : 'info', `${gateway?.available ? '✅' : 'ℹ️'} Optional — LLM Gateway ${gateway?.available ? 'reachable' : gateway ? 'unavailable' : 'not configured'}`, 'deep');
  mark(gateway?.available ? 'healthy' : gateway ? 'attention' : 'notConfigured', 'optional');
  output.line(lmStudio?.available ? 'success' : 'info', `${lmStudio?.available ? '✅' : 'ℹ️'} Optional — LM Studio ${lmStudio?.available ? 'reachable' : lmStudio ? 'unavailable' : 'not configured'}`, 'deep');
  mark(lmStudio?.available ? 'healthy' : lmStudio ? 'attention' : 'notConfigured', 'optional');
  const directoriesOk = dataWrite.ok && uploadWrite.ok;
  if (directoriesOk) {
    output.success('✅ Data and upload folders passed write/read/delete checks', 'deep');
    mark('healthy');
  } else {
    emitHealthWarning(output, 'Failed — Data and upload folders are not fully writable', 'Check folder permissions under server/data and server/uploads.', 'deep');
    mark('attention');
  }
  if (disk.ok && Number.isFinite(disk.availableBytes)) {
    const freeGb = disk.availableBytes / (1024 ** 3);
    if (freeGb >= 2) {
      output.success(`✅ Disk space: ${freeGb.toFixed(1)} GB available`, 'deep');
      mark('healthy');
    } else {
      emitHealthWarning(output, `Failed — Low disk space: ${freeGb.toFixed(1)} GB available`, 'Free at least 2 GB before running large checks.', 'deep');
      mark('attention');
    }
  } else {
    output.info(`ℹ️ Optional — Disk space unavailable${disk.error ? `: ${disk.error}` : ''}`, 'deep');
    mark('attention');
  }

  return { gmail, calendar, canary, elevenLabs, providerRefresh, dataWrite, uploadWrite, disk, summary: deepSummary };
}

async function runServiceHealthChecks(ports, options = {}) {
  const output = options.output || createOutput({ color: false });
  output.blank();
  output.heading(options.postReady ? '🔄 Finishing background checks' : '🩺 Service health');
  const health = await collectServiceHealth(ports, options);
  health.summary = emitServiceHealth(output, health);
  if (options.deep) {
    output.blank();
    output.heading('🧪 Deep external checks');
    output.write('   These checks contact connected services and use one small AI canary request.');
    health.deep = await runDeepServiceHealth(ports, output, { ...options, profile: health.profile });
    health.summary = mergeHealthSummaries(health.summary, health.deep.summary);
  }
  return health;
}

function mergeHealthSummaries(...summaries) {
  const createGroup = () => ({ healthy: 0, attention: 0, notConfigured: 0, total: 0 });
  const merged = { operational: createGroup(), optional: createGroup() };
  for (const summary of summaries.filter(Boolean)) {
    const normalized = summary.operational || summary.optional
      ? summary
      : { operational: summary, optional: createGroup() };
    for (const category of ['operational', 'optional']) {
      for (const field of ['healthy', 'attention', 'notConfigured', 'total']) {
        merged[category][field] += Number(normalized[category]?.[field]) || 0;
      }
    }
  }
  return merged;
}

function formatReadySummary(options = {}) {
  const health = options.healthSummary || {};
  const operational = health.operational || {
    healthy: Number(health.healthy) || 0,
    attention: Number(health.attention) || 0,
    notConfigured: Number(health.notConfigured) || 0,
    total: Number(health.total) || 0,
  };
  const optional = health.optional || { healthy: 0, attention: 0, notConfigured: 0, total: 0 };
  const parts = [
    `core ${options.coreReady ?? 2}/${options.coreTotal ?? 2} ready`,
    `operational ${Number(operational.healthy) || 0}/${Number(operational.total) || 0} healthy`,
  ];
  if (Number(operational.notConfigured) > 0) parts.push(`${operational.notConfigured} operational not configured`);
  if (Number(operational.attention) > 0) {
    parts.push(`${operational.attention} operational ${Number(operational.attention) === 1 ? 'needs' : 'need'} attention`);
  }
  if (Number(optional.total) > 0) {
    const optionalDetails = [
      Number(optional.healthy) > 0 ? `${optional.healthy} healthy` : '',
      Number(optional.notConfigured) > 0 ? `${optional.notConfigured} not configured` : '',
      Number(optional.attention) > 0 ? `${optional.attention} ${Number(optional.attention) === 1 ? 'needs' : 'need'} attention` : '',
    ].filter(Boolean).join(', ');
    parts.push(`optional ${optionalDetails}`);
  } else {
    parts.push('optional live checks deferred');
  }
  return `✨ Ready in ${formatDuration(options.durationMs)} — ${parts.join(' · ')}`;
}

function renderPreview(output, ports = { api: DEFAULT_API_PORT, client: DEFAULT_CLIENT_PORT }, options = {}) {
  const identity = options.identity || { branch: 'master', commit: '417b85c', dirty: false, nodeVersion: process.versions.node };
  output.banner();
  output.blank();
  output.heading('🔎 Preflight');
  output.info(`ℹ️ ${identity.branch} · commit ${identity.commit}${identity.dirty ? ' · local changes' : ''} · Node ${identity.nodeVersion}`);
  output.success(`✅ API port ${ports.api} is available`);
  output.success(`✅ Web port ${ports.client} is available`);
  output.blank();
  output.heading('⚙️ Starting services');
  output.success('🗄️ MongoDB connected', 'api');
  output.success('🧩 Agent registry loaded (5 agents)', 'api');
  output.success(`✅ API ready at http://127.0.0.1:${ports.api} (3.8s)`, 'api');
  output.success(`✅ Web app ready at http://localhost:${ports.client} (0.4s)`, 'web');
  output.info('📬 Email and calendar monitoring active (5 min)', 'api');
  output.info('🤖 AI providers ready: OpenAI, Kimi, Gemini, Claude CLI, Codex CLI', 'api');
  output.info('ℹ️ Optional connections unavailable: LLM Gateway, LM Studio', 'api');
  output.blank();
  output.heading('✨ Core app ready in 4.2s');
  output.write(`   App: ${colorize('36;4', `http://localhost:${ports.client}`, output.color)}`);
  output.write(`   API: ${colorize('36;4', `http://127.0.0.1:${ports.api}`, output.color)}`);
  output.write('   Press Ctrl+C once to stop both services.');
  output.blank();
  output.heading('🔄 Finishing background checks');
  output.success('✅ Realtime socket healthy through web proxy (19 ms)', 'live');
  output.success('✅ Workspace event stream connected (8 ms)', 'live');
  output.success('✅ Local Live Call socket ready — ElevenLabs configured; external call not tested', 'call');
  output.success('✅ No stuck requests, AI operations, Workspace sessions, or background tasks', 'jobs');
  output.success('✅ Provider evidence storage is writable and readable (12 ms)', 'data');
  output.success('✅ Connected services: Gmail just now · Calendar 2m ago', 'work');
  output.success('✅ Background systems: monitor healthy · briefing healthy · knowledge review-needed · AI catalog scheduled · agents checked just now', 'jobs');
  output.blank();
  output.always(formatReadySummary({
    durationMs: 4300,
    healthSummary: {
      operational: { healthy: 7, notConfigured: 0, attention: 0, total: 7 },
      optional: { healthy: 0, notConfigured: 0, attention: 0, total: 0 },
    },
  }));
}

function buildNpmInvocation(scriptName, options = {}) {
  const normalizedScript = String(scriptName || '').trim();
  if (!/^[a-z0-9:_-]+$/i.test(normalizedScript)) {
    throw new Error(`Invalid npm script name: ${scriptName || '(empty)'}`);
  }

  const env = options.env || process.env;
  const execPath = options.execPath || process.execPath;
  const existsSync = options.existsSync || fs.existsSync;
  const candidates = [
    env.npm_execpath,
    path.join(path.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  const npmCliPath = candidates.find((candidate) => existsSync(candidate));

  if (!npmCliPath) {
    throw new Error('Could not locate npm-cli.js. Start the launcher with npm run dev.');
  }

  return {
    command: execPath,
    args: [npmCliPath, 'run', normalizedScript],
  };
}

function spawnManagedNpm(scriptName, options = {}) {
  const env = options.env || process.env;
  const invocation = buildNpmInvocation(scriptName, { env });
  return spawn(invocation.command, invocation.args, {
    cwd: REPO_ROOT,
    env,
    stdio: [options.inheritStdin ? 'inherit' : 'ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
}

function explainStartupFailure(error, recentLines = []) {
  const joined = recentLines.join('\n');
  if (/MONGODB_URI is not set/.test(joined)) return 'MongoDB connection details are missing from server/.env.';
  if (/MongoDB connection failed/.test(joined)) return 'MongoDB could not be reached. Check the connection and server/.env.';
  if (/EADDRINUSE/.test(joined)) return 'A process claimed the API port while startup was in progress.';
  return error.message || 'The service did not start.';
}

async function runDevLauncher(options = {}) {
  const parsed = { ...parseArgs(), ...options };
  if (parsed.quiet) parsed.verbose = false;
  const output = parsed.output || createOutput({ color: parsed.color, quiet: parsed.quiet });
  const ports = parsed.ports || resolvePorts({ env: parsed.env });
  const healthRunner = parsed.healthRunner || runServiceHealthChecks;
  const inspectStack = parsed.inspectExistingStackFn || inspectExistingStack;
  const browserOpener = parsed.openBrowserFn || openBrowser;
  const now = parsed.now || Date.now;
  const startedAt = now();
  const identity = parsed.identity || getRuntimeIdentity({ nodeVersion: parsed.nodeVersion });
  const showReadySummary = (healthSummary, durationMs = now() - startedAt) => {
    output.always(formatReadySummary({ durationMs, healthSummary }));
  };
  const maybeOpenApp = async () => {
    if (!parsed.open) return false;
    try {
      await browserOpener(`http://localhost:${ports.client}/`);
      output.success('✅ Opened the web app in your default browser', 'web');
      return true;
    } catch (error) {
      emitHealthWarning(
        output,
        `Failed — The browser could not be opened automatically: ${sanitizeDiagnostic(error.message)}`,
        `Open http://localhost:${ports.client}/ manually.`,
        'web'
      );
      return false;
    }
  };
  const runHealthSafely = async (healthOptions = {}) => {
    try {
      return await healthRunner(ports, { output, deep: parsed.deep, ...healthOptions });
    } catch (error) {
      emitHealthWarning(
        output,
        `Unavailable — Background health checks could not finish: ${sanitizeDiagnostic(error.message)}`,
        'Run npm run dev:check after startup settles.',
        'dev'
      );
      return { summary: { healthy: 0, attention: 1, notConfigured: 0, total: 1 } };
    }
  };

  if (parsed.preview) {
    renderPreview(output, ports, { identity });
    return { mode: 'preview', ports };
  }

  output.banner();
  output.blank();
  output.heading('🔎 Preflight');
  output.info(`ℹ️ ${identity.branch} · commit ${identity.commit}${identity.dirty ? ' · local changes' : ''} · Node ${identity.nodeVersion}`);
  const existing = await inspectStack(ports);
  if (parsed.check) {
    if (existing.apiIsQbo) output.success(`✅ QBO API is healthy on port ${ports.api}`);
    else if (existing.apiConnected) {
      output.warning(`⚠️ Port ${ports.api} is occupied, but it did not identify as the QBO API`);
      output.action('Check the port owner before stopping any process.');
    }
    else output.info(`ℹ️ QBO API is not running on port ${ports.api}`);

    if (existing.clientPage?.ok) output.success(`✅ QBO web app is available on port ${ports.client}`);
    else if (existing.clientConnected) {
      output.warning(`⚠️ Port ${ports.client} is occupied, but it did not return the QBO web app`);
      output.action('Check the port owner before stopping any process.');
    }
    else output.info(`ℹ️ QBO web app is not running on port ${ports.client}`);
    let health = null;
    if (existing.apiIsQbo && existing.clientPage?.ok) {
      await maybeOpenApp();
      health = await runHealthSafely();
    } else if (parsed.deep) {
      output.warning('⚠️ Deep checks need both the QBO API and web app to be running.');
      output.action('Start the app first, then rerun npm run dev:check -- --deep.');
    }
    output.write('   Status check only — no processes were started or stopped.');
    if (existing.apiIsQbo && existing.clientPage?.ok) showReadySummary(health?.summary);
    return { mode: 'check', ports, existing, deep: parsed.deep, health };
  }
  if (existing.apiIsQbo && existing.clientPage?.ok) {
    output.info('ℹ️ This development stack is already running; no duplicate processes were started.');
    await maybeOpenApp();
    const health = await runHealthSafely();
    output.write(`   App: http://localhost:${ports.client}`);
    output.write(`   API: http://127.0.0.1:${ports.api}`);
    output.write('   If you expected fresh code, stop the existing dev terminal and run this command again.');
    showReadySummary(health?.summary);
    return { mode: 'already-running', ports, health };
  }
  if (existing.apiConnected || existing.clientConnected) {
    if (existing.apiConnected) output.error(formatPortConflict('api', ports.api, existing.apiIsQbo));
    if (existing.clientConnected) output.error(formatPortConflict('client', ports.client, existing.clientPage?.ok));
    output.write('   Stop the process that owns the port, then run npm run dev again.');
    output.write(`   Windows check: powershell.exe -NoProfile -Command "Get-NetTCPConnection -State Listen -LocalPort ${existing.apiConnected ? ports.api : ports.client}"`);
    const error = new Error('Development startup stopped safely because a required port is already occupied.');
    error.code = 'DEV_PORT_IN_USE';
    throw error;
  }
  output.success(`✅ API port ${ports.api} is available`);
  output.success(`✅ Web port ${ports.client} is available`);

  const state = {};
  const children = [];
  const childDetails = new Map();
  const startupLines = [];
  let shuttingDown = false;
  let fullyReady = false;

  const shutdown = async (reason = 'shutdown') => {
    if (shuttingDown) return { ok: false, alreadyInProgress: true };
    shuttingDown = true;
    output.blank();
    output.info(`🛑 ${reason === 'SIGINT' ? 'Stopping development services' : 'Cleaning up development services'}…`);
    return stopDevelopmentServices(children, childDetails, output, { reason });
  };

  const signalHandler = (signal) => {
    void shutdown(signal).then((result) => { process.exitCode = result?.ok ? 0 : 1; });
  };
  process.once('SIGINT', signalHandler);
  process.once('SIGTERM', signalHandler);

  try {
    output.blank();
    output.heading('⚙️ Starting services');
    output.info('⏳ Starting API and connecting to MongoDB…', 'api');
    const server = spawnManagedNpm('dev:server', {
      inheritStdin: true,
      env: {
        ...process.env,
        ...parsed.env,
        PORT: String(ports.api),
        QBO_DEV_LAUNCHER: '1',
        QBO_DEV_VERBOSE: parsed.verbose ? '1' : '0',
      },
    });
    children.push(server);
    childDetails.set(server, { label: 'API', source: 'api' });
    attachChildOutput(server, 'api', output, state, { recentLines: startupLines, verbose: parsed.verbose });

    const apiReady = await waitForHttp(`http://127.0.0.1:${ports.api}/api/health`, {
      child: server,
      isFailed: () => state.apiCrashed === true,
      label: 'API',
      timeoutMs: API_START_TIMEOUT_MS,
    });
    output.success(`✅ API ready at http://127.0.0.1:${ports.api} (${(apiReady.elapsedMs / 1000).toFixed(1)}s)`, 'api');

    output.info('⏳ Starting the web app…', 'web');
    const client = spawnManagedNpm('dev:client', {
      env: {
        ...process.env,
        ...parsed.env,
        VITE_DEV_PORT: String(ports.client),
        VITE_PROXY_TARGET: `http://127.0.0.1:${ports.api}`,
      },
    });
    children.push(client);
    childDetails.set(client, { label: 'Web app', source: 'web' });
    attachChildOutput(client, 'web', output, state, { recentLines: startupLines, verbose: parsed.verbose });

    const clientReady = await waitForHttp(`http://localhost:${ports.client}/`, {
      child: client,
      label: 'Web app',
      timeoutMs: CLIENT_START_TIMEOUT_MS,
    });
    output.success(`✅ Web app ready at http://localhost:${ports.client} (${(clientReady.elapsedMs / 1000).toFixed(1)}s)`, 'web');

    fullyReady = true;
    state.coreReady = true;
    output.blank();
    output.heading(`✨ Core app ready in ${formatDuration(now() - startedAt)}`);
    output.write(`   App: http://localhost:${ports.client}`);
    output.write(`   API: http://127.0.0.1:${ports.api}`);
    output.write('   Press Ctrl+C once to stop both services.');
    if (!parsed.verbose) output.write('   Need raw details? Run: npm run dev -- --verbose');

    await maybeOpenApp();

    const onUnexpectedExit = (name) => (code, signal) => {
      if (shuttingDown) return;
      const detail = signal ? `signal ${signal}` : `exit code ${code}`;
      output.error(`❌ ${name} stopped unexpectedly (${detail}).`);
      void shutdown(`${name} failure`).then(() => { process.exitCode = code || 1; });
    };
    server.once('exit', onUnexpectedExit('API process'));
    client.once('exit', onUnexpectedExit('Web process'));

    const health = await runHealthSafely({ postReady: true });

    if (!shuttingDown) {
      output.blank();
      showReadySummary(health?.summary);
    }

    return { mode: 'running', ports, children, health };
  } catch (error) {
    if (!fullyReady) output.error(`❌ ${explainStartupFailure(error, startupLines)}`);
    await shutdown('startup failure');
    throw error;
  } finally {
    if (!fullyReady) {
      process.removeListener('SIGINT', signalHandler);
      process.removeListener('SIGTERM', signalHandler);
    }
  }
}

if (require.main === module) {
  runDevLauncher().catch((error) => {
    if (error.code !== 'DEV_PORT_IN_USE') {
      const parsed = parseArgs();
      const output = createOutput({ color: parsed.color, quiet: parsed.quiet });
      output.muted(`Details: ${error.message}`);
    }
    process.exitCode = 1;
  });
}

module.exports = {
  buildOpenInvocation,
  buildNpmInvocation,
  buildTreeKillInvocation,
  canConnect,
  checkDiskSpace,
  checkLiveCallProvider,
  checkWebSocket,
  checkWorkspaceEventStream,
  checkWritableDirectory,
  collectServiceHealth,
  connectionSummary,
  createOutput,
  emitServiceHealth,
  formatDuration,
  formatPortConflict,
  formatAge,
  formatReadySummary,
  getRuntimeIdentity,
  inspectExistingStack,
  latestTimestamp,
  mergeHealthSummaries,
  parseArgs,
  parseEnvValue,
  parseJsonResponse,
  parsePort,
  openBrowser,
  renderPreview,
  requestHttp,
  resolvePorts,
  runDevLauncher,
  runDeepServiceHealth,
  runServiceHealthChecks,
  safeHealthCheck,
  sanitizeDiagnostic,
  stopDevelopmentServices,
  stripAnsi,
  translateChildLine,
  waitForHttp,
  retryTransientHealthCheck,
};
