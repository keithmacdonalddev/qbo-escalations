## -------------------------------------------------------------

Use this prompt for each provider agent. Replace {PROVIDER_ID} before sending.

Suggested provider assignments:

anthropic-api
anthropic-cli
openai-api
openai-cli
gemini-api
kimi-api
lm-studio-openai-compatible
llm-gateway

## ----------------------------------------------------------

You are researching one provider for the qbo-escalations provider-harness work.

Provider to research: {PROVIDER_ID}

Goal:
Create one provider contract document that explains exactly how this app currently calls this provider, what full
response package comes back to this server, and what MongoDB would need to store so we preserve that full provider
response package exactly enough for later replay/debug/audit.

Important scope:

- This is research and documentation only.
- Do not implement code.
- Do not edit production source files.
- Do not change tests.
- Do not design parser validation.
- Do not extract or judge the model answer.
- Stay focused on receiving and storing the provider response package.

Write your final document here:

provider-harness-research/providers/{PROVIDER_ID}.md

Research requirements:

1. Provider name used in this app

- List the exact provider id or ids this app uses for this provider.
- Include any aliases, catalog ids, or local provider names if present.
- If `{PROVIDER_ID}` is a research label and the app uses a different actual provider id, state both clearly:
  - Research provider id:
  - Actual app provider id:
- Do not rename source behavior to match the research label.

1. Current code path that calls it

- Identify every current source file/function that sends a request to this provider.
- Include clickable path-style references with line numbers in the document.
- Explain in plain English what each function does.
- Note whether the provider is called directly, through a local gateway, through an SDK, or through a CLI process.

1. Request format this app sends today

- Document the actual request body/headers/options this app builds.
- Include provider URL/endpoint shape.
- Include auth mechanism names only, not secret values.
- Include model, temperature, max token, image payload, streaming, and timeout fields if present.
- If the app supports multiple modes for this provider, document each mode separately.

1. Official/API response format to research

- Use official provider documentation where available.
- If the provider is local or OpenAI-compatible, document the compatibility format and where that is established.
- Include success response shape.
- Include error response shape.
- Include streaming chunk/event shape if applicable.
- Include usage/token metadata shape if documented.
- Include finish/stop reason fields if documented.
- Cite official docs URLs or local source evidence used.

1. Whether it returns one response or streams

- State whether this app currently uses non-streaming, streaming, or both for this provider.
- If streaming is possible but not currently used here, say that clearly.
- If this app does not currently use streaming for this provider, document the provider's official streaming response shape only as reference.
- Mark all streaming Mongo fields as optional/not-current unless current source proves this app receives streaming responses for this provider.
- Do not discuss enabling streaming, future flips to streaming, or future streaming architecture.
- For streaming, document what individual chunks/events look like and how the final response is detected.

1. What raw package reaches our server today

- Based on current code, identify the first raw object/string/event body that reaches this server after the provider
  responds.
- Do not skip to normalized app fields.
- Name the exact variable if visible in source, such as response body string, parsed JSON object, SDK message object,
  stdout text, SSE event, etc.
- State whether the current code preserves the full raw package or discards parts of it.

1. Mongo record needed to preserve the full provider package

- Propose the fields needed for this provider-specific Mongo record.
- The goal is full response-package preservation, not answer extraction.
- Include status code, headers, raw body text, parsed JSON, stream chunks, SDK message objects, CLI stdout/stderr,
  usage metadata, provider request id, model id, timestamps, and error payloads as applicable.
- Separate required fields from optional fields.
- If streaming, include how to store ordered chunks/events.
- If non-streaming, include how to store the full response body.
- Include size/cap concerns only as storage notes, not as implementation policy unless the provider docs require it.

1. Gaps and questions

- List anything that could not be confirmed from source or official docs.
- List assumptions separately from facts.
- Do not silently fill gaps.

Document format:

# {PROVIDER_ID} Provider Harness Contract

## Summary

## Provider IDs In This App

## Current App Call Sites

## Request Package Sent Today

## Official Response Package

## Streaming vs Non-Streaming

## Raw Package That Reaches This Server Today

## Proposed Mongo Storage Shape

## Gaps And Questions

## Evidence

Rules:

- Keep this document factual and source-backed.
- Clearly label official documentation facts vs inference from current app code.
- Do not include secret values.
- Do not modify anything outside `provider-harness-research/providers/{PROVIDER_ID}.md`.
- Before finishing, run `git diff -- provider-harness-research/providers/{PROVIDER_ID}.md` and make sure the only
  changed file is your provider document.
- In your final response, summarize the document you created and list any uncertainties.
