# Provider Research Documents

Each file in this folder should cover exactly one provider id.

These documents support provider evidence and provenance for the operational
intelligence platform. They should prove what reached this server, not decide
whether the model answer was correct or what the app should do next.

Required filename:

`<provider-id>.md`

Examples:

- `anthropic-api.md`
- `anthropic-cli.md`
- `openai-api.md`
- `openai-cli.md`
- `gemini-api.md`
- `kimi-api.md`
- `lm-studio-openai-compatible.md`
- `llm-gateway.md`

Each document must stay inside this boundary:

provider path returns package -> app server receives package -> proposed Mongo record preserves package

Do not include parser decisions, model-answer judgment, answer extraction, normalization, UI behavior, or implementation changes.
