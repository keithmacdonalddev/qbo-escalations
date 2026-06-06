# Agents Page

The Agents page should be mission control for the specialist agent team inside
the operational intelligence platform.

It is not a prompt gallery and not a separate product area. It should help the
user understand which agents exist, what each one is responsible for, which
tools and memories they can use, how they hand work to each other, what changed
recently, and what needs human review before the user trusts the system.

1. Real Agent Mission Control
   The index should not just be a gallery. It should answer: what agents exist, which are healthy, which are stale, which are risky, and which need your
   attention.
2. Needs Attention Queue
   Add a first-class queue for:
   - prompt changed but not reviewed
   - runtime/model changed recently
   - tool access changed
   - no recent harness run
   - failed prompt save/version restore
   - degraded provider status
   - agent has no owner/review policy
3. Agent Map View
   The Map toggle should become real: show agents as nodes with workflow edges, tool dependencies, handoffs, and shared memory/context relationships.
4. Comparison Mode
   Let you compare two agents side by side:
   - role and prompt contract
   - tools
   - model/runtime
   - risk level
   - workflow ownership
   - latest activity
     This would be useful for agents that overlap, like triage vs chat vs copilot.
5. Operational Filters
   Current filters are a start. I’d add:
   - Review status
   - Prompt surface exists / missing
   - Runtime provider
   - Tool count
   - Risk level
   - Recently edited
   - Needs harness run

Agent Profiles

1. Profile as a Review Document
   Each profile should feel like an operational dossier:
   - identity and purpose
   - exact responsibilities
   - boundaries
   - what it must never do
   - tools it can use
   - workflows it participates in
   - escalation/handoff rules
   - recent changes
   - review status
2. Prompt Contract Panel
   Separate the raw prompt editor from a structured contract:
   - mission
   - input assumptions
   - output format
   - required guardrails
   - refusal/escalation triggers
   - deterministic vs model-assisted boundaries
     That makes it easier to review without reading a giant prompt every time.
3. Harness Results Page
   The Harness tab should eventually show actual test cases:
   - last run
   - pass/fail
   - regressions
   - screenshots/fixtures used
   - expected vs actual output
   - “run harness” action
     This is probably one of the highest-value next features.
4. Change Review Workflow
   Any edit to prompt/profile/runtime should create a review item:
   - what changed
   - who changed it
   - before/after diff
   - risk rating
   - approve/reject/needs follow-up
5. Tool Permissions Audit
   Profiles should show tool access as a permission matrix, not just a tag list:
   - read/write scope
   - dangerous actions
   - whether human confirmation is required
   - recent use
   - last failure
6. Agent Memory / Relationship View
   For this project specifically, agent identity and community matter. I’d make a dedicated section for:
   - memory notes
   - relationships to other agents
   - handoff style
   - collaboration rules
   - what the agent has learned from user corrections

Highest-Value Next Build
If I were picking the next concrete thing, I’d do this order:

1. Make the Map view real.
2. Add a Needs Attention queue.
3. Add prompt/profile/runtime diff review.
4. Add real harness result tracking.
5. Add tool permission matrix.

The biggest product unlock is the Needs Attention queue. It turns the Agents page from “where agent settings live” into “what needs review before something
breaks.”
