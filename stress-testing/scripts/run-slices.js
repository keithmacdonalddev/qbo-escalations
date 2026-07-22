'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getRunner, listRunnerIds } = require('./runner-registry');
const { startHarnessServer } = require('./harness-runner-utils');

function parseArgs(argv) {
  const options = { list: false, resultPath: null, selected: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--list') options.list = true;
    else if (arg === '--result-path') options.resultPath = argv[++index] || null;
    else options.selected.push(arg);
  }
  if (argv.includes('--result-path') && !options.resultPath) {
    throw new Error('--result-path requires a file path');
  }
  return options;
}

function createSummary(selected, results, { harnessError = null } = {}) {
  const passedCount = results.filter((entry) => entry.status === 'passed').length;
  const failedCount = results.filter((entry) => entry.status === 'failed').length;
  const incompleteCount = results.filter((entry) => entry.status === 'incomplete').length;
  const notRunCount = results.filter((entry) => entry.status === 'not-run').length;
  const terminalCount = passedCount + failedCount;
  const incomplete = Boolean(harnessError)
    || results.some((entry) => entry.status === 'not-run' || entry.status === 'incomplete')
    || terminalCount !== selected.length;
  const failed = failedCount > 0;
  return {
    schemaVersion: 1,
    verdict: incomplete ? 'incomplete' : failed ? 'failed' : 'passed',
    selectedCount: selected.length,
    terminalCount,
    passedCount,
    failedCount,
    incompleteCount,
    notRunCount,
    harnessError,
    slices: results,
  };
}

function reportCompletionProblem(report, expectedSlice = null) {
  if (!report || typeof report !== 'object') return 'Slice runner returned no report.';
  if (report.schemaVersion !== 1) return 'Slice runner returned an invalid report schema.';
  if (expectedSlice && report.slice !== expectedSlice) return 'Slice runner returned a mismatched slice identity.';
  if (typeof report.runId !== 'string' || !report.runId.trim()) return 'Slice runner returned no run identity.';
  if (!report.paths?.reportPath || !report.paths?.latestPath) return 'Slice runner returned no durable report paths.';
  if (report.incomplete === true) return report.incompleteReason || 'Slice report marked completion incomplete.';
  const fixtures = Array.isArray(report.fixtures) ? report.fixtures : [];
  const incompleteFixture = fixtures.find((fixture) => fixture?.incomplete === true);
  return incompleteFixture ? incompleteFixture.error || incompleteFixture.reason || 'Slice fixture marked completion incomplete.' : null;
}

function writeSummary(resultPath, summary) {
  if (!resultPath) return;
  const absolutePath = path.resolve(process.cwd(), resultPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const listIds = dependencies.listRunnerIds || listRunnerIds;
  const findRunner = dependencies.getRunner || getRunner;
  const startHarness = dependencies.startHarnessServer || startHarnessServer;
  const options = parseArgs(argv);
  if (options.list) {
    console.log(listIds().join('\n'));
    return null;
  }

  const selected = options.selected.length > 0 ? options.selected : listIds();
  const invalid = selected.filter((sliceId) => !findRunner(sliceId));
  if (invalid.length > 0) {
    throw new Error(`Unknown slice runner(s): ${invalid.join(', ')}. Known slices: ${listIds().join(', ')}`);
  }

  let harness;
  const summary = [];
  let cleanupError = null;

  try {
    harness = await startHarness();
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    const result = createSummary(selected, selected.map((slice) => ({
      slice,
      status: 'not-run',
      ok: false,
      reason: 'Harness failed to start.',
    })), { harnessError: message });
    writeSummary(options.resultPath, result);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 2;
    return result;
  }

  try {
    for (const sliceId of selected) {
      const runner = findRunner(sliceId);
      console.log(`[slice-runner] running ${sliceId}`);
      try {
        const report = await runner.runSlice(harness);
        const completionProblem = reportCompletionProblem(report, sliceId);
        summary.push({
          slice: sliceId,
          runId: report?.runId || null,
          status: completionProblem ? 'incomplete' : report?.ok ? 'passed' : 'failed',
          ok: completionProblem ? false : report.ok === true,
          baselineOk: report.baselineComparison?.available ? report.baselineComparison.ok : null,
          reportPath: report?.paths?.reportPath || null,
          latestPath: report?.paths?.latestPath || null,
          ...(completionProblem ? { error: completionProblem } : {}),
        });
      } catch (err) {
        summary.push({
          slice: sliceId,
          status: 'incomplete',
          ok: false,
          error: err && err.message ? err.message : String(err),
        });
      }
    }
  } finally {
    try {
      await harness.stop();
    } catch (err) {
      cleanupError = err && err.message ? err.message : String(err);
    }
  }

  const result = createSummary(selected, summary, { harnessError: cleanupError });
  writeSummary(options.resultPath, result);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.verdict === 'passed' ? 0 : result.verdict === 'failed' ? 1 : 2;
  return result;
}

if (require.main === module) {
  main()
    .then(() => process.exit(process.exitCode || 0))
    .catch((err) => {
      console.error(err.stack || err);
      process.exit(2);
    });
}

module.exports = { createSummary, main, parseArgs, reportCompletionProblem, writeSummary };
