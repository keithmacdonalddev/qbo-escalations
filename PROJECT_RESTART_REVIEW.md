# QBO Escalations: Full Project Review and Restart Recommendations

## Bottom line

I would reset the architecture and product scope, but I would not throw this repository away.

The project contains unusually valuable domain knowledge: how evidence enters a case, how agents should reason over it, how uncertain conclusions should be shown, how human approval should work, how resolved cases become reusable knowledge, and how testing should distinguish “passed” from “not proven.” Recreating all of that from memory would lose years of useful thinking.

What I would not preserve is the current shape of the application. It has gradually become three things at once:

1. A QBO escalation product.
2. A general operational-intelligence platform.
3. A laboratory for agents, models, providers, prompts, testing, observability, Gmail, calendars, rooms, proactive monitoring, and UI experiments.

That combination has produced a sophisticated but overextended system. The project is now better at exposing its internal machinery than at giving the user one calm, obvious path through difficult work.

My recommendation is:

> Build a new “v2” around one trusted case workflow, reuse selected domain logic and tests, and migrate gradually. Do not perform a big-bang rewrite or delete the current repository.

The concise product promise should be:

> Turn messy evidence into a trusted next action, record what happened, and convert reviewed outcomes into reusable knowledge.

That supports the broader operational-intelligence vision in [PRODUCT_NORTH_STAR.md](PRODUCT_NORTH_STAR.md), while giving the first QBO module a sharply defined purpose.

---

## Current project assessment

| Area | Current assessment | What I would do differently |
|---|---|---|
| Product concept | Strong | Preserve the evidence-first, human-validated operating model. |
| Product focus | Overextended | Ship one complete case lifecycle before platform-wide collaboration and autonomy. |
| Core workflow | Valuable but buried | Make the case—not Chat, Agents, Rooms, or Workspace—the center of the product. |
| Agent architecture | Serious safety thinking, incomplete unification | Build one durable execution system before adding more agent surfaces. |
| Data architecture | Fast to extend, increasingly fragmented | Use a relational core with explicit transactions, migrations, and object storage. |
| UI visual quality | Often polished and information-dense | Simplify navigation, header, mobile structure, and progressive disclosure. |
| CSS architecture | In severe debt | Rebuild the design system without rescue/override layers. |
| Testing philosophy | Unusually honest and comprehensive | Fix the current broken gate and create faster verification layers. |
| Security | Reasonable for loopback-only local use | Make local-only mode explicit and refuse remote operation without real authentication. |
| Observability | Many useful records, no unified story | One request/run identity, one audit trail, durable errors, and user-visible diagnostics. |
| Repository hygiene | Poor | Separate product code, laboratories, screenshots, research, and generated evidence. |
| Developer experience | Good launcher intentions, missing ordinary baselines | Add README, CI, linting, formatting, type checking, migrations, and architecture decisions. |

The central imbalance is this:

> The agent/provider/testing machinery is becoming more mature than the everyday case-resolution experience it is supposed to serve.

That is intellectually impressive, but it is the wrong investment order for the product.

---

## What is already excellent and should be preserved

### 1. Evidence and provenance

The project takes “why did the AI say this?” seriously. Evidence, traces, provider records, hashes, validation results, and knowledge trust states are not treated as afterthoughts.

That is the right foundation for an operational system. The user should be able to see:

- What evidence was considered.
- What was missing.
- What the agent concluded.
- How confident it was.
- What changed after a retry or provider switch.
- What a human approved.
- What actually happened after an action.

Most AI products remain vague here. QBO Escalations has the beginnings of a genuinely trustworthy evidence chain.

### 2. The escalation-to-knowledge lifecycle

The idea that a resolved case can become a reviewed knowledge candidate is one of the strongest product decisions in the repository.

I would preserve the workflow, but simplify its data model and interface:

1. Case resolved.
2. System proposes reusable learning.
3. Human reviews private data, scope, evidence, and wording.
4. Knowledge is published.
5. Future cases show when and why it was reused.
6. Corrections propagate without rewriting history.

I would not start over with a generic knowledge-management product. I would start with this narrow, outcome-driven lifecycle.

### 3. Honest confidence boundaries

The test map and review documents frequently distinguish:

- Implemented.
- Tested in isolation.
- Browser-verified.
- Repeatedly stable.
- Incomplete.
- Not at confidence.

That vocabulary is a major strength. Keep it.

A system that says “not proven” is more valuable than a system that turns every green unit test into a claim of product readiness.

### 4. Human approval and agent permissions

The current unfinished work introduces valuable concepts:

- Versioned effective tool permissions.
- Exact action hashes.
- Approval tied to the precise proposed action.
- Durable run and attempt records.
- Output validation before success.
- Fail-closed behavior when server-owned evaluation is unavailable.

These are the right concepts. They should become part of one small execution kernel, rather than being spread across Chat, Rooms, Workspace, Knowledge, triage, and other loops.

### 5. Friendly local operation

Loopback-only defaults, the friendly launcher, explicit health distinctions, safe shutdown expectations, and redacted startup output are all worth retaining.

For a solo local application, “one command and a truthful status screen” is more useful than production infrastructure theater.

### 6. Design principles

[DESIGN.md](DESIGN.md) contains good principles:

- Calm operational console.
- Compact without feeling cramped.
- Evidence over decoration.
- Stable layouts.
- Progressive disclosure.
- Reduced-motion support.
- Screenshots as acceptance evidence.

The problem is not the design intent. It is that years of local fixes have accumulated underneath it.

---

## What I would leave out of a from-scratch first release

This does not mean every item is worthless. It means I would not allow it into the new core until the case workflow was complete, stable, and repeatedly used.

### Product surfaces I would defer

- Standalone Rooms.
- Standalone Workspace.
- Generic agent creation and profile editing.
- Proactive Gmail and Calendar monitoring.
- Background personal-assistant behavior.
- Live Call Assist.
- Copilot as a separate global product.
- Investigations as a separate top-level application.
- Gallery as a primary destination.
- Usage analytics as a primary destination.
- Prompt and playbook editing in the normal user interface.
- Provider discovery and provider management in the normal user interface.
- Generic Templates as a primary product area.
- Multiple atmospheric themes.
- General-purpose “work and life” automation before the first domain is solid.

Some of these could return under a secondary System or Labs area. They should not compete with completing a case.

### Engineering machinery I would not add initially

- Multiple independent agent orchestration loops.
- Coding-agent CLIs running as normal product providers.
- Full provider request and response capture by default.
- Process-local schedulers for important work.
- Parallel SSE and WebSocket systems without a clear need for both.
- Generic agent ontologies before the operating roles are proven.
- A vector database merely because the app contains AI.
- Microservices.
- Redis, Kafka, Kubernetes, or distributed infrastructure.
- A universal plugin system.
- Multiple overlapping browser test stacks.
- Theme override layers.
- Large binary screenshot collections in the Git repository.

The current `.env` documentation still says complete provider requests and responses are captured by default in [server/.env.example](server/.env.example). That is too broad for an application handling screenshots, emails, account data, and support evidence. Normal product calls should retain bounded metadata and validated outputs. Full payload capture should require an explicit diagnostic session with visible retention rules.

---

## The product I would build

### The primary workflow

```text
Evidence intake
      ↓
Case workspace
      ↓
Durable agent run
      ↓
Recommendation + evidence + uncertainty
      ↓
Human decision or approved action
      ↓
Verified outcome
      ↓
Reviewed knowledge candidate
```

Everything else should support that flow.

### The first release

A complete first release would do six things well:

1. Accept screenshots, text, notes, and structured case information.
2. Create one durable case with an evidence-completeness state.
3. Run parsing, known-issue retrieval, triage, and recommendation through one execution system.
4. Show the conclusion, supporting evidence, missing evidence, risks, and next action.
5. Record the human’s decision and the actual outcome.
6. Propose reusable knowledge for human review.

It would not try to be a generic team collaboration environment, personal assistant, agent builder, provider dashboard, and AI research console at the same time.

### Product success measures

I would measure:

- Time from evidence intake to a trusted recommendation.
- Percentage of cases with sufficient evidence.
- Percentage of recommendations accepted without correction.
- Human correction rate and why corrections happened.
- Time from recommendation to resolution.
- Percentage of published knowledge that is reused.
- Whether reused knowledge improved the later outcome.
- Failed, abandoned, duplicated, or outcome-unknown agent actions.

I would not use agent count, message count, provider count, or number of screens as measures of progress.

---

## Information architecture and UI/UX

The current sidebar has 14 primary destinations in [Sidebar.jsx](client/src/components/Sidebar.jsx). Most are implementation concepts rather than user goals:

- Chat
- Sessions
- Escalations
- Attention
- Knowledge
- Investigations
- Agents
- Playbook
- Templates
- Analytics
- Gallery
- Usage
- Workspace
- Rooms

That navigation requires the user to understand how the application was built before deciding where to go.

### New primary navigation

I would use three primary destinations:

#### Today

- Cases needing attention.
- Work currently running.
- Questions agents need answered.
- Recent completed work.
- Failed or outcome-unknown actions.

#### Cases

- All cases.
- Saved views and filters.
- The case workspace.
- New evidence intake.

#### Knowledge

- Review queue.
- Trusted knowledge.
- Corrections and conflicts.
- Reuse history.

A secondary System area would contain:

- Agent status and effective permissions.
- Provider configuration.
- Prompt evaluation.
- Traces and diagnostics.
- Usage and cost.
- Data retention.
- Integrations.
- Developer tools.

### The case workspace

The case workspace should be the product’s stable frame.

Desktop:

- Left: case facts, evidence, and completeness.
- Center: current recommendation, next action, and decision controls.
- Right: collapsible agent activity, provenance, and supporting details.

Mobile:

- One column.
- Sticky next-action area.
- Evidence and activity revealed as drawers or sections.
- No horizontal tab strip with truncated three-letter labels.
- No permanent multi-panel layout.

The current saved mobile Workspace evidence shows profile labels reduced to cryptic fragments; see [workspace-agent-permissions-architecture-hardening-mobile.png](test-results/workspace-agent-permissions-architecture-hardening-mobile.png). That is a sign the desktop information architecture was compressed instead of redesigned for mobile.

### Header

The normal header should contain only:

- Global search or command entry.
- Work/agent activity.
- Attention indicator.
- Settings/account.

Provider state, test controls, model selection, diagnostics, and developer status should appear only when relevant or in System.

### Chat

Chat should be a supporting interaction inside a case, not the application’s organizing concept.

The user should never have to wonder:

- Is this conversation a session, case, room, workspace thread, investigation, or escalation?
- Where did the generated recommendation go?
- Is this message saved as evidence?
- Is this agent working in the background?
- Does navigating away cancel it?

The case should own the conversation, evidence, run, recommendation, and outcome.

### Design-system rebuild

The client currently imports 12 application-wide CSS layers in [main.jsx](client/src/main.jsx).

There are 4,158 `!important` declarations, including 3,209 in `overhaul.css`. That file alone is 7,372 lines. This is no longer a conventional stylesheet; it is a second rendering system overriding the first one.

From scratch I would use:

- One tokens file for color, spacing, typography, radius, elevation, and motion.
- A small set of accessible primitives: button, field, modal, drawer, tabs, table, status, menu, toast.
- Component-scoped CSS, such as CSS Modules.
- One explicit responsive strategy.
- One maintained theme.
- Story or example states for hover, focus, loading, empty, error, disabled, and reduced motion.
- Automated accessibility checks.
- Screenshot comparisons for core desktop and mobile workflows.

I would not copy `overhaul.css` into v2. I would use current screenshots as visual references and rebuild the components cleanly.

---

## Application architecture

### Use a modular monolith

A modular monolith is one deployable application whose internal business areas have strict boundaries.

That is the right scale here. I would not use microservices.

Suggested structure:

```text
apps/
  web/
  api/

packages/
  domain/
    cases/
    evidence/
    runs/
    knowledge/
    actions/
  contracts/
  ai/
  ui/
  observability/

tests/
  integration/
  browser/
  fixtures/
```

The modules should communicate through explicit application services and typed contracts, not by importing arbitrary models and helper functions from one another.

### Keep React and Express

React, Vite, and Express are not the fundamental problems. Replacing frameworks would introduce work without fixing scope and boundaries.

I would use:

- React and Vite.
- Express 5.
- TypeScript throughout.
- Zod or an equivalent runtime validator for API and provider boundaries.
- A real router for URLs and route-level data loading.
- A query/cache library for server state.
- npm or pnpm workspaces for shared packages.

TypeScript would not magically improve the architecture, but it would make cross-module contracts, provider outputs, action envelopes, and test fixtures harder to accidentally drift.

### One agent execution kernel

The most important architectural change would be one execution path:

1. Create or reuse an idempotent AgentRun.
2. Acquire a database lease.
3. Record the exact agent, prompt, provider, model, tools, and input hashes.
4. Execute model/tool steps against a single overall deadline.
5. Validate the structured output.
6. Save evidence.
7. Produce a recommendation or proposed action.
8. Apply server-owned permission policy.
9. Require approval where necessary.
10. Execute through a constrained handler.
11. Verify the external result.
12. Save a receipt and terminal state.

Chat, Knowledge, case triage, and future Workspace behavior should call this kernel. They should not each own a variation of provider cleanup, fallback, cancellation, retries, tools, memory, and logging.

The unfinished current AgentRun work is large—[agent-run-service.js](server/src/services/agent-run-service.js) is more than 1,200 lines—but fresh source tracing shows it is still reached mainly by its own dispatcher and route, not by the main Chat, Room, or Workspace execution paths.

### Use provider-native structured tool calls

The current unfinished hardening replaces permissive action text with a strict JSON response envelope. That is safer, but it is still making the model write a protocol into its answer.

From scratch:

- Use each provider’s native function/tool-call facility.
- Validate arguments against a typed schema.
- Map the provider call to one immutable internal action format.
- Never derive permission from what the prompt says.
- Reject unknown tools and unknown fields.
- Give every run only the tools needed for that operation.
- Hash the exact proposal that the user approves.

### Provider boundary

The product should use one provider broker or gateway contract:

```text
Product → Provider broker → Anthropic/OpenAI/Google/local model
```

The product should know about capabilities such as:

- Text generation.
- Image understanding.
- Tool calls.
- Structured output.
- Reasoning evidence availability.
- Cancellation.
- Usage reporting.

It should not contain vendor-specific behavior throughout the case workflow.

I would keep a deterministic fake provider for tests and move provider comparison, model research, CLI experiments, and prompt laboratories out of the core product path.

Coding CLIs are especially risky as product providers because they inherit filesystem, environment, configuration, and tool assumptions intended for software development. If retained for local experiments, they should run in an isolated broker with an empty temporary working directory and no user/repository configuration.

### Deadline and cancellation

The current shared tool loop creates one deadline, but each model round still receives the full configured timeout in [agent-tool-loop.js](server/src/services/agent-tool-loop.js). That means multiple model rounds can exceed what the caller reasonably believes is the total deadline.

A new kernel should calculate a remaining budget before every provider or tool call:

```text
remaining = overall deadline - current time
```

Every sub-operation receives only that remaining time.

Cancellation should terminate:

- Provider work.
- Tool work.
- Heartbeats.
- Leases.
- Streaming.
- Any child operation.

It should then save a truthful terminal state: cancelled, timed out, failed, or outcome unknown.

### Fallback and evaluation

The current server explicitly has `SERVER_EVALUATION_AUTHORITY_IMPLEMENTED = false` in [agent-evaluation-contract.js](server/src/services/agent-evaluation-contract.js). Ordinary product fallback is therefore intentionally blocked.

That safety choice is reasonable, but it exposes the architectural incompleteness: “fallback is available” and “the server is allowed to trust the fallback result” are different things.

From scratch I would not expose automatic fallback until the server can evaluate:

- Whether a retry is safe.
- Whether the backup agent received equivalent context.
- Whether the output satisfies the same contract.
- Whether it contradicts already saved evidence.
- Whether a fallback action requires renewed approval.
- Whether comparison evidence was preserved.

---

## Data architecture

MongoDB helped the project grow rapidly, but the core domain now contains strong relationships and transactional rules:

- Case.
- Evidence.
- Claims.
- Runs and attempts.
- Recommendations.
- Approvals.
- Actions and receipts.
- Knowledge candidates.
- Published knowledge.
- Audit events.

I would use PostgreSQL with JSONB for bounded provider-specific details.

Why it matters here:

- Approval and execution can be committed atomically.
- Duplicate actions can be prevented with unique constraints.
- Leases can be acquired safely across processes.
- Case, evidence, and knowledge relationships can be enforced.
- Migrations make data-model changes explicit.
- Reporting does not require reconstructing truth across large nested documents and sidecar files.

Images and large payloads should go to object storage or a managed local evidence directory. The database should store:

- Content hash.
- Size and media type.
- Storage reference.
- Retention classification.
- Redaction state.
- Who added it.
- Which runs used it.

I would not use full event sourcing—the technique where every state is reconstructed from events. I would use normal relational tables plus an append-only audit log.

---

## Security and privacy

The default `HOST=127.0.0.1` in [server/.env.example](server/.env.example) is a good local boundary, but CORS and loopback binding are not authentication.

From scratch I would introduce two explicit operating modes.

### Local-only mode

- Default.
- Binds only to loopback.
- Refuses non-loopback binding unless authentication is configured.
- Uses an operating-system-backed secret store.
- Shows a visible “Local only” security status.
- Does not trust role headers.
- Does not retain raw provider payloads by default.

### Authenticated mode

Before remote or multi-user use:

- Real login and sessions.
- User and account scoping on every query.
- Roles enforced server-side.
- TLS.
- CSRF protection where applicable.
- Durable security audit events.
- Shared rate limiting.
- Secret rotation and revocation.
- Export, retention, and deletion controls.

### Data safeguards to add

- Data classifications: public, internal, customer-private, credential-like.
- Screenshot and email redaction.
- Provenance-aware outbound filtering.
- Explicit consent before sending private evidence to external providers.
- Retention windows by evidence type.
- A janitor for expired provider sidecars.
- An operator-visible deletion report.
- An incident-safe diagnostic export that strips secrets.

The current server production dependency audit also reports six advisories: three high and three moderate. Affected packages include Mongoose and transitive URL/IP/static-serving dependencies. I did not apply automatic fixes because dependency changes were outside this review and require regression testing.

---

## Observability and auditability

The project has useful pieces:

- AI traces.
- Usage logs.
- Provider call packages.
- Provider health.
- Image parsing records.
- Knowledge audit history.
- Runtime activity surfaces.

But they do not yet form one joined explanation of an incident.

The rebuild should assign one correlation identity to:

```text
Browser action
→ API request
→ case operation
→ agent run
→ provider attempt
→ tool proposal
→ approval
→ external execution
→ receipt
```

I would add:

- Structured, redacted logs.
- A durable client/server error store.
- Actor-aware audit events.
- One agent-run timeline.
- Provider capture status on each run.
- Runtime configuration snapshots without secrets.
- A diagnostics page that answers “what happened?” without opening a terminal.
- Downloadable diagnostic packages with privacy filtering.
- Health checks that separate required, optional, unconfigured, degraded, and failed.

The existing [OBSERVABILITY_REVIEW.md](OBSERVABILITY_REVIEW.md) identifies many of these gaps. Its recommendations should be converted into the new execution/data design, not layered onto every existing route separately.

---

## Testing and engineering quality

The testing philosophy is one of the strongest parts of the project, but the current tree is not green.

I ran `npm run verify:core` against the current worktree. The result was incomplete:

- Client behavior tests: passed.
- Stress-harness infrastructure: passed.
- Verification-runner contracts: passed.
- Friendly startup contracts: passed.
- Server files: 128 discovered, 125 passed, 2 failed, 1 timed out.
- Capability-map validation: failed.
- Client production build: passed.
- Client production dependency audit: zero findings.
- Root production dependency audit: zero findings.
- Server production dependency audit: six findings.

The server failures were:

- `abort.test.js`: provider cleanup/cancellation assertions fail.
- `agent-run-service.test.js`: all seven tests fail because test setup does not supply the newly required `purpose`.
- `usage-integration.test.js`: timed out after 120 seconds.
- The capability map does not include `ScreenshotEditor.test.js` or `provider-reasoning-evidence.test.js`.

The exact result is in [summary.json](test-results/app-check/2026-08-03T20-26-00-402Z-209c11d1/summary.json).

### New verification layers

I would split testing into clear levels.

#### Fast change gate

- Formatting.
- Linting.
- Type checking.
- Contract/schema tests.
- Pure domain tests.
- Capability-map validation.

This should give feedback quickly.

#### Core workflow gate

- Database-backed case lifecycle.
- Evidence ingestion.
- AgentRun state transitions.
- Cancellation and deadlines.
- Approval and idempotency.
- Knowledge publication.
- Client behavior tests.
- Production build.

#### Browser acceptance gate

- Evidence upload through resolution.
- Failed parse and retry.
- Navigation away and reattachment.
- Hard reload and resume.
- Desktop and mobile layout.
- Keyboard navigation.
- Accessibility.
- Browser console errors.

#### Long confidence gate

- Live-provider checks with controlled accounts.
- Provider/model comparison.
- Multi-tab and disconnect/reconnect.
- Repeated runs.
- Large-list pressure.
- Fault injection.
- External action receipt verification.

I would use one deterministic browser system for CI. Agent-browser can remain the acceptance/exploratory tool; if its transport cannot reliably run in CI, a deterministic Playwright layer should own CI while agent-browser remains the human-style review tool.

---

## Repository and developer experience

The repository currently has:

- 1,629 tracked files.
- 92 modified tracked files.
- 4,987 inserted and 1,669 deleted lines in the current uncommitted patch.
- 25 untracked status entries.
- 256 tracked review screenshots occupying roughly 294 MiB in the working directory.
- A Git pack of roughly 149 MiB.
- No root README.
- No CI workflow.
- No lint configuration.
- No formatting configuration.
- No TypeScript configuration.
- No SECURITY, CONTRIBUTING, or LICENSE file.
- No normal migration framework.

The `.gitignore` contains `review-screenshots/`, but the screenshots are already tracked, so ignoring the directory does not remove them from Git history.

### What I would add immediately in v2

- `README.md`: product purpose, privacy boundary, start command, URLs, architecture, limitations.
- CI workflow.
- Type checking.
- Linting and formatting.
- Database migrations.
- Seeded synthetic cases.
- Architecture decision records—short documents explaining important choices.
- Security and data-retention documentation.
- A changelog or release-evidence record.
- Automated dependency updates.
- A clean example environment file.
- One command for development and one read-only status command.

### What belongs outside the main product repository

- Large rendered screenshot archives.
- Old prototypes.
- Provider research.
- Stress-run outputs.
- Playwright/MCP experiment artifacts.
- Parser-hardening research snapshots.
- Prompt experiments that are no longer active.
- Full provider payloads.

Stable fixtures can remain small and intentional. Large evidence should live in CI artifacts, object storage, Git LFS, or a separate testing-assets repository.

---

## The current dirty architecture patch

This is the most urgent present-day issue.

The working tree contains a 92-file, uncommitted authority/privacy/durable-run redesign. It includes useful ideas, but current verification proves it is not ready to treat as a finished foundation.

Confirmed current limitations include:

- AgentRun is not the universal live execution path.
- AgentRun tests are broken.
- Server-owned evaluation authority is still disabled.
- Overall agent deadlines are not consistently budgeted across model rounds.
- Some important live/background state remains process-local.
- Test mapping has drifted.
- Provider payload retention remains unfinished.
- Documentation and environment examples do not fully match the changed capture policy.
- The server suite is not green.

I would not revert this patch broadly, and I would not copy it wholesale into v2.

I would first divide it into reviewable concepts:

1. Tool capability enforcement.
2. Action proposal and approval integrity.
3. Provider capture/privacy policy.
4. AgentRun persistence.
5. Durable dispatcher.
6. Evaluation/fallback authority.
7. Room and Workspace trust boundaries.
8. Documentation and test-map changes.

Each should receive its own diff, tests, and acceptance decision. That protects the valuable security work without permanently adopting unfinished architecture.

---

## Recommended restart strategy

### Phase 0: Preserve and classify

Before writing v2:

- Freeze unrelated feature growth.
- Identify ownership of the current dirty patch.
- Export or back up current data.
- Record the current QBO workflow as executable acceptance scenarios.
- Catalogue which tests describe real product behavior versus internal implementation.
- Mark features as keep, defer, retire, or research-only.

### Phase 1: Build one vertical case slice

Implement:

- Case creation.
- Evidence upload.
- Parsing.
- Recommendation.
- Human outcome.
- Persistence and reload.
- One agent provider plus a fake test provider.

No Knowledge, Rooms, Workspace, proactive integrations, or generic agent management yet.

### Phase 2: Add trustworthy execution

Implement:

- Durable AgentRun.
- Attempts and deadlines.
- Cancellation.
- Server-enforced capabilities.
- Validated outputs.
- Provider evidence.
- Idempotency.
- Audit timeline.
- Error recovery.

### Phase 3: Add the knowledge lifecycle

Implement:

- Knowledge candidate generation.
- Human review.
- Redaction.
- Publication.
- Reuse.
- Correction and retirement.
- Clear provenance back to cases.

### Phase 4: Add carefully selected platform capabilities

Only after repeated use shows need:

- Today/Attention center.
- External integrations.
- Approved actions.
- Collaboration.
- Domain modules beyond QBO.
- Custom agents.
- Proactive monitoring.

Each addition should integrate into Cases, Runs, Evidence, Actions, and Knowledge. It should not create another parallel product.

### Phase 5: Migrate gradually

- Run v1 and v2 side by side.
- Import selected historical cases.
- Compare recommendations and evidence.
- Port vetted tests.
- Move real work only when v2 completes the entire workflow reliably.
- Keep v1 read-only until its data has been verified in v2.
- Archive v1 rather than deleting it immediately.

---

## My prioritized recommendations

### Do now

1. Stop adding broad new features until the 92-file patch is reconciled.
2. Restore a green core verification gate.
3. Address the server dependency advisories.
4. Decide whether to create v2 as a new repository or a clean long-lived branch.
5. Write the v2 product boundary before choosing more technology.

### Do next

6. Build the case-centered vertical slice.
7. Create the single durable execution kernel.
8. Introduce typed contracts and a relational database.
9. Rebuild the UI around Today, Cases, and Knowledge.
10. Establish authentication/privacy boundaries before remote use.

### Defer

11. Rooms, generic Workspace, proactive email/calendar activity, generic agents, live calls, multiple themes, and broad platform automation.
12. Advanced distributed infrastructure.
13. Provider/model breadth beyond what the case workflow demonstrably needs.

---

## Final verdict

The project should not be considered a failed prototype. It is a productive research program that discovered many of the requirements a trustworthy operational-intelligence product actually needs.

Its problem is that too many discoveries were promoted directly into the product:

- Every capability became a surface.
- Every surface acquired its own orchestration.
- Every visual problem gained another CSS layer.
- Every provider gained direct integration paths.
- Every trust concern gained another record or policy seam.
- Experiments, evidence, product code, and governance stayed together.

Starting over should therefore be a process of subtraction and consolidation, not a chance to add a newer framework.

The most important architectural decision is one case model and one agent execution kernel.

The most important product decision is that the case is the product; agents, chat, knowledge, providers, traces, and automation are supporting capabilities.

The most important UI decision is to expose the next trustworthy action first and reveal implementation evidence only when the user needs it.

The most important engineering decision is to migrate incrementally and use the current repository as a behavioral specification—not as a template to copy.

No source or configuration changes were made during the review. The verification command generated its normal `test-results` evidence. The app was not running on its configured client/server ports, and the available browser session was blank, so current live desktop/mobile rendering remained unverified. UI conclusions were based on current source and saved acceptance screenshots, not a claim that the working tree passed the live visual gate.

Older project notes were used only to locate the unfinished agent-architecture and testing work. Those historical notes may be stale; all current-state claims in this report were checked again against the present files, Git state, runtime state, and fresh tests.
