#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const testDir = path.join(rootDir, 'test');
const timeoutMs = Number.parseInt(process.env.TEST_FILE_TIMEOUT_MS || '120000', 10);
const verbose = process.env.TEST_VERBOSE === '1';
const maxCapturedOutput = 128 * 1024;

function parseArgs(argv) {
  const options = { continueOnFailure: false, resultPath: null, files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--continue') options.continueOnFailure = true;
    else if (arg === '--result-path') options.resultPath = argv[++index] || null;
    else options.files.push(arg);
  }
  if (argv.includes('--result-path') && !options.resultPath) {
    throw new Error('--result-path requires a file path');
  }
  return options;
}

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

function hasCompleteTestSummary(output) {
  const text = String(output || '');
  return /(?:^|\n)# tests \d+\s*(?:\r?\n)/.test(text)
    && /(?:^|\n)# pass \d+\s*(?:\r?\n)/.test(text)
    && /(?:^|\n)# fail \d+\s*(?:\r?\n|$)/.test(text);
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

function runTestFile(relativePath, { fileTimeoutMs = timeoutMs } = {}) {
  return new Promise((resolve) => {
    const args = ['--test', '--test-isolation=none', '--test-reporter=tap', relativePath];
    const childEnv = { ...process.env };
    // When this runner is itself exercised by node:test, inheriting this
    // internal variable makes the nested child emit binary V8 protocol data
    // instead of a standalone terminal test report.
    delete childEnv.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, args, {
      cwd: rootDir,
      env: {
        ...childEnv,
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
      stdio: ['ignore', 'pipe', 'pipe'],
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

    child.stdout.on('data', (chunk) => {
      appendOutput(chunk);
      if (verbose) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      appendOutput(chunk);
      if (verbose) process.stderr.write(chunk);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
    }, fileTimeoutMs);
    timer.unref();

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const disconnected = !timedOut && !signal && code !== 0 && !hasCompleteTestSummary(output);
      resolve({ code, signal, timedOut, disconnected, output });
    });
  });
}

function summarizeResults(discoveredFiles, results) {
  const counts = {
    discovered: discoveredFiles.length,
    started: results.length,
    completed: results.filter((result) => !result.timedOut && result.terminal).length,
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
    timedOut: results.filter((result) => result.status === 'timed-out').length,
    interrupted: results.filter((result) => result.status === 'interrupted').length,
    notRun: Math.max(0, discoveredFiles.length - results.length),
  };
  const verdict = counts.timedOut > 0 || counts.interrupted > 0 || counts.notRun > 0 || counts.completed < counts.discovered
    ? 'incomplete'
    : counts.failed > 0
      ? 'failed'
      : 'passed';
  return { schemaVersion: 1, verdict, counts, files: results };
}

function writeSummary(resultPath, summary) {
  if (!resultPath) return;
  const absolutePath = path.resolve(process.cwd(), resultPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = options.files.length > 0
    ? options.files.map((file) => path.resolve(rootDir, file))
    : discoverTests(testDir);

  if (files.length === 0) {
    console.error('[server-test] No test files found.');
    process.exitCode = 124;
    return;
  }

  const suiteStart = Date.now();
  const results = [];
  let stoppedFailFast = false;
  for (const file of files) {
    const relativePath = normalizeTestPath(file);
    const fileStart = Date.now();
    process.stdout.write(`[server-test] ${relativePath} ... `);
    const result = await runTestFile(relativePath);
    const elapsedSec = ((Date.now() - fileStart) / 1000).toFixed(1);

    const interrupted = !result.timedOut && (Boolean(result.signal) || result.disconnected === true);
    const fileResult = {
      file: relativePath,
      status: result.timedOut ? 'timed-out' : interrupted ? 'interrupted' : result.code === 0 ? 'passed' : 'failed',
      terminal: !result.timedOut && !interrupted,
      durationMs: Date.now() - fileStart,
      exitCode: result.code,
      signal: result.signal || null,
      interruptionReason: result.disconnected ? 'process-disconnected-before-terminal-summary' : null,
      timedOut: result.timedOut,
    };
    results.push(fileResult);

    if (result.timedOut || interrupted || result.code !== 0) {
      const reason = result.timedOut
        ? `timed out after ${timeoutMs}ms`
        : interrupted
          ? result.signal ? `interrupted by ${result.signal}` : 'test process disconnected before its terminal summary'
          : `exited with ${result.code}`;
      console.error(`${interrupted || result.timedOut ? 'incomplete' : 'failed'} (${elapsedSec}s, ${reason})`);
      if (!verbose && result.output.trim()) {
        console.error('\n[server-test] Captured output:');
        console.error(result.output.trim());
      }
      if (!options.continueOnFailure) {
        stoppedFailFast = true;
        break;
      }
      continue;
    }

    console.log(`passed (${elapsedSec}s)`);
  }

  const summary = summarizeResults(files.map(normalizeTestPath), results);
  summary.startedAt = new Date(suiteStart).toISOString();
  summary.finishedAt = new Date().toISOString();
  summary.continueOnFailure = options.continueOnFailure;
  writeSummary(options.resultPath, summary);
  const suiteElapsedSec = ((Date.now() - suiteStart) / 1000).toFixed(1);
  console.log(`[server-test] ${summary.counts.passed}/${summary.counts.discovered} test files passed (${suiteElapsedSec}s, ${summary.verdict})`);
  process.exitCode = stoppedFailFast && results.at(-1)?.status === 'failed'
    ? 1
    : summary.verdict === 'passed'
      ? 0
      : summary.verdict === 'incomplete'
        ? 124
        : 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[server-test] Unhandled runner error:', err);
    process.exitCode = 124;
  });
}

module.exports = {
  discoverTests,
  hasCompleteTestSummary,
  normalizeTestPath,
  parseArgs,
  runTestFile,
  summarizeResults,
  writeSummary,
};
