# Stress Testing Current Implementation Review - 2026-04-23

## Verdict

Current status: not at broad confidence, but the implementation is now materially executable.

Fresh verification passed for the current disk state:

- `node --test stress-testing/scripts/test/*.test.js` - 21 passed
- `node --test --test-isolation=none server/test/startup-controls.test.js server/test/harness-provider-gate.test.js server/test/harness-service-gate.test.js server/test/image-parser-harness.test.js server/test/connected-services-harness.test.js` - 18 passed
- `node --check` across 17 harness/server entrypoint files - passed
- `node stress-testing/scripts/run-slices.js image-intake-and-parse main-chat workspace-assistant room-orchestration connected-services runtime-and-observability` - all 6 passed, baseline gates green
- `node stress-testing/scripts/run-slices.js client-surfaces` - passed, baseline gate green
- `npm --prefix client run build` - passed, with the existing Vite large chunk warning

The harness platform is real: server startup is import-safe, background startup noise is controlled, provider and connected-service calls are gated through stubs, reports include baseline comparisons, and seven executable runners now produce fresh green reports.

## Findings

1. Medium - Browser automation still lacks a command-level timeout.
   `stress-testing/scripts/agent-browser-utils.js` wraps `agent-browser` calls through `runCommand()`, but the spawned child has no timeout or kill path if the process stops producing output and never exits. This is the same class of failure that previously caused a long browser-canary timeout. The canary passed today, but before this goes into CI or unattended runs, add explicit per-command timeouts for `runAgentBrowser`, `runAgentBrowserBatch`, and client dev-server subprocess handling, with stdout/stderr captured in the failure report.

2. Medium - Generated stress reports and screenshots will keep dirtying the repo.
   `stress-testing/scripts/harness-runner-utils.js` writes both timestamped JSON reports and `latest.json`; `client-surfaces` also writes PNG screenshots under `stress-testing/reports/client-surfaces/artifacts/`. `.gitignore` does not currently exclude `stress-testing/reports`, so every stress run creates more untracked review noise and risks committing bulky/generated artifacts. Decide the policy now: track baselines and docs, but ignore timestamped reports/artifacts unless intentionally preserving a specific evidence bundle.

3. Medium - Coverage is still below the plan's own ship-confidence bar.
   The current runner registry covers `image-intake-and-parse`, `main-chat`, `workspace-assistant`, `room-orchestration`, `connected-services`, `runtime-and-observability`, and `client-surfaces`. There is still no executable `escalation-domain` runner, while the plan lists it as required for ship-confidence. The existing runners are useful targeted probes, not broad burst/soak or full slice confidence.

4. Low - The browser runner emits Node `DEP0190` on Windows.
   The fresh `client-surfaces` run passed, but Node warned about passing args to a child process with `shell: true`. This comes from the Windows-safe spawn path in the browser utility. It is not a current failure, but it should be cleaned up before automation so future Node versions or stricter CI settings do not turn it into a blocker.

5. Low - `stress-testing/README.md` has a malformed current-state bullet.
   `client-surfaces` is nested under `runtime-and-observability` in the rendered list, even though it is a separate runner. Fix this with the next docs pass.

## Recommended Next Work

1. Harden the runner platform before adding more scenarios.
   Add command timeouts/kill behavior, fix the Windows spawn warning, and add report/artifact ignore policy. This is the right next step because the suite is now executable and green; unattended reliability matters more than more breadth for the next slice of work.

2. Add the missing `escalation-domain` runner.
   Cover at least CRUD/search/knowledge/investigation/template paths with deterministic fixtures and baseline checks. That closes the biggest gap against the stated ship-confidence criteria.

3. Promote fixture isolation and data cleanup.
   Current runners use seeded content and timestamps, but the stress database accumulates records across runs. Add a run id cleanup/tagging convention before soak, replay, or large-data scenarios.

4. Widen `client-surfaces` after the timeout fix.
   The browser canary now validates main chat happy path, fallback, and route refresh. Next browser targets should be rooms, workspace, image parser, and dashboard/high-churn render paths.

5. Keep baseline expansion conservative.
   The existing baseline gates are useful but narrow. Add checks only after scenarios prove stable, and avoid treating baseline-green as product-wide confidence.
