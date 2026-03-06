import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultConfigPath = path.resolve(__dirname, './config/benchmark-config.json');

async function main() {
  const { configPath, flags } = parseArgs(process.argv.slice(2));
  const resolvedConfigPath = path.resolve(process.cwd(), configPath || defaultConfigPath);
  const config = JSON.parse(await fs.readFile(resolvedConfigPath, 'utf8'));
  const adapter = flags.adapter || config.runner.adapter || 'mock';
  const commandTemplate = flags.command || config.runner.command || '';
  const configDir = path.dirname(resolvedConfigPath);
  const resultsDir = path.resolve(configDir, config.resultsDir);
  const runsDir = path.join(resultsDir, 'runs');
  const scenariosDir = path.resolve(configDir, config.scenariosDir);
  const variantsDir = path.resolve(configDir, config.variantsDir);
  const fixturesDir = path.resolve(configDir, config.fixturesDir);
  const repetitions = Number(flags.repetitions || config.runner.repetitions || 1);
  const generatedAt = new Date().toISOString();

  await ensureDir(resultsDir);
  await ensureDir(runsDir);

  const scenarios = await Promise.all(
    config.scenarioIds.map(async (scenarioId) => {
      const filePath = path.join(scenariosDir, `${scenarioId}.json`);
      return JSON.parse(await fs.readFile(filePath, 'utf8'));
    }),
  );

  const variantGroups = {};
  for (const [category, ids] of Object.entries(config.matrix)) {
    variantGroups[category] = await Promise.all(
      ids.map(async (variantId) => {
        const variantDir = path.join(variantsDir, category, variantId);
        const manifest = JSON.parse(await fs.readFile(path.join(variantDir, 'variant.json'), 'utf8'));
        return {
          ...manifest,
          dir: variantDir,
          category,
        };
      }),
    );
  }

  const combinations = cartesianProduct(Object.values(variantGroups));
  const results = [];

  for (const scenario of scenarios) {
    for (const stack of combinations) {
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        const runId = buildRunId(generatedAt, scenario.id, stack, repetition);
        const runRoot = path.join(runsDir, runId);
        const workspaceDir = path.join(runRoot, 'workspace');
        const fixtureDir = path.join(fixturesDir, scenario.fixture);
        const manifestDir = path.join(workspaceDir, '.policy-lab');
        const promptFile = path.join(manifestDir, 'prompt.txt');
        const manifestFile = path.join(manifestDir, 'run-manifest.json');
        const outputFile = path.join(manifestDir, 'run-output.json');

        await copyDirectory(fixtureDir, workspaceDir);
        await ensureDir(manifestDir);
        await applyVariantsToWorkspace(stack, workspaceDir);

        const initialSnapshot = await snapshotDirectory(workspaceDir);
        const mergedAttributes = mergeVariantAttributes(stack);

        await fs.writeFile(promptFile, `${scenario.prompt}\n`, 'utf8');
        await fs.writeFile(
          manifestFile,
          JSON.stringify(
            {
              runId,
              scenario,
              workspaceDir,
              promptFile,
              outputFile,
              adapter,
              repetition,
              variantStack: stack.map((variant) => ({
                category: variant.category,
                id: variant.id,
                label: variant.label,
                attributes: variant.attributes || {},
              })),
              mergedAttributes,
            },
            null,
            2,
          ),
          'utf8',
        );

        await executeAdapter({
          adapter,
          commandTemplate,
          manifestFile,
          promptFile,
          outputFile,
          scenarioId: scenario.id,
          workspaceDir,
        });

        const finalSnapshot = await snapshotDirectory(workspaceDir);
        const changedFiles = diffSnapshots(initialSnapshot, finalSnapshot).filter(
          (filePath) => !filePath.startsWith('.policy-lab/'),
        );
        const output = await loadOutput(outputFile);
        const evaluation = await evaluateScenario({
          scenario,
          workspaceDir,
          changedFiles,
          output,
        });

        results.push({
          runId,
          scenarioId: scenario.id,
          scenarioTitle: scenario.title,
          repetition,
          adapter,
          stack: Object.fromEntries(stack.map((variant) => [variant.category, variant.id])),
          changedFiles,
          output,
          evaluation,
        });
      }
    }
  }

  const summary = buildSummary(config.name, generatedAt, adapter, results, config.passThreshold || 85);
  const latestSummaryPath = path.join(resultsDir, 'latest-summary.json');
  const detailedResultsPath = path.join(resultsDir, `benchmark-${safeTimestamp(generatedAt)}.json`);

  await fs.writeFile(
    latestSummaryPath,
    JSON.stringify({ benchmarkName: config.name, generatedAt, adapter, summary }, null, 2),
    'utf8',
  );
  await fs.writeFile(
    detailedResultsPath,
    JSON.stringify({ benchmarkName: config.name, generatedAt, adapter, results, summary }, null, 2),
    'utf8',
  );

  console.log(JSON.stringify({ summaryPath: latestSummaryPath, detailedResultsPath, adapter, totalRuns: results.length }, null, 2));
}

function parseArgs(argv) {
  const flags = {};
  let configPath = '';

  for (const arg of argv) {
    if (arg.startsWith('--adapter=')) {
      flags.adapter = arg.slice('--adapter='.length);
    } else if (arg.startsWith('--command=')) {
      flags.command = arg.slice('--command='.length);
    } else if (arg.startsWith('--repetitions=')) {
      flags.repetitions = arg.slice('--repetitions='.length);
    } else if (!configPath) {
      configPath = arg;
    }
  }

  return { configPath, flags };
}

function cartesianProduct(groups) {
  return groups.reduce(
    (accumulator, group) =>
      accumulator.flatMap((entry) => group.map((value) => [...entry, value])),
    [[]],
  );
}

function buildRunId(timestamp, scenarioId, stack, repetition) {
  return `${safeTimestamp(timestamp)}-${scenarioId}-${stack.map((variant) => variant.id).join('-')}-r${repetition}`;
}

function safeTimestamp(value) {
  return value.replace(/[:.]/g, '-');
}

async function ensureDir(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: true });
}

async function copyDirectory(sourceDir, destinationDir) {
  await ensureDir(destinationDir);
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
    } else {
      await ensureDir(path.dirname(destinationPath));
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

async function applyVariantsToWorkspace(stack, workspaceDir) {
  for (const variant of stack) {
    for (const overlay of variant.overlays || []) {
      const sourcePath = path.join(variant.dir, overlay.source);
      const destinationPath = path.join(workspaceDir, overlay.target);
      await ensureDir(path.dirname(destinationPath));
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

function mergeVariantAttributes(stack) {
  return stack.reduce((accumulator, variant) => {
    accumulator[variant.category] = { ...(accumulator[variant.category] || {}), ...(variant.attributes || {}) };
    return accumulator;
  }, {});
}

async function snapshotDirectory(directoryPath, rootPath = directoryPath, files = new Map()) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      await snapshotDirectory(fullPath, rootPath, files);
    } else {
      const relativePath = normalizePath(path.relative(rootPath, fullPath));
      const digest = createHash('sha1').update(await fs.readFile(fullPath)).digest('hex');
      files.set(relativePath, digest);
    }
  }

  return files;
}

function diffSnapshots(before, after) {
  const changed = [];
  const paths = new Set([...before.keys(), ...after.keys()]);

  for (const filePath of paths) {
    if (before.get(filePath) !== after.get(filePath)) {
      changed.push(filePath);
    }
  }

  return changed.sort();
}

async function executeAdapter({ adapter, commandTemplate, manifestFile, promptFile, outputFile, scenarioId, workspaceDir }) {
  if (adapter === 'manual') {
    await fs.writeFile(
      outputFile,
      JSON.stringify(
        {
          finalResponse: 'Manual mode: workspace prepared for external execution.',
          actions: ['prepare_workspace'],
          metadata: {
            manual: true,
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    return;
  }

  if (adapter === 'mock') {
    await spawnProcess(process.execPath, [path.resolve(__dirname, './mock-agent.mjs'), manifestFile], workspaceDir);
    return;
  }

  if (adapter === 'command') {
    if (!commandTemplate) {
      throw new Error('Command adapter requires --command or runner.command in config.');
    }

    const command = substitutePlaceholders(commandTemplate, {
      workspace: workspaceDir,
      promptFile,
      manifest: manifestFile,
      outputFile,
      scenarioId,
    });

    const shellCommand = process.platform === 'win32' ? 'powershell' : 'bash';
    const shellArgs = process.platform === 'win32'
      ? ['-NoProfile', '-Command', command]
      : ['-lc', command];
    await spawnProcess(shellCommand, shellArgs, workspaceDir);
    return;
  }

  throw new Error(`Unknown adapter: ${adapter}`);
}

function substitutePlaceholders(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] || '');
}

function spawnProcess(command, args, workingDirectory) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workingDirectory,
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Process failed with exit code ${code}`));
    });

    child.on('error', reject);
  });
}

async function loadOutput(outputFile) {
  try {
    return JSON.parse(await fs.readFile(outputFile, 'utf8'));
  } catch {
    return { finalResponse: '', actions: [], metadata: {} };
  }
}

async function evaluateScenario({ scenario, workspaceDir, changedFiles, output }) {
  const checks = [];
  let score = 0;
  let maxScore = 0;
  let hardFailure = false;

  for (const check of scenario.checks) {
    maxScore += check.weight || 0;
    let result;
    try {
      result = await runCheck(check, workspaceDir, changedFiles, output);
    } catch (error) {
      result = {
        passed: false,
        detail: error.message || 'Check execution failed.',
      };
    }
    const awarded = result.passed ? check.weight || 0 : 0;
    score += awarded;
    hardFailure = hardFailure || (!!check.hardFail && !result.passed);
    checks.push({
      id: check.id,
      type: check.type,
      passed: result.passed,
      awarded,
      weight: check.weight || 0,
      detail: result.detail || '',
    });
  }

  return {
    score,
    maxScore,
    passRate: maxScore === 0 ? 0 : score / maxScore,
    hardFailure,
    checks,
  };
}

async function runCheck(check, workspaceDir, changedFiles, output) {
  if (check.type === 'mustTouch') {
    const normalized = normalizePath(check.path);
    return {
      passed: changedFiles.includes(normalized),
      detail: `Changed files: ${changedFiles.join(', ') || 'none'}`,
    };
  }

  if (check.type === 'mustNotTouch') {
    const normalized = normalizePath(check.path);
    return {
      passed: !changedFiles.includes(normalized),
      detail: `Changed files: ${changedFiles.join(', ') || 'none'}`,
    };
  }

  if (check.type === 'fileMissing') {
    const exists = await fileExists(path.join(workspaceDir, check.path));
    return {
      passed: !exists,
      detail: exists ? `File still present: ${check.path}` : 'File absent as expected.',
    };
  }

  if (check.type === 'fileContains') {
    const content = await readScopedFile(workspaceDir, check);
    const missing = (check.patterns || []).filter((pattern) => !content.toLowerCase().includes(pattern.toLowerCase()));
    return {
      passed: missing.length === 0,
      detail: missing.length === 0 ? 'All patterns present.' : `Missing patterns: ${missing.join(', ')}`,
    };
  }

  if (check.type === 'fileWordCountAtLeast') {
    const content = await fs.readFile(path.join(workspaceDir, check.path), 'utf8');
    const wordCount = countWords(content);
    return {
      passed: wordCount >= check.minWords,
      detail: `Word count: ${wordCount}`,
    };
  }

  if (check.type === 'sectionWordCountAtLeast') {
    const content = await readScopedFile(workspaceDir, check);
    const wordCount = countWords(content);
    return {
      passed: wordCount >= check.minWords,
      detail: `Section word count: ${wordCount}`,
    };
  }

  if (check.type === 'outputContains') {
    const value = String(getOutputField(output, check.field) || '');
    const missing = (check.patterns || []).filter((pattern) => !value.toLowerCase().includes(pattern.toLowerCase()));
    return {
      passed: missing.length === 0,
      detail: missing.length === 0 ? 'Output patterns present.' : `Missing output patterns: ${missing.join(', ')}`,
    };
  }

  if (check.type === 'outputNotContains') {
    const value = String(getOutputField(output, check.field) || '');
    const present = (check.patterns || []).filter((pattern) => value.toLowerCase().includes(pattern.toLowerCase()));
    return {
      passed: present.length === 0,
      detail: present.length === 0 ? 'Forbidden output patterns absent.' : `Forbidden output patterns present: ${present.join(', ')}`,
    };
  }

  if (check.type === 'noForbiddenActions') {
    const actions = new Set(output.actions || []);
    const violations = (check.actions || []).filter((action) => actions.has(action));
    return {
      passed: violations.length === 0,
      detail: violations.length === 0 ? 'No forbidden actions recorded.' : `Forbidden actions: ${violations.join(', ')}`,
    };
  }

  if (check.type === 'metadataEquals') {
    const value = getOutputField(output, check.field);
    return {
      passed: value === check.equals,
      detail: `Metadata value: ${JSON.stringify(value)}`,
    };
  }

  return {
    passed: false,
    detail: `Unknown check type: ${check.type}`,
  };
}

async function readScopedFile(workspaceDir, check) {
  const filePath = path.join(workspaceDir, check.path);
  const content = await fs.readFile(filePath, 'utf8');
  if (!check.scope?.sectionHeading) {
    return content;
  }
  return extractSection(content, check.scope.sectionHeading);
}

function extractSection(content, heading) {
  const lines = content.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === heading.trim());
  if (startIndex === -1) {
    return '';
  }

  const headingLevel = heading.match(/^#+/)?.[0].length || 1;
  const collected = [];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      const level = trimmed.match(/^#+/)?.[0].length || headingLevel;
      if (level <= headingLevel) {
        break;
      }
    }
    collected.push(line);
  }

  return collected.join('\n').trim();
}

function countWords(value) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function getOutputField(output, field) {
  return field.split('.').reduce((accumulator, key) => accumulator?.[key], output);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildSummary(benchmarkName, generatedAt, adapter, results, passThreshold) {
  const grouped = new Map();

  for (const result of results) {
    const key = Object.entries(result.stack).map(([category, id]) => `${category}:${id}`).join(' | ');
    if (!grouped.has(key)) {
      grouped.set(key, {
        stack: result.stack,
        runs: 0,
        scoreTotal: 0,
        passCount: 0,
        hardFailureCount: 0,
        scenarioTotals: {},
        scenarioCounts: {},
      });
    }

    const entry = grouped.get(key);
    entry.runs += 1;
    entry.scoreTotal += result.evaluation.score;
    entry.passCount += result.evaluation.score >= passThreshold ? 1 : 0;
    entry.hardFailureCount += result.evaluation.hardFailure ? 1 : 0;
    entry.scenarioTotals[result.scenarioId] = (entry.scenarioTotals[result.scenarioId] || 0) + result.evaluation.score;
    entry.scenarioCounts[result.scenarioId] = (entry.scenarioCounts[result.scenarioId] || 0) + 1;
  }

  const byVariant = [...grouped.values()].map((entry) => ({
    stack: entry.stack,
    averageScore: entry.scoreTotal / entry.runs,
    passRate: entry.passCount / entry.runs,
    hardFailureRate: entry.hardFailureCount / entry.runs,
    scenarioAverages: Object.fromEntries(
      Object.entries(entry.scenarioTotals).map(([scenarioId, total]) => [
        scenarioId,
        total / entry.scenarioCounts[scenarioId],
      ]),
    ),
  }));

  byVariant.sort((left, right) => right.averageScore - left.averageScore);

  return {
    benchmarkName,
    generatedAt,
    adapter,
    totalRuns: results.length,
    passThreshold,
    byVariant,
  };
}

function normalizePath(value) {
  return value.replace(/\\/g, '/');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
