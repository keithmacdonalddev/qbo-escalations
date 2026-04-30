'use strict';

const { getRunner, listRunnerIds } = require('./runner-registry');
const { startHarnessServer } = require('./harness-runner-utils');

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--list')) {
    console.log(listRunnerIds().join('\n'));
    return;
  }

  const selected = argv.length > 0 ? argv : listRunnerIds();
  const invalid = selected.filter((sliceId) => !getRunner(sliceId));
  if (invalid.length > 0) {
    throw new Error(`Unknown slice runner(s): ${invalid.join(', ')}. Known slices: ${listRunnerIds().join(', ')}`);
  }

  const harness = await startHarnessServer();
  const summary = [];
  let failed = false;

  try {
    for (const sliceId of selected) {
      const runner = getRunner(sliceId);
      console.log(`[slice-runner] running ${sliceId}`);
      try {
        const report = await runner.runSlice(harness);
        if (!report.ok) {
          failed = true;
        }
        summary.push({
          slice: sliceId,
          ok: report.ok,
          baselineOk: report.baselineComparison?.available ? report.baselineComparison.ok : null,
          reportPath: report.paths.reportPath,
          latestPath: report.paths.latestPath,
        });
      } catch (err) {
        failed = true;
        summary.push({
          slice: sliceId,
          ok: false,
          error: err && err.message ? err.message : String(err),
        });
      }
    }
  } finally {
    await harness.stop();
  }

  console.log(JSON.stringify({ summary }, null, 2));
  if (failed) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(process.exitCode || 0))
    .catch((err) => {
      console.error(err.stack || err);
      process.exit(1);
    });
}

module.exports = { main };
