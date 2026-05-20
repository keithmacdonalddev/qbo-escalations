# OpenAI CLI Provider Research Prompt

You are researching one provider for the qbo-escalations provider-harness work.

Provider to research: openai-cli

Before starting, read:

- provider-harness-research/HANDOFF.md
- provider-harness-research/RESEARCH_PLAN.md
- provider-harness-research/providers/_template.md

These files are required context, not optional references. If you cannot access them in your environment, stop and ask for the handoff files before doing the research.

Local meaning of `openai-cli` in this application:

`openai-cli` means the application reaches OpenAI through a local command-line or login-backed subscription path, not through the direct OpenAI HTTP API key path. Treat this as a provider path where this app launches or talks to a local OpenAI command process and receives whatever that process returns.

Do not assume this is the same as `openai-api`.

Do not assume this is the same as `codex` unless the current app source proves that the app is actually invoking Codex for this provider path.

Your job is to document what this app actually does today. If the app currently uses a local OpenAI command, SDK wrapper, spawned process, stdout/stderr, JSON output mode, or any other CLI-adjacent path, document the exact path and what raw package reaches this server.

Deterministic stopping point:

provider path returns package -> app server receives package -> proposed Mongo record preserves package

Goal:
Create one provider contract document that explains exactly how this app currently calls this provider, what full response package comes back to this server, and what MongoDB would need to store so we preserve that full provider response package exactly enough for later inspection/debug/audit.

Important scope:

- This is research and documentation only.
- Do not implement code.
- Do not edit production source files.
- Do not change tests.
- Do not design parser validation.
- Do not extract or judge the model answer.
- Do not normalize the model answer.
- Do not design downstream behavior after storage.
- Stay focused on receiving and storing the full provider response package.
- If official vendor documentation does not support a general subscription-backed application API, say that clearly as a finding. Still document what this app currently invokes locally.

Write your final document here:

provider-harness-research/providers/openai-cli.md

Research requirements:

1. Provider name used in this app

- List the exact provider id or ids this app uses for this provider.
- Include any aliases, catalog ids, local provider names, environment variables, or UI labels if present.
- State clearly whether the current code calls it `openai-cli`, `codex`, `openai-sdk`, or something else.
- If `openai-cli` is only a research label and the app uses a different actual provider id, state both clearly:
  - Research provider id:
  - Actual app provider id:
- Do not rename source behavior to match the research label.

2. Current code path that calls it

- Identify every current source file/function that sends a request to this provider path.
- Include clickable path-style references with line numbers in the document.
- Explain in plain English what each function does.
- Note whether the provider is called through a spawned CLI command, a local SDK wrapper, a local gateway, or another local process.
- If there is no current implementation for `openai-cli`, state that directly and list the closest related code paths.

3. Request package this app sends today

- Document the actual prompt/request/options this app passes into the local command or wrapper.
- Include command name, command args, stdin payload, env var names, model, reasoning effort, temperature, max token, image payload, streaming, and timeout fields if present.
- Include auth mechanism names only, not secret values.
- If the app supports multiple modes for this provider, document each mode separately.

4. Official/vendor response format to research

- Use official OpenAI documentation where available.
- If the path is a CLI command, document the documented CLI output modes and error output modes.
- If the path is really Codex or another OpenAI product, document that product accurately and say why it applies.
- Include success response shape.
- Include error response shape.
- Include streaming chunk/event shape if applicable.
- Include usage/token metadata shape if documented.
- Include finish/stop reason fields if documented.
- Cite official docs URLs or local source evidence used.

5. Whether it returns one response or streams

- State whether this app currently uses non-streaming, streaming, or both for this provider path.
- If streaming is possible but not currently used here, say that clearly.
- If this app does not currently use streaming for this provider path, document the official streaming response shape only as reference.
- Mark all streaming Mongo fields as optional/not-current unless current source proves this app receives streaming responses for this provider path.
- Do not discuss enabling streaming, future flips to streaming, or future streaming architecture.
- For streaming, document what individual chunks/events look like and how the final response is detected.

6. What raw package reaches our server today

- Based on current code, identify the first raw object/string/event body that reaches this server after the provider process responds.
- Do not skip to normalized app fields.
- Name the exact variable if visible in source, such as stdout text, stderr text, parsed JSON object, SDK message object, SSE event, response body string, etc.
- State whether the current code preserves the full raw package or discards parts of it.

7. Mongo record needed to preserve the full provider package

- Propose the fields needed for this provider-specific Mongo record.
- The goal is full response-package preservation, not answer extraction.
- Include command, args, stdin payload reference, stdout, stderr, exit code, parsed JSON if any, stream chunks, SDK message objects, usage metadata, provider request id, model id, timestamps, duration, and error payloads as applicable.
- Separate required fields from optional fields.
- If streaming, include how to store ordered chunks/events.
- If non-streaming, include how to store the full stdout/stderr/response body.
- Include size/cap concerns only as storage notes, not as implementation policy unless the provider docs require it.

8. Gaps and questions

- List anything that could not be confirmed from source or official docs.
- List assumptions separately from facts.
- Do not silently fill gaps.

Document format:

# openai-cli Provider Harness Contract

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
- Do not modify anything outside `provider-harness-research/providers/openai-cli.md`.
- Before finishing, run `git diff -- provider-harness-research/providers/openai-cli.md` and make sure the only changed file is your provider document.
- In your final response, summarize the document you created and list any uncertainties.
