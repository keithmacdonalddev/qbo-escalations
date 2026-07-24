'use strict';

const { spawn } = require('child_process');

const ALLOWED_CLI_COMMANDS = new Set(['claude', 'codex']);

function buildCliVersionInvocation(command, options = {}) {
  const normalized = String(command || '').trim().toLowerCase();
  if (!ALLOWED_CLI_COMMANDS.has(normalized)) {
    throw new Error(`Unsupported CLI version probe: ${command || '(empty)'}`);
  }

  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  if (platform === 'win32') {
    return {
      command: env.ComSpec || process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', `${normalized} --version`],
    };
  }

  return {
    command: normalized,
    args: ['--version'],
  };
}

function buildProbeEnv(source = process.env) {
  const env = { ...source };
  delete env.CLAUDECODE;
  return env;
}

function buildProbeTerminationInvocation(pid, platform = process.platform) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return null;
  if (platform !== 'win32') return null;
  return {
    command: 'taskkill.exe',
    args: ['/pid', String(pid), '/T', '/F'],
  };
}

function terminateProbeChild(child, options = {}) {
  if (!child) return;
  const platform = options.platform || process.platform;
  const invocation = buildProbeTerminationInvocation(child.pid, platform);
  if (invocation) {
    try {
      const killer = (options.spawnFn || spawn)(invocation.command, invocation.args, {
        stdio: 'ignore',
        shell: false,
        windowsHide: true,
      });
      killer.on?.('error', () => {});
      killer.unref?.();
      return;
    } catch {
      // Fall through to the direct process stop.
    }
  }
  try { child.kill('SIGTERM'); } catch { /* already stopped */ }
}

function probeCliVersion(command, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : 3000;
  const spawnFn = options.spawnFn || spawn;
  const env = buildProbeEnv(options.env || process.env);
  const invocation = buildCliVersionInvocation(command, {
    platform: options.platform,
    env,
  });

  return new Promise((resolve) => {
    let settled = false;
    let output = '';
    let errorOutput = '';
    let child;

    function finish(payload) {
      if (settled) return;
      settled = true;
      resolve(payload);
    }

    try {
      child = spawnFn(invocation.command, invocation.args, {
        cwd: options.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
    } catch (err) {
      finish({
        available: false,
        code: 'CLI_UNAVAILABLE',
        reason: err.message || `${command} unavailable`,
      });
      return;
    }

    const timeout = setTimeout(() => {
      (options.terminateFn || terminateProbeChild)(child, {
        platform: options.platform,
        spawnFn: options.killSpawnFn,
      });
      finish({
        available: false,
        code: 'TIMEOUT',
        reason: `${command} availability check timed out`,
      });
    }, timeoutMs);
    if (timeout.unref) timeout.unref();

    child.stdout?.on('data', (chunk) => {
      if (output.length < 1000) output += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      if (errorOutput.length < 1000) errorOutput += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      finish({
        available: false,
        code: 'CLI_UNAVAILABLE',
        reason: err.message || `${command} unavailable`,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        finish({
          available: true,
          code: 'OK',
          reason: output.trim().split(/\r?\n/)[0] || `${command} ready`,
        });
        return;
      }
      finish({
        available: false,
        code: 'CLI_UNAVAILABLE',
        reason: (errorOutput || output || `${command} exited with code ${code}`).trim().slice(0, 240),
      });
    });
  });
}

module.exports = {
  ALLOWED_CLI_COMMANDS,
  buildCliVersionInvocation,
  buildProbeTerminationInvocation,
  buildProbeEnv,
  probeCliVersion,
  terminateProbeChild,
};
