'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TEST_DIR = path.resolve(__dirname, '..', '..', 'test');
const GROUPS = [
  {
    id: 'image-parser',
    label: 'Image Parser',
    description: 'Parser services, routes, and gallery coverage.',
    match: (fileName) => fileName.startsWith('image-parser'),
  },
  {
    id: 'chat',
    label: 'Chat',
    description: 'Chat flows, orchestration, SSE, and abort behavior.',
    match: (fileName) => fileName.startsWith('chat-')
      || fileName === 'abort.test.js'
      || fileName === 'parse-orchestrator.test.js'
      || fileName === 'sse-parser.test.js',
  },
  {
    id: 'usage',
    label: 'Usage',
    description: 'Usage logging, pricing, and reporting coverage.',
    match: (fileName) => fileName.startsWith('usage-') || fileName === 'pricing.test.js',
  },
  {
    id: 'escalation',
    label: 'Escalations',
    description: 'Escalation parsing, validation, and matching logic.',
    match: (fileName) => fileName.startsWith('escalation-')
      || fileName === 'inv-matcher.test.js'
      || fileName === 'parse-validation.test.js',
  },
  {
    id: 'provider',
    label: 'Providers',
    description: 'Provider helpers and provider usage contracts.',
    match: (fileName) => fileName.startsWith('provider-'),
  },
  {
    id: 'integration',
    label: 'Integration',
    description: 'End-to-end route and cross-surface integration coverage.',
    match: (fileName) => fileName.includes('integration')
      || fileName.includes('routes'),
  },
  {
    id: 'infra',
    label: 'Infra',
    description: 'Shared helpers and low-level infrastructure coverage.',
    match: () => true,
  },
];

let activeRun = null;
const rawTestFileTimeoutMs = Number.parseInt(process.env.TEST_RUNNER_FILE_TIMEOUT_MS, 10);
const TEST_FILE_TIMEOUT_MS = Number.isFinite(rawTestFileTimeoutMs) && rawTestFileTimeoutMs > 0
  ? rawTestFileTimeoutMs
  : 180_000;
const TEST_ENV_STRIP_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'MOONSHOT_API_KEY',
  'GEMINI_API_KEY',
  'LLM_GATEWAY_API_KEY',
  'LM_STUDIO_API_KEY',
  'LM_STUDIO_API_TOKEN',
  'LLM_GATEWAY_API_URL',
  'LLM_GATEWAY_DEFAULT_MODEL',
  'LM_STUDIO_API_URL',
  'LM_STUDIO_CHAT_TIMEOUT_MS',
  'LM_STUDIO_PARSE_TIMEOUT_MS',
  'IMAGE_PARSER_STATUS_CACHE_TTL_MS',
  'ENABLE_GEMINI_IMAGE_PARSER',
];

function buildTestProcessEnv() {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT || 'dashboard-test-runner',
  };

  for (const key of TEST_ENV_STRIP_KEYS) {
    delete env[key];
  }

  return env;
}

function listTestFiles() {
  if (!fs.existsSync(TEST_DIR)) return [];
  return fs.readdirSync(TEST_DIR)
    .filter((fileName) => fileName.endsWith('.test.js'))
    .sort((left, right) => left.localeCompare(right));
}

function getGroupForFile(fileName) {
  return GROUPS.find((group) => group.match(fileName)) || GROUPS[GROUPS.length - 1];
}

function decodeQuotedString(raw) {
  const quote = raw[0];
  if (!quote || !['"', '\'', '`'].includes(quote)) return '';
  if (quote === '`') {
    return raw.slice(1, -1).replace(/\$\{[\s\S]*?\}/g, '${...}');
  }

  try {
    return JSON.parse(`"${raw.slice(1, -1).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  } catch {
    return raw.slice(1, -1);
  }
}

function findMatchingParen(source, openIndex) {
  let depth = 0;
  let inString = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === inString) {
        inString = null;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      inString = char;
      continue;
    }

    if (char === '(') {
      depth += 1;
      continue;
    }

    if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function extractTestsFromSource(source) {
  const tests = [];
  const matcher = /\b(?:await\s+)?(?:(\w+)\.)?test\s*\(/g;
  let match;

  while ((match = matcher.exec(source)) !== null) {
    const openIndex = source.indexOf('(', match.index);
    const closeIndex = findMatchingParen(source, openIndex);
    if (closeIndex === -1) continue;

    const callBody = source.slice(openIndex + 1, closeIndex);
    const nameMatch = callBody.match(/^\s*(['"`])(?:\\.|(?!\1)[\s\S])*?\1/);
    if (!nameMatch) continue;

    const name = decodeQuotedString(nameMatch[0]);
    const nestedBody = callBody.slice(nameMatch[0].length);
    const hasNestedTests = /\b(?:await\s+)?\w*\.?test\s*\(/.test(nestedBody);

    tests.push({
      name,
      hasNestedTests,
    });
  }

  return tests;
}

function getFileMetadata(fileName) {
  const filePath = path.join(TEST_DIR, fileName);
  const source = fs.readFileSync(filePath, 'utf8');
  const parsed = extractTestsFromSource(source);
  const suiteNames = parsed.filter((entry) => entry.hasNestedTests).map((entry) => entry.name);
  const testNames = parsed
    .filter((entry) => !entry.hasNestedTests)
    .map((entry) => entry.name);

  return {
    fileName,
    filePath,
    suiteNames,
    testNames,
    groupId: getGroupForFile(fileName).id,
  };
}

function buildNameCounts(names) {
  const counts = new Map();
  for (const name of names) {
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return counts;
}

function getAllFileMetadata() {
  return listTestFiles().map((fileName) => getFileMetadata(fileName));
}

function getGroupCatalog() {
  const files = getAllFileMetadata();
  const byGroup = new Map(GROUPS.map((group) => [group.id, []]));

  for (const file of files) {
    if (!byGroup.has(file.groupId)) byGroup.set(file.groupId, []);
    byGroup.get(file.groupId).push(file);
  }

  const groups = GROUPS.map((group) => {
    const groupedFiles = byGroup.get(group.id) || [];
    return {
      id: group.id,
      label: group.label,
      description: group.description,
      fileCount: groupedFiles.length,
      testCount: groupedFiles.reduce((sum, file) => sum + file.testNames.length, 0),
    };
  });

  return {
    groups,
    totalTestCount: files.reduce((sum, file) => sum + file.testNames.length, 0),
  };
}

function getFilesForGroup(groupId) {
  const files = getAllFileMetadata();
  if (!groupId || groupId === 'all') return files;

  const groupExists = GROUPS.some((group) => group.id === groupId);
  if (!groupExists) return null;

  return files.filter((file) => file.groupId === groupId);
}

function serializeGroupTests(groupId) {
  const files = getFilesForGroup(groupId);
  if (files === null) return null;

  return files.map((file) => ({
    name: file.fileName,
    tests: file.testNames,
  }));
}

function parseResultLine(line) {
  const match = line.match(/^[ \t]*([✔✖﹣])\s+(.+?)\s+\(([\d.]+)ms\)(?:\s+#\s+SKIP)?\s*$/u);
  if (!match) return null;

  return {
    symbol: match[1],
    name: match[2].trim(),
    durationMs: Math.round(Number.parseFloat(match[3]) * 1000) / 1000,
    skip: line.includes('# SKIP'),
  };
}

function parseFailureDetails(output) {
  const lines = String(output || '').split(/\r?\n/);
  const details = new Map();
  let inFailureSection = false;
  let currentName = null;
  let currentLines = [];

  function flushCurrent() {
    if (!currentName) return;
    const detailText = currentLines.join('\n').trim();
    if (detailText) {
      details.set(currentName, {
        test: currentName,
        error: detailText,
        message: detailText.split('\n')[0],
        stack: detailText,
      });
    }
    currentName = null;
    currentLines = [];
  }

  for (const line of lines) {
    if (line === '✖ failing tests:') {
      inFailureSection = true;
      flushCurrent();
      continue;
    }

    if (!inFailureSection) continue;

    const result = parseResultLine(line);
    if (result && result.symbol === '✖') {
      flushCurrent();
      currentName = result.name;
      continue;
    }

    if (currentName) {
      if (!line.trim() && currentLines.length > 0) {
        currentLines.push('');
      } else if (line.trim()) {
        currentLines.push(line);
      }
    }
  }

  flushCurrent();
  return details;
}

async function runFile(file, writeEvent, isClientConnected) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-isolation=none', file.filePath], {
      cwd: path.resolve(TEST_DIR, '..'),
      env: buildTestProcessEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeRun.child = child;

    const stdoutChunks = [];
    const stderrChunks = [];
    const expectedNameCounts = buildNameCounts(file.testNames);
    const emittedNameCounts = new Map();
    const suiteNames = new Set(file.suiteNames);
    let timedOut = false;
    let finalized = false;
    let observedFailure = false;
    let completionTimer = null;
    let emittedCount = 0;

    function finalizeRun(codeOverride) {
      if (finalized) return;
      finalized = true;
      clearTimeout(fileTimeout);
      if (completionTimer) clearTimeout(completionTimer);

      const stdout = stdoutChunks.join('');
      const stderr = stderrChunks.join('');
      const failureDetails = parseFailureDetails(`${stdout}\n${stderr}`);

      for (const [name, detail] of failureDetails.entries()) {
        if (!suiteNames.has(name) && file.testNames.includes(name)) {
          writeEvent('test-error', detail);
        }
      }

      const summary = {
        tests: 0,
        pass: 0,
        fail: 0,
        skipped: 0,
      };

      for (const line of `${stdout}\n${stderr}`.split(/\r?\n/)) {
        let match = line.match(/^ℹ tests (\d+)$/u);
        if (match) summary.tests = Number.parseInt(match[1], 10);
        match = line.match(/^ℹ pass (\d+)$/u);
        if (match) summary.pass = Number.parseInt(match[1], 10);
        match = line.match(/^ℹ fail (\d+)$/u);
        if (match) summary.fail = Number.parseInt(match[1], 10);
        match = line.match(/^ℹ skipped (\d+)$/u);
        if (match) summary.skipped = Number.parseInt(match[1], 10);
      }

      if (!timedOut && emittedCount < file.testNames.length && isClientConnected()) {
        for (const [name, expectedCount] of expectedNameCounts.entries()) {
          const emittedForName = emittedNameCounts.get(name) || 0;
          const remainingCount = Math.max(0, expectedCount - emittedForName);
          for (let index = 0; index < remainingCount; index += 1) {
            const passed = !failureDetails.has(name) && !observedFailure && codeOverride === 0;
            writeEvent('test-result', {
              name,
              passed,
              skip: false,
              durationMs: null,
              file: file.fileName,
            });
          }
        }
      }

      resolve({
        exitCode: timedOut && (codeOverride === null || codeOverride === 0) ? 1 : codeOverride,
        stdout,
        stderr: timedOut
          ? `${stderr}${stderr ? '\n' : ''}${file.fileName} timed out after ${TEST_FILE_TIMEOUT_MS}ms`
          : stderr,
        summary,
        timedOut,
      });
    }

    function scheduleCompletion(codeOverride) {
      if (completionTimer || finalized) return;
      completionTimer = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {
          // Ignore forced shutdown failures after suite output completed.
        }
        finalizeRun(codeOverride);
      }, 500);
    }

    function processLine(rawLine) {
      const line = String(rawLine || '').trimEnd();
      if (!line) return;

      if (line.startsWith('▶ ')) {
        writeEvent('comment', {
          kind: 'suite',
          file: file.fileName,
          message: line.slice(2).trim(),
        });
      }

      const result = parseResultLine(line);
      if (result) {
        if (result.symbol === '✖') observedFailure = true;
        if (suiteNames.has(result.name)) {
          scheduleCompletion(result.symbol === '✖' ? 1 : 0);
          return;
        }
        if (!expectedNameCounts.has(result.name)) return;

        const expectedCount = expectedNameCounts.get(result.name) || 0;
        const emittedForName = emittedNameCounts.get(result.name) || 0;
        if (emittedForName >= expectedCount) return;

        emittedNameCounts.set(result.name, emittedForName + 1);
        emittedCount += 1;
        writeEvent('test-result', {
          name: result.name,
          passed: result.symbol === '✔',
          skip: result.skip || result.symbol === '﹣',
          durationMs: result.durationMs,
          file: file.fileName,
        });

        if (emittedCount >= file.testNames.length) {
          scheduleCompletion(observedFailure ? 1 : 0);
        }
        return;
      }

      if (line.startsWith('ℹ duration_ms ')) {
        scheduleCompletion(observedFailure ? 1 : 0);
      }
    }

    function attachLineProcessor(stream, chunks) {
      let buffer = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        chunks.push(chunk);
        buffer += chunk;

        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          processLine(line);
          newlineIndex = buffer.indexOf('\n');
        }
      });
      stream.on('end', () => {
        if (buffer) processLine(buffer);
      });
    }

    attachLineProcessor(child.stdout, stdoutChunks);
    attachLineProcessor(child.stderr, stderrChunks);

    const fileTimeout = setTimeout(() => {
      timedOut = true;
      writeEvent('comment', {
        kind: 'timeout',
        file: file.fileName,
        message: `${file.fileName} exceeded ${Math.round(TEST_FILE_TIMEOUT_MS / 1000)}s and was aborted`,
      });
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore timeout cleanup failures.
      }
    }, TEST_FILE_TIMEOUT_MS);

    child.on('close', (code) => {
      finalizeRun(code);
    });
  });
}

async function runTests({ groupId, writeEvent, isClientConnected }) {
  if (activeRun) {
    const error = new Error('A test run is already in progress');
    error.code = 'RUN_IN_PROGRESS';
    throw error;
  }

  const files = getFilesForGroup(groupId);
  if (files === null) {
    const error = new Error(`Unknown test group: ${groupId}`);
    error.code = 'UNKNOWN_GROUP';
    throw error;
  }

  activeRun = { child: null };
  const startedAt = Date.now();
  const groupLabel = groupId && groupId !== 'all'
    ? (GROUPS.find((group) => group.id === groupId) || {}).label || groupId
    : 'All Tests';

  writeEvent('run-start', {
    group: groupId || 'all',
    pattern: groupLabel,
  });

  const plannedTotal = files.reduce((sum, file) => sum + file.testNames.length, 0);
  writeEvent('test-plan', { total: plannedTotal });

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let total = 0;
  let stderr = '';
  let exitCode = 0;

  try {
    for (const file of files) {
      if (!isClientConnected()) break;

      writeEvent('comment', {
        kind: 'file-start',
        file: file.fileName,
        message: `Running ${file.fileName}`,
      });

      const result = await runFile(file, (event, payload) => {
        if (!isClientConnected()) return;

        if (event === 'test-result') {
          total += 1;
          if (payload.skip) skipped += 1;
          else if (payload.passed) passed += 1;
          else failed += 1;
        }
        writeEvent(event, payload);
      }, isClientConnected);

      if (result.exitCode && exitCode === 0) exitCode = result.exitCode;
      if (result.stderr) stderr += (stderr ? '\n' : '') + result.stderr.trim();
      if (result.timedOut) {
        writeEvent('error', {
          message: `${file.fileName} timed out after ${Math.round(TEST_FILE_TIMEOUT_MS / 1000)}s`,
        });
        break;
      }
    }

    writeEvent('suite-complete', {
      total,
      passed,
      failed,
      skipped,
      exitCode,
      stderr: stderr || '',
      durationMs: Date.now() - startedAt,
    });
  } finally {
    activeRun = null;
  }
}

function abortActiveRun() {
  if (!activeRun || !activeRun.child) return;
  try {
    activeRun.child.kill('SIGTERM');
  } catch {
    // Ignore cleanup failures during client disconnect.
  }
}

module.exports = {
  GROUPS,
  abortActiveRun,
  getGroupCatalog,
  runTests,
  serializeGroupTests,
  _internal: {
    extractTestsFromSource,
    getFileMetadata,
    getGroupForFile,
      listTestFiles,
      parseFailureDetails,
      parseResultLine,
      TEST_FILE_TIMEOUT_MS,
    },
};
