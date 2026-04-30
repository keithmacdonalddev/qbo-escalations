# Phase 2 — Harness Platform and Hermetic Environment

## Goal

Define and build the shared platform that every later harness will rely on.

## Why this phase exists

This repo cannot produce trustworthy baselines if the harness runs against live providers, uncontrolled Google responses, or background jobs that change the system while the test is running.

## Acceptance criteria

- [x] A harness process model is chosen and documented:
  - boot the real server entrypoint in-process via `start({ exitProcess, installSignalHandlers })` and hit it over HTTP/SSE
  - direct-module calls allowed per-slice when a harness opts in, but not the default
- [x] Existing observability reuse points are documented and wired into the design:
  - `/api/runtime/health`
  - `/api/health/providers`
  - `/api/usage/*`
  - `/api/traces/*`
  - `/api/test-runner/*`
- [x] Harness environment controls are specified for:
  - Mongo setup and teardown (`STRESS_MONGODB_URI` + `assertSafeMongoUri`; refuses non-hermetic URIs)
  - provider stubs (`HARNESS_PROVIDERS_STUBBED=1` + `harness-provider-gate.js` + `harness-provider-stubs.js` defaults)
  - startup warmups (`DISABLE_PROVIDER_WARMUP`, `DISABLE_IMAGE_PARSER_STARTUP_CHECK`, `DISABLE_IMAGE_PARSER_HEALTHCHECK`)
  - background scheduler / monitor disabling (`DISABLE_WORKSPACE_SCHEDULER`, `DISABLE_WORKSPACE_MONITOR`)
  - runtime pruning disabling (`DISABLE_RUNTIME_PRUNING`)
  - rate limiting disabling (`RATE_LIMIT_DISABLED`)
  - image-parser keys migration disabling (`DISABLE_IMAGE_PARSER_KEYS_MIGRATION`)
- [ ] Gmail / Calendar / shipment stub strategy — still open (tracked in `FEEDBACK.md`)
- [ ] Shared harness modules are defined for:
  - [x] app bootstrap (`bootstrap-server.js`, `harness-env.js`)
  - [x] provider stubs (`harness-provider-stubs.js` + `server/src/lib/harness-provider-gate.js`)
  - [ ] fixture loading
  - [ ] trace and usage capture
  - [ ] SSE transcript capture
  - [ ] report generation
  - [ ] baseline read/write
- [x] `scripts/README.md` describes the intended shared modules and their ownership.

## Work items

1. Decide how each slice will execute:
   - direct module call
   - HTTP request
   - SSE transcript capture
   - browser-driven client run
2. Decide how the app will be started in harness mode without background-noise side effects.
3. Decide how provider and Google behavior will be stubbed.
4. Define shared result schemas for metrics, event transcripts, and assertions.
5. Decide whether to extend the existing server test-runner or build a parallel `stress` runner that reuses the same grouping ideas.

## Artifacts

- `scripts/README.md`
- initial shared script/module stubs under `scripts/`
- phase notes describing harness-mode env flags and startup controls

## Dependencies

Phase 1.

## How to verify done

The team can answer, in writing, how a future harness for `workspace-assistant` will:

- boot the app
- capture SSE output
- stub Gmail and provider failures
- assert on traces and usage

## Non-goals

- no per-slice harnesses yet
- no baselines yet
