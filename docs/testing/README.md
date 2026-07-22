# App Testing Evidence

## What this gives the user

The checks answer whether the configured important workflows finished, what failed, and what was not checked. They support the larger operational-intelligence platform by protecting shared evidence and saved decisions across agent and human handoffs.

They do not prove the app has no bugs. A green result means every required group in that named profile completed successfully. It does not mean every route, layout, provider, deployment, or multi-user situation was tested.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run test:client` | Fast simulated-browser behavior tests. |
| `npm run test:server` | Server tests in the normal fail-first development mode. |
| `npm run test:stress-harness` | Isolation, stub, baseline, and harness contract tests. |
| `npm run verify:core` | Client, complete server, harness, runner, and map checks. |
| `npm run verify:qbo` | Critical QBO checks plus selected isolated stress/browser slices. |
| `npm run verify:full` | Core checks, production build/bundle canary, and all nine stress slices. |
| `npm run validate:testing-map` | Checks capability references and exposes known gaps. |

Generated summaries and capped logs are written below `test-results/app-check/`. That directory is ignored by Git because local logs may contain machine-specific details.

Before starting any group, the runner checks every command and declared dependency required by the selected profile. A missing dependency therefore produces an `incomplete` result without starting a partial run. Server files run independently and report `interrupted` separately from ordinary assertion failures; the final arithmetic distinguishes completed, timed-out, interrupted, and not-run files.

## What each check type proves

- A unit test checks one small decision quickly.
- A component test renders React in a simulated browser and checks what a user can see or do. It does not prove real browser wiring.
- A server test checks routes, persistence rules, permissions, and service contracts with controlled dependencies.
- A stress slice runs several real application pieces against an isolated test database and controlled provider/service responses.
- A browser journey drives the real React app and isolated server through `agent-browser`. It can catch navigation, reload, file-input, focus, and wiring failures that simulated component tests miss.
- A production build check proves the client can be packaged. It does not exercise the packaged app's workflows.

Normal automated checks must not contact live AI providers, connected accounts, the user's database, or the user's persistent app servers.

## Fixed verdicts

- `passed`: every required group started, completed, and exited successfully.
- `failed`: every required group completed, and at least one completed assertion or reviewed baseline failed.
- `incomplete`: at least one required group never started, timed out, lost its tool connection, threw before writing a durable report, was interrupted, lacked a dependency, or produced no valid terminal result.

When failure and incomplete evidence both exist, the overall result is `incomplete` and the failure remains listed. Fixed code determines the verdict; an AI explanation cannot turn red or missing evidence green.

## Capability map

`testing/app-capabilities.json` connects important user outcomes to source files, required check types, configured groups, evidence files, owners, review dates, and known gaps. Static map validation can establish that evidence is mapped, but it cannot call a capability strongly tested without a current completed run. Structured run summaries derive these evidence-strength labels:

- `strongly-tested`: every required evidence type is mapped and there is no recorded gap.
- `partially-tested`: required types are mapped but an important limitation remains.
- `weakly-tested`: at least one required evidence type is missing.
- `unknown`: no evidence is mapped.

These labels describe evidence strength, not certainty that no bug exists. The repository deliberately does not publish a made-up “percent tested” score.

## Adding or changing a capability

1. Add or update the capability's user outcome, risk, owner, source paths, required check types, evidence, known gaps, and human-review date.
2. Add its stable ID to every relevant group in `testing/check-profiles.json`.
3. Run the focused tests and `npm run validate:testing-map`.
4. If a required test is not practical yet, record the exact gap. Do not add an unrelated test merely to fill a field.

New client and server tests in the validated inventory roots must be mapped to a capability, listed as testing infrastructure, or deliberately added to an exact reviewed category. The server inventory is pinned by filename; broad wildcard categorization is intentionally not accepted. Missing references and unmapped test files make validation fail.

## Reviewing a baseline change

Stress baselines are reviewed evidence, not snapshots to update automatically. Read the current report and determine why the expectation changed. Update a baseline only when the new behavior is intended and still protects the user outcome. Never promote a failed result just to restore green.

Stress results are accepted only when both their run-specific report and latest-report pointer exist, contain valid versioned JSON, identify the expected slice and run, and agree with the child outcome. Empty, malformed, stale, or mismatched artifacts are incomplete evidence. A child process cannot claim success with missing artifact paths, and an incomplete or not-run slice must state a reason.

Browser cleanup is part of completion. If the isolated browser session cannot be proven closed within its hard limit, the fixture and slice are `incomplete` even when every user-facing assertion had already passed.

Browser transport loss is also incomplete evidence. Fixed code recognizes Node `ECONN*` errors, native connection loss/refusal/reset, signals, timeouts, and known Windows socket failures. Ordinary selector, page assertion, HTTP/application, and baseline failures remain completed `failed` results.

## Current reliability gate

The command and data foundation exists, but the visual App Check dashboard and a dedicated App Check agent remain deferred. The five dedicated QBO browser journeys are structurally implemented with bounded commands, failure artifacts, and isolated cleanup. They are not yet trusted as completed evidence: the native browser command timed out even while opening a static local known-good page in a unique disposable session. Before the deferred UI or agent is approved, those journeys must run reliably and the repository must complete five consecutive representative full runs with structurally valid summaries. Current gaps remain listed in the capability map and `stress-testing/STATUS.md`.
