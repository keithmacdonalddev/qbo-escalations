# PLAN — qbo-escalations Stress Testing

Index and implementation sequence for the repo-aligned stress harness.

## Mission

Build a stress-testing system that validates correctness, capacity, recovery behavior, and long-run stability for the actual qbo-escalations product surfaces:

- escalation APIs and knowledge workflows
- image intake and parse flows
- main chat and conversations
- workspace assistant
- multi-agent rooms
- Gmail and Calendar connectors
- runtime, traces, usage, and provider health
- major React client surfaces

## Confidence tiers

### Implementation-ready

We can start coding harnesses without re-litigating system boundaries.

Required:

- slices reflect the real repo
- harness environment strategy is written
- contract formats are defined for sync, streaming, and side-effectful flows
- implementation order is risk-ranked

### Ship-confidence

Core product paths have repeatable burst + soak coverage and correctness checks.

Required:

- `escalation-domain`
- `image-intake-and-parse`
- `main-chat`
- `workspace-assistant`

### Sleep-confidence

All applicable slices have burst, soak, relevant failure-shape coverage, and validated harnesses.

Required:

- all slices below covered
- harness validation in place
- stale baselines and skipped shapes treated as active confidence gaps

## Repo reality

The harness must be designed around these facts:

1. The server is an Express + MongoDB app, not a stateless HTTP layer.
2. Several critical paths are SSE or multi-step action loops, not single JSON responses.
3. Gmail and Calendar are real Google integrations with OAuth and token refresh behavior.
4. Image parsing uses local file handling, provider fallbacks, and trace/usage logging.
5. The repo already has runtime health, provider health, usage, traces, and grouped test execution surfaces that should be reused.
6. Prompt and playbook edits can change runtime behavior without a dependency change.

## Slices under test

| Slice | Purpose | Priority |
|---|---|---|
| `escalation-domain` | CRUD, search, knowledge, investigations, templates, playbook-backed escalation workflows | Wave A |
| `shipment-domain` | shipment CRUD, carrier detection, email scanning, context injection, and workspace shipment tools | Wave A |
| `image-intake-and-parse` | screenshot upload, parse orchestration, image parser history, archive, and provider fallback | Wave A |
| `main-chat` | `/api/chat`, conversations, retry, parallel decisioning, and chat-side tool loops | Wave B |
| `workspace-assistant` | workspace action loop, memory, briefings, alerts, auto-actions, and agent sessions | Wave B |
| `room-orchestration` | multi-agent rooms, room memory, realtime events, and room agent coordination | Wave B |
| `connected-services` | Gmail, Calendar, and Google-auth-backed operational flows | Wave C |
| `runtime-and-observability` | startup, health, traces, usage, provider health, realtime, config, and shared runtime safety | Wave C |
| `client-surfaces` | React app shells and high-churn UI paths across dashboard, chat, workspace, rooms, image parser, and settings | Wave C |

## Cross-cutting rules

### Reuse before rebuild

The harness should integrate with or wrap:

- `/api/runtime/health`
- `/api/health/providers`
- `/api/usage/*`
- `/api/traces/*`
- `/api/test-runner/*`

### Hermetic where it matters

Baselines are invalid unless the harness can control or stub:

- provider calls
- Gmail and Calendar behavior
- shipment lookups
- background schedulers and monitors
- startup warmups

### Contract shapes

The harness must support more than request/response fixtures:

- JSON request/response
- SSE transcript assertions
- workflow step assertions across action rounds
- persistence and side-effect assertions
- client render/state assertions

### Trigger policy

The following all count as behavior-changing events:

- server or client code edits
- prompt edits
- playbook edits
- provider configuration changes
- dependency upgrades
- environment/runtime flag changes

## Test shapes

### Core shapes

- `contract-replay`: deterministic correctness checks at low concurrency
- `burst`: short high-load runs on priority paths
- `soak`: long-running stability runs

### Failure and capacity shapes

- `spike`
- `ramp`
- `brownout`
- `chaos`
- `restart-recovery`
- `concurrency-race`
- `boundary`
- `data-scale`
- `traffic-replay` when safe capture exists

### AI-specific shapes

Applied to `main-chat`, `workspace-assistant`, `room-orchestration`, and AI-dependent portions of `image-intake-and-parse` and `escalation-domain`:

- golden-set regression
- output and tool-call drift
- provider fallback correctness
- timeout / 429 / malformed-stream recovery
- long-conversation stability
- hallucination and entity-fabrication guard
- prompt / playbook change regression

## Phase order

1. **[Phase 1](phases/phase-1-foundations.md)** — repo alignment and slice boundaries
2. **[Phase 2](phases/phase-2-harness-infrastructure.md)** — harness platform and hermetic environment
3. **[Phase 3](phases/phase-3-contract-definition.md)** — contract model and fixture capture
4. **[Phase 4](phases/phase-4-burst-soak.md)** — wave A harnesses: escalation-domain and image-intake-and-parse
5. **[Phase 5](phases/phase-5-extended-shapes.md)** — wave B harnesses: main-chat, workspace-assistant, room-orchestration
6. **[Phase 6](phases/phase-6-ai-stress-tests.md)** — wave C harnesses plus AI regression suites and connected-service coverage
7. **[Phase 7](phases/phase-7-harness-validation.md)** — extended failure shapes, capacity, and recovery testing
8. **[Phase 8](phases/phase-8-automation-triggers.md)** — harness validation, automation, and repo triggers
9. **[Phase 9](phases/phase-9-operations.md)** — operations, cadence, and confidence governance

## Hard dependencies

- Phase 2 depends on phase 1. Slice boundaries drive harness ownership and environment shape.
- Phase 3 depends on phase 2. Contract formats must match the real harness adapters.
- Phase 4 depends on phases 2 and 3.
- Phase 5 depends on phases 2 and 3, and should reuse lessons from phase 4.
- Phase 6 depends on stable provider stubs and shared harness helpers from phases 2 through 5.
- Phase 7 depends on at least one implemented harness wave.
- Phase 8 depends on phase 7. Do not automate an untrusted harness.
- Phase 9 depends on all prior phases.

## Exit criteria

### Ready to start implementation

All true:

- this planning package matches the repo
- starter slice and contract scaffolding exists
- phase order and harness ownership are explicit
- the next task is writing harness code, not re-scoping the plan

### Sleep-confidence achieved

All true at the same time:

- every active slice has passing core-shape coverage
- every AI-heavy slice has passing golden-set and failure-mode coverage
- every applicable failure shape is either passing or explicitly marked as a confidence gap
- harness validation is green enough to trust red and green results
- baselines are current
- no open critical item remains in `FEEDBACK.md`
