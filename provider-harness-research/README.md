# Provider Harness Research

This folder is for provider-by-provider handoff research before implementation.

The narrow goal is to document how each provider response package reaches this app today, and what MongoDB would need to store to preserve that package for later inspection, debugging, and audit.

Start with `HANDOFF.md` if you have no prior chat context.

Use `RESEARCH_PLAN.md` for the step-by-step research procedure.

This is not parser-harness work.

## Boundary

In scope:

- Current app code paths that call a provider.
- The request package this app sends today.
- The full response package the provider path returns to this server.
- Official response schemas or documented CLI output formats.
- A provider-specific Mongo storage shape for preserving the full package.
- Gaps where source or official docs do not prove a fact.

Out of scope:

- Parser validation.
- Extracting the model answer.
- Judging whether the model answer is correct.
- Normalizing the answer into canonical escalation text.
- Designing downstream workflow behavior.
- Implementing code, tests, routes, UI, or Mongo models.

## Provider IDs

Use these provider ids unless current source proves a different app id:

- `anthropic-api`
- `anthropic-cli`
- `openai-api`
- `openai-cli`
- `gemini-api`
- `kimi-api`
- `lm-studio-openai-compatible`
- `llm-gateway`

Plain meaning:

- `*-api` means this app calls the provider through a direct HTTP/API-key path.
- `*-cli` means this app reaches the provider through a local command-line, spawned process, or login-backed local path.
- `lm-studio-openai-compatible` means this app talks to LM Studio using an OpenAI-compatible local API shape.
- `llm-gateway` means this app talks to the local gateway service. Separate the package qbo-escalations receives from any gateway upstream package, and only document upstream details that are visible to qbo-escalations.

## How To Use

Give one agent one prompt file.

For general providers, use:

- `provider-research-prompt.md`

Replace every `{PROVIDER_ID}` with the provider id before sending.

For the subscription/login-backed local command paths, use the specific prompts:

- `anthropic-cli-prompt.md`
- `openai-cli-prompt.md`

For the local gateway provider, use the specific prompt:

- `llm-gateway-prompt.md`

Each agent writes exactly one document:

`provider-harness-research/providers/<provider-id>.md`

Each agent should follow:

- `HANDOFF.md`
- `RESEARCH_PLAN.md`
- the prompt file for their assigned provider

## Required Output

Every provider document must cover only these questions:

1. What provider id does this app use?
2. What source path calls it?
3. What request package does this app send today?
4. What response package does the provider or local process document?
5. Does this app receive one response, a stream, or both?
6. What exact raw object/string/event reaches this server first?
7. What Mongo record shape would preserve that full package?
8. What facts are still unknown?

If a provider path does not exist in current source, the document should say that directly and list the closest related paths. It should not invent an implementation.
