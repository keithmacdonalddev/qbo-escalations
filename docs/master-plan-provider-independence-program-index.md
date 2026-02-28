# Provider Independence Program Index (Local-Only Execution Guide)

## Objective
Deliver full dual-provider capability across this app so Claude and Codex can operate:
1. Independently
2. With bidirectional fallback
3. In parallel opinion mode where applicable

This index is the source of truth for sequencing and quality checks for this local single-user app.

## Operating Context
1. Deployment model: local machine only.
2. User model: single user (owner/operator).
3. Security posture: practical local safety only.

## Source Documents
1. Gap matrix: `docs/master-plan-gap-matrix-current-vs-target.md`
2. Phase 1: `docs/master-plan-phase-1-provider-foundation-and-chat-parity.md`
3. Phase 2: `docs/master-plan-phase-2-provider-independent-parsing.md`
4. Phase 3: `docs/master-plan-phase-3-provider-independent-dev-mode.md`
5. Phase 4: `docs/master-plan-phase-4-parallel-opinions-and-acceptance.md`

## Program Scope

### In Scope
1. Provider abstraction and orchestration for chat, parse, dev, and co-pilot.
2. Bidirectional fallback with deterministic policy.
3. Parallel candidate generation and acceptance workflow.
4. Provider provenance, telemetry, and reliability controls.

### Out of Scope
1. Replacing CLI transports with direct vendor APIs.
2. Multi-tenant auth redesign.
3. Automated semantic merge of two accepted answers as mandatory behavior.

## Sequencing
1. Phase 1 (chat foundation) must complete before all others.
2. Phase 2 (parse parity) depends on provider policy and telemetry introduced in Phase 1.
3. Phase 3 (dev/co-pilot parity) depends on shared provider registry and fallback controls.
4. Phase 4 (parallel opinions) depends on mature single/fallback stability and cost controls.

## Phase Checkpoints
Use these as lightweight completion checks.

### Checkpoint: Entry
1. Phase doc approved.
2. Feature flags reserved.
3. Test strategy accepted.

### Checkpoint: Midpoint
1. Primary happy path implemented.
2. Fallback/failure paths implemented.
3. Telemetry events emitted and validated.

### Checkpoint: Exit
1. Automated tests pass (unit + integration + route-level streaming tests).
2. Failure injection scenarios pass.
3. Rollback flag verified.
4. Acceptance checklist signed off.

## Canonical Runtime Invariants
1. Canonical providers:
   - `claude`
   - `chatgpt-5.3-codex-high`
2. Canonical modes:
   - `single`
   - `fallback`
   - `parallel` (only where phase explicitly enables)
3. All assistant outputs include provider provenance metadata.
4. Fallback decisions are deterministic and observable.
5. Feature flags guard every new execution mode.

## Reliability Targets (Local Practical)
1. Single-user experience should remain stable during normal usage.
2. Fallback should keep core workflows usable when one provider is unavailable.
3. Timeouts should prevent hung requests and allow retry/fallback.

## Cost Controls (Optional)
1. Keep request-level timeout caps for each provider/service.
2. Add soft usage/cost tracking if parallel mode usage grows.
3. Skip strict quotas unless they become necessary.

## Local Safety Baseline
1. No raw filesystem path passthrough from user input.
2. Keep current API key model optional for local convenience.
3. Provider stderr redaction for user-facing payloads.
4. Dev mode policy guards for tool execution.

## Feature Flag Matrix
1. `FEATURE_CHAT_PROVIDER_PARITY`
2. `FEATURE_CHAT_FALLBACK_MODE`
3. `FEATURE_PARSE_PROVIDER_PARITY`
4. `FEATURE_PARSE_PARALLEL_MODE`
5. `FEATURE_DEV_PROVIDER_PARITY`
6. `FEATURE_DEV_FALLBACK_MODE`
7. `FEATURE_COPILOT_PROVIDER_PARITY`
8. `FEATURE_COPILOT_FALLBACK_MODE`
9. `FEATURE_CHAT_PARALLEL_MODE`
10. `FEATURE_CHAT_PARALLEL_ACCEPT`

## Program Risks and Mitigations
1. CLI output schema drift.
   Mitigation: normalize adapters + parser tests with captured fixtures.
2. Provider-specific behavior mismatch.
   Mitigation: capability matrix and explicit unsupported-mode behavior.
3. Parallel mode cost growth.
   Mitigation: optional soft tracking and local caps if needed.
4. Operator ambiguity during outages.
   Mitigation: provider health route + runbook + simple status view.

## Definition of Program Complete
1. Either provider can run all intended services independently.
2. Either provider can fail without total service outage (fallback paths active).
3. Parallel mode exists for designated flows with deterministic acceptance semantics.
4. Operational controls, telemetry, tests, and rollback toggles are practical for local use.
