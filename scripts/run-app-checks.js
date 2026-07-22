#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG = path.join(ROOT, 'testing', 'check-profiles.json');
const OUTPUT_LIMIT = 128 * 1024;
const ACTIVE_CHILDREN = new Set();

function resolveExecutable(command) {
  if (command === 'npm') return process.platform === 'win32' ? process.execPath : 'npm';
  if (command === 'node') return process.execPath;
  return command;
}

function resolveArguments(command, args) {
  if (command === 'npm' && process.platform === 'win32') {
    // Windows cannot CreateProcess a .cmd shim without a command shell. Invoke
    // npm's JavaScript CLI with Node so arguments remain an array and shell:false.
    const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    return [npmCli, ...args];
  }
  return args;
}

function validateConfig(config, profileName, root = ROOT) {
  if (!config || config.schemaVersion !== 1 || !config.groups || !config.profiles) {
    throw new Error('Check profile file must use schemaVersion 1 and define groups and profiles.');
  }
  const ids = config.profiles[profileName];
  if (!Array.isArray(ids) || ids.length === 0) throw new Error(`Unknown or empty profile: ${profileName}`);
  const seen = new Set();
  return ids.map((id) => {
    if (seen.has(id)) throw new Error(`Profile ${profileName} repeats group ${id}.`);
    seen.add(id);
    const group = config.groups[id];
    if (!group || typeof group.command !== 'string' || !Array.isArray(group.args)) {
      throw new Error(`Profile ${profileName} references malformed group ${id}.`);
    }
    if (!Number.isFinite(group.timeoutMs) || group.timeoutMs <= 0) {
      throw new Error(`Group ${id} needs a positive timeoutMs.`);
    }
    const cwd = path.resolve(root, group.cwd || '.');
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`Group ${id} cwd does not exist: ${cwd}`);
    return { id, required: true, ...group, cwd };
  });
}

function killOwnedProcess(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch {
    try { child.kill('SIGKILL'); } catch { /* already exited */ }
  }
}

function killAllOwnedProcesses() {
  for (const child of [...ACTIVE_CHILDREN]) killOwnedProcess(child);
}

function createRunController() {
  return {
    interrupted: false,
    signal: null,
    interrupt(signal = 'SIGINT') {
      this.interrupted = true;
      this.signal = signal;
      killAllOwnedProcesses();
    },
  };
}

function buildChildEnvironment(group) {
  const env = { ...process.env };
  if (group.environment === 'production') {
    delete env.NODE_ENV;
  } else {
    env.NODE_ENV = env.NODE_ENV || 'test';
  }
  return env;
}

function runGroup(group, { logPath, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = '';
    let settled = false;
    let child;
    try {
      child = spawnImpl(resolveExecutable(group.command), resolveArguments(group.command, group.args), {
        cwd: group.cwd,
        env: buildChildEnvironment(group),
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });
      ACTIVE_CHILDREN.add(child);
    } catch (error) {
      resolve({ status: 'incomplete', durationMs: Date.now() - started, exitCode: null, error: error.message });
      return;
    }
    const append = (chunk) => {
      output += chunk.toString();
      if (output.length > OUTPUT_LIMIT) output = output.slice(-OUTPUT_LIMIT);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ACTIVE_CHILDREN.delete(child);
      killOwnedProcess(child);
      if (logPath) fs.writeFileSync(logPath, output, 'utf8');
      resolve({ status: 'incomplete', durationMs: Date.now() - started, exitCode: null, timedOut: true, logPath });
    }, group.timeoutMs);
    timer.unref();
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ACTIVE_CHILDREN.delete(child);
      if (logPath) fs.writeFileSync(logPath, `${output}\n${error.message}`, 'utf8');
      resolve({ status: 'incomplete', durationMs: Date.now() - started, exitCode: null, error: error.message, logPath });
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ACTIVE_CHILDREN.delete(child);
      if (logPath) fs.writeFileSync(logPath, output, 'utf8');
      resolve({
        status: code === 0 ? 'passed' : code === 124 || code === 2 || signal ? 'incomplete' : 'failed',
        durationMs: Date.now() - started,
        exitCode: code,
        signal: signal || null,
        logPath,
      });
    });
  });
}

function assertExactUniqueIds(actual, expected, label) {
  if (actual.some((id) => typeof id !== 'string' || !id)) throw new Error(`${label} records need non-empty string IDs.`);
  if (new Set(actual).size !== actual.length) throw new Error(`${label} records contain duplicate IDs.`);
  if (!expected) return;
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`${label} records do not exactly match the expected inventory.`);
  }
}

function deriveExpectedChildItems(group) {
  if (group.resultContract === 'server-tests') {
    const scriptIndex = group.args.findIndex((arg) => String(arg).replace(/\\/g, '/').endsWith('server/scripts/run-tests.js'));
    const selected = scriptIndex >= 0
      ? group.args.slice(scriptIndex + 1).filter((arg, index, args) => arg !== '--continue' && arg !== '--result-path' && args[index - 1] !== '--result-path' && !String(arg).startsWith('--'))
      : [];
    if (selected.length > 0) return selected.map((item) => String(item).replace(/\\/g, '/')).sort();
    const testRoot = path.join(ROOT, 'server', 'test');
    const visit = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) return visit(absolute);
      return entry.isFile() && entry.name.endsWith('.test.js')
        ? [path.relative(path.join(ROOT, 'server'), absolute).replace(/\\/g, '/')]
        : [];
    });
    return visit(testRoot).sort();
  }
  if (group.resultContract === 'stress-slices') {
    const scriptIndex = group.args.findIndex((arg) => String(arg).replace(/\\/g, '/').endsWith('stress-testing/scripts/run-slices.js'));
    const selected = scriptIndex >= 0
      ? group.args.slice(scriptIndex + 1).filter((arg, index, args) => arg !== '--result-path' && args[index - 1] !== '--result-path' && !String(arg).startsWith('--'))
      : [];
    if (selected.length > 0) return selected;
    return require('../stress-testing/scripts/runner-registry').listRunnerIds();
  }
  return null;
}

function validateChildSummary(contract, summary, expectedItems = null, { verifyArtifacts = false } = {}) {
  if (!summary || summary.schemaVersion !== 1 || !['passed', 'failed', 'incomplete'].includes(summary.verdict)) {
    throw new Error('Child result is missing the versioned verdict contract.');
  }
  if (contract === 'server-tests') {
    const counts = summary.counts || {};
    for (const key of ['discovered', 'started', 'completed', 'passed', 'failed', 'timedOut', 'interrupted', 'notRun']) {
      if (!Number.isInteger(counts[key]) || counts[key] < 0) throw new Error(`Server child result has invalid ${key} count.`);
    }
    if (!Array.isArray(summary.files)) throw new Error('Server child result needs file records.');
    assertExactUniqueIds(summary.files.map((file) => file?.file), expectedItems, 'Server child file');
    for (const file of summary.files) {
      if (!['passed', 'failed', 'timed-out', 'interrupted'].includes(file.status)) throw new Error(`Server child file ${file.file} has an invalid status.`);
      const timedOut = file.status === 'timed-out';
      const interrupted = file.status === 'interrupted';
      if (file.timedOut !== timedOut || file.terminal !== (!timedOut && !interrupted)) throw new Error(`Server child file ${file.file} has contradictory terminal flags.`);
      if ((file.status === 'passed' || file.status === 'failed') && file.signal) throw new Error(`Server child file ${file.file} has a signal-bearing terminal status.`);
      if (interrupted && !file.signal && !String(file.interruptionReason || '').trim()) throw new Error(`Server child file ${file.file} is interrupted without a signal or disconnection reason.`);
      if (file.status === 'passed' && file.exitCode !== 0) throw new Error(`Server child file ${file.file} passed with a nonzero exit.`);
      if (file.status === 'failed' && (!Number.isInteger(file.exitCode) || file.exitCode === 0)) throw new Error(`Server child file ${file.file} failed without an integer nonzero exitCode.`);
    }
    const fileCounts = {
      passed: summary.files.filter((file) => file.status === 'passed').length,
      failed: summary.files.filter((file) => file.status === 'failed').length,
      timedOut: summary.files.filter((file) => file.status === 'timed-out').length,
      interrupted: summary.files.filter((file) => file.status === 'interrupted').length,
    };
    if (counts.discovered !== (expectedItems?.length ?? counts.discovered)) throw new Error('Server child discovered count does not match expected inventory.');
    if (counts.started !== summary.files.length) throw new Error('Server child started count does not match file records.');
    if (counts.passed !== fileCounts.passed || counts.failed !== fileCounts.failed || counts.timedOut !== fileCounts.timedOut || counts.interrupted !== fileCounts.interrupted) throw new Error('Server child aggregate status counts do not match file records.');
    if (counts.completed !== counts.passed + counts.failed) throw new Error('Server child completed count must equal passed plus failed.');
    if (counts.started !== counts.completed + counts.timedOut + counts.interrupted) throw new Error('Server child started count must equal completed plus timed out plus interrupted.');
    if (counts.discovered !== counts.started + counts.notRun) throw new Error('Server child discovered count must equal started plus not run.');
    const derivedVerdict = counts.timedOut > 0 || counts.interrupted > 0 || counts.notRun > 0 || counts.started !== counts.discovered
      ? 'incomplete'
      : counts.failed > 0 ? 'failed' : 'passed';
    if (summary.verdict !== derivedVerdict) throw new Error(`Server child verdict ${summary.verdict} contradicts file evidence ${derivedVerdict}.`);
  } else if (contract === 'stress-slices') {
    if (!Number.isInteger(summary.selectedCount) || !Number.isInteger(summary.terminalCount) || !Array.isArray(summary.slices)) {
      throw new Error('Stress child result has invalid counts or slice records.');
    }
    assertExactUniqueIds(summary.slices.map((slice) => slice?.slice), expectedItems, 'Stress child slice');
    if (summary.selectedCount !== (expectedItems?.length ?? summary.slices.length) || summary.slices.length !== summary.selectedCount) throw new Error('Stress child selected count does not match slice records.');
    for (const slice of summary.slices) {
      if (!['passed', 'failed', 'incomplete', 'not-run'].includes(slice.status)) throw new Error(`Stress child slice ${slice.slice} has an invalid status.`);
      if (slice.ok !== (slice.status === 'passed')) throw new Error(`Stress child slice ${slice.slice} has contradictory status and ok values.`);
      if ((slice.status === 'passed' || slice.status === 'failed') && (typeof slice.reportPath !== 'string' || !slice.reportPath.trim() || typeof slice.latestPath !== 'string' || !slice.latestPath.trim())) {
        throw new Error(`Stress child slice ${slice.slice} needs durable reportPath and latestPath evidence.`);
      }
      if ((slice.status === 'passed' || slice.status === 'failed') && (typeof slice.runId !== 'string' || !slice.runId.trim())) {
        throw new Error(`Stress child slice ${slice.slice} needs a non-empty runId.`);
      }
      if ((slice.status === 'incomplete' || slice.status === 'not-run') && !String(slice.reason || slice.error || '').trim()) {
        throw new Error(`Stress child slice ${slice.slice} needs an incomplete reason or error.`);
      }
      if (verifyArtifacts && (slice.status === 'passed' || slice.status === 'failed')) {
        const artifacts = {};
        for (const [label, value] of [['reportPath', slice.reportPath], ['latestPath', slice.latestPath]]) {
          const artifactPath = path.isAbsolute(value) ? value : path.resolve(ROOT, value);
          try {
            fs.accessSync(artifactPath, fs.constants.R_OK);
            if (!fs.statSync(artifactPath).isFile()) throw new Error('not a file');
            const source = fs.readFileSync(artifactPath, 'utf8');
            artifacts[label] = JSON.parse(source);
          } catch (error) {
            throw new Error(`Stress child slice ${slice.slice} ${label} is not readable valid JSON: ${artifactPath}`);
          }
        }
        for (const [label, artifact] of Object.entries(artifacts)) {
          if (!artifact || artifact.schemaVersion !== 1) throw new Error(`Stress child slice ${slice.slice} ${label} has an invalid report schema.`);
          if (artifact.slice !== slice.slice) throw new Error(`Stress child slice ${slice.slice} ${label} has a mismatched slice identity.`);
          if (artifact.runId !== slice.runId) throw new Error(`Stress child slice ${slice.slice} ${label} has a stale or mismatched run identity.`);
          if (artifact.ok !== slice.ok) throw new Error(`Stress child slice ${slice.slice} ${label} outcome disagrees with the child status.`);
        }
        if (artifacts.reportPath.slice !== artifacts.latestPath.slice
          || artifacts.reportPath.runId !== artifacts.latestPath.runId
          || artifacts.reportPath.ok !== artifacts.latestPath.ok) {
          throw new Error(`Stress child slice ${slice.slice} latestPath does not point to the same run and outcome.`);
        }
      }
    }
    const counts = {
      passed: summary.slices.filter((slice) => slice.status === 'passed').length,
      failed: summary.slices.filter((slice) => slice.status === 'failed').length,
      incomplete: summary.slices.filter((slice) => slice.status === 'incomplete').length,
      notRun: summary.slices.filter((slice) => slice.status === 'not-run').length,
    };
    const terminal = counts.passed + counts.failed;
    if (terminal !== summary.terminalCount) throw new Error('Stress child terminal count does not match slice records.');
    for (const [field, value] of [['passedCount', counts.passed], ['failedCount', counts.failed], ['incompleteCount', counts.incomplete], ['notRunCount', counts.notRun]]) {
      if (!Number.isInteger(summary[field]) || summary[field] !== value) throw new Error(`Stress child ${field} does not match slice records.`);
    }
    const derivedVerdict = summary.harnessError || counts.incomplete || counts.notRun || terminal !== summary.selectedCount
      ? 'incomplete'
      : counts.failed ? 'failed' : 'passed';
    if (summary.verdict !== derivedVerdict) throw new Error(`Stress child verdict ${summary.verdict} contradicts slice evidence ${derivedVerdict}.`);
  } else {
    throw new Error(`Unknown child result contract: ${contract}`);
  }
  return summary;
}

function readChildSummary(group, childResultPath) {
  if (!group.resultContract) return null;
  if (!fs.existsSync(childResultPath)) throw new Error('Required child result file was not written.');
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(childResultPath, 'utf8')); } catch (error) {
    throw new Error(`Child result is malformed JSON: ${error.message}`);
  }
  return validateChildSummary(group.resultContract, parsed, deriveExpectedChildItems(group), { verifyArtifacts: true });
}

function computeVerdict(groups) {
  const required = groups.filter((group) => group.required !== false);
  if (required.some((group) => group.status === 'incomplete')) return 'incomplete';
  if (required.some((group) => group.status === 'failed')) return 'failed';
  return required.length > 0 && required.every((group) => group.status === 'passed') ? 'passed' : 'incomplete';
}

function repositoryState(root = ROOT) {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true });
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true });
  return { commit: commit.status === 0 ? commit.stdout.trim() : null, dirty: status.status !== 0 || status.stdout.trim().length > 0 };
}

function commandAvailable(command) {
  if (command === 'node') return fs.existsSync(process.execPath);
  if (command === 'npm' && process.platform === 'win32') {
    return fs.existsSync(path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  }
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  return spawnSync(finder, [command], { stdio: 'ignore', windowsHide: true }).status === 0;
}

function preflightGroups(groups) {
  const problems = [];
  for (const group of groups) {
    if (!commandAvailable(group.command)) problems.push(`Group ${group.id} command is unavailable: ${group.command}`);
    for (const requirement of group.requirements || []) {
      if (!commandAvailable(requirement)) problems.push(`Group ${group.id} requirement is unavailable: ${requirement}`);
    }
  }
  return problems;
}

function buildCapabilitySummary(map, groupResults, { profile = null, repository = null, finishedAt = null } = {}) {
  const byId = new Map(groupResults.map((group) => [group.id, group.status]));
  return Object.fromEntries((map.capabilities || []).map((capability) => {
    const mappedTypes = new Set((capability.evidence || []).map((item) => item.type));
    const typesComplete = (capability.requiredCheckTypes || []).every((type) => mappedTypes.has(type));
    const statusForEvidence = (item) => (item.groupIds || [item.groupId]).map((id) => byId.get(id)).find(Boolean);
    const statuses = [...new Set((capability.evidence || []).map(statusForEvidence).filter(Boolean))];
    let assessment = 'unknown';
    const everyEvidenceGroupRan = (capability.evidence || []).every((item) => statusForEvidence(item));
    if (typesComplete && statuses.length > 0) {
      assessment = everyEvidenceGroupRan && statuses.every((status) => status === 'passed') && (capability.knownGaps || []).length === 0
        ? 'strongly-tested'
        : 'partially-tested';
    } else if (statuses.length > 0 || mappedTypes.size > 0) {
      assessment = 'weakly-tested';
    }
    return [capability.id, {
      assessment,
      checkStatuses: statuses,
      knownGaps: capability.knownGaps || [],
      lastHumanReviewDate: capability.lastHumanReviewDate || null,
      latestRelevantRun: everyEvidenceGroupRan ? { profile, commit: repository?.commit || null, finishedAt } : null,
    }];
  }));
}

async function runProfile({ profileName = 'core', configPath = DEFAULT_CONFIG, outputRoot = path.join(ROOT, 'test-results', 'app-check'), runGroupImpl = runGroup, controller = createRunController() } = {}) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const groups = validateConfig(config, profileName);
  const startedAt = new Date();
  const runId = `${startedAt.toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
  const runDir = path.join(outputRoot, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const results = [];
  const preflightProblems = preflightGroups(groups);
  for (const group of groups) {
    const logPath = path.join(runDir, `${group.id}.log`);
    process.stdout.write(`[app-check] ${group.label} ... `);
    const childResultPath = group.resultContract ? path.join(runDir, `${group.id}.child.json`) : null;
    const preparedGroup = childResultPath
      ? { ...group, args: [...group.args, '--result-path', childResultPath] }
      : group;
    let result = controller.interrupted
      ? { status: 'incomplete', durationMs: 0, exitCode: null, error: `Not started after ${controller.signal || 'interruption'}.` }
      : preflightProblems.length > 0
      ? { status: 'incomplete', durationMs: 0, exitCode: null, error: `Preflight failed before any group started: ${preflightProblems.join('; ')}` }
      : await runGroupImpl(preparedGroup, { logPath });
    if (controller.interrupted) {
      result = { ...result, status: 'incomplete', error: `Interrupted by ${controller.signal || 'signal'}.` };
    }
    let childSummary = null;
    if (group.resultContract && !controller.interrupted) {
      try {
        childSummary = readChildSummary(group, childResultPath);
        if (childSummary.verdict !== result.status) {
          result = { ...result, status: 'incomplete', error: `Child verdict ${childSummary.verdict} disagrees with process status ${result.status}.` };
        }
      } catch (error) {
        result = { ...result, status: 'incomplete', error: error.message };
      }
    }
    results.push({
      id: group.id,
      label: group.label,
      required: group.required,
      ...result,
      logPath: path.relative(ROOT, logPath).replace(/\\/g, '/'),
      childResultPath: childResultPath ? path.relative(ROOT, childResultPath).replace(/\\/g, '/') : null,
      childSummary,
    });
    console.log(result.status);
  }
  const verdict = computeVerdict(results);
  const capabilityMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'testing', 'app-capabilities.json'), 'utf8'));
  const repository = repositoryState();
  const finishedAt = new Date().toISOString();
  const summary = {
    schemaVersion: 1,
    runId,
    profile: profileName,
    repository,
    startedAt: startedAt.toISOString(),
    finishedAt,
    verdict,
    groups: results,
    failedGroups: results.filter((group) => group.status === 'failed').map((group) => group.id),
    incompleteGroups: results.filter((group) => group.status === 'incomplete').map((group) => group.id),
    capabilitySummary: buildCapabilitySummary(capabilityMap, results, { profile: profileName, repository, finishedAt }),
    knownGlobalGaps: capabilityMap.knownGlobalGaps || [],
    capabilityGaps: Object.fromEntries((capabilityMap.capabilities || []).filter((item) => item.knownGaps?.length).map((item) => [item.id, item.knownGaps])),
    quarantined: capabilityMap.quarantined || { tests: [], slices: [] },
    limitations: ['A passing run is evidence for the configured checks, not proof that the app has no bugs.'],
  };
  const summaryPath = path.join(runDir, 'summary.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return { summary, summaryPath };
}

async function main() {
  const profileName = process.argv[2] || 'core';
  const controller = createRunController();
  const onSigint = () => controller.interrupt('SIGINT');
  const onSigterm = () => controller.interrupt('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  let run;
  try {
    run = await runProfile({ profileName, controller });
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
  const { summary, summaryPath } = run;
  console.log(`[app-check] ${summary.verdict}: ${path.relative(ROOT, summaryPath)}`);
  process.exitCode = summary.verdict === 'passed' ? 0 : summary.verdict === 'failed' ? 1 : 2;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[app-check] incomplete: ${error.message}`);
    process.exitCode = 2;
  });
}

module.exports = {
  ACTIVE_CHILDREN,
  buildCapabilitySummary,
  buildChildEnvironment,
  computeVerdict,
  createRunController,
  preflightGroups,
  killAllOwnedProcesses,
  readChildSummary,
  resolveExecutable,
  runGroup,
  runProfile,
  validateChildSummary,
  validateConfig,
};
