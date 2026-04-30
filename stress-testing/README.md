# Stress Testing — qbo-escalations

Repo-aligned planning package for building stress and reliability harnesses in this project.

## What changed

The original draft assumed slices that do not exist in the repo today, including a generic app-auth/session layer and a QuickBooks outbound API layer. This package has been rewritten around the code that is actually present:

- Express + MongoDB server with existing runtime health, usage, traces, and grouped test-runner surfaces.
- AI-heavy streaming paths: main chat, workspace assistant, and multi-agent rooms.
- Image ingestion and parse flows with local file handling and provider fallbacks.
- Connected Gmail and Google Calendar workflows.
- Large React client surfaces that depend on SSE, WebSocket, and high-churn state.

## Mission

Build a stress-testing system that proves this repo is stable and correct under load, long-lived streaming sessions, provider failure, image-heavy flows, and connected-service brownouts.

This package is now intended to get the team from "we have a plan" to "we can start implementing harness code without arguing about scope."

## Current state

- Planning package is repo-aligned.
- Slice boundaries are documented.
- Starter directories exist for slices, contracts, baselines, reports, scripts, and playbooks.
- Harness boot surface (`scripts/bootstrap-server.js`) is hermetic by default: refuses non-stress Mongo URIs, disables warmups/schedulers/monitors/pruning, short-circuits rate limiting, gates harnessed provider entry points through the stub registry, and gates Gmail/Calendar service entry points through connected-service stubs.
- First executable slice runners now exist for:
  - `escalation-domain`
  - `shipment-domain`
  - `image-intake-and-parse`
  - `main-chat`
  - `workspace-assistant`
  - `room-orchestration`
  - `connected-services`
  - `runtime-and-observability`
  - `client-surfaces`
- Those nine slice runners now cover targeted server and browser scenarios instead of only single happy-path checks.
- Each runner writes JSON output to `stress-testing/reports/<slice>/latest.json`.
- First baseline files and threshold comparisons now exist for those nine slice runners.
- First shared fixture libraries now exist for common harness lifecycle plus chat, workspace, and room scenarios.
- Browser/realtime canaries now exist for `client-surfaces`, using `agent-browser` to drive the real `main-chat` page, workspace shipment tracker, and two-agent room UI against the hermetic test server.
- Contract libraries and broader scenario libraries are still not implemented.

## Booting the harness

```bash
# From repo root
STRESS_MONGODB_URI="mongodb://127.0.0.1:27017/qbo-stress" \
  node stress-testing/scripts/bootstrap-server.js
```

The boot script refuses to start if `STRESS_MONGODB_URI` is not set and the `MONGODB_URI` in `server/.env` does not contain one of: `stress`, `harness`, `mongodb-memory-server`, `127.0.0.1`, `localhost`. Set `STRESS_MONGODB_UNSAFE_ALLOW=1` to bypass this check (do not use in CI).

## Running the slice runners

```bash
# Run all implemented slice runners
npm run stress:slices

# Run a subset
node stress-testing/scripts/run-slices.js main-chat workspace-assistant

# List available slice runner ids
node stress-testing/scripts/run-slices.js --list
```

`npm run stress:slices` now exits non-zero when a slice runner fails or when a report regresses against `stress-testing/baselines/<slice>.json`.

## Operating principles

1. Test the system that exists, not the one implied by the project name.
2. Reuse existing observability before inventing parallel plumbing.
3. Treat SSE, WebSocket, action loops, and side effects as first-class contracts.
4. Keep Gmail, Calendar, provider APIs, and background jobs under explicit harness control.
5. Prompt, playbook, and configuration changes are first-class regression triggers.

## Package layout

```text
stress-testing/
├── README.md
├── PLAN.md
├── FEEDBACK.md
├── STATUS.md
├── phases/
├── slices/
├── contracts/
├── baselines/
├── reports/
├── scripts/
└── playbook/
```

## First implementation order

1. Pull the current inline multi-scenario runners into reusable fixture libraries and add second-wave failure/load cases.
2. Widen `client-surfaces` into workspace streaming, image parser, dashboard/settings churn, larger workspace datasets, and browser render pressure.
3. Keep baseline files narrow and stable; add more checks only after each scenario proves reliable.
4. Add an operator-facing UI only after the JSON artifacts and baseline gates are stable enough to trust.

## Read this before starting

1. `PLAN.md`
2. `STATUS.md`
3. `FEEDBACK.md`
4. `slices/README.md`
5. The next active phase file
