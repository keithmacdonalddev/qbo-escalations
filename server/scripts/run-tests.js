#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const testDir = path.join(rootDir, 'test');
const timeoutMs = Number.parseInt(process.env.TEST_FILE_TIMEOUT_MS || '120000', 10);
const verbose = process.env.TEST_VERBOSE === '1';
const maxCapturedOutput = 128 * 1024;

function discoverTests(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return discoverTests(fullPath);
      return entry.isFile() && entry.name.endsWith('.test.js') ? [fullPath] : [];
    })
    .sort((a, b) => a.localeCompare(b));
}

function normalizeTestPath(filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, '/');
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process already exited.
    }
  }
}

function runTestFile(relativePath) {
  return new Promise((resolve) => {
    const args = ['--test', '--test-isolation=none', relativePath];
    const child = spawn(process.execPath, args, {
      cwd: rootDir,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || 'test',
        // Provider-call-package capture defaults to ON in production. Tests
        // must opt in per-file (most set the flag to 'true' themselves), so
        // the suite baseline is capture-off to avoid background package
        // writes from every chat/parse-path test. Tests asserting the
        // production default delete the variable inside the test.
        ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE:
          process.env.ENABLE_PROVIDER_CALL_PACKAGE_CAPTURE ?? 'false',
      },
      detached: process.platform !== 'win32',
      stdio: verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let timedOut = false;
    let output = '';
    const appendOutput = (chunk) => {
      output += chunk.toString();
      if (output.length > maxCapturedOutput) {
        output = output.slice(output.length - maxCapturedOutput);
      }
    };

    if (!verbose) {
      child.stdout.on('data', appendOutput);
      child.stderr.on('data', appendOutput);
    }

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
    }, timeoutMs);
    timer.unref();

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, output });
    });
  });
}

async function main() {
  const explicitFiles = process.argv.slice(2);
  const files = explicitFiles.length > 0
    ? explicitFiles.map((file) => path.resolve(rootDir, file))
    : discoverTests(testDir);

  if (files.length === 0) {
    console.error('[server-test] No test files found.');
    process.exitCode = 1;
    return;
  }

  const suiteStart = Date.now();
  for (const file of files) {
    const relativePath = normalizeTestPath(file);
    const fileStart = Date.now();
    process.stdout.write(`[server-test] ${relativePath} ... `);
    const result = await runTestFile(relativePath);
    const elapsedSec = ((Date.now() - fileStart) / 1000).toFixed(1);

    if (result.timedOut || result.code !== 0) {
      const reason = result.timedOut
        ? `timed out after ${timeoutMs}ms`
        : `exited with ${result.code ?? result.signal}`;
      console.error(`failed (${elapsedSec}s, ${reason})`);
      if (!verbose && result.output.trim()) {
        console.error('\n[server-test] Captured output:');
        console.error(result.output.trim());
      }
      process.exitCode = result.timedOut ? 124 : (result.code || 1);
      return;
    }

    console.log(`passed (${elapsedSec}s)`);
  }

  const suiteElapsedSec = ((Date.now() - suiteStart) / 1000).toFixed(1);
  console.log(`[server-test] ${files.length} test files passed (${suiteElapsedSec}s)`);
}

main().catch((err) => {
  console.error('[server-test] Unhandled runner error:', err);
  process.exitCode = 1;
});
