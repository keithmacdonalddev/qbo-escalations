# Plan schema

Every plan produced by this skill follows this structure. The schema is the contract between planning and review: the cto-review skill expects these sections in roughly this shape.

## Required sections

### 1. Problem

One to three sentences. What situation exists today that this feature changes? Who is affected, how often, and how painful is the current state?

Not: "We need a new dashboard."
Instead: "Admin users currently have no way to see aggregated revenue across accounts. They export data weekly and build pivot tables manually, costing roughly two hours per week and introducing calculation errors."

### 2. Scope

#### In scope
Bulleted list of what this feature includes.

#### Out of scope
Bulleted list of things someone might assume are included but aren't. Being explicit here prevents scope creep and reviewer confusion.

#### Deferred
Items that will be built later but are worth noting now. Tag each with `[deferred]`. The review skill excludes these from Plan Fidelity checks.

### 3. Acceptance criteria

Numbered list of testable statements. Each should be verifiable without interpretation.

Not: "Email change works correctly."
Instead: "User can submit a new email from Settings. The system sends a verification email to the new address with a link that expires after one hour. Clicking the link updates the account email and logs the change to the audit trail."

These criteria become the Plan Fidelity checklist during cto-review. Every Missing item is at minimum a High-severity finding.

### 4. Technical approach

#### Data flow
Walk through the main user journey from trigger to final state, naming files and functions involved. Arrow diagrams are encouraged.

#### Files to create
New files, each with a one-line purpose description.

#### Files to modify
Existing files, each with a note on what changes.

#### Key decisions
Choices made and the reasoning. These help future developers (and the reviewer) understand why the implementation looks the way it does.

### 5. Risks and edge cases

At least three. Each should include:

- **What could go wrong** — the specific failure mode.
- **What happens if it does** — user impact, data impact, security impact.
- **How the implementation will handle it** — the plan's response.

### 6. Exceeds bar

What would make this implementation exceed, not just meet, the ask?

Concrete examples:

- Specific, actionable error messages mapped to each failure mode, not a generic "something went wrong."
- Loading, empty, and error states handled on all UI surfaces.
- Structured logging with correlation IDs threaded through the request.
- Code organized to make the next related feature easier to add.

This section feeds directly into the cto-review skill's Exceeds Expectations assessment.

## Optional sections

### Dependencies

What must ship before this? What will this unblock?

### Migration

If schema, data, or configuration changes are required, how will they roll out safely? What's the rollback plan?

### Testing strategy

What tests will be written? What manual scenarios will be verified? What's the minimum evidence that this works in production?

### Rollout

If the feature should be gated behind a flag or rolled out progressively, note it here.
