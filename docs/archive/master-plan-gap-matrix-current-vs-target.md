# Provider Independence Gap Matrix (Code-Validated)

## Purpose
This document maps:
1. Original intent (`docs/plan.md` + `docs/handoff-session-1.md`)
2. Current implementation state
3. Target state across Phases 1-4

It is the control document for scope, sequencing, and completion validation.

## User Intent Snapshot (Consolidated)
1. Choose Claude or Codex at any time.
2. Make Codex fully independent end-to-end, not partial.
3. Ensure either provider can continue when the other is down.
4. Achieve feature parity in all operating modes (chat, parse, dev, co-pilot).
5. Support parallel model opinions and user acceptance of best output.
6. Keep escalation workflow quality and reliability equal or better than Claude-only baseline.
7. Keep architecture appropriate for local single-user use, without security overengineering.

## Current State (Validated from Code)

### A. Implemented
1. Chat provider selector exists in UI and API (`client/src/components/Chat.jsx`, `server/src/routes/chat.js`).
2. Conversation model stores provider on assistant messages (`server/src/models/Conversation.js`).
3. Codex chat subprocess exists and streams text (`server/src/services/codex.js`).
4. Role-based API key auth exists for protected routes (`server/src/middleware/authz.js`).
5. Screenshot attachment/dedup pipeline exists for escalations (`server/src/routes/escalations.js`).
6. Dev conversation persistence exists (`server/src/models/DevConversation.js`, `server/src/routes/dev.js`).

### B. Partially Implemented
1. Chat provider choice exists, but fallback policy is not implemented.
2. Warm-up exists for both providers, but no provider health API, no circuit breaker.
3. Export labels provider, but no fallback provenance metadata.
4. Dev mode persists sessions, but remains Claude-only execution path.

### C. Missing for Target Vision
1. No bidirectional chat fallback (Claude->Codex and Codex->Claude).
2. No provider-agnostic parse orchestrator.
3. `/api/chat/parse-escalation` is Claude-only.
4. `/api/escalations/parse` is Claude-first + regex text fallback only.
5. Dev mode has no Codex provider path.
6. Co-pilot routes are Claude-only (`server/src/routes/copilot.js`).
7. No parallel opinion mode, candidate store, or acceptance endpoint.
8. No cross-provider orchestration telemetry, advanced reliability tracking, or cost guardrails.

## Original Plan/Handoff vs Reality

### From `docs/plan.md`
1. Original architecture was Claude-centric; provider independence was not designed in as a first-class concern.
2. It assumed stateless CLI prompt routing but did not define multi-provider control plane.
3. It had no formal fallback mode contracts.

### From `docs/handoff-session-1.md`
1. Claims broad feature completion, but now outdated against current provider-independence goals.
2. It documented known issues from that session; several are already addressed in current code.
3. It does not define a path for dual-provider orchestration and acceptance workflows.

## Phase Mapping (Gap -> Delivery)

### Phase 1: Provider Foundation + Chat Fallback Parity
Closes:
1. Chat fallback absence.
2. No provider health/circuiting.
3. No deterministic chat runtime policy.

### Phase 2: Provider-Independent Parsing
Closes:
1. Claude-only parse paths.
2. Missing parse validation orchestration.
3. Missing parse metadata/audit trail.

### Phase 3: Full-Service Provider Parity (Dev + Co-pilot)
Closes:
1. Dev mode Claude lock-in.
2. Co-pilot Claude lock-in.
3. Missing fallback in non-chat AI services.

### Phase 4: Parallel Opinions + Acceptance
Closes:
1. No parallel opinion execution.
2. No candidate acceptance semantics.
3. No partial-failure tolerant multi-answer UX.

## Cross-Phase Non-Functional Targets
1. Availability: user-visible AI operation success >= 99.0% per 7-day rolling window.
2. Latency: single/fallback P95 <= 45s for chat and parse.
3. Degradation: if one provider is unhealthy, degraded mode remains functional with alternate provider.
4. Cost: parallel mode usage/spend should be trackable if needed.
5. Auditability: every AI output records provider provenance and decision path.

Local-first interpretation:
1. These are guidance targets for local quality.
2. Keep only controls that improve your day-to-day workflow reliability.

## Program-Level Risks
1. CLI stream format drift (Claude/Codex output schema changes).
2. Token/context growth from playbook injection.
3. Inconsistent tool semantics between providers in Dev mode.
4. Cost escalation in parallel mode without controls.
5. User confusion when fallback/parallel semantics are not explicit in UI.

## Governance Rule
A phase is not complete until:
1. Code is implemented.
2. Automated tests and failure injection pass.
3. Operational visibility and rollback toggles are live.
4. Acceptance criteria in phase doc are signed off.
