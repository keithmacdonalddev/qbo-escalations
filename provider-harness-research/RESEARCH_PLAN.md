# Provider Harness Research Plan

This plan is for agents researching one provider at a time.

The plan stops at response-package preservation. It does not design downstream parser behavior.

## Objective

Build one source-backed provider contract document per provider.

Each document should let a reader answer this question without guessing:

When this provider path responds, what exact package reaches the qbo-escalations server, and what would MongoDB need to store to preserve it?

## Non-Goals

Do not do these tasks:

- implement a provider harness
- implement a Mongo model
- edit server/client production code
- create tests
- change prompts
- parse the provider answer
- validate the provider answer
- normalize the provider answer
- decide whether the provider answer is useful
- design the next application step after storage

## Research Inputs

Each research agent gets:

- one provider id
- this folder
- the current qbo-escalations source tree
- official provider documentation if available

Each research agent produces:

- exactly one provider document in `provider-harness-research/providers/<provider-id>.md`

## Phase 1: Confirm The Provider Exists In This App

Goal:

Prove whether the provider id maps to a real current app path.

Actions:

1. Search the repo for the provider id and related aliases.
2. Search shared provider catalogs, server services, routes, env examples, and client provider selectors.
3. Record the exact id or ids the app uses.
4. If the provider id is not present, record that as a finding and identify the closest related paths.

Output:

- `Provider IDs In This App`
- initial entries for `Evidence`

Stop rule:

Do not rename the provider or invent a missing path. Document what exists.

## Phase 2: Trace The Current Call Path

Goal:

Find the source code that sends a request to the provider path.

Actions:

1. Locate the route, service, helper, or gateway client that starts the provider call.
2. Follow the call until the request leaves this app or reaches a local process/gateway.
3. Identify whether the path is direct HTTP, SDK, CLI/spawned process, local gateway, or OpenAI-compatible local server.
4. Capture source file paths and line numbers.

Output:

- `Current App Call Sites`

Stop rule:

Stop at the boundary where this app sends the provider request. Do not redesign the call.

## Phase 3: Document The Request Package Sent Today

Goal:

Document what this app sends to the provider path today.

Actions:

1. Capture request body shape, headers, options, endpoint URL shape, command args, stdin payload, env var names, and timeout.
2. Include model id, temperature, max tokens, reasoning effort, image payload, stream flag, and other provider options if present.
3. Do not include secret values.
4. If multiple modes exist, document each separately.

Output:

- `Request Package Sent Today`

Stop rule:

Do not propose better request fields. Document the current request package.

## Phase 4: Research The Documented Response Package

Goal:

Document what the provider or local process officially says it can return.

Actions:

1. Use official provider documentation where available.
2. For OpenAI-compatible local providers, document the compatibility shape and evidence for compatibility.
3. For CLI paths, document stdout, stderr, exit codes, JSON output modes, and streaming/event modes if documented.
4. Include success shape, error shape, usage metadata, request id fields, model id fields, finish/stop reason fields, and streaming events if documented.
5. Label official facts separately from source-code inference.

Output:

- `Official Response Package`
- `Streaming vs Non-Streaming`
- `Evidence`

Stop rule:

Do not use official docs to assume this app preserves fields. App preservation is proven only from current source.

## Phase 5: Identify The Raw Package That Reaches This Server

Goal:

Find the first provider response unit this server sees.

Actions:

1. Trace the response path back into qbo-escalations server code.
2. Identify the earliest variable that contains the provider response package.
3. Record whether that variable is raw body text, parsed JSON, SDK object, stream chunk, CLI stdout/stderr, exit result, or gateway response.
4. Record what fields are still present at that point.
5. Record what gets discarded before any later app normalization.

Output:

- `Raw Package That Reaches This Server Today`

Stop rule:

Do not keep tracing into parser validation or answer handling except to say where package fields are discarded.

## Phase 6: Propose A Preservation Record

Goal:

Describe the Mongo shape needed to preserve the provider package.

Actions:

1. Propose required fields for this provider path.
2. Propose optional fields for fields that may not always exist.
3. Include raw and parsed forms where both matter.
4. Include stream chunk ordering if streaming is used or supported by this app path.
5. Include error package preservation.
6. Include storage notes for large bodies, images, or long streams without turning those notes into implementation policy.

Output:

- `Proposed Mongo Storage Shape`

Stop rule:

Do not design indexes, retention, UI views, background jobs, or implementation classes. Keep this section to preservation fields and brief storage notes only.

## Phase 7: Record Gaps And Questions

Goal:

Make uncertainty visible instead of hiding it.

Actions:

1. List facts that could not be confirmed.
2. List assumptions separately from facts.
3. List docs that could not be found.
4. List source paths that look relevant but do not prove the provider path.

Output:

- `Gaps And Questions`

Stop rule:

Do not fill missing facts with guesses.

## Phase 8: Self-Check Before Handoff

Goal:

Make sure the document stays inside scope.

Checklist:

- The document covers exactly one provider id.
- The document includes current source references.
- The document separates official docs from source-code inference.
- The document says whether current code preserves or discards the full package.
- The document proposes storage fields for the full package.
- The document does not judge the model answer.
- The document does not extract the model answer.
- The document does not normalize the model answer.
- The document does not design downstream behavior.
- The document does not modify production app files.

Required final local check:

Run:

`git diff -- provider-harness-research/providers/<provider-id>.md`

Confirm that the only intended document change is the provider document assigned to that agent.

## Recommended Document Length

The provider document should be detailed enough that the call path does not need to be rediscovered.

Good target:

- short summary
- exact call site list
- concrete request package details
- concrete response package details
- raw package boundary
- proposed Mongo field list
- evidence and gaps

Avoid:

- generic provider summaries with no app source references
- long provider marketing descriptions
- downstream app designs
- parser behavior
- model-answer quality discussion
